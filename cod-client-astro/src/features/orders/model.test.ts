import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  ORDER_GROUPS,
  detailStatusActions,
  dispatchFieldSupport,
  canAssignOrder,
  canDeleteOrderFromDetail,
  canDispatchOrder,
  canEditOrder,
  filterOrders,
  formatMoney,
  groupDuplicateOrders,
  groupOrders,
  localDateKey,
  orderGroupCounts,
  orderTotal,
  orderStatusFlow,
  orderStatusOptions,
  paginateOrders,
  shipmentCapabilities,
  shipmentUpdateFieldSupport,
  sortOrders,
} from "./model";
import type { OrderListItem, OrderStatus } from "./types";
import type { OrderGroupKey } from "./model";

const order = (overrides: Partial<OrderListItem> = {}): OrderListItem => ({
  id: "1",
  orderNumber: "ORD-001",
  customerId: "c1",
  customerName: "Ahmed Benali",
  phone: "0551234567",
  wilayaId: 16,
  wilaya: "الجزائر",
  communeId: "c-16-001",
  commune: "باب الزوار",
  city: null,
  address: null,
  price: 9000,
  deliveryFee: 400,
  driverFee: 0,
  codAmount: 9400,
  status: "new",
  orderType: "online",
  deliveryMethod: "unassigned",
  deliveryType: "home",
  driverId: null,
  driverName: null,
  companyId: null,
  assignedAt: null,
  assignedBy: null,
  assignmentNotes: null,
  trackingNumber: null,
  trackingUrl: null,
  externalOrderId: null,
  stationCode: null,
  pickupTime: null,
  deliveryTime: null,
  deliveryAttempts: null,
  notes: null,
  photos: null,
  weight: null,
  isFragile: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  ...overrides,
});

