import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => seam);

import { updateOrder, bulkUpdateOrderStatus, bulkDeleteOrders } from "./api";

describe("orders API adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seam.apiFetch.mockResolvedValue({ success: true, data: {} });
  });

  it("PATCHes the order endpoint with an encoded id and the full body", async () => {
    await updateOrder("order/1", {
      customerName: "Ahmed",
      phone: "0551234567",
      wilayaId: 16,
      communeId: "c-16-001",
      address: "New address",
      deliveryType: "home",
      notes: null,
    });
    expect(seam.apiFetch).toHaveBeenLastCalledWith(
      "/api/orders/order%2F1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          customerName: "Ahmed",
          phone: "0551234567",
          wilayaId: 16,
          communeId: "c-16-001",
          address: "New address",
          deliveryType: "home",
          notes: null,
        }),
      }),
    );
  });

  it("sends only the supplied fields", async () => {
    await updateOrder("order-1", { communeId: "c-16-001" });
    expect(seam.apiFetch).toHaveBeenLastCalledWith(
      "/api/orders/order-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ communeId: "c-16-001" }),
      }),
    );
  });
});

describe("bulk order actions", () => {
  it("PATCHes the status endpoint once per selected id and counts outcomes", async () => {
    seam.apiFetch.mockImplementation(async (path: string) => {
      if (path.includes("/3/")) throw new Error("invalid transition");
      return { success: true, data: null };
    });
    const result = await bulkUpdateOrderStatus(["1", "2", "3"], "cancelled");
    expect(result).toEqual({ ok: 2, failed: 1 });
    expect(seam.apiFetch).toHaveBeenNthCalledWith(
      1,
      "/api/orders/1/status",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }),
    );
  });

  it("DELETEs each selected id and encodes them", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: null });
    const result = await bulkDeleteOrders(["a/b", "c"]);
    expect(result).toEqual({ ok: 2, failed: 0 });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/orders/a%2Fb", expect.objectContaining({ method: "DELETE" }));
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/orders/c", expect.objectContaining({ method: "DELETE" }));
  });

  it("reports all-failed without throwing", async () => {
    seam.apiFetch.mockRejectedValue(new Error("network down"));
    const result = await bulkDeleteOrders(["x", "y"]);
    expect(result).toEqual({ ok: 0, failed: 2 });
  });
});