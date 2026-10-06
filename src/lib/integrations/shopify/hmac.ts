import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shopify webhook signatures (SPEC §17.1; D88). X-Shopify-Hmac-Sha256 is
 * the base64 HMAC-SHA256 of the RAW request body with the app's webhook
 * secret. The check runs on the exact bytes received, before anything is
 * decoded or parsed (re-serialised JSON would not match), and compares in
 * constant time. Never throws: a missing, malformed or wrong header is
 * simply false.
 */
export function verifyShopifyHmac(
  rawBody: Uint8Array,
  header: string | null | undefined,
  secret: string,
): boolean {
  try {
    if (!header || !secret) return false;
    const value = header.trim();
    // Strict base64 of 32 bytes: 43 characters and one '=' pad.
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
    const received = Buffer.from(value, "base64");
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    if (received.length !== expected.length) return false;
    return timingSafeEqual(received, expected);
  } catch {
    return false;
  }
}
