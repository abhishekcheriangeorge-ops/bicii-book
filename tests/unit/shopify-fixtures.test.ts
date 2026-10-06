/**
 * The Shopify webhook fixtures (tests/fixtures/shopify.ts) have the shapes
 * BICII reads (DATA-MODEL §13) and sign like Shopify does, so the database
 * and E2E tests that use them exercise real payload mapping (TESTING.md
 * "Shopify payload mapping").
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  orderPaidPayload,
  refundPayload,
  SHOPIFY_TEST_SECRET,
  SHOPIFY_TEST_SHOP,
  signShopifyBody,
  webhookHeaders,
} from "../fixtures/shopify";

describe("orderPaidPayload", () => {
  const order = orderPaidPayload({
    orderId: 7001,
    name: "#1042",
    processedAt: "2026-10-01T02:03:04Z",
    customer: { id: 55, email: "someone@example.com" },
    lines: [
      {
        lineItemId: 1,
        productId: 10,
        variantId: 11,
        title: "Brake pads",
        quantity: 3,
        price: "40.00",
        discount: "20.00",
      },
      { lineItemId: 2, variantId: null, title: "Gift wrap", quantity: 1, price: "2.00" },
    ],
  });

  it("is a REST orders/paid body with the documented fields", () => {
    expect(order).toMatchObject({
      id: 7001,
      admin_graphql_api_id: "gid://shopify/Order/7001",
      name: "#1042",
      order_number: 1042,
      currency: "SGD",
      processed_at: "2026-10-01T02:03:04Z",
      taxes_included: true,
      total_tax: "0.00",
      total_tax_set: { shop_money: { amount: "0.00", currency_code: "SGD" } },
      test: false,
      source_name: "web",
      financial_status: "paid",
      customer: { id: 55, email: "someone@example.com" },
    });
    expect(order.line_items[0]).toMatchObject({
      id: 1,
      product_id: 10,
      variant_id: 11,
      quantity: 3,
      current_quantity: 3,
      price: "40.00",
      price_set: { shop_money: { amount: "40.00", currency_code: "SGD" } },
      discount_allocations: [{ amount: "20.00", amount_set: { shop_money: { amount: "20.00" } } }],
    });
    // A custom line has no product or variant; no discount = no allocation.
    expect(order.line_items[1]).toMatchObject({
      product_id: null,
      variant_id: null,
      discount_allocations: [],
    });
  });

  it("omits processed_at when not given and keeps a null customer", () => {
    const bare = orderPaidPayload({ orderId: 1, name: "#1", lines: [] });
    expect("processed_at" in bare).toBe(false);
    expect(bare.customer).toBeNull();
  });
});

describe("refundPayload", () => {
  it("has successful refund transactions that sum to the amount", () => {
    for (const [amount, n] of [
      ["100.00", 1],
      ["100.00", 3],
      ["0.05", 2],
      ["57.31", 4],
    ] as const) {
      const r = refundPayload({ refundId: 9, orderId: 7001, amount, transactions: n });
      expect(r.transactions).toHaveLength(n);
      expect(r.transactions.every((t) => t.kind === "refund" && t.status === "success")).toBe(true);
      const sum = r.transactions.reduce((s, t) => s + Math.round(Number(t.amount) * 100), 0);
      expect(sum).toBe(Math.round(Number(amount) * 100));
    }
  });

  it("carries refund line items with subtotal_set and a shipping refund line when given", () => {
    const r = refundPayload({
      refundId: 9,
      orderId: 7001,
      amount: "45.00",
      note: "Damaged",
      lines: [{ lineItemId: 1, quantity: 1, subtotal: "40.00", restockType: "return" }],
      shipping: "5.00",
    });
    expect(r).toMatchObject({ id: 9, order_id: 7001, note: "Damaged" });
    expect(r.refund_line_items).toEqual([
      expect.objectContaining({
        line_item_id: 1,
        quantity: 1,
        restock_type: "return",
        subtotal: "40.00",
        subtotal_set: expect.objectContaining({
          shop_money: { amount: "40.00", currency_code: "SGD" },
        }),
      }),
    ]);
    expect(r.refund_shipping_lines).toEqual([expect.objectContaining({ subtotal_amount: "5.00" })]);
    expect(
      refundPayload({ refundId: 1, orderId: 2, amount: "1.00" }).refund_shipping_lines,
    ).toEqual([]);
  });
});

describe("signing", () => {
  const raw = JSON.stringify(orderPaidPayload({ orderId: 1, name: "#1", lines: [] }));

  it("is base64 HMAC-SHA256 of the raw body; verifies with the secret, fails with another", () => {
    const signature = signShopifyBody(raw, SHOPIFY_TEST_SECRET);
    const expected = createHmac("sha256", SHOPIFY_TEST_SECRET).update(raw, "utf8").digest("base64");
    expect(signature).toBe(expected);
    expect(signShopifyBody(raw)).toBe(signature);
    expect(signShopifyBody(raw, "another-secret")).not.toBe(signature);
    expect(signShopifyBody(`${raw} `, SHOPIFY_TEST_SECRET)).not.toBe(signature);
  });

  it("webhookHeaders carries the topic, ids, shop, version and signature", () => {
    const headers = webhookHeaders({
      topic: "orders/paid",
      webhookId: "w-1",
      raw,
      triggeredAt: "2026-10-01T00:00:00Z",
      test: true,
    });
    expect(headers).toMatchObject({
      "x-shopify-topic": "orders/paid",
      "x-shopify-webhook-id": "w-1",
      "x-shopify-shop-domain": SHOPIFY_TEST_SHOP,
      "x-shopify-hmac-sha256": signShopifyBody(raw),
      "x-shopify-triggered-at": "2026-10-01T00:00:00Z",
      "x-shopify-test": "true",
    });
    expect("x-shopify-test" in webhookHeaders({ topic: "t", webhookId: "w", raw })).toBe(false);
  });
});
