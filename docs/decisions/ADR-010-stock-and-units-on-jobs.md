# ADR-010: Stock, unique units and publication when parts go on jobs

Date: D6 2026-10-04 (PR #1); D23–D28 2026-10-04 (commit 71574e5, PR #5);
D29 2026-10-04 (commit e181f6b, PR #5); owner changes 2026-10-05.
Status: per row below (D24 amended, D27 changed, D29 owner-confirmed; the
rest accepted). Decision owner: Abhishek Cherian George (owner) for business
meaning; defaults proposed by the build agent.

## Context

SPEC §11, §12 and §23 require a movement ledger in which a part consumes
stock exactly once, a unique unit cannot be sold twice, consignment stock
stays separate from shop stock, and public publication follows the item's
real state. The brief does not say when a unit on a job counts as sold,
whether job consumption may go below zero, what happens to a part with no
known price or cost, or how publication moves between states.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D6 | A unique unit on a job is `held_for_customer` on add and `sold` at completion; voiding before completion returns it to `available`; it follows `completed_at` on reopen with no stock movement | Accepted (refined by D25) | `20261004001800_inventory.sql`, `20261004001900_inventory_jobs.sql`; `tests/db/inventory-ledger.test.ts` |
| D23 | A job part may take a location below zero (the part was used; the UI warns); negatives show in `reporting.low_stock`; manual adjustments and transfers never go below zero (`insufficient_stock`) | Accepted | `20261004001900_inventory_jobs.sql`, `20261004002000_inventory_reporting.sql`; `tests/db/inventory-ledger.test.ts`, `tests/unit/inventory.test.ts` |
| D24 | A part needs a known sale price (override, else `private.selling_price`) and a known direct cost (unit cost, else product default; never overridden); otherwise `part_price_missing` / `part_cost_missing`; inventory lines are never `cost_pending` | Amended by the owner 2026-10-05: 0 is a known price or cost; only NULL counts as missing. The code already behaves this way (`coalesce(...)`, raising only when the result IS NULL); no test proves a 0 price or 0 cost part is accepted ([RISKS R-006](../RISKS.md#r-006--no-test-proves-a-zero-price-or-zero-cost-part-is-accepted)) | `add_inventory_line` (`20261004001900_inventory_jobs.sql`); `tests/db/inventory-ledger.test.ts` (NULL cases only) |
| D25 | SOLD-AT-COMPLETION: `held_for_customer` on add; `sold` whenever `completed_at` goes null → set (trigger `work_orders_sell_held_units`); back to held on reopen; add and void refuse on a job that is not open (`work_order_locked`) and lock it through `private.lock_work_order` | Accepted | `20261004001800_inventory.sql`, `20261004001900_inventory_jobs.sql`; `tests/db/inventory-ledger.test.ts`, `tests/unit/inventory.test.ts` |
| D26 | PUBLICATION-MACHINE: the draft/internal_only/public/sold/archived transitions; `sold` only by sale paths and only for unique products; entering public needs a name, a selling price, a public photo and (unique) an available unit; `public_slug` fixed at first publish | Accepted | `private.publication_transition_allowed`, `private.refresh_unique_publication` (`20261004001800_inventory.sql`), `20261004002100_inventory_publication.sql`; `tests/db/inventory-publication.test.ts`, `tests/db/inventory-catalog.test.ts`, `tests/e2e/inventory-publish.spec.ts` |
| D27 | SHOP-OWNED-ONLY: only shop-owned stock is a job part; `add_inventory_line` refuses consignment and customer_owned stock with `ownership_not_saleable` | Changed by the owner 2026-10-05: consigned stock may be a job part, built by the consignment phase (PLAN Phase 6). Until then the refusal stands. `customer_owned` is not covered by the change and stays never saleable | `add_inventory_line` (`20261004001900_inventory_jobs.sql`), backstop in `20261004002100_inventory_publication.sql`; `tests/db/inventory-ledger.test.ts`, `tests/db/inventory-split.test.ts` |
| D28 | SPLIT-COST: `split_unit_from_stock` takes one counted item out of stock (a reasoned `stock_adjustment`) and creates a draft unique product and unit at the same location with the source's `default_direct_cost` | Accepted | `20261004002100_inventory_publication.sql`; `tests/db/inventory-split.test.ts`, `tests/e2e/inventory-publish.spec.ts` |
| D29 | BIKE-WITH-CUSTOMER: once a sold unit's bike was transferred to a customer, reopening its job and voiding its line are refused (`bike_with_customer`); correction = transfer back to the shop, reopen, correct, complete, transfer again | Owner-confirmed 2026-10-05 ("confirmed, revisit later"; no trigger set by the owner) | `20261004001800_inventory.sql` (`private.assert_unit_consistent`), `20261004001900_inventory_jobs.sql`; `tests/db/inventory-ledger.test.ts`, `tests/db/inventory-publication.test.ts` |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner). Stated
rationale from the rows: a silent zero cost for an unknown cost would
overstate yield and Cult Commons (D24); a job part may take stock below
zero "because the part was physically used" (D23); a reopen or void must
not make a customer's bike available and public again (D29).

## Alternatives actually considered

None recorded.

## Consequences

- Negative stock is possible from job consumption and is reported, not
  blocked ([DATA-MODEL §7](../DATA-MODEL.md#7-inventory-movement-ledger)).
- Consigned bikes cannot be sold through a workshop job on this branch
  ([RISKS R-007](../RISKS.md#r-007--consigned-stock-cannot-be-a-job-part-yet));
  Phase 6 must add that path with the consignor liability intact.
- Correcting a job whose sold bike reached a customer takes several steps
  ([RISKS R-008](../RISKS.md#r-008--correcting-a-job-whose-sold-bike-reached-its-buyer-is-multi-step)).

## Revisit trigger

Phase 6 (consignment) starts, for D27. For D29, proposed (not set by the
owner): the first time staff need the transfer-back workaround.

## Evidence and links

- [DATA-MODEL §6](../DATA-MODEL.md#6-catalog-and-inventory),
  [§11](../DATA-MODEL.md#11-qr-identity-and-publication).
- `npm test` on 2026-10-05: 1186 tests passed, including the files above.
