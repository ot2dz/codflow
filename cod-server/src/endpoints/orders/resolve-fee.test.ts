/**
 * resolve-fee — Free Shipping Product
 *
 * applyFreeShippingProducts zeroes the delivery fee ONLY when every product in
 * the order is tagged `free_shipping`. A single untagged line keeps the fee.
 * It composes with applyFreeShippingOffer (cart-based, trigger product + qty).
 */
import { describe, expect, it } from "vitest";
import { makeMockDb, a } from "@/test-utils/mock-db";
import { applyFreeShippingProducts } from "./resolve-fee";

/** Partial select is { id, freeShipping } → rows carry exactly those columns. */
function productRows(...flags: boolean[]) {
  return a(flags.map((flag, i) => ({ id: `p${i + 1}`, free_shipping: flag ? 1 : 0 })));
}

describe("applyFreeShippingProducts", () => {
  it("returns 0 when every product is tagged", async () => {
    const db = makeMockDb([productRows(true, true)]);
    await expect(applyFreeShippingProducts(db, 600, ["p1", "p2"])).resolves.toBe(0);
  });

  it("keeps the fee when any product is untagged", async () => {
    const db = makeMockDb([productRows(true, false)]);
    await expect(applyFreeShippingProducts(db, 600, ["p1", "p2"])).resolves.toBe(600);
  });

  it("keeps the fee when every product is untagged", async () => {
    const db = makeMockDb([productRows(false, false)]);
    await expect(applyFreeShippingProducts(db, 600, ["p1", "p2"])).resolves.toBe(600);
  });

  it("dedupes repeated product lines before the all-free check", async () => {
    const db = makeMockDb([productRows(true)]);
    await expect(applyFreeShippingProducts(db, 600, ["p1", "p1", "p1"])).resolves.toBe(0);
  });

  it("keeps the fee when a tagged product cannot be resolved (unknown id)", async () => {
    // Requested p1 + p2 but only p1 came back → not every line verified free.
    const db = makeMockDb([productRows(true)]);
    await expect(applyFreeShippingProducts(db, 600, ["p1", "p2"])).resolves.toBe(600);
  });

  it("short-circuits an already-zero fee without querying", async () => {
    // No queue consumed — a missing queue entry would still return 0.
    const db = makeMockDb([]);
    await expect(applyFreeShippingProducts(db, 0, ["p1"])).resolves.toBe(0);
  });

  it("returns the fee unchanged for an empty product list", async () => {
    const db = makeMockDb([]);
    await expect(applyFreeShippingProducts(db, 600, [])).resolves.toBe(600);
  });
});
