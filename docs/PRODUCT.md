# Product context

Owner: Abhishek Cherian George ("George"; GitHub `abhishekcheriangeorge-ops`),
product owner. Last substantive decision: the owner decisions of 2026-10-05
([below](#decisions)). Current build state lives in [NOW.md](../NOW.md) at the
repository root; this page says why the product exists and what must stay
true.

## Why this exists

BICII is a custom bicycle shop and workshop in Singapore. Its public website
(repository `abhishekcheriangeorge-ops/bicii`) is static and has no backend,
so intake, job history, stock, consignment and the shop's money run on paper
and memory. The BICII Admin is the staff application for that work: intake
and work orders on a phone or iPad, permanent bicycle history, inventory with
a stock ledger, appointments, and job costing with the Cult Commons yield
share ([SPEC §1](SPEC.md#1-mission)). It is one of two frontends on one
Supabase backend: the public site stays the customer-facing site and later
reads the same database for appointments, My Bikes and public products. The
Admin never replaces the public site.

## Users

| User | What they can do today | Where it is enforced |
|---|---|---|
| Admin (owner/manager; `staff.role = 'admin'`) | Everything, including staff, shop settings, hours, closures, appointment types and Cult Commons rates | `private.require_admin()` / RLS; [ADR-001 A3](ADR-001-architecture.md#a3-authentication-and-authorization) |
| Staff and mechanics (`role = 'staff'`) | Customers, bikes, photos, jobs, lines, appointments, check-in, stock lookups; sale prices but no costs | RLS `private.is_staff()` and RPC guards |
| Staff with a permission (enum `public.permission_key`, `20261004000200_staff.sql`) | `view_costs`: see and enter costs, yield and Cult Commons on lines, services, products, units and movements. `manage_inventory`: products, units, locations, categories, services, publication, stock transfers. `adjust_stock`: stock adjustments, write-offs, splitting a unit from stock. `view_financial_reports`: money on Today and the financial lines (cost figures also need `view_costs`). `manage_staff`: invite, edit and deactivate staff and grant permissions within the D11 ceiling ([ADR-005](decisions/ADR-005-staff-sign-in-and-delegation.md)). `manage_consignments` and `manage_purchasing` exist but gate nothing yet: Phases 6 and 7 use them | `private.require_permission` / `private.has_permission` in the RPCs; `requireStaff(permission)` in pages and actions |
| Customers | Nothing in this app. The `my_*` RPCs exist for the public site; customer sign-in and screens arrive with [Phase 11](PLAN.md#phase-11--public-site-integration-in-the-bicii-repo) | security definer `my_*` RPCs ([ADR-003](decisions/ADR-003-customer-access.md)) |
| Anonymous visitors | Published items behind a QR code (`reporting.public_items`), public appointment types, shop hours and free appointment times | explicit public projections only ([DATA-MODEL §15](DATA-MODEL.md#15-row-level-security-matrix)) |

## Success and scope

- Smallest useful outcome: the first milestone of
  [SPEC §35](SPEC.md#35-first-implementation-milestone) — one bike checked in
  from a phone with a photo, a service line and a part that consumes stock
  through the ledger, correct yield and Cult Commons, statuses through
  collection, and a basic Today dashboard ([PLAN §3](PLAN.md#3-first-milestone--the-vertical-slice-spec-35)).
- Success measure: the MVP acceptance criteria of
  [SPEC §31](SPEC.md#31-acceptance-criteria-for-mvp). Phases 1 and 3 deliver
  intake, photos, assignment and the job timeline; Phases 3–5 lines, totals,
  snapshots, the ledger and Cult Commons; Phase 2 appointments; Phase 4 the
  catalogue and staff QR scanning; Phase 6 consignment; Phase 7 purchasing;
  Phase 8 labels; Phase 9 period reports; Phase 10 Shopify; Phase 11 the
  public side of QR pages and customer access; Phase 0 and every phase the
  PWA, the look and the RLS tests ([PLAN §2](PLAN.md#2-phases)). What is
  built today is recorded in [NOW.md](../NOW.md), not here.
- Explicit non-goals ([SPEC §30](SPEC.md#30-explicitly-out-of-mvp),
  [PLAN §7](PLAN.md#7-out-of-scope-restated-from-spec-30)): no payment
  processor or Shopify checkout replacement; no accounting, payroll or tax;
  no automatic customer approval of added work; no Shopify/BICII single
  sign-on; no customer choice of mechanic; no labour scheduling or time
  clock; no complex bulk-to-unique machinery; no multi-location
  optimisation; no native apps; no hard-coded Bluetooth printing before the
  printers are known; no marketing CRM or automated messaging.

## Domain rules

These are fixed by the brief ([SPEC §2](SPEC.md#2-non-negotiable-principles),
[§23](SPEC.md#23-domain-invariants-the-databaseservice-layer-must-enforce),
[§33](SPEC.md#33-guidance-for-agent-autonomy)); changing one needs the owner.

| Rule | Why | Example or edge case | Verification |
|---|---|---|---|
| Cult Commons is 30% of positive yield after all direct costs; a consignor payout is a direct cost | The shop's yield-share commitment (SPEC §10) | A $1,000 consigned bike owing $500 to the consignor gives $150 | `tests/unit/cult-commons.test.ts` (fixtures in `tests/fixtures/cult-commons.ts`); the consignor case in the database: `tests/db/sales.test.ts` ("Consignment sale creates correct liability and yield") and the seeded S-000003 in `tests/db/consignment-reporting.test.ts` (Phase 6 step 2) |
| Negative yield is a loss with zero share | A loss never creates a negative payment | Tyre sold at 20.00 costing 35.00: yield −15.00, share 0.00 | `tests/unit/cult-commons.test.ts`; `tests/db/reporting.test.ts` ("Negative yield never creates a negative Cult Commons payment") |
| Computed per line, then summed (D1) | A loss line must not reduce the share earned on other lines | Wheel true 40/0 + tyre 20/35: 12.00, not 7.50 | `tests/unit/cult-commons.test.ts`; `tests/db/reporting.test.ts` |
| Each line snapshots the rate in force when it is added (D21) | A rate change never rewrites past jobs | A new rate applies to later lines only | `tests/db/work-order-lines.test.ts` ("Cult Commons rate snapshot") |
| Financial snapshots are immutable | Historical jobs and sales never change with the catalogue | Editing a service price leaves old lines alone; lines refuse edits, even from the database owner | `tests/db/work-order-lines.test.ts`; `tests/db/reporting.test.ts`; sales: `tests/db/sales.test.ts` ("Historical line price/cost/yield snapshots do not change with catalog edits") |
| Ledger, never deletes: corrections are linked reversals | History over overwrites | Voiding a part keeps the line and adds one reversal movement | `tests/db/inventory-ledger.test.ts` (reversal; ledger refuses updates and deletes) |
| Every stock change has a reason | Stock must be explainable | An adjustment without a reason is refused | `tests/db/inventory-ledger.test.ts` ("requires a reason and records who, when and why") |
| A unique unit cannot be sold twice | Physical identity | One unit on two jobs at once: exactly one succeeds; a sold unit sells again only after a restock | `tests/db/inventory-ledger.test.ts`; `tests/db/sales.test.ts` and `consignment-concurrency.test.ts` (Phase 6 step 2) |
| A part consumes stock exactly once | Retries must not duplicate stock effects | The same line id twice: one line, one movement | `tests/db/inventory-ledger.test.ts`; `tests/db/workshop-concurrency.test.ts` |
| A webhook replay has one business effect | Shopify redelivers | Ten deliveries of one order make one sale | Not built yet (Phase 10) |
| Consignment liability is separate from settlement | The shop owes a consignor until it pays | A partial payment leaves the rest owed; a restock after payment leaves the consignor overpaid, never in credit | `tests/db/settlements.test.ts` (Phase 6 step 2); on screen, `tests/e2e/consignment.spec.ts` ($500 owed, $200 then $300 paid, Outstanding $0.00) and `tests/unit/consignment.test.ts` (the Overpaid label) |
| A consigned item used on a job is sold when the job is completed (D44) | The owner's D27 change: consigned stock may be a job part | The consignor is owed the agreed amount exactly while the line is live on a completed job; a reopen removes it, a void returns the stock | `tests/db/consignment-job-parts.test.ts`; `tests/e2e/consignment.spec.ts` |
| Every charge names who bears it (D4) | A consignor-paid charge comes off what they are owed; a shop-paid one is a direct cost | The charge sheet cannot be submitted until Consignor pays or Shop pays is chosen; Shop pays only on a single available item (D45) | `tests/db/consignment.test.ts`; `tests/e2e/consignment.spec.ts` |
| Paying more than is owed needs a reason; mistakes are reversed whole (D47) | Settlements are evidence of money paid | $350 against $300 owed waits for "Why pay more than is owed?" | `tests/db/settlements.test.ts`; `tests/unit/consignment.test.ts`; `tests/e2e/consignment.spec.ts` |
| Consignment money is for manage_consignments or view_costs only (D48) | Amounts owed to consignors are commercial terms | A mechanic sees the item and its asking price, not what is owed or paid | `tests/db/consignment-access.test.ts`; `tests/e2e/consignment.spec.ts` |
| A consigned bike keeps its bike record; agreement photos stay internal (D51, D52) | Physical identity; the agreement shows the terms | A consignor's own bike record is first transferred to the shop | `tests/db/consignment.test.ts`; `tests/e2e/consignment.spec.ts` (the agreement photo's Public and Customer are disabled) |
| Public/private boundary | Customers and the public never see costs, notes or other customers | Anonymous visitors read published items only; customers only their own rows | `tests/db/customer-access.test.ts`, `workshop-customer-access`, `appointment-customer-access`, `reporting-access`, `inventory-publication` |
| One backend, two frontends | One operational truth | The public site reads the same Supabase project, never a copy | Architecture ([ARCHITECTURE.md](ARCHITECTURE.md)); the public side is Phase 11 |

## Decisions

Decision records are indexed in [decisions/README.md](decisions/README.md);
the one-line index with each decision's status is
[PLAN §6](PLAN.md#6-open-decisions-for-the-owner). The owner's outcomes of
2026-10-05:

| Decision | Outcome | Record |
|---|---|---|
| D12, D15 (with its reopen deviation), D32 | Confirmed | [ADR-006](decisions/ADR-006-customer-and-public-visibility.md), [ADR-008](decisions/ADR-008-work-order-lifecycle.md), [ADR-011](decisions/ADR-011-recognition-and-financial-reporting.md) |
| D14 | Confirmed with clarification: a line's totals use its own cost, including 0; zero-price lines are valid (free parts) | [ADR-009](decisions/ADR-009-line-pricing-and-cost-pending.md) |
| D29 | Confirmed, revisit later (no trigger set) | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md) |
| D24 | Amended: 0 is a known price or cost; only NULL is missing (the code does this; tested since Phase 6 step 1, [R-006](RISKS.md#r-006--no-test-proves-a-zero-price-or-zero-cost-part-is-accepted) resolved) | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md) |
| D27 | Changed: consigned stock may be a job part; customer-owned stock stays never saleable. Built in the database by Phase 6 step 1 (D44, [R-007](RISKS.md#r-007--consigned-stock-cannot-be-a-job-part-yet) resolved); the part sheet offers consigned stock from Phase 6 step 3 | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md), [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D10 (recorded from the note "D11 changed") | Changed: staff sign in with Supabase email OTP, built on a parallel track; this branch still uses email + password | [ADR-005](decisions/ADR-005-staff-sign-in-and-delegation.md) |

Every other D-row is a build default the owner has not individually
confirmed.

## Open assumptions and owner questions

This is the home of the owner questions; the risk entries carry evidence and
next actions.

| # | Question | If unanswered | Risk |
|---|---|---|---|
| 1 | Did "D11 changed (staff email OTP)" mean the sign-in method (D10 on this branch), with the D11 delegation ceiling unchanged? | OTP is integrated against the assumed mapping | [R-004](RISKS.md#r-004--staff-sign-in-change-pending-email-otp) |
| 2 | Cost-pending lines (D14): keep the flag only, or block completion, enter a pending cost once, or exclude them from reports? | Figures stay overstated until a `view_costs` holder corrects the line | [R-005](RISKS.md#r-005--cost-pending-lines-overstate-yield-and-cult-commons) |
| 3 | What should trigger the D29 revisit? | It is revisited only when someone remembers to | [R-008](RISKS.md#r-008--correcting-a-job-whose-sold-bike-reached-its-buyer-is-multi-step) |
| 4 | How long are customer personal data kept, and how is a deletion request handled? | No retention or deletion procedure exists at go-live | [R-016](RISKS.md#r-016--no-retention-or-deletion-policy-for-customer-personal-data) |
| 5 | Who is the product administrator (first admin login) and who the technical operator (Supabase and Vercel account owner, billing)? | No hosted project can be created or recovered | [R-001](RISKS.md#r-001--nothing-is-deployed) |
| 6 | Which hosted plan tier, and how much data loss and downtime are acceptable? | Backups and recovery cannot be designed | [R-002](RISKS.md#r-002--no-backups-monitoring-alerting-or-exercised-recovery) |
| 7 | Which label printer models (SPEC §16)? | Phase 8 ships browser/PDF printing only; Phase 12 cannot start | [R-012](RISKS.md#r-012--label-printer-hardware-is-unknown) |
| 8 | Which Shopify store (and a development store) does Phase 10 integrate against? | Phase 10 can be fixture-tested only | [R-011](RISKS.md#r-011--shopify-is-not-built-and-will-be-fixture-tested-only) |
| 9 | Confirm the consignment and sales build defaults D44–D53 ([ADR-016](decisions/ADR-016-consignment-and-sales.md)), each "Accepted: build default, owner to confirm" | They stay in force as built | [R-020](RISKS.md#r-020--a-bike-record-consigned-once-cannot-be-consigned-again), [R-021](RISKS.md#r-021--reports-overstate-net-sales-after-a-refund-or-restock) |
| 10 | D53: should a sale price below the agreed amount plus shop charges on a consigned item need manage_consignments? | Any staff member may sell below it; the sheet warns (step 4) | — |
| 11 | Are a consignment's agreement photos consignment money (manage_consignments or view_costs only, D48) or ordinary internal photos? | The app shows them to money users only; the database lets any staff read them | [R-022](RISKS.md#r-022--agreement-photos-are-hidden-by-the-app-not-by-the-database) |

Assumed, not confirmed: one shop, one time zone (Asia/Singapore) and one
currency (SGD) ([ADR-012](decisions/ADR-012-shop-time-zone-and-currency.md)).

## Provenance

- [SPEC.md](SPEC.md): the authoritative brief, v1.0 of 3 October 2026, kept
  verbatim as a historical record and still the requirement.
- [PLAN.md](PLAN.md): phases and the decision index, from 4 October 2026.
- The owner decisions of 5 October 2026, recorded in PLAN §6 and the
  records above.
