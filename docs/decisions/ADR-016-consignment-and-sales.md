# ADR-016: Consignment and in-store sales

Date: 2026-10-05 (Phase 6, `feat/p6-consignment`). Status: per row below;
every row is "Accepted: build default, owner to confirm". Decision owner:
Abhishek Cherian George (owner) for business meaning; defaults proposed by
the build agent.

Status update 2026-10-05 (end of Phase 6): D44-D53 are implemented on
`feat/p6-consignment` and still await the owner's confirmation; D53's
open question stands. Final evidence per row: D44
`tests/db/consignment-job-parts.test.ts`, `tests/e2e/consignment.spec.ts`;
D45 `tests/db/consignment.test.ts`, `tests/db/sales.test.ts`; D46
`tests/db/sales.test.ts`, `tests/db/settlements.test.ts`,
`tests/e2e/sales.spec.ts` (restock); D47 `tests/db/settlements.test.ts`,
`tests/e2e/consignment-journey.spec.ts`; D48
`tests/db/consignment-access.test.ts`, the mechanic checks in
`consignment.spec.ts`, `sales.spec.ts` and `consignment-journey.spec.ts`;
D49 `tests/db/sales.test.ts`, `tests/e2e/sales.spec.ts`; D50 and D51
`tests/db/consignment.test.ts`; D52 `tests/db/consignment.test.ts`,
`tests/e2e/consignment-journey.spec.ts`; D53 `tests/unit/sales.test.ts`
(`priceWarnings`) and `tests/e2e/sales.spec.ts`. Gate results are in
[NOW.md](../../NOW.md).

## Context

SPEC §13 asks for consignment with liability kept apart from settlement,
SPEC §2 and §10 make the consignor payout a direct cost of the sale (Cult
Commons is 30% of positive yield after all direct costs), and SPEC §23
requires that a unique unit is never sold twice, a part consumes stock
exactly once and a replay has one business effect. Phase 4 refused
consigned stock on jobs (D27 SHOP-OWNED-ONLY); on 2026-10-05 the owner
changed D27: consigned stock may be a job part, customer-owned stock never
([ADR-010](ADR-010-stock-and-units-on-jobs.md)). The brief does not say how
a consigned part is costed, how quantity consignment is split between
consignors, which movements consigned stock may take, who sees consignment
money and sale costs, what a refund does to the books, or how a consignor
is overpaid and archived.

