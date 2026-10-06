// @vitest-environment node
/**
 * The in-memory Shopify (local development, tests, E2E): deterministic
 * ids matching the seed, productSet idempotent by handle, the compare
 * quantity enforced (D83), a Shopify-made product's other variants left
 * alone (D84), and injected failures.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ShopifyError } = await import("@/lib/integrations/shopify/admin");
const { createFakeShopifyAdmin } = await import("@/lib/integrations/shopify/fake-admin");
const { FAKE_LOCATION_GID } = await import("@/lib/integrations/shopify/fake-ids");

const INPUT = {
  handle: "bicii-p-000123",
  title: "Bottle",
  descriptionHtml: "",
  vendor: "BICII",
  status: "ACTIVE" as const,
  sku: "P-000123",
  price: "25.00",
  imageUrls: [],
};

const IDS = {
  productId: "gid://shopify/Product/9000000123",
  variantId: "gid://shopify/ProductVariant/9100000123",
  inventoryItemId: "gid://shopify/InventoryItem/9200000123",
};

let fake: ReturnType<typeof createFakeShopifyAdmin>;
beforeEach(() => {
  fake = createFakeShopifyAdmin();
});

const setQty = (
  quantity: number,
  compareQuantity: number | null,
  key = `k-${quantity}-${compareQuantity}`,
) =>
  fake.setAvailableQuantity({
    inventoryItemId: IDS.inventoryItemId,
    locationId: FAKE_LOCATION_GID,
    quantity,
    compareQuantity,
    idempotencyKey: key,
    reference: INPUT.handle,
  });

describe("fake Shopify", () => {
  it("derives ids from the handle's digits", async () => {
    expect(fake.mode).toBe("fake");
    expect(await fake.upsertProduct(INPUT, null)).toEqual(IDS);
    expect(await fake.primaryLocationId()).toBe("gid://shopify/Location/9300000001");
  });

  it("is idempotent by handle and updates by id without a second product", async () => {
    await fake.upsertProduct(INPUT, null);
    await fake.upsertProduct({ ...INPUT, title: "Bottle 2" }, null);
    await fake.upsertProduct(
      { ...INPUT, status: "DRAFT", price: "26.00" },
      { productId: IDS.productId },
    );
    expect(fake.products.size).toBe(1);
    expect(fake.products.get(IDS.productId)).toMatchObject({ title: "Bottle", status: "DRAFT" });
    expect(fake.variants.get(IDS.variantId)?.price).toBe("26.00");
    expect(fake.calls.map((c) => c.kind)).toEqual(["productSet", "productSet", "productSet"]);
  });

  it("keeps the last price when productSet sends none", async () => {
    await fake.upsertProduct(INPUT, null);
    await fake.upsertProduct(
      { ...INPUT, price: null, status: "DRAFT" },
      { productId: IDS.productId },
    );
    expect(fake.variants.get(IDS.variantId)?.price).toBe("25.00");
  });

  it("refuses an update of a product it does not know (not derivable from the handle)", async () => {
    await expect(
      fake.upsertProduct(INPUT, { productId: "gid://shopify/Product/1" }),
    ).rejects.toMatchObject({ code: "shopify_user_error", retriable: false });
    // The seed's ids are derivable from the handle: accepted.
    await expect(fake.upsertProduct(INPUT, { productId: IDS.productId })).resolves.toEqual(IDS);
  });

  it("enforces the compare quantity and accepts an overwrite without one", async () => {
    await fake.upsertProduct(INPUT, null);
    await setQty(10, null);
    await setQty(8, 10);
    expect(fake.quantities.get(IDS.inventoryItemId)).toBe(8);
    await expect(setQty(7, 10)).rejects.toMatchObject({
      code: "shopify_quantity_changed",
      retriable: true,
    });
    expect(fake.quantities.get(IDS.inventoryItemId)).toBe(8);
    await setQty(7, null);
    expect(fake.quantities.get(IDS.inventoryItemId)).toBe(7);
  });

  it("applies one idempotency key once", async () => {
    await fake.upsertProduct(INPUT, null);
    await setQty(5, null, "same");
    fake.simulateCheckout(IDS.inventoryItemId, 1);
    await setQty(5, null, "same");
    expect(fake.quantities.get(IDS.inventoryItemId)).toBe(4);
  });

  it("simulateCheckout moves Shopify's count so the next compare fails", async () => {
    fake.seedProduct(IDS, 20, INPUT.handle);
    fake.simulateCheckout(IDS.inventoryItemId, 2);
    expect(fake.quantities.get(IDS.inventoryItemId)).toBe(18);
    await expect(setQty(20, 20)).rejects.toBeInstanceOf(ShopifyError);
  });

  it("updates one variant of a Shopify-made product and leaves the others alone", async () => {
    const product = "gid://shopify/Product/8800000001";
    fake.seedExternalProduct({
      productId: product,
      variants: [
        {
          variantId: "gid://shopify/ProductVariant/8810000001",
          inventoryItemId: "gid://shopify/InventoryItem/8820000001",
          price: "10.00",
          quantity: 3,
        },
        {
          variantId: "gid://shopify/ProductVariant/8810000002",
          inventoryItemId: "gid://shopify/InventoryItem/8820000002",
          price: "11.00",
          quantity: 4,
        },
      ],
    });
    expect(
      await fake.updateVariantPrice({
        productId: product,
        variantId: "gid://shopify/ProductVariant/8810000002",
        price: "12.00",
      }),
    ).toEqual({ inventoryItemId: "gid://shopify/InventoryItem/8820000002" });
    expect(fake.variants.get("gid://shopify/ProductVariant/8810000001")?.price).toBe("10.00");
    expect(fake.variants.get("gid://shopify/ProductVariant/8810000002")?.price).toBe("12.00");
    expect(fake.products.get(product)?.variantIds).toHaveLength(2);
    expect(fake.quantities.get("gid://shopify/InventoryItem/8820000001")).toBe(3);
  });

  it("refuses a price update of an unknown variant (not retriable)", async () => {
    await expect(
      fake.updateVariantPrice({
        productId: IDS.productId,
        variantId: IDS.variantId,
        price: "1.00",
      }),
    ).rejects.toMatchObject({ code: "shopify_user_error", retriable: false });
  });

  it("refuses an inventory write for an unknown item", async () => {
    await expect(setQty(1, null)).rejects.toMatchObject({ code: "shopify_user_error" });
  });

  it("failNext throws once, optionally only for one kind of call", async () => {
    fake.failNext(new ShopifyError("shopify_unavailable", true, "down"));
    await expect(fake.upsertProduct(INPUT, null)).rejects.toMatchObject({
      code: "shopify_unavailable",
    });
    await expect(fake.upsertProduct(INPUT, null)).resolves.toEqual(IDS);
    fake.failNext(new ShopifyError("shopify_user_error", false, "no"), "inventorySetQuantities");
    await fake.upsertProduct(INPUT, { productId: IDS.productId });
    await expect(setQty(1, null)).rejects.toMatchObject({ code: "shopify_user_error" });
  });

  it("records every call and forgets everything on reset", async () => {
    await fake.upsertProduct(INPUT, null);
    await setQty(3, null);
    expect(fake.calls).toEqual([
      expect.objectContaining({
        kind: "productSet",
        handle: INPUT.handle,
        price: "25.00",
        status: "ACTIVE",
      }),
      expect.objectContaining({
        kind: "inventorySetQuantities",
        inventoryItemId: IDS.inventoryItemId,
        quantity: 3,
        compareQuantity: null,
      }),
    ]);
    fake.reset();
    expect(fake.calls).toEqual([]);
    expect(fake.products.size).toBe(0);
  });
});

describe("which Shopify a deployment talks to", () => {
  it("keeps the live adapter off in a Vercel Preview unless its store is a development store", async () => {
    const { liveShopifyAllowed } = await import("@/lib/integrations/shopify/client");
    expect(liveShopifyAllowed({})).toBe(true);
    expect(liveShopifyAllowed({ VERCEL_ENV: "production" })).toBe(true);
    expect(liveShopifyAllowed({ VERCEL_ENV: "development" })).toBe(true);
    // A preview build on the staging database must never push into the live store.
    expect(liveShopifyAllowed({ VERCEL_ENV: "preview" })).toBe(false);
    expect(liveShopifyAllowed({ VERCEL_ENV: "preview", SHOPIFY_ALLOW_PREVIEW: "true" })).toBe(true);
  });
});
