import { createHash } from "node:crypto";

import type { ShopifyIds } from "./admin";

/**
 * The fake adapter's deterministic Shopify ids (Phase 10; matches the
 * seed): the number in a BICII handle n (bicii-p-000123 -> 123) gives
 * Product 9000000000 + n, ProductVariant 9100000000 + n and InventoryItem
 * 9200000000 + n. A handle without digits gets n from its SHA-256 (below
 * 10^8). The one fake location is Location 9300000001. Pure.
 */
export const FAKE_LOCATION_GID = "gid://shopify/Location/9300000001";

function handleNumber(handle: string): number {
  const digits = handle.match(/(\d+)\s*$/)?.[1];
  if (digits && digits.length <= 8) return Number(digits);
  const hex = createHash("sha256").update(handle).digest("hex").slice(0, 12);
  return Number.parseInt(hex, 16) % 100_000_000;
}

export function fakeShopifyIds(handle: string): ShopifyIds {
  const n = handleNumber(handle);
  return {
    productId: `gid://shopify/Product/${9_000_000_000 + n}`,
    variantId: `gid://shopify/ProductVariant/${9_100_000_000 + n}`,
    inventoryItemId: `gid://shopify/InventoryItem/${9_200_000_000 + n}`,
  };
}
