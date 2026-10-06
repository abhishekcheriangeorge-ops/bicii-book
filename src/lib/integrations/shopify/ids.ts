/**
 * Shopify ids as gids (Phase 10; DATA-MODEL §13). Pure.
 *
 * toShopifyGid follows private.shopify_gid exactly (tests/db/
 * shopify-gid-parity.test.ts runs one table through both): the value is
 * trimmed of spaces (Postgres btrim: spaces only), then 1-20 ASCII digits
 * become gid://shopify/<Kind>/<digits>, a gid of that kind is kept, null
 * stays null and anything else is refused.
 */

export const SHOPIFY_GID_KINDS = [
  "Product",
  "ProductVariant",
  "InventoryItem",
  "Location",
  "Order",
  "LineItem",
  "Refund",
  "Customer",
] as const;

export type ShopifyGidKind = (typeof SHOPIFY_GID_KINDS)[number];

/** A value that is not a Shopify id of the kind asked for (shopify_gid_invalid). */
export class ShopifyGidError extends Error {
  readonly code = "shopify_gid_invalid";
  constructor(
    readonly kind: string,
    readonly value: string,
  ) {
    super(`That is not a valid Shopify ${kind} ID.`);
    this.name = "ShopifyGidError";
  }
}

function isKind(kind: string): kind is ShopifyGidKind {
  return (SHOPIFY_GID_KINDS as readonly string[]).includes(kind);
}

/** Postgres btrim(text): leading and trailing spaces only. */
function btrim(value: string): string {
  return value.replace(/^ +| +$/g, "");
}

/** Throws RangeError for an unknown kind (Postgres: 22023), ShopifyGidError for a bad value. */
export function toShopifyGid(
  kind: ShopifyGidKind | (string & {}),
  value: string | number | null,
): string | null {
  if (!isKind(kind)) throw new RangeError(`unknown Shopify id kind ${kind}`);
  if (value === null) return null;
  const v = btrim(String(value));
  if (/^[0-9]{1,20}$/.test(v)) return `gid://shopify/${kind}/${v}`;
  if (new RegExp(`^gid://shopify/${kind}/[0-9]{1,20}$`).test(v)) return v;
  throw new ShopifyGidError(kind, String(value));
}

/** The kind and numeric id of a gid, or null when it is not one. */
export function parseShopifyGid(gid: string): { kind: ShopifyGidKind; id: string } | null {
  const m = /^gid:\/\/shopify\/([A-Za-z]+)\/([0-9]{1,20})$/.exec(gid);
  if (!m || !isKind(m[1])) return null;
  return { kind: m[1], id: m[2] };
}

/** D84: the handle of a Shopify product BICII creates (P-000123 -> bicii-p-000123); private.shopify_handle. */
export function shopifyHandle(shortId: string): string {
  return `bicii-${shortId.toLowerCase()}`;
}
