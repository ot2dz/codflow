import { describe, it, expect } from "vitest";
import {
  applyWaTemplate,
  buildOrderWaMessage,
  buildWaUrl,
  normalizeAlgerianPhoneToWa,
  DEFAULT_WA_TEMPLATE,
} from "./whatsapp";

describe("normalizeAlgerianPhoneToWa", () => {
  it("normalises the local 0X form to 213", () => {
    expect(normalizeAlgerianPhoneToWa("0662839224")).toBe("213662839224");
  });

  it("accepts spaced, dashed and plus-prefixed inputs", () => {
    expect(normalizeAlgerianPhoneToWa("+213 662 83 92 24")).toBe("213662839224");
    expect(normalizeAlgerianPhoneToWa("06-62-83-92-24")).toBe("213662839224");
    expect(normalizeAlgerianPhoneToWa("00213662839224")).toBe("213662839224");
  });

  it("accepts a bare national number without the leading 0", () => {
    expect(normalizeAlgerianPhoneToWa("555123456")).toBe("213555123456");
    expect(normalizeAlgerianPhoneToWa("77718210".padEnd(9, "0"))).toBe("213777182100");
  });

  it("rejects garbage", () => {
    expect(normalizeAlgerianPhoneToWa("123")).toBeNull();
    expect(normalizeAlgerianPhoneToWa("abcdefghij")).toBeNull();
    expect(normalizeAlgerianPhoneToWa("")).toBeNull();
    expect(normalizeAlgerianPhoneToWa("1234567890123456")).toBeNull();
  });
});

describe("buildWaUrl", () => {
  it("encodes the message as the text param", () => {
    const url = buildWaUrl("0555123456", "مرحبا أحمد")!;
    expect(url.startsWith("https://wa.me/213555123456?text=")).toBe(true);
    expect(decodeURIComponent(url.split("?text=")[1])).toBe("مرحبا أحمد");
  });

  it("returns null for an un-dialable number", () => {
    expect(buildWaUrl("123", "hi")).toBeNull();
  });
});

describe("applyWaTemplate", () => {
  it("replaces known tokens and leaves unknown ones visible", () => {
    expect(applyWaTemplate("{a}/{b}", { a: "1" })).toBe("1/{b}");
  });

  it("fills the order vars in the default template", () => {
    const message = buildOrderWaMessage(
      {
        customerName: "محمد",
        orderNumber: "ORD-1",
        status: "dispatched",
        wilaya: "الجزائر",
        price: 1500,
        deliveryFee: 0,
      },
      "قيد التوصيل",
      DEFAULT_WA_TEMPLATE,
    );
    expect(message).toContain("محمد");
    expect(message).toContain("ORD-1");
    expect(message).toContain("قيد التوصيل");
    expect(message).toContain("1500");
    expect(message).not.toMatch(/(customer|order|status|total|wilaya)\}/);
  });
});