describe("orders model", () => {
  it("keeps the lifecycle transitions explicit", () => {
    expect(ALLOWED_TRANSITIONS.new).toEqual([
      "confirmed",
      "unreachable",
      "cancelled",
    ]);
    expect(ALLOWED_TRANSITIONS.delivered).toEqual([]);
    expect(orderStatusOptions("new")).toEqual([
      "new",
      "confirmed",
      "unreachable",
      "cancelled",
    ]);
    expect(orderStatusOptions("delivered")).toEqual(["delivered"]);
  });

  it("filters by query and delivery assignment", () => {
    const result = filterOrders(
      [
        order(),
        order({
          id: "2",
          orderNumber: "ORD-002",
          driverId: "d1",
          status: "assigned",
        }),
      ],
      {
        query: "ahmed",
        status: "all",
        delivery: "driver",
        wilaya: "all",
        type: "all",
        dateFrom: "",
        dateTo: "",
      },
    );
    expect(result.map((item) => item.id)).toEqual(["2"]);
  });

  it("calculates the COD total from product price and delivery fee", () => {
    expect(orderTotal(order())).toBe(9400);
    expect(formatMoney(9400, "en")).toBe("9,400 DA");
  });

  it("exposes distinct detail actions for branching statuses", () => {
    expect(detailStatusActions("new")).toEqual([
      { status: "confirmed", emphasis: "primary" },
      { status: "unreachable", emphasis: "secondary" },
    ]);
    expect(detailStatusActions("unreachable")).toEqual([
      { status: "confirmed", emphasis: "primary" },
      { status: "cancelled", emphasis: "danger" },
    ]);
    expect(
      detailStatusActions("ready", order({ deliveryMethod: "unassigned" })),
    ).toEqual([]);
    expect(
      detailStatusActions("ready", order({ deliveryMethod: "company" })),
    ).toEqual([]);
    expect(
      detailStatusActions(
        "ready",
        order({ trackingNumber: "TRK-1", deliveryMethod: "company" }),
      ),
    ).toEqual([{ status: "dispatched", emphasis: "primary" }]);
    expect(detailStatusActions("dispatched")).toEqual([
      { status: "out_for_delivery", emphasis: "primary" },
    ]);
  });

  it("keeps provider-specific dispatch fields explicit", () => {
    expect(dispatchFieldSupport("packers_ecotrack")).toEqual({
      remarks: true,
      weight: true,
      fragile: true,
    });
    expect(dispatchFieldSupport("noest")).toEqual({
      remarks: true,
      weight: true,
      fragile: false,
    });
    // Yalidine: weight is a real create-parcel field (oversize fee past
    // 5kg billable); no remarks endpoint; no fragile field.
    expect(dispatchFieldSupport("yalidine")).toEqual({
      remarks: false,
      weight: true,
      fragile: false,
    });
    // ZR Express exposes none of the three.
    expect(dispatchFieldSupport("zr_express")).toEqual({
      remarks: false,
      weight: false,
      fragile: false,
    });
  });

  it("keeps carrier actions inside each provider status window", () => {
    expect(
      shipmentCapabilities("packers_ecotrack", "dispatched", true),
    ).toMatchObject({
      canValidate: true,
      canUpdate: true,
      canCancel: true,
      canRemark: true,
      canTrack: true,
    });
    expect(
      shipmentCapabilities("noest", "out_for_delivery", true),
    ).toMatchObject({
      canValidate: false,
      canUpdate: false,
      canCancel: false,
      canRemark: true,
      canTrack: true,
    });
    expect(
      shipmentCapabilities("zr_express", "dispatched", true),
    ).toMatchObject({
      canUpdate: true,
      // DELETE /parcels/bulk/by-tracking-number works (live-verified 2026-09-10;
      // the old 405 came from wrongly using POST) — cancel is offered while the
      // order is not in a terminal status.
      canCancel: true,
      canRemark: false,
      canTrack: true,
    });
    expect(
      shipmentCapabilities("yalidine", "out_for_delivery", true),
    ).toMatchObject({
      canUpdate: true,
      canCancel: true,
      canRemark: false,
      canTrack: true,
    });
  });

  it("exposes only carrier-supported update fields", () => {
    expect(shipmentUpdateFieldSupport("noest")).toMatchObject({
      phone2: true,
      weight: true,
      fragile: true,
      remarks: true,
    });
    expect(shipmentUpdateFieldSupport("yalidine")).toMatchObject({
      phone2: false,
      weight: true,
      fragile: false,
      remarks: false,
    });
    expect(shipmentUpdateFieldSupport("zr_express")).toMatchObject({
      phone2: false,
      weight: false,
      fragile: false,
      remarks: false,
    });
  });

  it("keeps assignment, dispatch, and deletion inside the legacy eligibility windows", () => {
    const ready = order({ status: "ready" });
    expect(canAssignOrder(ready)).toBe(true);
    expect(canDispatchOrder(ready)).toBe(true);
    expect(canAssignOrder(order({ status: "unreachable" }))).toBe(false);
    expect(
      canDispatchOrder(order({ driverId: "d1", deliveryMethod: "driver" })),
    ).toBe(false);
    expect(canDeleteOrderFromDetail("new")).toBe(true);
    expect(canDeleteOrderFromDetail("preparing")).toBe(true);
    expect(canDeleteOrderFromDetail("confirmed")).toBe(false);
  });

  it("uses the delivery method's full lifecycle for the detail timeline", () => {
    expect(
      orderStatusFlow(order({ deliveryMethod: "driver", driverId: "d1" })),
    ).toEqual([
      "new",
      "confirmed",
      "preparing",
      "ready",
      "assigned",
      "out_for_delivery",
      "delivered",
    ]);
    expect(
      orderStatusFlow(
        order({ deliveryMethod: "company", trackingNumber: "TRK-1" }),
      ),
    ).toEqual([
      "new",
      "confirmed",
      "preparing",
      "ready",
      "dispatched",
      "out_for_delivery",
      "delivered",
    ]);
  });

  it("sorts and paginates the filtered order collection", () => {
    const rows = [
      order({ id: "1", orderNumber: "ORD-003", price: 300 }),
      order({ id: "2", orderNumber: "ORD-001", price: 100 }),
      order({ id: "3", orderNumber: "ORD-002", price: 200 }),
    ];

    expect(
      sortOrders(rows, "orderNumber", "asc").map((item) => item.id),
    ).toEqual(["2", "3", "1"]);
    expect(sortOrders(rows, "total", "desc").map((item) => item.id)).toEqual([
      "1",
      "3",
      "2",
    ]);
    expect(paginateOrders(rows, 2, 2).map((item) => item.id)).toEqual(["3"]);
  });
});

describe("canEditOrder", () => {
  it("allows editing before the parcel is with the carrier", () => {
    expect(canEditOrder(order({ status: "new", trackingNumber: null }))).toBe(
      true,
    );
    expect(canEditOrder(order({ status: "ready", trackingNumber: null }))).toBe(
      true,
    );
    expect(
      canEditOrder(order({ status: "assigned", trackingNumber: null })),
    ).toBe(true);
  });

  it("locks the order once the parcel is with the carrier", () => {
    expect(
      canEditOrder(order({ status: "dispatched", trackingNumber: "NE1DZ" })),
    ).toBe(false);
    expect(
      canEditOrder(
        order({ status: "out_for_delivery", trackingNumber: "NE1DZ" }),
      ),
    ).toBe(false);
    expect(
      canEditOrder(order({ status: "delivered", trackingNumber: "NE1DZ" })),
    ).toBe(false);
    expect(
      canEditOrder(order({ status: "returned", trackingNumber: "NE1DZ" })),
    ).toBe(false);
    expect(
      canEditOrder(order({ status: "cancelled", trackingNumber: null })),
    ).toBe(false);
  });
});

