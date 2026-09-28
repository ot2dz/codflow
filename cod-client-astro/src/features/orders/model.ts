import type { Locale } from "@/i18n/config";
import type {
  AbandonedOrder,
  AbandonedOrderStatus,
  OrderListItem,
  OrderStatus,
} from "./types";

export const FILTER_STATUSES: OrderStatus[] = [
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
];

export type OrderGroupKey =
  | "all"
  | "new"
  | "confirmed"
  | "in_progress"
  | "following"
  | "delivered"
  | "returned"
  | "cancelled";

export interface OrderGroup {
  key: OrderGroupKey;
  /** Statuses that belong to this group. null = every status ("all"). */
  statuses: OrderStatus[] | null;
}

/**
 * Lifecycle buckets shown as tabs above the orders table. Fixed by product
 * decision — not merchant-configurable. Order follows the fulfilment flow,
 * with terminal outcomes last.
 */
export const ORDER_GROUPS: OrderGroup[] = [
  { key: "all", statuses: null },
  { key: "new", statuses: ["new"] },
  { key: "confirmed", statuses: ["confirmed"] },
  { key: "in_progress", statuses: ["unreachable"] },
  {
    key: "following",
    statuses: [
      "preparing",
      "ready",
      "assigned",
      "dispatched",
      "out_for_delivery",
    ],
  },
  { key: "delivered", statuses: ["delivered"] },
  { key: "returned", statuses: ["returned"] },
  { key: "cancelled", statuses: ["cancelled"] },
];

export function groupOrders(
  orders: OrderListItem[],
  group: OrderGroupKey,
): OrderListItem[] {
  const def = ORDER_GROUPS.find((entry) => entry.key === group);
  if (!def || !def.statuses) return orders;
  return orders.filter((order) => def.statuses!.includes(order.status));
}

export function orderGroupCounts(
  orders: OrderListItem[],
): Record<OrderGroupKey, number> {
  const counts = {} as Record<OrderGroupKey, number>;
  for (const group of ORDER_GROUPS) {
    counts[group.key] = group.statuses
      ? orders.filter((order) => group.statuses!.includes(order.status)).length
      : orders.length;
  }
  return counts;
}

export interface OrderUnit {
  primary: OrderListItem;
  duplicates: OrderListItem[];
}

/**
 * Collapse orders that belong to the same customer (same phone) into a single
 * display unit. The newest order becomes the primary row; the rest hang off it
 * as `duplicates`. First-appearance order is preserved for stable pagination.
 */
