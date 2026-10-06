/**
 * Orders Route Handlers - CRUD Operations
 * 
 * Basic HTTP handlers for orders listing, retrieval, creation, and deletion.
 * Complex operations (dispatch, status transitions) are in separate modules.
 */

import { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { wilayas, communes, customers, products, productVariants } from "@/db/schema";
import { eq } from "drizzle-orm";
import * as queries from "./queries";
import * as validation from "./validation";
import { resolveDeliveryFee, applyFreeShippingOffer, applyFreeShippingProducts } from "./resolve-fee";
import { logActivity, ACTIONS } from "@/lib/activity";
import { getDeliveryCompanyById } from "@/endpoints/delivery-companies/queries";
import { NotFoundError, ValidationError, BusinessLogicError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import {
  applyOrderLineEdits,
  addOrderLines,
  type OrderLineEdit,
} from "../../../../cod-shared/queries/orders";
import { getProductInventory } from "../../../../cod-shared/queries/stock";

/**
 * GET /orders
 * List all orders with optional filters
 */
export async function listOrders(c: Context<AppContext>) {
  try {
    const db = getDb(c.env.DB);

    const queryData: any = (c.req as any).valid?.("query");
    const filters = queryData ?? validation.orderFiltersSchema.parse({
      status: c.req.query("status"),
      wilayaId: c.req.query("wilayaId"),
      search: c.req.query("search"),
      isTest: c.req.query("isTest"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });

    const orders = await queries.getAllOrders(db, filters);

    return c.json({
      success: true,
      data: orders,
      count: orders.length,
    }, 200);
  } catch (error) {
    throw error;
  }
}

/**
 * GET /orders/:id
 * Get single order by ID
 */
export async function getOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id");

  if (!orderId) {
    throw new ValidationError("Order ID is required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }

  const order = await queries.getOrderById(db, orderId);

  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  return c.json({
    success: true,
    data: order,
  }, 200);
}

/**
 * PATCH /orders/:id
 * Edit an order's customer + delivery details before dispatch: correct a name
 * or phone, complete a missing commune (storefront orders when the commune
 * field was hidden), change the wilaya/address, switch the delivery type, or
 * edit notes. Changing the wilaya or the delivery type re-prices the delivery
 * fee; correcting identity/commune/address/notes never moves the amount owed.
 */
export async function updateOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id");

  if (!orderId) {
    throw new ValidationError("Order ID is required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }

  const order = await queries.getOrderById(db, orderId);
  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  const bodyData: any = (c.req as any).valid?.("json");
  const validated: validation.UpdateOrderInput =
    bodyData ?? validation.updateOrderSchema.parse(await c.req.json());

  if (Object.keys(validated).length === 0) {
    throw new ValidationError("No fields to update", ERROR_CODES.REQUIRED_FIELD_MISSING, { orderId });
  }

  if (order.trackingNumber) {
    throw new BusinessLogicError(
      "Order is already dispatched to a delivery company",
      ERROR_CODES.ORDER_ALREADY_DISPATCHED,
      { orderId, trackingNumber: order.trackingNumber }
    );
  }

  const lockedStatuses = ["out_for_delivery", "delivered", "returned", "cancelled"];
  if (lockedStatuses.includes(order.status)) {
    throw new BusinessLogicError(
      "Order details can no longer be edited in its current status",
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      { orderId, currentStatus: order.status, allowedStatuses: lockedStatuses }
    );
  }

  const effectiveWilayaId = validated.wilayaId ?? order.wilayaId;
  if (!effectiveWilayaId) {
    throw new ValidationError(
      "Order has no wilaya set",
      ERROR_CODES.MISSING_WILAYA_COMMUNE,
      { orderId }
    );
  }
  const effectiveDeliveryType = validated.deliveryType ?? order.deliveryType;
  const effectiveCommuneId =
    validated.communeId !== undefined ? validated.communeId : order.communeId;

  if (validated.communeId !== undefined) {
    const commune = await db
      .select({ id: communes.id, wilayaId: communes.wilayaId })
      .from(communes)
      .where(eq(communes.id, validated.communeId))
      .get();

    if (!commune || commune.wilayaId !== effectiveWilayaId) {
      throw new ValidationError(
        "Commune does not belong to the order's wilaya",
        ERROR_CODES.MISSING_WILAYA_COMMUNE,
        { orderId, wilayaId: effectiveWilayaId, communeId: validated.communeId }
      );
    }
  }

  // Re-price only when the destination zone (wilaya) or the delivery mode
  // changes — a fee the customer already agreed to must not move otherwise.
  const wilayaChanged =
    validated.wilayaId !== undefined && validated.wilayaId !== order.wilayaId;
  const typeChanged =
    validated.deliveryType !== undefined && validated.deliveryType !== order.deliveryType;

  let deliveryFee: number | undefined;
  if (wilayaChanged || typeChanged) {
    const lines = order.products ?? [];
    const productIds = lines.map((line) => line.productId);
    const quantities = new Map<string, number>();
    for (const line of lines) {
      quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
    }

    const resolved = await resolveDeliveryFee(db, {
      wilayaId: effectiveWilayaId,
      communeId: effectiveCommuneId ?? null,
      deliveryType: effectiveDeliveryType,
      productIds,
    });
    deliveryFee = await applyFreeShippingOffer(db, resolved.deliveryFee, productIds, quantities);
    deliveryFee = await applyFreeShippingProducts(db, deliveryFee, productIds);
  }

  const patch: {
    customerName?: string;
    phone?: string;
    wilayaId?: number;
    communeId?: string | null;
    address?: string | null;
    deliveryType?: "home" | "stop_desk";
    stationCode?: string | null;
    notes?: string | null;
    deliveryFee?: number;
  } = {};

  if (validated.customerName !== undefined) patch.customerName = validated.customerName;
  if (validated.phone !== undefined) patch.phone = validated.phone;
  if (validated.wilayaId !== undefined) patch.wilayaId = validated.wilayaId;
  if (validated.communeId !== undefined) patch.communeId = validated.communeId;
  if (validated.address !== undefined) patch.address = validated.address ?? null;
  if (validated.deliveryType !== undefined) patch.deliveryType = validated.deliveryType;
  if (validated.notes !== undefined) patch.notes = validated.notes ?? null;
  if (deliveryFee !== undefined) patch.deliveryFee = deliveryFee;

  // A home delivery never carries a stop-desk station code.
  if (validated.deliveryType === "home") {
    patch.stationCode = null;
  } else if (validated.stationCode !== undefined) {
    patch.stationCode = validated.stationCode ?? null;
  }

  await queries.updateOrderDetails(db, orderId, patch);

  const actor = c.get("user");

  // Product / quantity / price edits. Runs AFTER the detail patch so the COD
  // recompute uses the final delivery fee.
  const hasLineEdits =
    validated.products !== undefined ||
    validated.quantity !== undefined ||
    validated.total !== undefined;

  if (hasLineEdits) {
    const lines = (order.products ?? []) as Array<{
      id: string;
      productId: string;
      variantId: string | null;
      quantity: number;
      pricePerUnit: number;
    }>;
    if (lines.length === 0) {
      throw new ValidationError(
        "Order has no products to edit",
        ERROR_CODES.REQUIRED_FIELD_MISSING,
        { orderId }
      );
    }

    const effectiveFee = deliveryFee ?? order.deliveryFee;
    const byId = new Map(lines.map((line) => [line.id, line]));
    const drafts: Array<{
      line: (typeof lines)[number];
      productId: string;
      variantId: string | null;
      quantity: number;
      pricePerUnit?: number;
    }> = [];

    if (validated.products) {
      for (const entry of validated.products) {
        const line = byId.get(entry.id);
        if (!line) {
          throw new ValidationError(
            `Unknown order line "${entry.id}"`,
            ERROR_CODES.REQUIRED_FIELD_MISSING,
            { lineId: entry.id }
          );
        }
        drafts.push({
          line,
          productId: entry.productId ?? line.productId,
          variantId:
            entry.variantId !== undefined ? entry.variantId ?? null : line.variantId,
          quantity: entry.quantity ?? line.quantity,
          pricePerUnit: entry.pricePerUnit,
        });
      }
    } else {
      if (lines.length !== 1) {
        throw new ValidationError(
          "This order has multiple products — edit each line individually",
          ERROR_CODES.REQUIRED_FIELD_MISSING,
          { orderId, lineCount: lines.length }
        );
      }
      const line = lines[0];
      const quantity = validated.quantity ?? line.quantity;
      let pricePerUnit: number | undefined;
      if (validated.total !== undefined) {
        if (validated.total < effectiveFee) {
          throw new ValidationError(
            "Total cannot be less than the delivery fee",
            ERROR_CODES.VALIDATION_FAILED,
            { total: validated.total, deliveryFee: effectiveFee }
          );
        }
        pricePerUnit = (validated.total - effectiveFee) / quantity;
      }
      drafts.push({
        line,
        productId: line.productId,
        variantId: line.variantId,
        quantity,
        pricePerUnit,
      });
    }

    const edits: OrderLineEdit[] = [];
    for (const draft of drafts) {
      const productRow = await db
        .select()
        .from(products)
        .where(eq(products.id, draft.productId))
        .get();
      if (!productRow) {
        throw new NotFoundError("Product", draft.productId);
      }

      let variantRow: typeof productVariants.$inferSelect | undefined;
      if (draft.variantId) {
        variantRow = await db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, draft.variantId))
          .get();
        if (!variantRow || variantRow.productId !== draft.productId) {
          throw new ValidationError(
            "Variant does not belong to the product",
            ERROR_CODES.VALIDATION_FAILED,
            { productId: draft.productId, variantId: draft.variantId }
          );
        }
      }

      const sameSku =
        draft.productId === draft.line.productId &&
        (draft.variantId ?? null) === (draft.line.variantId ?? null);

      // The old product's tracked flag — needed to restock it on a product swap.
      let previousTrackInventory: boolean;
      if (sameSku) {
        previousTrackInventory = Boolean(productRow.trackInventory);
      } else {
        const oldProduct = await db
          .select({ trackInventory: products.trackInventory })
          .from(products)
          .where(eq(products.id, draft.line.productId))
          .get();
        previousTrackInventory = Boolean(oldProduct?.trackInventory);
      }

      const trackInventory = Boolean(productRow.trackInventory);
      const pricePerUnit =
        draft.pricePerUnit ??
        (sameSku ? draft.line.pricePerUnit : variantRow?.price ?? productRow.price);

      if (trackInventory) {
        const required = sameSku
          ? Math.max(0, draft.quantity - draft.line.quantity)
          : draft.quantity;
        if (required > 0) {
          const { inventory } = await getProductInventory(
            db,
            draft.productId,
            draft.variantId ?? null
          );
          if (inventory < required) {
            throw new BusinessLogicError(
              `Insufficient stock. Available: ${inventory}, Required: ${required}`,
              ERROR_CODES.INSUFFICIENT_STOCK,
              { lineId: draft.line.id, available: inventory, required }
            );
          }
        }
      }

      let variantLabel: string | null = null;
      if (variantRow) {
        try {
          const parsed = JSON.parse(variantRow.variations) as Record<string, string>;
          variantLabel = Object.values(parsed).join(" / ") || null;
        } catch {
          variantLabel = null;
        }
      }

      edits.push({
        id: draft.line.id,
        productId: draft.productId,
        productName: productRow.name,
        variantId: draft.variantId ?? null,
        variantLabel,
        sku: variantRow?.sku ?? productRow.sku ?? null,
        quantity: draft.quantity,
        pricePerUnit,
        trackInventory,
        previousProductId: draft.line.productId,
        previousVariantId: draft.line.variantId,
        previousQuantity: draft.line.quantity,
        previousTrackInventory,
      });
    }

    await applyOrderLineEdits(db, orderId, edits, {
      id: actor?.id,
      name: actor?.name ?? undefined,
    });
  }

  await logActivity(
    db,
    actor,
    ACTIONS.ORDER_UPDATED,
    { type: "order", id: orderId, label: order.orderNumber },
    { fields: Object.keys(validated), ...(deliveryFee !== undefined ? { deliveryFee } : {}) }
  );

  const updated = await queries.getOrderById(db, orderId);
  return c.json({ success: true, data: updated, message: "Order updated" }, 200);
}

/**
 * POST /orders/{id}/products
 * Append one product line to an existing order (same product variant or a
 * different product). Recomputes the order total + COD and adjusts stock.
 */
export async function addOrderProduct(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id");
  if (!orderId) {
    throw new ValidationError("Order ID is required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }

  const order = await queries.getOrderById(db, orderId);
  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  const bodyData: any = (c.req as any).valid?.("json");
  const validated: validation.AddOrderProductInput =
    bodyData ?? validation.addOrderProductSchema.parse(await c.req.json());

  if (order.trackingNumber) {
    throw new BusinessLogicError(
      "Order is already dispatched to a delivery company",
      ERROR_CODES.ORDER_ALREADY_DISPATCHED,
      { orderId, trackingNumber: order.trackingNumber }
    );
  }
  const lockedStatuses = ["out_for_delivery", "delivered", "returned", "cancelled"];
  if (lockedStatuses.includes(order.status)) {
    throw new BusinessLogicError(
      "Products can no longer be added in this status",
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      { orderId, currentStatus: order.status }
    );
  }

  const productRow = await db
    .select()
    .from(products)
    .where(eq(products.id, validated.productId))
    .get();
  if (!productRow) {
    throw new NotFoundError("Product", validated.productId);
  }

  let variantRow: typeof productVariants.$inferSelect | undefined;
  if (validated.variantId) {
    variantRow = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, validated.variantId))
      .get();
    if (!variantRow || variantRow.productId !== validated.productId) {
      throw new ValidationError(
        "Variant does not belong to the selected product",
        ERROR_CODES.VALIDATION_FAILED,
        { productId: validated.productId, variantId: validated.variantId }
      );
    }
  }

  const trackInventory = Boolean(productRow.trackInventory);
  if (trackInventory) {
    const { inventory } = await getProductInventory(
      db,
      validated.productId,
      validated.variantId ?? null
    );
    if (inventory < validated.quantity) {
      throw new BusinessLogicError(
        `Insufficient stock. Available: ${inventory}, Required: ${validated.quantity}`,
        ERROR_CODES.INSUFFICIENT_STOCK,
        { productId: validated.productId, available: inventory, required: validated.quantity }
      );
    }
  }

  const pricePerUnit =
    validated.pricePerUnit ?? variantRow?.price ?? productRow.price;
  let variantLabel: string | null = null;
  if (variantRow) {
    try {
      const parsed = JSON.parse(variantRow.variations) as Record<string, string>;
      variantLabel = Object.values(parsed).join(" / ") || null;
    } catch {
      variantLabel = null;
    }
  }

  const actor = c.get("user");
  await addOrderLines(
    db,
    orderId,
    [
      {
        productId: validated.productId,
        productName: productRow.name,
        variantId: validated.variantId ?? null,
        variantLabel,
        sku: variantRow?.sku ?? productRow.sku ?? null,
        quantity: validated.quantity,
        pricePerUnit,
        trackInventory,
      },
    ],
    { id: actor?.id, name: actor?.name ?? undefined }
  );

  await logActivity(
    db,
    actor,
    ACTIONS.ORDER_UPDATED,
    { type: "order", id: orderId, label: order.orderNumber },
    { addedProductId: validated.productId, quantity: validated.quantity, pricePerUnit }
  );

  const updated = await queries.getOrderById(db, orderId);
  return c.json({ success: true, data: updated, message: "Product added" }, 201);
}

/**
 * POST /orders
 * Create new order
 */
export async function createOrder(c: Context<AppContext>) {
  try {
    const db = getDb(c.env.DB);
    const bodyData: any = (c.req as any).valid?.("json");
    const validated: validation.CreateOrderInput =
      bodyData ?? validation.createOrderSchema.parse(await c.req.json());

    // Generate order number (format: ORD-YYYYMMDD-XXXX)
    const date = new Date();
    const dateStr = date.toISOString().split("T")[0].replace(/-/g, "");
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
    const orderNumber = `ORD-${dateStr}-${random}`;

    const now = date.toISOString();
    const orderId = crypto.randomUUID();

    // Validate companyId if provided — it references a delivery_companies FK
    if (validated.companyId) {
      const company = await getDeliveryCompanyById(db, validated.companyId);
      if (!company) {
        throw new NotFoundError("Delivery company", validated.companyId);
      }
    }

    // Auto-resolve delivery fee from shipping profile.
    // Dashboard orders (orderType="offline") may pass an explicit fee override.
    // Online orders always use the shipping profile to enforce coverage rules.
    let deliveryFee = validated.deliveryFee ?? 0;
    if (validated.wilayaId) {
      try {
        const productIds = validated.products.map((p) => p.productId);
        const resolved = await resolveDeliveryFee(db, {
          wilayaId: validated.wilayaId,
          communeId: validated.communeId ?? null,
          deliveryType: validated.deliveryType,
          productIds,
        });
        // For online orders, always use resolved fee. For offline/dashboard orders,
        // use the resolved fee unless admin explicitly passed a fee override.
        if (validated.orderType === "online" || validated.deliveryFee == null) {
          deliveryFee = resolved.deliveryFee;
        }
        // Apply free-shipping offer override
        const productQuantities = new Map(validated.products.map((p) => [p.productId, p.quantity]));
        deliveryFee = await applyFreeShippingOffer(db, deliveryFee, productIds, productQuantities);
        deliveryFee = await applyFreeShippingProducts(db, deliveryFee, productIds);
      } catch (err) {
        // If the order is offline (dashboard), allow fee=0 and skip coverage check errors.
        // Online orders: re-throw to block order creation for uncovered zones.
        if (validated.orderType === "online") throw err;
        deliveryFee = validated.deliveryFee ?? 0;
      }
    }

    // Auto-create customer if not in DB (walk-in / manual entry)
    const existingCustomer = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, validated.customerId))
      .get();

    if (!existingCustomer) {
      const [wilayaRow, communeRow] = await Promise.all([
        db.select({ nameAr: wilayas.nameAr }).from(wilayas).where(eq(wilayas.id, validated.wilayaId)).get(),
        validated.communeId
          ? db.select({ nameAr: communes.nameAr }).from(communes).where(eq(communes.id, validated.communeId)).get()
          : Promise.resolve(null),
      ]);

      await db.insert(customers).values({
        id: validated.customerId,
        name: validated.customerName,
        phone: validated.phone,
        phone2: null,
        wilayaId: validated.wilayaId,
        communeId: validated.communeId ?? null,
        wilaya: wilayaRow?.nameAr ?? String(validated.wilayaId),
        commune: communeRow?.nameAr ?? null,
        address: validated.address ?? null,
        totalOrders: 0,
        totalSpent: 0,
        createdAt: now,
        lastOrderAt: null,
      });
    }

    // Prepare order data
    const orderData = {
      id: orderId,
      orderNumber,
      customerId: validated.customerId,
      customerName: validated.customerName,
      phone: validated.phone,
      wilayaId: validated.wilayaId,
      communeId: validated.communeId ?? null,
      city: validated.city || null,
      address: validated.address || null,
      price: validated.price,
      notes: validated.notes || null,
      status: "new" as const,
      orderType: validated.orderType,
      driverId: null,
      companyId: validated.companyId || null,
      deliveryType: validated.deliveryType,
      deliveryFee,
      codAmount: validated.price + deliveryFee,  // driver collects price + delivery fee
      photos: null,
      createdAt: now,
      updatedAt: now,
    };

    // Prepare order products
    const productsData = validated.products.map((p) => ({
      id: crypto.randomUUID(),
      orderId,
      productId: p.productId,
      productName: p.productName,
      variantId: p.variantId || null,
      variantLabel: p.variantLabel || null,
      quantity: p.quantity,
      pricePerUnit: p.pricePerUnit,
      lineTotal: p.lineTotal,
      createdAt: now,
    }));

    const actor = c.get("user");
    // Create order — passes actor so stock movements are attributed correctly
    await queries.createOrder(db, orderData, productsData, actor ? { id: actor.id, name: actor.name ?? "Unknown" } : null);
    await logActivity(db, actor, ACTIONS.ORDER_CREATED, {
      type: "order", id: orderId, label: orderNumber,
    });

    return c.json(
      {
        success: true,
        data: {
          id: orderId,
          orderNumber,
          deliveryFee,
          price: validated.price,
          codAmount: validated.price + deliveryFee,
          customerId: validated.customerId,
          customerName: validated.customerName,
          phone: validated.phone,
          wilayaId: validated.wilayaId,
          communeId: validated.communeId ?? null,
          deliveryType: validated.deliveryType,
          orderType: validated.orderType,
          status: "new",
        },
        message: "Order created successfully",
      },
      201
    );
  } catch (error) {
    throw error;
  }
}

/**
 * PATCH /orders/:id/products/:productLineId/return
 *
 * Record how many units on a single order line the customer refused at the
 * door. Used for the Algerian "open the box at delivery" workflow where a
 * customer may accept part of an order and return the rest.
 *
 * Body: { returnedQuantity: number }  // 0 ≤ n ≤ line.quantity
 *
 * Server:
 *  - computes status ("fulfilled" | "partially_returned" | "returned")
 *    from newReturnedQuantity / line.quantity
 *  - restocks the delta vs. the line's current returnedQuantity so repeated
 *    calls are idempotent and correcting an overstated return un-restocks
 *  - logs a stock_movement with type ORDER_RETURNED
 *
 * Only callable while the order is not already in a terminal state — once
 * the order itself is marked `returned` or `cancelled`, updateOrderStatus
 * has already restocked remaining units and further per-line edits would
 * desync inventory.
 */
export async function returnOrderProduct(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id");
  const productLineId = c.req.param("productLineId");

  if (!orderId || !productLineId) {
    throw new ValidationError("Order ID and product line ID are required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }

  const order = await queries.getOrderById(db, orderId);
  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  // Block edits on orders whose overall state has already settled the books.
  const terminalStatuses = ["returned", "cancelled"];
  if (terminalStatuses.includes(order.status)) {
    throw new BusinessLogicError(
      `Cannot edit returns on a ${order.status} order — stock was already reconciled.`,
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      { orderId, currentStatus: order.status }
    );
  }

  const bodyData: any = (c.req as any).valid?.("json");
  const validated: validation.ReturnOrderProductInput =
    bodyData ?? validation.returnOrderProductSchema.parse(await c.req.json());

  const user = c.get("user");

  let result;
  try {
    result = await queries.setOrderProductReturn(
      db,
      orderId,
      productLineId,
      validated.returnedQuantity,
      user?.id,
      user?.name ?? undefined,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(msg, ERROR_CODES.VALUE_OUT_OF_RANGE, { orderId, productLineId });
  }

  await logActivity(db, user, ACTIONS.ORDER_PRODUCT_RETURNED, {
    type: "order", id: orderId, label: order.orderNumber,
  }, { productLineId, returnedQuantity: result.returnedQuantity, status: result.status });

  return c.json({ success: true, data: result, message: "Return recorded" }, 200);
}

/**
 * DELETE /orders/:id
 * Permanently delete the order: restore tracked inventory, adjust customer
 * counters, then remove the order with its lines, shipments, and cascaded
 * history/reviews. No soft-delete exists for orders.
 */
export async function deleteOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id");

  if (!orderId) {
    throw new ValidationError("Order ID is required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }

  // Check if order exists
  const order = await queries.getOrderById(db, orderId);
  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  await queries.deleteOrder(db, orderId);

  const deleteActor = c.get("user");
  await logActivity(db, deleteActor, ACTIONS.ORDER_DELETED, {
    type: "order", id: orderId,
  });

  return c.json({
    success: true,
    message: "Order deleted",
  }, 200);
}

/**
 * POST /orders/promote
 * Promote test-mode orders into the live orders book: flips `is_test` to 0
 * on the SAME row (customer, lines and history preserved) and leaves an
 * auditable status-history entry tagged `test-promotion`. Per-order refusals
 * (not a test order, already dispatched, terminal status) are reported, never
 * silently dropped.
 */
export async function promoteOrders(c: Context<AppContext>) {
  const db = getDb(c.env.DB);

  const bodyData: any = (c.req as any).valid?.("json") ?? (await c.req.json().catch(() => ({})));
  const orderIds: string[] = Array.isArray(bodyData?.orderIds) ? bodyData.orderIds : [];
  if (orderIds.length === 0) {
    throw new ValidationError("orderIds must be a non-empty array", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }

  const result = await queries.promoteTestOrders(db, orderIds);

  const user = c.get("user");
  await logActivity(db, user, ACTIONS.ORDER_UPDATED, {
    type: "order",
    id: result.promoted[0] ?? orderIds[0],
    label: `${result.promoted.length} test order(s) promoted to live`,
  }, { promoted: result.promoted.length, refused: result.refused.length });

  return c.json(
    {
      success: true,
      data: result,
      message: `${result.promoted.length} order(s) promoted to live`,
    },
    200,
  );
}
