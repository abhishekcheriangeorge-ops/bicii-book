# ADR-018: Purchasing

Date: 2026-10-05 (Phase 7, `feat/p7-purchasing`, built from Phase 5's head
and integrated with the main line, Phases 2 and 6 included). Status: per
row below. Decision owner: Abhishek Cherian George (owner) for business
meaning; defaults proposed by the build agent.

Status update 2026-10-06 (staff roles): the owner decided on three staff
roles, admin, manager and mechanic (today's role "staff" becomes mechanic).
A manager holds every permission except `manage_staff`, `view_costs` and
`manage_purchasing` included, so a manager sees purchase and product costs
through the role, not through D60. D60's rule (manage_purchasing alone
shows purchase costs on purchasing screens only) stays as built for the
exception case: an admin granting `manage_purchasing` to one mechanic as a
single-permission exception. The owner was told and has not objected. The
roles themselves are recorded in their own record (ADR-021, D90–D99) when
that work lands.

Status update 2026-10-05 (integration with Phase 6): consignment-owned
products (Phase 6, D45) are never purchased. The PO line and the low-stock
draft already refused any product that is not shop-owned
(`purchase_line_not_shop_owned`); at the integration `set_supplier_product`
refuses them too, so a consigned product never gets a supplier link.
Evidence: `tests/db/purchasing.test.ts` ("Phase 6's consigned stock is
never purchased"). The receive screen's label-print shortcut waits for
Phase 8 (labels are not on this line).

## Context

SPEC §14 asks for suppliers, purchase orders and receiving with partial
receipts, an actual cost per received line and a reorder view; SPEC §23
requires that receiving the same purchase receipt twice cannot double
stock; D5 (ADR-014) set the default that a receipt's actual cost becomes
the product's cost (last cost, no averaging). The brief does not say who
may see purchase costs, how an order is cancelled, what an order may hold,
which of two receipts is "latest", how far a delivery may be back-dated,
what happens to more than was ordered, or how reorder quantities are
suggested.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D60 D-PO-COSTS | Purchase costs (line, receipt and supplier last costs, totals, cost defaults, PO history) are for `view_costs` OR `manage_purchasing` (`private.can_view_purchase_costs()`); `manage_purchasing` alone opens no Phase 3/4/5 cost, yield or financial surface; cost defaults only for products a PO can hold | Accepted: build default, owner informed; amended in effect by the owner's staff roles (2026-10-06): managers see costs through their role, and this rule now covers a mechanic granted `manage_purchasing` as an exception | `20261005000100_suppliers` to `…0300_purchase_receiving` |
| D61 D-PO-CANCEL | Cancel from draft, submitted or partially received with a reason; received stock, receipts and movements stay; the remainder is reported as cancelled; final | Accepted: build default, owner to confirm | `…0200_purchase_orders` |
| D62 D-PO-SCOPE | A PO orders quantity-tracked, shop-owned, active products, one line per product; its currency is the shop currency and must equal the product's; unique items are registered with `create_unique_unit` | Accepted: build default, owner to confirm; consignment-owned products refused (checked against Phase 6) | `…0200_purchase_orders`, `…0300_purchase_receiving`, `…0500_purchasing_reorder`; supplier links since the integration |
| D63 D-LASTCOST | "Latest" is by receipt `received_at` (ties: later `created_at`, then id; within a receipt the highest line); the supplier link's last cost follows the same rule per supplier; 0 is a known cost (D24 as amended); a change writes Phase 4's `cost_changed` event; snapshots never change | Accepted: build default, owner to confirm (refines D5) | `…0300_purchase_receiving` |
| D64 D-RECEIPT-TIME | `received_at` defaults to now, back-dated up to 30 days, never more than 5 minutes ahead or before submission; movements keep record time and name the delivery time in their reason | Accepted: build default, owner to confirm | `…0300_purchase_receiving` |
| D65 D-OVERRECEIPT | More than outstanding is refused; staff raise the ordered quantity first on an open PO; a received PO is closed; receipts are immutable and corrected by a stock adjustment; a duplicate delivery note is a soft warning in the Receive screen | Accepted: build default, owner to confirm | `…0300_purchase_receiving`; the Receive screen |
| D66 D-REORDER | Suggested quantity = max(2 × reorder point − on hand − on order, 0) over `reporting.low_stock`; on order counts submitted and partially received POs only; a draft from low stock takes the supplier's last cost, else the product's cost (0 included), else 0 | Accepted: build default, owner to confirm | `…0500_purchasing_reorder` |

Full text of each row: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner).
Rationale:

- D60: a buyer cannot order or receive without seeing what things cost,
  and by D5 a receipt's cost becomes the product's cost; but purchasing is
  not a licence to see yield, margins or Cult Commons, so those surfaces
  stay with `view_costs` and `view_financial_reports`. With the staff
  roles, the people who buy are managers, who hold `view_costs` anyway;
  the rule matters only for a mechanic given the single permission.
