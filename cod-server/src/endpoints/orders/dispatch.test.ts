import { describe, expect, it } from "vitest";
import {
  buildShipmentProductDescription,
  CARRIER_DESCRIPTION_MAX,
} from "./dispatch";

describe("buildShipmentProductDescription", () => {
  it("falls back to the order number when there are no lines", () => {
    expect(buildShipmentProductDescription("ORD-1", undefined)).toBe("ORD-1");
    expect(buildShipmentProductDescription("ORD-1", [])).toBe("ORD-1");
  });

  it("carries the customer's variant selection in parentheses", () => {
    expect(
      buildShipmentProductDescription("ORD-1", [
        { productName: "ملصقات الكراسات", variantLabel: "بنات، 12 قطعة", quantity: 1 },
      ]),
    ).toBe("ملصقات الكراسات (بنات، 12 قطعة) — ORD-1");
  });

  it("marks per-line quantities above one", () => {
    expect(
      buildShipmentProductDescription("ORD-2", [
        { productName: "حقيبة", variantLabel: null, quantity: 3 },
      ]),
    ).toBe("حقيبة ×3 — ORD-2");
  });

  it("keeps distinct variants as distinct parts but collapses identical ones", () => {
    const description = buildShipmentProductDescription("ORD-3", [
      { productName: "حقيبة", variantLabel: "أحمر", quantity: 1 },
      { productName: "حقيبة", variantLabel: "أزرق", quantity: 1 },
      { productName: "حقيبة", variantLabel: "أحمر", quantity: 1 },
    ]);
    expect(description).toContain("حقيبة (أحمر)");
    expect(description).toContain("حقيبة (أزرق)");
    expect(description.split("حقيبة (أحمر)")).toHaveLength(2);
  });

  it("skips lines without a product name", () => {
    expect(
      buildShipmentProductDescription("ORD-4", [
        { productName: null, variantLabel: "X", quantity: 2 },
        { productName: "دفتر", variantLabel: null, quantity: 1 },
      ]),
    ).toBe("دفتر — ORD-4");
  });

  it("truncates to the carrier field limit", () => {
    const big = Array.from({ length: 40 }, (_, i) => ({
      productName: `منتج طويل جدا للاستعراض ${i}`,
      variantLabel: "اختيار طويل كذلك بأحرف كثيرة",
      quantity: 5,
    }));
    const description = buildShipmentProductDescription("ORD-5", big);
    expect(description.length).toBeLessThanOrEqual(CARRIER_DESCRIPTION_MAX);
    expect(description.endsWith("…")).toBe(true);
  });
});
