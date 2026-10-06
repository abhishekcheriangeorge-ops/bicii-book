/**
 * One table of Shopify id inputs, run through the TypeScript
 * toShopifyGid (tests/unit/shopify-ids.test.ts) and Postgres
 * private.shopify_gid (tests/db/shopify-gid-parity.test.ts), so the two
 * agree (DATA-MODEL §13).
 */
export type GidCase = {
  kind:
    | "Product"
    | "ProductVariant"
    | "InventoryItem"
    | "Location"
    | "Order"
    | "LineItem"
    | "Refund"
    | "Customer";
  value: string | null;
  /** The gid, null for null, or "invalid" (shopify_gid_invalid). */
  expected: string | null | "invalid";
};

export const SHOPIFY_GID_CASES: GidCase[] = [
  { kind: "Product", value: "9000000027", expected: "gid://shopify/Product/9000000027" },
  {
    kind: "ProductVariant",
    value: "  9100000027  ",
    expected: "gid://shopify/ProductVariant/9100000027",
  },
  {
    kind: "InventoryItem",
    value: "gid://shopify/InventoryItem/9200000027",
    expected: "gid://shopify/InventoryItem/9200000027",
  },
  {
    kind: "Location",
    value: " gid://shopify/Location/9300000001 ",
    expected: "gid://shopify/Location/9300000001",
  },
  { kind: "Order", value: "1", expected: "gid://shopify/Order/1" },
  {
    kind: "LineItem",
    value: "12345678901234567890",
    expected: "gid://shopify/LineItem/12345678901234567890",
  },
  { kind: "Refund", value: "123456789012345678901", expected: "invalid" },
  { kind: "Customer", value: null, expected: null },
  { kind: "Product", value: "", expected: "invalid" },
  { kind: "Product", value: "   ", expected: "invalid" },
  { kind: "Product", value: "-1", expected: "invalid" },
  { kind: "Product", value: "1.5", expected: "invalid" },
  { kind: "Product", value: "12a", expected: "invalid" },
  { kind: "Product", value: "\t123", expected: "invalid" },
  { kind: "Product", value: "123\n", expected: "invalid" },
  { kind: "Product", value: "١٢٣", expected: "invalid" },
  { kind: "Product", value: "gid://shopify/ProductVariant/1", expected: "invalid" },
  { kind: "Product", value: "gid://shopify/product/1", expected: "invalid" },
  { kind: "Product", value: "GID://shopify/Product/1", expected: "invalid" },
  { kind: "Product", value: "gid://shopify/Product/", expected: "invalid" },
  { kind: "Product", value: "gid://shopify/Product/1/2", expected: "invalid" },
  { kind: "Product", value: "gid://shopify/Product/1?x=1", expected: "invalid" },
  {
    kind: "Order",
    value: "gid://shopify/Order/7000001001",
    expected: "gid://shopify/Order/7000001001",
  },
  { kind: "Customer", value: "7200000001", expected: "gid://shopify/Customer/7200000001" },
];
