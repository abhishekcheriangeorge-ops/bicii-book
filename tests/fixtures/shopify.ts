/**
 * Shopify webhook fixtures (Phase 10; TESTING.md "Shopify"). Pure
 * TypeScript on node:crypto only, shared by unit, database and E2E tests.
 *
 * The payloads follow Shopify's REST webhook shapes (orders/paid,
 * refunds/create) for the fields BICII reads (DATA-MODEL §13): ids are
 * numbers, money is a decimal string with a `*_set.shop_money` twin, and a
 * line's discounts are `discount_allocations`. Anything BICII does not read
 * is left out. Verify these shapes against a real development store before
 * go-live (RUNBOOK, Phase 10 step 3).
 */
import { createHmac } from "node:crypto";

/** The webhook signing secret E2E and the database tests sign with (never a real secret). */
export const SHOPIFY_TEST_SECRET = "bicii-e2e-webhook-secret";

/** The shop domain the fixtures claim to come from. */
export const SHOPIFY_TEST_SHOP = "bicii-test.myshopify.com";

/** A money string with its shop-money twin, as Shopify sends it. */
function moneySet(amount: string, currency: string) {
  return {
    shop_money: { amount, currency_code: currency },
    presentment_money: { amount, currency_code: currency },
  };
}

export type OrderLineInput = {
  lineItemId: number;
  productId?: number | null;
  /** null = a custom line (no product). */
  variantId: number | null;
  title: string;
  variantTitle?: string | null;
  quantity: number;
  /** After order edits; defaults to quantity. */
  currentQuantity?: number;
  /** Unit price, e.g. "120.00". */
  price: string;
  /** This line's total discount allocation, e.g. "20.00" ("0.00" = none). */
  discount?: string;
};

export type OrderPaidInput = {
  orderId: number;
  /** "#1042" */
  name: string;
  currency?: string;
  /** ISO instant; omitted = no processed_at in the payload. */
  processedAt?: string;
  taxesIncluded?: boolean;
  totalTax?: string;
  test?: boolean;
  sourceName?: string;
  customer?: { id: number; email?: string | null } | null;
  lines: OrderLineInput[];
};

export type OrderPaidPayload = ReturnType<typeof orderPaidPayload>;

/** A REST-shaped orders/paid body. */
export function orderPaidPayload(input: OrderPaidInput) {
  const currency = input.currency ?? "SGD";
  const totalTax = input.totalTax ?? "0.00";
  return {
    id: input.orderId,
    admin_graphql_api_id: `gid://shopify/Order/${input.orderId}`,
    name: input.name,
    order_number: Number(input.name.replace(/\D/g, "")) || input.orderId,
    currency,
    ...(input.processedAt === undefined ? {} : { processed_at: input.processedAt }),
    taxes_included: input.taxesIncluded ?? true,
    total_tax: totalTax,
    total_tax_set: moneySet(totalTax, currency),
    test: input.test ?? false,
    source_name: input.sourceName ?? "web",
    financial_status: "paid",
    customer:
      input.customer === undefined || input.customer === null
        ? null
        : {
            id: input.customer.id,
            admin_graphql_api_id: `gid://shopify/Customer/${input.customer.id}`,
            email: input.customer.email ?? null,
          },
    line_items: input.lines.map((l) => {
      const discount = l.discount ?? "0.00";
      return {
        id: l.lineItemId,
        admin_graphql_api_id: `gid://shopify/LineItem/${l.lineItemId}`,
        product_id: l.productId ?? null,
        variant_id: l.variantId,
        title: l.title,
        variant_title: l.variantTitle ?? null,
        quantity: l.quantity,
        current_quantity: l.currentQuantity ?? l.quantity,
        price: l.price,
        price_set: moneySet(l.price, currency),
        discount_allocations:
          Number(discount) === 0
            ? []
            : [
                {
                  amount: discount,
                  amount_set: moneySet(discount, currency),
                  discount_application_index: 0,
                },
              ],
      };
    }),
  };
}

export type RefundInput = {
  refundId: number;
  orderId: number;
  /** The money refunded (Σ of the successful refund transactions). */
  amount: string;
  currency?: string;
  note?: string | null;
  lines?: { lineItemId: number; quantity: number; subtotal: string; restockType?: string }[];
  /** A shipping refund, e.g. "8.00". */
  shipping?: string;
  /** Split the amount over this many successful transactions (default 1). */
  transactions?: number;
};

export type RefundPayload = ReturnType<typeof refundPayload>;

/** Cents of a decimal string (exact, no floats). */
function cents(amount: string): number {
  const [whole, frac = ""] = amount.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

function fromCents(n: number): string {
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
}

/** A REST-shaped refunds/create body whose successful transactions sum to `amount`. */
export function refundPayload(input: RefundInput) {
  const currency = input.currency ?? "SGD";
  const n = Math.max(1, input.transactions ?? 1);
  const total = cents(input.amount);
  const share = Math.floor(total / n);
  const amounts = Array.from({ length: n }, (_, i) =>
    i === n - 1 ? total - share * (n - 1) : share,
  );
  return {
    id: input.refundId,
    admin_graphql_api_id: `gid://shopify/Refund/${input.refundId}`,
    order_id: input.orderId,
    note: input.note ?? null,
    transactions: amounts.map((c, i) => ({
      id: input.refundId * 10 + i,
      kind: "refund",
      status: "success",
      amount: fromCents(c),
      currency,
    })),
    refund_line_items: (input.lines ?? []).map((l, i) => ({
      id: input.refundId * 10 + i,
      line_item_id: l.lineItemId,
      quantity: l.quantity,
      restock_type: l.restockType ?? "no_restock",
      subtotal: l.subtotal,
      subtotal_set: moneySet(l.subtotal, currency),
    })),
    refund_shipping_lines:
      input.shipping === undefined
        ? []
        : [
            {
              id: input.refundId,
              subtotal_amount: input.shipping,
              subtotal_amount_set: moneySet(input.shipping, currency),
            },
          ],
    order_adjustments: [],
  };
}

/** Shopify's X-Shopify-Hmac-Sha256: base64 HMAC-SHA256 of the raw body. */
export function signShopifyBody(raw: string, secret: string = SHOPIFY_TEST_SECRET): string {
  return createHmac("sha256", secret).update(raw, "utf8").digest("base64");
}

/** The headers Shopify sends with a webhook, signed with `secret`. */
export function webhookHeaders({
  topic,
  webhookId,
  raw,
  secret = SHOPIFY_TEST_SECRET,
  triggeredAt,
  test,
  shop = SHOPIFY_TEST_SHOP,
  apiVersion = "2026-07",
}: {
  topic: string;
  webhookId: string;
  raw: string;
  secret?: string;
  triggeredAt?: string;
  test?: boolean;
  shop?: string;
  apiVersion?: string;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-shopify-topic": topic,
    "x-shopify-webhook-id": webhookId,
    "x-shopify-event-id": `evt-${webhookId}`,
    "x-shopify-shop-domain": shop,
    "x-shopify-api-version": apiVersion,
    "x-shopify-hmac-sha256": signShopifyBody(raw, secret),
    ...(triggeredAt ? { "x-shopify-triggered-at": triggeredAt } : {}),
    ...(test === undefined ? {} : { "x-shopify-test": String(test) }),
  };
}
