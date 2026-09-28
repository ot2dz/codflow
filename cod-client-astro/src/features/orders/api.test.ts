import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => seam);

import { updateOrder } from "./api";

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
