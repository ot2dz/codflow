/**
 * Orders Validation Schemas
 * 
 * Zod schemas for request validation.
 */

import { z } from "zod";
import { parseOrderCursor } from "../../../../cod-shared/queries/orders";
import { toLocalAlgerianMobile } from "@/endpoints/store-otp/phone";

export const createOrderSchema = z.object({
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  phone: z.string().regex(/^0[5-7]\d{8}$/, "Invalid Algerian phone number"),
  wilayaId: z.number().int().min(1).max(58),
  communeId: z.string().min(1, "Commune is required"),
  city: z.string().nullish(),
  address: z.string().nullish(),
  price: z.number().positive(),
  notes: z.string().nullish(),
  orderType: z.enum(["online", "offline"]).default("online"),
  deliveryType: z.enum(["home", "stop_desk"]).default("home"),
  /** Optional explicit fee — for offline/dashboard orders. Online orders ignore this and auto-resolve from shipping profile. */
  deliveryFee: z.number().min(0).optional(),
  companyId: z.string().min(1).nullish(),
  products: z.array(
    z.object({
      productId: z.string().min(1),
      productName: z.string(),
      variantId: z.string().min(1).nullish(),
      variantLabel: z.string().nullish(),
      quantity: z.number().int().positive(),
      pricePerUnit: z.number().positive(),
      lineTotal: z.number().positive(),
    })
  ).min(1, "At least one product is required"),
}).superRefine((data, ctx) => {
  if (data.deliveryType === "home" && !data.address?.trim()) {
    ctx.addIssue({ code: "custom", path: ["address"], message: "Address is required for home delivery" });
  }
});

export const ORDER_STATUSES = [
  "new",
  "confirmed",
  "unreachable",
  "preparing",
  "ready",
  "assigned",
  "dispatched",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled",
] as const;

export type OrderStatus = typeof ORDER_STATUSES[number];

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  /**
   * Manual override — skip the forward-transition guard so the merchant can
   * correct a mistaken status (e.g. ready → new). Used by the dashboard's
   * status dropdown. The commune-required-to-confirm rule still applies.
   */
  override: z.boolean().optional(),
});

/**
 * Edits an order's customer + delivery details before dispatch. Partial patch:
 * only supplied fields are written. Used to correct a name/phone, complete a
 * missing commune (storefront orders when the commune field was hidden), change
 * the wilaya/address, or switch the delivery type. Changing the wilaya or the
 * delivery type re-prices the delivery fee in the handler.
 */
export const updateOrderSchema = z.object({
  customerName: z.string().min(1).max(100).optional(),
  phone: z
    .preprocess(
      (v) => (typeof v === "string" ? toLocalAlgerianMobile(v) ?? v : v),
      z.string().regex(/^0[567]\d{8}$/, "Invalid Algerian phone number"),
    )
    .optional(),
  wilayaId: z.number().int().min(1).max(58).optional(),
  communeId: z.string().min(1).optional(),
  address: z.string().max(300).nullish(),
  deliveryType: z.enum(["home", "stop_desk"]).optional(),
  stationCode: z.string().max(50).nullish(),
  notes: z.string().max(500).nullish(),
  /**
   * Product/quantity edits. `products` edits each line individually
   * (authoritative when present); `quantity`/`total` are single-line
   * shorthands — `total` is the grand total INCLUDING delivery, from which the
   * unit price is derived. Every edit recomputes the order's price + COD.
   */
  products: z
    .array(
      z.object({
        id: z.string().min(1),
        /** Replace the line's product/variant (optional — keeps the current one). */
        productId: z.string().min(1).optional(),
        variantId: z.string().min(1).nullish(),
        quantity: z.number().int().positive().max(100000).optional(),
        pricePerUnit: z.number().min(0).optional(),
      }),
    )
    .min(1)
    .optional(),
  quantity: z.number().int().positive().max(100000).optional(),
  total: z.number().min(0).optional(),
});

export const assignDriverSchema = z.object({
  driverId: z.string().min(1),
});

/**
 * POST /orders/{id}/products
 * Appends one product line to an existing order. Price defaults to the catalog
 * (variant price when a variant is chosen), but the merchant may override it.
 */
export const addOrderProductSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullish(),
  quantity: z.number().int().positive().max(100000),
  pricePerUnit: z.number().min(0).optional(),
});

/**
 * PATCH /orders/:id/products/:productLineId/return
 * Records how many units on a single order line the customer refused at the door.
 * Server computes status ("fulfilled" | "partially_returned" | "returned") from
 * the ratio of returnedQuantity to the line's original quantity.
 */
export const returnOrderProductSchema = z.object({
  returnedQuantity: z.number().int().min(0),
});

export const orderFiltersSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  wilayaId: z.coerce.number().int().optional(),
  search: z.string().optional(),
  /** Test-mode scope: true = test orders only, false = live orders only, omitted = both. */
  isTest: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  cursor: z
    .string()
    .min(1)
    .max(300)
    .refine((v) => parseOrderCursor(v) !== null, "Invalid cursor")
    .optional()
    .describe(
      "Keyset pagination cursor (takes precedence over offset). " +
        "Pass the (createdAt, id) cursor of the last row of the current page " +
        "to fetch the next page; deep pages stay index-served unlike offset."
    ),
});

/**
 * POST /orders/bulk-dispatch — dispatch multiple existing orders to a delivery company.
 * Uses the provider's bulk creation API (up to 100 orders per request).
 */
export const bulkDispatchSchema = z.object({
  companyId: z.string().min(1),
  orderIds: z.array(z.string().min(1)).min(1).max(100, "Maximum 100 orders per bulk dispatch"),
});

export type BulkDispatchInput = z.infer<typeof bulkDispatchSchema>;

/**
 * POST /orders/promote — move test-mode orders into the live orders book:
 * flips `is_test` to 0 on the same row (history preserved). Refused for
 * non-test orders, already-dispatched orders, and terminal statuses.
 */
export const promoteOrdersSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(200, "Maximum 200 orders per promotion"),
});

export type PromoteOrdersInput = z.infer<typeof promoteOrdersSchema>;

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type AssignDriverInput = z.infer<typeof assignDriverSchema>;
export type AddOrderProductInput = z.infer<typeof addOrderProductSchema>;
export type OrderFiltersInput = z.infer<typeof orderFiltersSchema>;
export type ReturnOrderProductInput = z.infer<typeof returnOrderProductSchema>;
