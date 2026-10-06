/**
 * Shopify gids and handles (DATA-MODEL §13; D84). The table shared with
 * the database parity test lives in tests/fixtures/shopify-gids.ts.
 */
import { describe, expect, it } from "vitest";

import {
  ShopifyGidError,
  parseShopifyGid,
  shopifyHandle,
  toShopifyGid,
} from "@/lib/integrations/shopify/ids";
import { fakeShopifyIds, FAKE_LOCATION_GID } from "@/lib/integrations/shopify/fake-ids";

import { SHOPIFY_GID } from "../fixtures/ids";
import { SHOPIFY_GID_CASES } from "../fixtures/shopify-gids";

describe("toShopifyGid", () => {
  it.each(SHOPIFY_GID_CASES)("$kind $value -> $expected", ({ kind, value, expected }) => {
    if (expected === "invalid") {
      expect(() => toShopifyGid(kind, value)).toThrow(ShopifyGidError);
    } else {
      expect(toShopifyGid(kind, value)).toBe(expected);
    }
  });

  it("accepts numbers as Shopify's REST payloads send them", () => {
    expect(toShopifyGid("Order", 7000001001)).toBe("gid://shopify/Order/7000001001");
  });

  it("refuses an unknown kind", () => {
    expect(() => toShopifyGid("Collection", "1")).toThrow(RangeError);
  });

  it("names the kind in the refusal", () => {
    expect(() => toShopifyGid("Location", "abc")).toThrow(
      "That is not a valid Shopify Location ID.",
    );
  });
});

describe("parseShopifyGid", () => {
  it("splits a gid into kind and id", () => {
    expect(parseShopifyGid("gid://shopify/ProductVariant/9100000027")).toEqual({
      kind: "ProductVariant",
      id: "9100000027",
    });
  });

  it("returns null for anything else", () => {
    for (const v of [
      "",
      "123",
      "gid://shopify/Collection/1",
      "gid://shopify/Product/",
      "gid://shopify/Product/1/2",
    ]) {
      expect(parseShopifyGid(v)).toBeNull();
    }
  });
});

describe("handles and fake ids", () => {
  it("builds bicii-<short id lower-cased>", () => {
    expect(shopifyHandle("P-000027")).toBe("bicii-p-000027");
  });

  it("derives the seed's ids from a handle's number", () => {
    expect(fakeShopifyIds("bicii-p-000027")).toEqual({
      productId: SHOPIFY_GID.syncedTyreProduct,
      variantId: SHOPIFY_GID.syncedTyreVariant,
      inventoryItemId: SHOPIFY_GID.syncedTyreInventoryItem,
    });
    expect(FAKE_LOCATION_GID).toBe(SHOPIFY_GID.location);
  });

  it("is deterministic for a handle without digits", () => {
    expect(fakeShopifyIds("no-digits")).toEqual(fakeShopifyIds("no-digits"));
    expect(fakeShopifyIds("no-digits").productId).toMatch(/^gid:\/\/shopify\/Product\/9\d{9}$/);
  });
});
