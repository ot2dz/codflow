/**
 * EcoTrack Webhook Signature Verification
 *
 * EcoTrack signs every delivery with an HMAC-SHA256 of the RAW request body
 * keyed by the endpoint's secret, sent as:
 *
 *   X-ECOTRACK-Signature: sha256=<lowercase_hex_digest>
 *
 * (Shipper Integration Guide, §3 — "Authenticating requests".) The digest
 * MUST be computed over the raw bytes before any JSON parsing, and compared
 * in constant time. A missing `sha256=` prefix or a non-hex digest fails
 * closed.
 */

const PREFIX = "sha256=";
const HEX_LEN = 64;

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Constant-time equality — no early exit, no length leak beyond mismatch. */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyEcotrackSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;

  const header = signatureHeader.trim();
  if (!header.startsWith(PREFIX)) return false;

  const receivedHex = header.slice(PREFIX.length).toLowerCase();
  if (receivedHex.length !== HEX_LEN) return false;
  const received = hexToBytes(receivedHex);
  if (!received) return false;

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(rawBody)),
  );

  return timingSafeEqualBytes(received, expected);
}
