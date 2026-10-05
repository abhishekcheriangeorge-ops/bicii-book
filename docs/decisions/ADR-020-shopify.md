# ADR-020: Shopify integration

Date: 2026-10-06 (Phase 10, `feat/p10-shopify`). Status: per row below;
D80–D88 are "Accepted: build default, owner to confirm"; D89's tax basis
and Shopify POS points are OPEN for the owner. Decision owner: Abhishek
Cherian George (owner) for business meaning; defaults proposed by the build
agent and the orchestrator's Phase 10 brief. Numbering: the orchestrator's
allocation of 2026-10-06 gives Phase 10 exactly D80–D89 and this record;
the brief's fifteen working labels are merged into these ten rows
(RECOGNITION into D80, CATALOG into D84, CUSTOMER into D86, RETENTION into
D88, TAX and TEST into D89). Applies D7 to online refunds
([ADR-014](ADR-014-defaults-for-unbuilt-phases.md)).

Status update 2026-10-06 (Phase 10 step 1): the inbound database side of
D80, D82, D85–D89 is built and tested
(`supabase/migrations/20261004003900_shopify_integration.sql`,
`20261004004000_shopify_order_processing.sql`,
`tests/db/shopify-webhooks.test.ts`): webhook recording, the queue, order
and refund processing through Phase 6's `private.sell_line`, the
retry/dismiss/link RPCs and the admin-only `integration_failed` exception.
The outbound sync (D81's sync side, D83, D84's push and `buy_online_url`)
is step 2; the service layer step 3; the screens step 4.

## Context

SPEC §17 asks for Shopify as the online channel: BICII is the operational
truth for products, stock and sales; webhooks are verified, stored and
processed idempotently (a replay has one business effect, SPEC §23); an
unmapped variant goes to a visible retry queue with nothing partial (SPEC
§17.1, §26); refunds are recorded (D7 decided they are financial only);
customers link to Shopify customers only by a durable id, a matching email
being a candidate (SPEC §17.2). The brief does not say what price an
online line carries when Shopify discounts it, when an online sale is
recognised, how a unique bike is represented online, what happens when the
ledger cannot fulfil a paid order, which stock is online, what a refund
records when it includes shipping, who may administer the integration,
how retries work, what is kept of a delivery that fails verification, or
how tax, test and POS orders are treated.

