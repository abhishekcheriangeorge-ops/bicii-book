# ADR-014: Defaults for consignment charges, purchase cost and online refunds

Date: 2026-10-04 (PR #1). Status: accepted defaults (not individually
confirmed by the owner); not implemented on this branch. Decision owner:
Abhishek Cherian George (owner) for business meaning; defaults proposed by
the build agent.

Status update 2026-10-05 (D4): implemented by Phase 6 (a charge's `bearer`
has no default and a missing one is refused with `charge_bearer_required`),
see [ADR-016](ADR-016-consignment-and-sales.md).

Status update 2026-10-05 (D7): applied to retail refunds by Phase 6 (D49):
`record_sale_refund` writes a financial `sale_refunds` row only, and stock
and unit status change only through `restock_unit`; evidence in
`tests/db/sales.test.ts` and `tests/e2e/sales.spec.ts` (a partial refund
leaves the stock unchanged). Online refunds remain Phase 10's.

Status update 2026-10-06 (D7): applied to online refunds by Phase 10 (D85,
[ADR-020](ADR-020-shopify.md)): `process_shopify_refund` writes one
`sale_refunds` row (capped like D49) and nothing else; Shopify's restock
claims stay in the event's result; evidence in
`tests/db/shopify-webhooks.test.ts` ("Refunds are financial only").

## Context

The plan had to choose defaults for three phases that are not built on this
branch: consignment (SPEC §13, Phase 6), purchasing (SPEC §14, Phase 7) and
Shopify (SPEC §17, Phase 10). Each touches business meaning that the brief
does not state.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D4 | Consignment charges carry an explicit bearer, `consignor` (deducted at settlement) or `shop` (added to direct cost); no default bearer, the UI requires a choice | Accepted default; not implemented | Planned for [Phase 6](../PLAN.md#phase-6--consignment) |
| D5 | A purchase receipt sets `products.default_direct_cost` to the latest actual unit cost (last-cost, no averaging) | Accepted default; not implemented on this branch | Planned for [Phase 7](../PLAN.md#phase-7--purchasing), being built on the parallel track and reconciled at integration |
| D7 | An online refund is a financial `sale_refunds` row only; stock and unit status change only when staff run `restock_unit` | Accepted default; not implemented | Planned for [Phase 10](../PLAN.md#phase-10--shopify) |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner). The plan
asks for each to be confirmed or changed "before the phase that uses it".

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| A default bearer for consignment charges (excluded by D4's "No default bearer") | Not chosen; staff choose per charge |
| Averaging the purchase cost (excluded by D5's "No averaging") | Not chosen; last-cost |

## Consequences

- None on this branch yet; each phase must implement and test its row or
  record a change first.

## Revisit trigger

Each phase starts: Phase 6 for D4, the integration of the purchasing track
for D5, Phase 10 for D7.

## Evidence and links

- [PLAN §2](../PLAN.md#2-phases) phase descriptions.
