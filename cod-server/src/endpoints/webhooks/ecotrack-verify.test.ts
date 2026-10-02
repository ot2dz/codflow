import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyEcotrackSignature } from "./ecotrack-verify";

const SECRET = "whsec_test_ecotrack_signature_2026";

function sign(body: string, secret: string = SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyEcotrackSignature", () => {
  it("accepts a signature computed over the exact raw body", async () => {
    const body = '{"event":"order.state.en_livraison","tracking":"ECO-1"}';
    expect(await verifyEcotrackSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body (signature over different raw bytes)", async () => {
    const signed = '{"event":"order.state.en_livraison","tracking":"ECO-1"}';
    const delivered = '{"event":"order.state.en_livraison","tracking":"ECO-2"}';
    expect(await verifyEcotrackSignature(delivered, sign(signed), SECRET)).toBe(false);
  });

  it("rejects the wrong secret", async () => {
    const body = '{"a":1}';
    expect(await verifyEcotrackSignature(body, sign(body, "other-secret"), SECRET)).toBe(false);
  });

  it("rejects missing/garbled header forms", async () => {
    const body = '{"a":1}';
    expect(await verifyEcotrackSignature(body, null, SECRET)).toBe(false);
    expect(await verifyEcotrackSignature(body, "", SECRET)).toBe(false);
    // no sha256= prefix
    expect(
      await verifyEcotrackSignature(body, createHmac("sha256", SECRET).update(body).digest("hex"), SECRET),
    ).toBe(false);
    // wrong digest length
    expect(await verifyEcotrackSignature(body, "sha256=abcd", SECRET)).toBe(false);
    // non-hex digest
    expect(await verifyEcotrackSignature(body, "sha256=" + "z".repeat(64), SECRET)).toBe(false);
  });

  it("accepts uppercase hex digest", async () => {
    const body = '{"a":1}';
    const sig = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex").toUpperCase();
    expect(await verifyEcotrackSignature(body, sig, SECRET)).toBe(true);
  });

  it("rejects an empty secret even against a valid-looking header", async () => {
    const body = '{"a":1}';
    expect(await verifyEcotrackSignature(body, sign(body), "")).toBe(false);
  });

  it('re-serialised JSON with reordered keys fails (raw-bytes contract)', async () => {
    const raw = '{"tracking":"ECO-1","event":"order.state.en_livraison"}';
    const reparsed = JSON.stringify(JSON.parse(raw).event === undefined ? {} : { event: "order.state.en_livraison", tracking: "ECO-1" });
    expect(await verifyEcotrackSignature(reparsed, sign(raw), SECRET)).toBe(false);
  });
});