- D61: a supplier that cannot deliver is a normal event; what arrived is
  a fact of the ledger and stays.
- D62: purchased stock is the shop's; consigned stock belongs to its
  consignor (SPEC §13) and arrives through intake, and a product never
  mixes shop and consigned stock (D45), so a consigned product on a PO
  could only corrupt the consignor's position.
- D63: back-dated paper delivery notes are common, so "latest" follows
  when the goods arrived, not when someone typed them in.
- D64: Phase 4's ledger has no effective-date column and is append-only;
  the receipt carries the delivery date and the movement says it in words.
- D65: refusing over-receipt keeps "what is still to come" true, and a
  closed order keeps its history readable; a reversing receipt RPC was not
  needed for the MVP.
- D66: twice the reorder point is a simple, explainable target; drafts are
  not commitments, so they do not reduce the suggestion.

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| Purchase costs for `view_costs` only (D60) | Rejected: a buyer without it could not order or receive at a cost |
| `manage_purchasing` implies `view_costs` everywhere (D60) | Rejected: it would reveal yield, margins and Cult Commons |
| Reopen a cancelled or received PO (D61, D65) | Rejected: history would no longer say what was ordered when |
| Unique units on POs (D62) | Deferred: registered one by one with their cost in Stock; a unique-unit purchase flow is future work |
| Consigned products on POs (D62, at the integration) | Rejected: consigned stock comes in through intake (D45, D50) |
| Average cost, or latest by recording time (D5, D63) | Rejected: D5 says last cost; a late paper note must not overwrite a newer price |
| Accept over-receipt and record the surplus (D65) | Rejected: raise the ordered quantity first, so the order stays the record of the agreement |
| A unique constraint on the delivery-note reference (D65) | Rejected: suppliers reuse a reference for split deliveries; the Receive screen warns instead |
| Count drafts as on order (D66) | Rejected: a draft is not sent to the supplier |

## Consequences

- `staff_search` is replaced by `20261005000400_purchasing_search.sql`,
  which carries every earlier kind (Phase 6's included) plus `supplier`
  and `purchase_order`; a later replacement must keep them all.
- `private.record_receipt_movement` is Phase 7's insert path into the
  ledger beside `private.record_movement` and Phase 6's
  `private.record_linked_movement`.
- `private.purchasing_shop_today()` is a definer wrapper of
  `private.shop_today()` (which reads `shop_settings` since Phase 2) so an
  invoker view can use the shop day; it is not a second calendar.
- Receipts cannot be corrected in place
  ([RISKS R-030](../RISKS.md#r-030--a-wrong-delivery-cannot-be-reversed-only-adjusted));
  two staff can record one delivery twice under different keys
  ([R-031](../RISKS.md#r-031--two-staff-can-record-the-same-delivery-twice));
  movement dates are recording dates
  ([R-032](../RISKS.md#r-032--purchase-movements-carry-the-recording-time-not-the-delivery-time));
  unique items have no PO
  ([R-033](../RISKS.md#r-033--unique-items-bought-from-a-supplier-have-no-purchase-order));
  a `manage_purchasing` exception shows product unit costs on purchasing
  screens ([R-034](../RISKS.md#r-034--a-manage_purchasing-exception-shows-unit-costs-on-purchasing-screens)).

## Open question for the owner

Confirm D61–D66; D60 stands as amended by the staff roles unless the owner
objects.

## Revisit trigger

The owner confirms or changes a row; the staff roles land (D90–D99); a
supplier relationship needs credit notes or returns to supplier; the
first unique item bought on a supplier invoice (D62); Phase 9 reporting
asks for purchase reports.

## Evidence and links

- [DATA-MODEL §10](../DATA-MODEL.md#10-suppliers-and-purchasing),
  [§15](../DATA-MODEL.md#15-row-level-security-matrix),
  [§16](../DATA-MODEL.md#16-rpc-catalogue-security-definer-in-public),
  [§18](../DATA-MODEL.md#18-seed-data-supabaseseedsql).
- Tests: `tests/db/purchasing.test.ts`, `purchasing-access.test.ts` (D60),
  `purchasing-concurrency.test.ts`, `purchasing-reorder.test.ts` (D66),
  `purchasing-seed.test.ts`; `tests/unit/purchasing.test.ts`,
  `purchasing-forms.test.ts`, `receive-form.test.ts`,
  `purchasing-components.test.tsx`; `tests/e2e/purchasing.spec.ts`.
- [ADR-014](ADR-014-defaults-for-unbuilt-phases.md) (D5),
  [ADR-016](ADR-016-consignment-and-sales.md) (D45, D50).
- Phase 7 as shipped: [PLAN Phase 7](../PLAN.md#phase-7--purchasing);
  verification in [NOW.md](../../NOW.md).