The D27 change is implemented by D44: `add_inventory_line` accepts
consignment stock with the same signature; `customer_owned` stays refused
(`ownership_not_saleable`); consigned units exist only through
`create_consignment_item`.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D44 CONS-JOB-PART | Consigned stock may be a job part: the line snapshots cost = agreed amount (+ shop charges on a unique item) and `consignor_payout_snapshot` = agreed amount; quantity parts draw FIFO from one item at its asking price by default; consigned stock never goes below zero; held on add, sold at completion; the item is sold and the liability exists exactly while the line is live on a completed job | Accepted: build default, owner to confirm | `20261004003400_consignment_job_parts.sql`; `tests/db/consignment-job-parts.test.ts`, `tests/db/consignment-concurrency.test.ts` |
| D45 CONS-QTY-FIFO | Dedicated consignment-owned products (ownership immutable once used); `remaining = quantity − (sold − restocked) − on jobs − returned`; each sale line draws from one item (named or FIFO) at its own asking price; `private.selling_price` returns the consigned unit's or the FIFO-head item's asking price; shop charges only on unique, available items | Accepted: build default, owner to confirm | `20261004003300_consignment.sql` (selling price, position view, charges, `product_ownership_immutable`); the sale side in Phase 6 step 2; `tests/db/consignment.test.ts` |
| D46 CONS-RESTOCK | Liability from live non-restocked sale lines and live lines of completed jobs × payout snapshot; owed = liability − consignor charges; paid = Σ allocations of unreversed settlements; restock of a consigned unit needs `manage_consignments` too; one live sale line per unit; negative outstanding is "Overpaid", never credit; a refund alone does not change liability | Accepted: build default, owner to confirm | Job-line liability in `reporting.consignment_item_position` (`20261004003300_consignment.sql`); sales, restock and the ledger in Phase 6 step 2 |
| D47 SETTLEMENT-RULES | Settlement amount = Σ allocations; above `max(outstanding, 0)` only with an override reason; corrections by whole-settlement reversal with a reason; archive only with no active item and outstanding exactly 0 | Accepted: build default, owner to confirm | `consignor_has_open_items` in `20261004003300_consignment.sql`; settlements and `consignor_has_balance` in Phase 6 step 2 |
| D48 SALES-ACCESS | Any staff may sell and see headers, lines, prices and totals; sale costs need `view_costs`; consignment money needs `manage_consignments` or `view_costs`; `view_financial_reports` alone reveals neither; payout details `manage_consignments` only | Accepted: build default, owner to confirm | `private.can_view_consignment_money`, `private.can_view_sale_costs`, the consignment grants and policies (`20261004003300_consignment.sql`); sales in step 2; `tests/db/consignment-access.test.ts` |
| D49 RETAIL-REFUND | Admins only, capped at sale total minus earlier refunds, financial only (D7); Phase 6 nets neither refunds nor restocks in reports; netting and Cult Commons claw-back belong to Phase 9's refund-reporting row (DR5) | Accepted: build default, owner to confirm | Phase 6 step 2 |
| D50 CONS-STOCK-MOVES | Consigned stock moves only through intake, return, sale, restock, job consumption and its void reversal, and transfers; adjustments, damage, write-off, `create_unique_unit`, split and purchase receipts are refused (`consignment_stock_adjust_blocked`); on-hand = Σ remaining | Accepted: build default, owner to confirm | `inventory_movements_consignment_rules`, `inventory_units_consignment_rules` (`20261004003300_consignment.sql`); `tests/db/consignment.test.ts` |
| D51 CONS-BIKE-LINK | Intake links only a shop bike record (not archived, no owner, not already a unit; Phase 4's codes); a consignor's own bike record is first transferred to the shop with a reason; links both ways; no automatic transfer on sale; the link stays on return and the bike record cannot be consigned again | Accepted: build default, owner to confirm | `create_consignment_item`, `return_consignment_item` (`20261004003300_consignment.sql`); `tests/db/consignment.test.ts`; limitation in [RISKS R-020](../RISKS.md#r-020--a-bike-record-consigned-once-cannot-be-consigned-again) |
| D52 CONS-PHOTOS-INTERNAL | Photos on a consignment item are internal only (trigger + CHECK `attachments_consignment_item_internal_only`, P0001 `attachment_consignment_internal_only`); listing photos live on the product or unit | Accepted: build default, owner to confirm | `20261004003300_consignment.sql`; `tests/db/consignment.test.ts` |
| D53 PRICE-OVERRIDE | Any staff may override a sale price, no database floor; the sale sheet warns below the asking price (everyone) and below cost (`view_costs`) | Accepted: build default, owner to confirm; open question below | Phase 6 steps 2 and 4 |

Full text of each row: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner).
Rationale stated in the rows:

- D44: liability is derived from live lines on completed jobs, never
  stored, so a replay or a repeated completion can never create a second
  liability; consigned stock may not go negative because on-hand must equal
  what the consignors still have with the shop (D50).
- D45: one product never mixes shop and consigned stock, so the ledger of a
  consigned product is exactly the consignors' stock; one selling-price
  function keeps the label, public page, Shopify and the sale in agreement.
- D46: owed, paid and outstanding are separate facts (SPEC §13); money paid
  stays paid, so an overpayment is shown, not silently recovered.
- D48: follows D30 (cost-derived figures need `view_costs`); the agreed
  amount is the cost of a consigned item, so it is consignment money.
- D50: every other movement would make on-hand differ from the consignors'
  remaining quantity, which nothing could reconcile.
- D51: D29 forbids stock whose bike a customer owns.
- D52: an agreement photo shows terms and amounts (the D13/D19 pattern).

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| Keep refusing consigned parts and record them as retail sales (the default before the owner's change, D44) | Rejected by the owner's D27 change |
| Let a job part take consigned stock below zero, as D23 allows for shop stock (D44) | Rejected: on-hand of a consigned product must equal the consignors' remaining quantity (D50) |
| Store liability on the item and update it on each sale (D44, D46) | Rejected: a replay or repeated completion could double it; derived liability cannot |
| Products that mix shop-owned and consigned stock (D45) | Rejected: the ledger could no longer tell whose stock moved |
| Plain `unique` on `sale_lines.inventory_unit_id` as DATA-MODEL §8 designed (D46) | Rejected: a restocked unit could never be sold again; replaced by a partial unique index over live lines (a recorded deviation, step 2) |
| Recover an overpayment automatically from the next sale (D46) | Rejected: money already paid stays paid; staff decide |
| Let `view_financial_reports` reveal sale costs or consignment money (D48) | Rejected: D30 already gates cost-derived figures by `view_costs` |
| A database price floor at the agreed amount (D53) | Not chosen for the build default; asked as an open question |

## Consequences

- `add_inventory_line` and the completion trigger `work_orders_sell_held_units`
  are replaced (same signature and trigger); `void_line` is not.
- `private.selling_price` is replaced with the same signature and grants.
- Consigned stock cannot be adjusted, written off or split; damaged or lost
  consigned stock is out of MVP (return it or sell it).
- A consigned bike record can be consigned once
  ([RISKS R-020](../RISKS.md#r-020--a-bike-record-consigned-once-cannot-be-consigned-again)).
- Phase 6 step 2 replaces `reporting.consignment_item_position`'s body
  (same columns) to add sale lines, and `consignors_enforce_rules` to add
  `consignor_has_balance`.

## Open question for the owner

D53: should a price below the agreed amount plus shop charges on a consigned
item need `manage_consignments`?

## Revisit trigger

The owner confirms or changes any row; D53's open question is answered; the
first consigned bike that comes back to be consigned again (D51); Phase 9's
refund-reporting row (D49).

## Evidence and links

- [DATA-MODEL §5](../DATA-MODEL.md#5-services-and-line-items),
  [§7](../DATA-MODEL.md#7-inventory-movement-ledger),
  [§9](../DATA-MODEL.md#9-consignment),
  [§15](../DATA-MODEL.md#15-row-level-security-matrix),
  [§16](../DATA-MODEL.md#16-rpc-catalogue-security-definer-in-public).
- [ADR-010](ADR-010-stock-and-units-on-jobs.md) (D27, D29),
  [ADR-014](ADR-014-defaults-for-unbuilt-phases.md) (D4, D7).
- Verification for step 1 is recorded in [NOW.md](../../NOW.md).
- Phase 6 as shipped: [PLAN Phase 6](../PLAN.md#phase-6--consignment).