Phase 6 already built the one sale-line writer (`private.sell_line`), the
refund cap and status rule (`record_sale_refund`, D49) and a reporting
rule that nets no refund (D49). Those are reused unchanged in meaning.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D80 SHOP-PRICE | An online line's price = Shopify line price × effective quantity − the line's discount allocations, in shop money, split exactly so Σ sale_total = Shopify's discounted line totals (uneven quantity → two lines, parts 1 and 2; unique units one line each, the last absorbing the remainder); 0 is a price; shipping, tips, duties and order adjustments are not lines; `recognized_at` = the payload's `processed_at`, else X-Shopify-Triggered-At, else `received_at`; the rate follows `recognized_at` | Accepted: build default, owner to confirm | `private.shopify_split_amount`, `process_shopify_order_paid` (step 1) |
| D81 SHOP-UNIQUE | A unique product is one Shopify variant; online quantity = available, non-customer-owned, non-archived units at the online location; price = `private.selling_price` of the oldest such unit (D58); sync refuses when such units' prices differ; orders sell the oldest available unit(s) | Accepted: build default, owner to confirm | Orders: `process_shopify_order_paid` (step 1); sync: step 2 |
| D82 SHOP-STOCK | When the ledger cannot fulfil a paid order (no unit, on-hand below the quantity at the online location, no single consignment covering a consigned quantity line, a NULL cost, any `sell_line` refusal) nothing is recorded; the event needs attention with a human reason; staff fix and retry, or refund in Shopify and dismiss with a reason | Accepted: build default, owner to confirm | `process_shopify_order_paid`'s subtransaction and failure branch (step 1) |
| D83 SHOP-LOCATION | One online BICII location mapped to one Shopify location; BICII pushes its absolute ledger quantity, defers while an order is in flight, pushes with a compare quantity and overwrites a moved count after one 2-minute deferral | Accepted: build default, owner to confirm | `shopify_settings.online_location_id` (step 1); the push is step 2–3 |
| D84 SHOP-PUBLISH | Publish online needs public, a selling price, not archived, not customer-owned; only BICII-created Shopify products get the full productSet and are drafted at 0 when unpublished; products linked to Shopify-made products get price and inventory only and no Buy-online link; `products.shopify_product_id` not unique, `shopify_variant_id` unique; `buy_online_url` only when available, published online, synced, with a handle and a storefront URL | Accepted: build default, owner to confirm | Columns, constraints and `link_shopify_variant` (step 1); publishing and `buy_online_url` step 2 |
| D85 SHOP-REFUND | One `sale_refunds` row = the line-attributable refund, never above the money refunded, capped at the remaining total; shipping and excess in the event result; status as `record_sale_refund`; reports net nothing (D49); stock, units, consignment and lines never change (D7); netting and claw-back stay owner question 12 / R-021 for Phase 9; `orders/cancelled` not subscribed | Accepted: build default, owner to confirm | `process_shopify_refund`, `private.shopify_refund_line_amount` (step 1) |
| D86 SHOP-ACCESS | Integration administration (inspector, queue, dismiss, links, settings, integration exception rows) admin-only (payloads hold PII); `manage_inventory` publishes, syncs and retries product-sync jobs; all staff see sync status; customers linked only by an admin with a reason, never by email; a link applies to later orders | Accepted: build default, owner to confirm | RLS and RPC guards, `link_shopify_customer`, `private.integration_exceptions` (step 1) |
| D87 SHOP-RETRY | Transient failures back off 1 minute doubling to 6 hours, at most 8 attempts, then needs attention; business failures need attention at once; a waiting refund re-queues when its order lands and closes when the order is dismissed; a 5-minute cron behind `CRON_SECRET` plus a few due jobs after each webhook | Accepted: build default, owner to confirm | `private.integration_backoff`, `claim_integration_jobs`, the processors and `dismiss_integration_job` (step 1); cron and route step 3 |
| D88 SHOP-REJECTED | Rejected deliveries kept as evidence (capped headers, size, SHA-256; never the body), never in the dedupe key, one row per bad body with a count; not stored above 30/min/instance; 413 over 1 MiB; purged only by the owner-only `private.purge_integration_events` (≥ 30 days), never failed or pending events, no cron | Accepted: build default, owner to confirm | `record_shopify_webhook`, `integration_events` constraints and immutability trigger, the purge function (step 1); rate limit and 413 in the route (step 3) |
| D89 SHOP-TAX-TEST | Tax-inclusive prices recorded when `taxes_included`; tax-exclusive orders with tax refused; test deliveries stored but skipped unless `accept_test_orders` (admin + reason + audit; dev/E2E seed only); `source_name` 'pos' orders skipped | OPEN for the owner: tax basis and Shopify POS ([PRODUCT questions 17 and 18](../PRODUCT.md#open-assumptions-and-owner-questions)); the rest accepted | `process_shopify_order_paid`, `record_shopify_webhook` (step 1) |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner).

Rationale:

- D80: Shopify charged the customer the discounted line total; recording
  anything else would make BICII's sales disagree with the money received.
  Splitting the remainder onto one line keeps every line's price a cent
  amount and the sale total exact. The order's `processed_at` is the same
  in every delivery, so a replay can never move a sale to another day
  (inferred from Shopify's documented payload; verified in Step 3 against a
  real store before go-live).
- D81: the oldest unit sells first because it has waited longest
  (inferred); one price function keeps the label, the public page, the
  in-store default and Shopify in agreement (D58).
- D82: a sale never takes stock below zero outside job parts (D23) and a
  unit never sells twice (SPEC §23); recording part of an order would be
  wrong in a way staff cannot see, so the whole order waits for a person.
- D83: BICII is the stock truth (SPEC §17); one location keeps the mapping
  explainable to staff.
- D84: pushing a full product into a product someone built in Shopify
  would overwrite their work; linking a variant is a mapping only.
- D85: D7 and D49 already decide that a refund is a financial fact capped
  at the sale; shipping was never a sale line, so its refund cannot be
  either.
- D86: payloads hold names, addresses and emails of customers; only admins
  read them. A matching email is not proof of identity (SPEC §17.2), and a
  recorded sale is immutable (Phase 6), so a link cannot rewrite history.
- D87: transient failures (a network error, a refund before its order)
  resolve themselves; business failures do not, and retrying them only
  hides them.
- D88: a delivery that fails verification may be an attack or a
  misconfiguration; its evidence is useful, its body is not trustworthy and
  may be large.
- D89: BICII never invents or drops tax; the owner must confirm the store's
  configuration before go-live.

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| Record the catalogue selling price on online lines | Rejected: disagrees with what Shopify charged after discounts |
| Spread a line's remainder one cent at a time over several lines | Rejected: more lines for no gain; one remainder line keeps Σ exact |
| `recognized_at` = processing time | Rejected: a retried or replayed order would land on a later day |
| Sell what is available and leave the rest for later (partial orders) | Rejected: partial records hide the problem (SPEC §17.1 "nothing partial") |
| Allow online sales to take stock below zero (as job parts may, D23) | Rejected: D23 covers parts that were physically used; an online order is a promise, not a fact |
| A second sale-line writer for online lines (`private.write_sale_line`) | Rejected: one writer keeps the economics identical; `sell_line` is extended only to persist `shopify_line_part` |
| Link Shopify customers by email automatically | Rejected: SPEC §17.2; emails are shared and change |
| Backfill `customer_id` on earlier online sales after a link | Rejected: sales are immutable except status (Phase 6, `sales_enforce_rules`) |
| Net refunds in reports now | Not decided here: owner question 12 / R-021 belong to Phase 9 (D100–D119), for retail and online together |
| Store rejected bodies | Rejected: untrusted, possibly large, possibly PII; the hash and size identify a repeat |
| A purge cron | Rejected for the MVP: deletion of evidence stays a deliberate owner action |

## Consequences

- An online order BICII cannot fulfil records nothing and appears to admins
  as an `integration_failed` operational exception until someone acts.
- Earlier online sales stay without `customer_id` after a customer link;
  the screens show the link through `sales.shopify_customer_id`
  ([RISKS R-042](../RISKS.md#r-042--earlier-online-sales-keep-no-customer-after-a-shopify-customer-is-linked)).
- Webhook payloads hold customer personal data until the owner purges them
  by hand ([RISKS R-040](../RISKS.md#r-040--shopify-webhook-payloads-hold-customer-personal-data-until-purged-by-hand)).
- A consigned quantity line larger than any single consignment at the
  online location fails (D45's one item per line)
  ([RISKS R-041](../RISKS.md#r-041--an-online-order-for-more-consigned-stock-than-one-consignment-holds-fails)).
- Phase 9 must widen `private.integration_exceptions()` when it appends its
  columns to `reporting.operational_exceptions`
  ([RISKS R-043](../RISKS.md#r-043--phase-9-must-widen-the-integration-exceptions-function)).
- An order edited after payment with a discounted line may be recorded
  below what Shopify charged until verified on a development store
  ([RISKS R-044](../RISKS.md#r-044--an-edited-order-with-a-discounted-line-records-a-lower-price)).
- `products.shopify_product_id` is no longer unique (DATA-MODEL §6
  deviation).

## Revisit trigger

The owner answers D89 or confirms a row; the first real Shopify store or
development store is connected (R-011); Phase 9 decides refund netting;
Shopify changes its webhook payloads or API version.

## Evidence and links

- [PLAN Phase 10](../PLAN.md#phase-10--shopify), [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner) rows D7, D80–D89.
- [DATA-MODEL §13](../DATA-MODEL.md#13-shopify-integration), §6, §8, §14–§16, §18.
- `supabase/migrations/20261004003900_shopify_integration.sql`,
  `supabase/migrations/20261004004000_shopify_order_processing.sql`,
  `tests/db/shopify-webhooks.test.ts`, `tests/fixtures/shopify.ts`.
- [ARCHITECTURE "Shopify inbound flow"](../ARCHITECTURE.md#shopify-inbound-flow);
  risks [R-011](../RISKS.md#r-011--shopify-is-not-built-and-will-be-fixture-tested-only),
  [R-021](../RISKS.md#r-021--reports-overstate-net-sales-after-a-refund-or-restock),
  R-040 to R-044.