describe("order lifecycle groups", () => {
  it("maps every status into exactly one non-'all' group", () => {
    const statuses = ORDER_GROUPS.filter(
      (group) => group.key !== "all",
    ).flatMap((group) => group.statuses ?? []);
    expect(new Set(statuses).size).toBe(statuses.length);
    expect(statuses.sort()).toEqual(
      [
        "assigned",
        "cancelled",
        "confirmed",
        "delivered",
        "dispatched",
        "new",
        "out_for_delivery",
        "preparing",
        "ready",
        "returned",
        "unreachable",
      ].sort(),
    );
  });

  it("buckets each status into the agreed section", () => {
    const cases: Record<OrderStatus, OrderGroupKey> = {
      new: "new",
      confirmed: "confirmed",
      unreachable: "in_progress",
      preparing: "following",
      ready: "following",
      assigned: "following",
      dispatched: "following",
      out_for_delivery: "following",
      delivered: "delivered",
      returned: "returned",
      cancelled: "cancelled",
    };
    for (const [status, key] of Object.entries(cases) as [
      OrderStatus,
      OrderGroupKey,
    ][]) {
      const grouped = groupOrders([order({ status })], key);
      expect(grouped).toHaveLength(1);
    }
  });

  it("filters and counts by group", () => {
    const rows = [
      order({ id: "1", status: "new" }),
      order({ id: "2", status: "new" }),
      order({ id: "3", status: "confirmed" }),
      order({ id: "4", status: "unreachable" }),
      order({ id: "5", status: "dispatched" }),
      order({ id: "6", status: "delivered" }),
      order({ id: "7", status: "returned" }),
      order({ id: "8", status: "cancelled" }),
    ];
    expect(groupOrders(rows, "all")).toHaveLength(8);
    expect(groupOrders(rows, "new")).toHaveLength(2);
    expect(groupOrders(rows, "in_progress")).toHaveLength(1);
    expect(groupOrders(rows, "following")).toHaveLength(1);
    const counts = orderGroupCounts(rows);
    expect(counts.all).toBe(8);
    expect(counts.new).toBe(2);
    expect(counts.confirmed).toBe(1);
    expect(counts.in_progress).toBe(1);
    expect(counts.following).toBe(1);
    expect(counts.delivered).toBe(1);
    expect(counts.returned).toBe(1);
    expect(counts.cancelled).toBe(1);
  });
});

describe("order creation-date filtering", () => {
  const baseFilters = {
    query: "",
    status: "all",
    delivery: "all",
    wilaya: "all",
    type: "all",
    dateFrom: "",
    dateTo: "",
  };

  it("keeps only orders within the inclusive date range", () => {
    const rows = [
      order({ id: "a", createdAt: "2026-09-01T12:00:00.000Z" }),
      order({ id: "b", createdAt: "2026-09-10T12:00:00.000Z" }),
      order({ id: "c", createdAt: "2026-09-20T12:00:00.000Z" }),
    ];
    const from = localDateKey(rows[1].createdAt);
    const to = localDateKey(rows[2].createdAt);
    expect(
      filterOrders(rows, { ...baseFilters, dateFrom: from, dateTo: to }).map(
        (row) => row.id,
      ),
    ).toEqual(["b", "c"]);
    expect(localDateKey(rows[0].createdAt) < from).toBe(true);
  });
});

describe("duplicate order grouping", () => {
  it("collapses orders with the same phone into one unit, newest first", () => {
    const rows = [
      order({
        id: "a",
        phone: "0550000000",
        createdAt: "2026-09-26T10:00:00.000Z",
      }),
      order({
        id: "b",
        phone: "0550000000",
        createdAt: "2026-09-26T10:05:00.000Z",
      }),
      order({ id: "c", phone: "0661111111" }),
    ];
    const units = groupDuplicateOrders(rows);
    expect(units).toHaveLength(2);
    const pair = units.find((unit) => unit.primary.phone === "0550000000")!;
    expect(pair.primary.id).toBe("b");
    expect(pair.duplicates.map((dup) => dup.id)).toEqual(["a"]);
    const single = units.find((unit) => unit.primary.phone === "0661111111")!;
    expect(single.duplicates).toHaveLength(0);
  });

  it("keeps first-appearance order and stacks 3+ copies", () => {
    const rows = [
      order({ id: "z", phone: "0770000000" }),
      order({ id: "y", phone: "0550000000" }),
      order({ id: "x", phone: "0770000000" }),
      order({ id: "w", phone: "0770000000" }),
    ];
    const units = groupDuplicateOrders(rows);
    expect(units.map((unit) => unit.primary.phone)).toEqual([
      "0770000000",
      "0550000000",
    ]);
    expect(units[0].duplicates).toHaveLength(2);
  });
});