export function groupDuplicateOrders(orders: OrderListItem[]): OrderUnit[] {
  const units: OrderUnit[] = [];
  const byPhone = new Map<string, OrderUnit>();
  for (const order of orders) {
    const key = order.phone.trim();
    const existing = byPhone.get(key);
    if (!existing) {
      const unit: OrderUnit = { primary: order, duplicates: [] };
      byPhone.set(key, unit);
      units.push(unit);
      continue;
    }
    if (
      new Date(order.createdAt).getTime() >=
      new Date(existing.primary.createdAt).getTime()
    ) {
      existing.duplicates.push(existing.primary);
      existing.primary = order;
    } else {
      existing.duplicates.push(order);
    }
  }
  for (const unit of units) {
    unit.duplicates.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
  return units;
}

export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["confirmed", "unreachable", "cancelled"],
  confirmed: ["preparing", "unreachable", "cancelled"],
  unreachable: ["confirmed", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["out_for_delivery", "dispatched", "cancelled"],
  assigned: ["out_for_delivery", "dispatched", "cancelled"],
  dispatched: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered", "returned"],
  delivered: [],
  returned: [],
  cancelled: [],
};

export function orderStatusOptions(status: OrderStatus): OrderStatus[] {
  return [status, ...ALLOWED_TRANSITIONS[status]];
}

export interface OrderFilters {
  query: string;
  status: string;
  delivery: string;
  wilaya: string;
  type: string;
  /** Inclusive creation-date range, "YYYY-MM-DD" in local time ("" = open). */
  dateFrom: string;
  dateTo: string;
}

/** The order's creation date as a local YYYY-MM-DD key (for range filtering). */
export function localDateKey(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export type DetailStatusAction = {
  status: OrderStatus;
  emphasis: "primary" | "secondary" | "danger";
};

export function detailStatusActions(
  status: OrderStatus,
  order?: Pick<OrderListItem, "deliveryMethod" | "trackingNumber">,
): DetailStatusAction[] {
  const actions: Partial<Record<OrderStatus, DetailStatusAction[]>> = {
    new: [
      { status: "confirmed", emphasis: "primary" },
      { status: "unreachable", emphasis: "secondary" },
    ],
    confirmed: [
      { status: "preparing", emphasis: "primary" },
      { status: "unreachable", emphasis: "secondary" },
    ],
    unreachable: [
      { status: "confirmed", emphasis: "primary" },
      { status: "cancelled", emphasis: "danger" },
    ],
    preparing: [{ status: "ready", emphasis: "primary" }],
    assigned: [{ status: "out_for_delivery", emphasis: "primary" }],
    dispatched: [{ status: "out_for_delivery", emphasis: "primary" }],
    out_for_delivery: [{ status: "delivered", emphasis: "primary" }],
  };
  if (status === "ready") {
    return order?.trackingNumber
      ? [{ status: "dispatched", emphasis: "primary" }]
      : [];
  }
  return actions[status] ?? [];
}

export function dispatchFieldSupport(companyCode: string): {
  remarks: boolean;
  weight: boolean;
  fragile: boolean;
} {
  const isEcotrack =
    companyCode === "ecotrack" || companyCode.endsWith("_ecotrack");
  if (isEcotrack) return { remarks: true, weight: true, fragile: true };
  if (companyCode === "noest")
    return { remarks: true, weight: true, fragile: false };
  // Yalidine takes a per-parcel weight (official create contract; the
  // adapter forwards it) — over 5kg billable weight an oversize fee applies,
  // so the merchant needs the input. No remarks endpoint, no fragile field.
  if (companyCode === "yalidine")
    return { remarks: false, weight: true, fragile: false };
  return { remarks: false, weight: false, fragile: false };
}

export function shipmentCapabilities(
  companyCode: string,
  status: OrderStatus,
  dispatched: boolean,
): {
  canValidate: boolean;
  canUpdate: boolean;
  canCancel: boolean;
  canRemark: boolean;
  canTrack: boolean;
} {
  const isEcotrack =
    companyCode === "ecotrack" || companyCode.endsWith("_ecotrack");
  const supportsUpdate =
    isEcotrack || ["noest", "yalidine", "zr_express"].includes(companyCode);
  // ZR Express deletion works via DELETE /parcels/bulk/by-tracking-number
  // (live-verified 2026-09-10; the earlier 405 came from a wrong POST).
  const supportsCancel =
    isEcotrack || ["noest", "yalidine", "zr_express"].includes(companyCode);
  const canUpdate =
    isEcotrack || companyCode === "zr_express"
      ? !isTerminalStatus(status)
      : companyCode === "yalidine"
        ? ["dispatched", "out_for_delivery"].includes(status)
        : companyCode === "noest"
          ? status === "dispatched"
          : false;
  const canCancel =
    supportsCancel &&
    (companyCode === "yalidine"
      ? ["dispatched", "out_for_delivery"].includes(status)
      : status === "dispatched");

  return {
    canValidate: dispatched && status === "dispatched",
    canUpdate: dispatched && supportsUpdate && canUpdate,
    canCancel: dispatched && canCancel,
    canRemark: dispatched && (isEcotrack || companyCode === "noest"),
    canTrack: dispatched && Boolean(companyCode),
  };
}

export function shipmentUpdateFieldSupport(companyCode: string): {
  name: boolean;
  phone: boolean;
  phone2: boolean;
  address: boolean;
  amount: boolean;
  weight: boolean;
  fragile: boolean;
  remarks: boolean;
} {
  const isEcotrack =
    companyCode === "ecotrack" || companyCode.endsWith("_ecotrack");
  if (isEcotrack || companyCode === "noest") {
    return {
      name: true,
      phone: true,
      phone2: true,
      address: true,
      amount: true,
      weight: true,
      fragile: true,
      remarks: true,
    };
  }
  if (companyCode === "yalidine") {
    return {
      name: true,
      phone: true,
      phone2: false,
      address: true,
      amount: true,
      weight: true,
      fragile: false,
      remarks: false,
    };
  }
  if (companyCode === "zr_express") {
    return {
      name: true,
      phone: true,
      phone2: false,
      address: true,
      amount: true,
      weight: false,
      fragile: false,
      remarks: false,
    };
  }
  return {
    name: false,
    phone: false,
    phone2: false,
    address: false,
    amount: false,
    weight: false,
    fragile: false,
    remarks: false,
  };
}

export function canAssignOrder(
  order: Pick<OrderListItem, "status" | "trackingNumber" | "deliveryMethod">,
): boolean {
  return (
    !order.trackingNumber &&
    order.deliveryMethod !== "company" &&
    ![
      "unreachable",
      "out_for_delivery",
      "delivered",
      "returned",
      "cancelled",
    ].includes(order.status)
  );
}

export function canDispatchOrder(
  order: Pick<
    OrderListItem,
    "status" | "trackingNumber" | "driverId" | "deliveryMethod"
  >,
): boolean {
  const driverCommitted =
    order.deliveryMethod === "driver" && Boolean(order.driverId);
  return (
    !order.trackingNumber &&
    !driverCommitted &&
    ![
      "unreachable",
      "out_for_delivery",
      "delivered",
      "returned",
      "cancelled",
    ].includes(order.status)
  );
}

export function canDeleteOrderFromDetail(status: OrderStatus): boolean {
  return status === "new" || status === "preparing";
}

export function orderStatusFlow(
  order: Pick<OrderListItem, "deliveryMethod" | "driverId" | "trackingNumber">,
): OrderStatus[] {
  const companyDelivery =
    Boolean(order.trackingNumber) || order.deliveryMethod === "company";
  return companyDelivery
    ? [
        "new",
        "confirmed",
        "preparing",
        "ready",
        "dispatched",
        "out_for_delivery",
        "delivered",
      ]
    : [
        "new",
        "confirmed",
        "preparing",
        "ready",
        "assigned",
        "out_for_delivery",
        "delivered",
      ];
}

export function filterOrders(
  orders: OrderListItem[],
  filters: OrderFilters,
): OrderListItem[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return orders.filter((order) => {
    if (
      query &&
      !`${order.orderNumber} ${order.customerName} ${order.phone}`
        .toLocaleLowerCase()
        .includes(query)
    ) {
      return false;
    }
    if (filters.status !== "all" && order.status !== filters.status)
      return false;
    if (filters.type !== "all" && order.orderType !== filters.type)
      return false;
    if (filters.wilaya !== "all" && order.wilaya !== filters.wilaya)
      return false;
    if (
      filters.delivery === "driver" &&
      (!order.driverId || order.trackingNumber)
    )
      return false;
    if (filters.delivery === "company" && !order.trackingNumber) return false;
    if (
      filters.delivery === "unassigned" &&
      (order.driverId || order.trackingNumber)
    )
      return false;
    if (filters.dateFrom || filters.dateTo) {
      const key = localDateKey(order.createdAt);
      if (filters.dateFrom && key < filters.dateFrom) return false;
      if (filters.dateTo && key > filters.dateTo) return false;
    }
    return true;
  });
}

export function formatMoney(
  amount: number | null | undefined,
  locale: Locale,
  currency = "DA",
): string {
  if (amount == null) return "-";
  return `${new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : `${locale}-DZ`).format(amount)} ${currency}`;
}

export function orderTotal(
  order: Pick<OrderListItem, "price" | "deliveryFee">,
): number {
  return order.price + order.deliveryFee;
}

export type OrderSortKey =
  "createdAt" | "orderNumber" | "customerName" | "status" | "wilaya" | "total";

export function sortOrders(
  orders: OrderListItem[],
  key: OrderSortKey,
  direction: "asc" | "desc",
): OrderListItem[] {
  return [...orders].sort((left, right) => {
    const leftValue = key === "total" ? orderTotal(left) : left[key];
    const rightValue = key === "total" ? orderTotal(right) : right[key];
    const comparison = String(leftValue ?? "").localeCompare(
      String(rightValue ?? ""),
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    );
    return direction === "asc" ? comparison : -comparison;
  });
}

export function paginateOrders<T>(
  orders: T[],
  page: number,
  pageSize: number,
): T[] {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  const start = (safePage - 1) * safePageSize;
  return orders.slice(start, start + safePageSize);
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return (
    status === "delivered" || status === "returned" || status === "cancelled"
  );
}

/**
 * An order's customer + delivery details can be edited until it is handed to a
 * carrier. Once tracking exists or the parcel is out for delivery, the order is
 * locked.
 */
export function canEditOrder(
  order: Pick<OrderListItem, "status" | "trackingNumber">,
): boolean {
  return (
    !order.trackingNumber &&
    !isTerminalStatus(order.status) &&
    order.status !== "out_for_delivery"
  );
}

const ABANDONED_TRANSITIONS: Record<
  AbandonedOrderStatus,
  AbandonedOrderStatus[]
> = {
  pending: ["contacted", "abandoned"],
  abandoned: ["contacted", "converted"],
  contacted: ["converted", "abandoned"],
  converted: [],
};

export function abandonedStatusOptions(
  status: AbandonedOrderStatus,
): AbandonedOrderStatus[] {
  return [status, ...ABANDONED_TRANSITIONS[status]];
}

export interface AbandonedFilters {
  query: string;
  status: string;
}

export function filterAbandonedOrders(
  rows: AbandonedOrder[],
  filters: AbandonedFilters,
): AbandonedOrder[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (
      query &&
      !`${row.customerName} ${row.phone} ${row.productName ?? ""}`
        .toLocaleLowerCase()
        .includes(query)
    ) {
      return false;
    }
    if (filters.status !== "all" && row.status !== filters.status)
      return false;
    return true;
  });
}
