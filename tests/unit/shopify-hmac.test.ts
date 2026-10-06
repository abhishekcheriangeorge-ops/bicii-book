// @vitest-environment node
/**
 * Shopify webhook signatures (D88; SPEC §17.1): the HMAC is checked on the
 * raw bytes, in constant time, and anything odd is simply "not valid".
 */
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyShopifyHmac } from "@/lib/integrations/shopify/hmac";

import { SHOPIFY_TEST_SECRET, signShopifyBody } from "../fixtures/shopify";

const enc = (s: string) => new TextEncoder().encode(s);
const body = JSON.stringify({ id: 7000002001, name: "#2001", total: "120.00" });

describe("verifyShopifyHmac", () => {
  it("accepts Shopify's signature of the exact body", () => {
    expect(verifyShopifyHmac(enc(body), signShopifyBody(body), SHOPIFY_TEST_SECRET)).toBe(true);
  });

  it("refuses a body with one byte flipped", () => {
    const bytes = enc(body);
    bytes[10] ^= 0x01;
    expect(verifyShopifyHmac(bytes, signShopifyBody(body), SHOPIFY_TEST_SECRET)).toBe(false);
  });

  it("refuses another secret's signature", () => {
    expect(
      verifyShopifyHmac(enc(body), signShopifyBody(body, "another-secret"), SHOPIFY_TEST_SECRET),
    ).toBe(false);
    expect(verifyShopifyHmac(enc(body), signShopifyBody(body), "")).toBe(false);
  });

  it("refuses a missing, empty, truncated, padded-wrong or garbage header without throwing", () => {
    const good = signShopifyBody(body);
    for (const header of [
      null,
      undefined,
      "",
      " ",
      good.slice(0, 20),
      good.slice(0, -1),
      `${good}=`,
      "not base64 at all!!",
      "%%%%",
      good.replace(/=$/, ""),
    ]) {
      expect(verifyShopifyHmac(enc(body), header, SHOPIFY_TEST_SECRET)).toBe(false);
    }
  });

  it("refuses a hex digest (Shopify sends base64)", () => {
    const hex = createHmac("sha256", SHOPIFY_TEST_SECRET).update(body).digest("hex");
    expect(verifyShopifyHmac(enc(body), hex, SHOPIFY_TEST_SECRET)).toBe(false);
  });

  it("verifies multibyte UTF-8 on the bytes, not on a re-encoded string", () => {
    const text = JSON.stringify({ note: "Café Ñandú 🚲 – 東京" });
    const bytes = Buffer.from(text, "utf8");
    expect(verifyShopifyHmac(bytes, signShopifyBody(text), SHOPIFY_TEST_SECRET)).toBe(true);
    // The same characters as Latin-1 bytes are a different body.
    const latin1 = Buffer.from(text, "latin1");
    expect(verifyShopifyHmac(latin1, signShopifyBody(text), SHOPIFY_TEST_SECRET)).toBe(false);
  });

  it("tolerates surrounding whitespace in the header", () => {
    expect(verifyShopifyHmac(enc(body), ` ${signShopifyBody(body)} `, SHOPIFY_TEST_SECRET)).toBe(
      true,
    );
  });
});
