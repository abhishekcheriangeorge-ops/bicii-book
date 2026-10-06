# Product context

Owner: Abhishek Cherian George ("George"; GitHub `abhishekcheriangeorge-ops`),
product owner. Last substantive decision: the owner decisions of 2026-10-05
and the staff roles of 2026-10-06
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
| Admin (`staff.role = 'admin'`, D90) | Everything: every permission, retail refunds, and the admin-only things: shop settings, hours, closures, appointment types, Cult Commons rates, roles, and inviting or changing admins and managers (D91, D93) | `private.role_implies` / `private.has_permission`, `private.is_admin()` / `private.require_admin()`, `private.can_record_refunds()`; `requireAdmin()` / `{ admin: true }` in pages and actions; [ADR-021](decisions/ADR-021-staff-roles.md), [ADR-001 A3](ADR-001-architecture.md#a3-authentication-and-authorization) |
| Manager (`role = 'manager'`, D90) | Every permission except `manage_staff` (`view_costs`, `manage_inventory`, `adjust_stock`, `manage_consignments`, `manage_purchasing`, `view_financial_reports`), and retail refunds (D94); not the admin-only things | `private.role_implies` / `private.has_permission` in RLS and RPCs; `private.can_record_refunds()` (a role check); `roleImplies` / `canRecordRefund` and `{ roles: ["admin", "manager"] }` in the app |
| Mechanic (`role = 'mechanic'`, formerly `'staff'`; the default for new staff) | Customers, bikes, photos, jobs, lines, appointments, check-in, stock lookups, in-store sales (D48), reading consignment items, suppliers and purchase orders (quantities, statuses and dates); sale prices and sale totals but no costs. Nothing more unless granted as an exception | RLS `private.is_staff()` and RPC guards; `private.role_implies` implies nothing |
| Extra access exceptions (`staff_permissions` rows on top of the role, D92; enum `public.permission_key`) | One permission for one person, granted by an admin (or, for a mechanic, by a `manage_staff` holder within the D11 ceiling, D93). A mechanic may hold any; a manager only `manage_staff`; an admin none (a row the role implies is refused). The permissions: `view_costs`: see and enter costs, yield and Cult Commons on lines, services, products, units and movements. `manage_inventory`: products, units, locations, categories, services, publication, stock transfers. `adjust_stock`: stock adjustments, write-offs, splitting a unit from stock. `view_financial_reports`: money on Today and the financial lines (cost figures also need `view_costs`). `manage_staff`: invite mechanics, and change mechanics' exceptions and access within the D11 ceiling (only an admin acts on admins and managers or changes roles; [ADR-005](decisions/ADR-005-staff-sign-in-and-delegation.md), D93). `manage_consignments`: consignors, intake, charges, returns, settlements, payout details, and (with `adjust_stock`) restocking a consigned unit; consignment money is visible with it or with `view_costs` (D48). `manage_purchasing`: suppliers, purchase orders, receiving and reorder; as a mechanic's exception it shows purchase costs on purchasing screens only (D60). No exception grants refunds (D94) | `private.has_permission` (role plus rows) / `private.require_permission` in the RPCs, trigger `staff_permissions_refuse_implied`; `requireStaff(permission)` and `isExceptionFor` in the app |
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
| Any staff member may sell in store; sale costs are for view_costs only (D48) | Selling is front-desk work; cost and yield are not | A mechanic records a sale and sees its total, never its cost, yield or Cult Commons | `tests/db/sales.test.ts`; `tests/e2e/sales.spec.ts`, `tests/e2e/consignment-journey.spec.ts` |
| A refund is money only; a returned unit is restocked separately (D7, D49) | A refund and a return are different facts | A partial refund marks the sale Partly refunded and leaves the stock as it was; only admins and managers refund (D94) | `tests/db/sales.test.ts`; `tests/e2e/sales.spec.ts` |
| A sale price may be overridden with no floor; the sheet warns (D53) | Staff negotiate at the counter | Below the asking price warns everyone; below cost warns View costs holders | `tests/unit/sales.test.ts`; `tests/e2e/sales.spec.ts` |
| A consignor is charged only for stock that was where it was sold (D54) | The consignor ledger must follow the goods | Alpha's jerseys in the workshop store and Beta's on the shop floor: a sale on the shop floor is Beta's, at Beta's price and payout; a transfer moves one consignor's stock | `tests/db/consignment-locations.test.ts` |
| A sale is never dated before its stock was with the shop (D55) | A sale before the item arrived is an impossible record | "Sold earlier?" may go back, but not before a consigned item's intake or a unit's restock, and not into the future | `tests/db/sales.test.ts`; `tests/e2e/sales.spec.ts` (a future date is marked on Sold at) |
| Receiving the same delivery twice cannot double stock (SPEC §23) | A retry or a double tap must not add stock again | One submission's key received twice: one receipt, stock +18 once; a lost response is looked up, never re-sent blindly | `tests/db/purchasing.test.ts`, `purchasing-concurrency.test.ts`; `tests/unit/receive-form.test.ts`; `tests/e2e/purchasing.spec.ts` (double tap, lost response, lost request) |
| A receipt's actual cost becomes the product's cost; the latest delivery wins (D5, D63) | Last cost, no averaging; a late paper note must not overwrite a newer price | A receipt back-dated before a newer one changes no cost; 0 is a known cost; job and sale snapshots never change | `tests/db/purchasing.test.ts` |
| More than ordered is refused; a received order is closed (D65) | The order stays the record of what was agreed | 20 ordered, 18 received: receiving 3 more is refused until the line is raised | `tests/db/purchasing.test.ts`; `tests/e2e/purchasing.spec.ts` |
| Only shop-owned counted products are purchased (D62) | Consigned stock belongs to its consignor and comes in through intake (D45, D50) | The seeded consigned jerseys cannot go on an order, a low-stock draft or a supplier link, and are never a reorder suggestion even when below their reorder point | `tests/db/purchasing.test.ts` ("Phase 6's consigned stock is never purchased") |
| Purchase costs are for view_costs or manage_purchasing, on purchasing screens only (D60) | A buyer must see costs to order; purchasing is no licence to see yield or Cult Commons | A manage_purchasing-only holder (since the staff roles, a mechanic with it as extra access; managers see every cost through their role, D91) sees line and last costs on purchasing screens but no job, product-page or report cost: the product page's "Suppliers & orders" card shows supplier last costs to view_costs holders only | `tests/db/purchasing-access.test.ts`; `tests/unit/purchasing.test.ts` (`canSeeProductPageSupplierCosts`); `tests/e2e/purchasing.spec.ts` (mechanic2 sees no cost) |
| A consigned bike keeps its bike record; agreement photos stay internal (D51, D52) | Physical identity; the agreement shows the terms | A consignor's own bike record is first transferred to the shop | `tests/db/consignment.test.ts`; `tests/e2e/consignment.spec.ts` (the agreement photo's Public and Customer are disabled) |
| Staff sign in only with an emailed one-time code; no staff login has a known password (D10, D70) | Logins live on shared shop devices; an inviter must not hold a colleague's password | An invite creates the login without a password and shows none; an unknown email gets the same "Check your email" screen and no account; a right code for someone who is not active staff signs them straight out | `tests/e2e/auth.spec.ts`, `tests/e2e/staff.spec.ts`, `tests/db/stack.smoke.test.ts`, `tests/db/seed-logins.test.ts`, `tests/unit/sign-in-errors.test.ts` |
| Deactivating someone ends their sessions at once (D71) | A person who leaves must lose access on every device | Their refresh tokens are deleted in the same transaction; a token already issued is refused by every page, action and RPC until it expires | `tests/db/staff-sessions.test.ts`, `tests/db/staff-sessions.stack.test.ts`, `tests/unit/session-guard.test.ts`, `tests/e2e/staff.spec.ts` |
| A report says which date it counts by (D100) | Check-in, completion, collection and sale are different events (SPEC §19.2) | A job checked in Monday, completed Wednesday and collected Sunday counts on Monday by check-in, Wednesday by completion and on the sale basis, Sunday by collection; work in progress counts only by check-in; retail sales only on the sale basis; a cancelled job never carries money | `tests/db/period-reports.test.ts` ("Completed and collected are different events") |
| Refunds are reported beside gross sales, never netted (D102) | A refund is its own event; netting yield or Cult Commons is the owner's open question 12 | A $100 refund recorded today shows as "refunds recorded" today; the March sale keeps its $1,000 gross, $500 yield and $150 Cult Commons, restocked line included | `tests/db/period-reports.test.ts` ("Refunds are reported separately (D102)") |
| Public/private boundary | Customers and the public never see costs, notes or other customers | Anonymous visitors read published items only; customers only their own rows | `tests/db/customer-access.test.ts`, `workshop-customer-access`, `appointment-customer-access`, `reporting-access`, `inventory-publication` |
| One backend, two frontends | One operational truth | The public site reads the same Supabase project, never a copy | Architecture ([ARCHITECTURE.md](ARCHITECTURE.md)); the public side is Phase 11 |

## Decisions

Decision records are indexed in [decisions/README.md](decisions/README.md);
the one-line index with each decision's status is
[PLAN §6](PLAN.md#6-open-decisions-for-the-owner). The owner's outcomes of
2026-10-05 and 2026-10-06:

| Decision | Outcome | Record |
|---|---|---|
| D12, D15 (with its reopen deviation), D32 | Confirmed | [ADR-006](decisions/ADR-006-customer-and-public-visibility.md), [ADR-008](decisions/ADR-008-work-order-lifecycle.md), [ADR-011](decisions/ADR-011-recognition-and-financial-reporting.md) |
| D14 | Confirmed with clarification: a line's totals use its own cost, including 0; zero-price lines are valid (free parts) | [ADR-009](decisions/ADR-009-line-pricing-and-cost-pending.md) |
| D29 | Confirmed, revisit later (no trigger set) | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md) |
| D24 | Amended: 0 is a known price or cost; only NULL is missing (the code does this; tested since Phase 6 step 1, [R-006](RISKS.md#r-006--no-test-proves-a-zero-price-or-zero-cost-part-is-accepted) resolved) | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md) |
| D27 | Changed: consigned stock may be a job part; customer-owned stock stays never saleable. Built in the database by Phase 6 step 1 (D44, [R-007](RISKS.md#r-007--consigned-stock-cannot-be-a-job-part-yet) resolved); the part sheet offers consigned stock from Phase 6 step 3 | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md), [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D10 (recorded from the note "D11 changed") | Changed: staff sign in with Supabase email one-time codes. Built on `feat/auth-email-otp` and integrated with main and purchasing on 2026-10-06 (D70–D72 are its build defaults) | [ADR-019](decisions/ADR-019-staff-email-sign-in.md), [ADR-005](decisions/ADR-005-staff-sign-in-and-delegation.md) |
| Staff roles (2026-10-06; D90–D94, D92 and part of D93 are build defaults) | Three roles, admin, manager and mechanic (today's "staff" becomes mechanic); a manager holds every permission except `manage_staff` and may record refunds; admin-only things stay admin-only; single-permission exceptions on top of a role stay. Built on `feat/staff-roles` (database, permission model, guards, refunds, profile page, staff screens with the role picker and Extra access, invites by role; integration-reviewed 2026-10-06, not pushed); D92 and D93's build-default parts await owner question 20 | [ADR-021](decisions/ADR-021-staff-roles.md) |
| D60 | Informed, no objection: since the staff roles (D90–D94, built) managers see purchase costs through their role's `view_costs`, and D60's purchasing-screens-only cost visibility covers only the exception case, a mechanic granted `manage_purchasing` as extra access | [ADR-018](decisions/ADR-018-purchasing.md), [ADR-021](decisions/ADR-021-staff-roles.md) |

Every other D-row is a build default the owner has not individually
confirmed.

## Open assumptions and owner questions

This is the home of the owner questions; the risk entries carry evidence and
next actions.

| # | Question | If unanswered | Risk |
|---|---|---|---|
| 1 | Did "D11 changed (staff email OTP)" mean the sign-in method (D10 on this branch), with the D11 delegation ceiling unchanged? (Treated as answered on 2026-10-06: the owner's decision list names D11 as the email-code sign-in, now built as D10 here; the ceiling itself is restated for roles by D93: only admins act on admins and managers, and a non-admin `manage_staff` holder acts on mechanics only. The owner may still object.) | Email codes are integrated against this mapping | [ADR-019](decisions/ADR-019-staff-email-sign-in.md), [R-035](RISKS.md#r-035--logins-created-before-email-codes-keep-a-known-password-until-the-pre-deploy-reset) (R-004 closed 2026-10-06) |
| 2 | Cost-pending lines (D14): keep the flag only, or block completion, enter a pending cost once, or exclude them from reports? | Figures stay overstated until a `view_costs` holder corrects the line | [R-005](RISKS.md#r-005--cost-pending-lines-overstate-yield-and-cult-commons) |
| 3 | What should trigger the D29 revisit? | It is revisited only when someone remembers to | [R-008](RISKS.md#r-008--correcting-a-job-whose-sold-bike-reached-its-buyer-is-multi-step) |
| 4 | How long are customer personal data kept, and how is a deletion request handled? | No retention or deletion procedure exists at go-live | [R-016](RISKS.md#r-016--no-retention-or-deletion-policy-for-customer-personal-data) |
| 5 | Who is the product administrator (first admin login) and who the technical operator (Supabase and Vercel account owner, billing)? | No hosted project can be created or recovered | [R-001](RISKS.md#r-001--nothing-is-deployed) |
| 6 | Which hosted plan tier, and how much data loss and downtime are acceptable? | Backups and recovery cannot be designed | [R-002](RISKS.md#r-002--no-backups-monitoring-alerting-or-exercised-recovery) |
| 7 | Which label printer models (SPEC §16)? | Phase 8 ships browser/PDF printing only; Phase 12 cannot start | [R-012](RISKS.md#r-012--label-printer-hardware-is-unknown) |
| 8 | Which Shopify store (and a development store) does Phase 10 integrate against? | Phase 10 can be fixture-tested only | [R-011](RISKS.md#r-011--shopify-is-not-built-and-will-be-fixture-tested-only) |
| 9 | Confirm the consignment and sales build defaults D44–D55 ([ADR-016](decisions/ADR-016-consignment-and-sales.md)), each "Accepted: build default, owner to confirm" (D54 and D55 came from the Phase 6 review) | They stay in force as built | [R-020](RISKS.md#r-020--a-bike-record-consigned-once-cannot-be-consigned-again), [R-021](RISKS.md#r-021--reports-overstate-net-sales-after-a-refund-or-restock), [R-025](RISKS.md#r-025--a-transfer-of-consigned-stock-cannot-choose-whose-stock-moves) |
| 10 | D53: should a sale price below the agreed amount plus shop charges on a consigned item need manage_consignments? | Any staff member may sell below it; the sheet warns "Below the asking price" and, for View costs, "Below cost" | [R-024](RISKS.md#r-024--a-consigned-item-can-be-sold-below-what-the-consignor-is-owed) |
| 11 | Are a consignment's agreement photos consignment money (manage_consignments or view_costs only, D48) or ordinary internal photos? | The app shows them to money users only; the database lets any staff read them | [R-022](RISKS.md#r-022--agreement-photos-are-hidden-by-the-app-not-by-the-database) |
| 12 | Refunds in reports (D49 points here): should refunds and restocks be netted out of gross sales, yield and Cult Commons, and should Cult Commons be clawed back? Decided by Phase 9's refund-reporting row (working name DR5), for retail and online refunds together — build default D102 (refunds reported separately, no claw-back) | Reports keep every sale line at its snapshot | [R-021](RISKS.md#r-021--reports-overstate-net-sales-after-a-refund-or-restock) |
| 13 | D55: should dating an in-store sale more than a few days back (for example 7) need a permission such as view_financial_reports or admin? | Any staff member may backdate a sale to when its stock came in, changing that past day's figures | [R-027](RISKS.md#r-027--a-sale-can-be-backdated-without-limit-by-any-staff-member) |
| 14 | How long are consignors' personal and payout details kept, and should changes to payout details be recorded? | Kept indefinitely; a changed bank detail leaves no history | [R-026](RISKS.md#r-026--consignor-personal-and-payout-details-are-kept-indefinitely-with-no-change-history) |
| 15 | Confirm the purchasing build defaults D61–D66 ([ADR-018](decisions/ADR-018-purchasing.md)): cancel with a reason, shop-owned counted products only, last cost by delivery date, 30-day back-dating, no over-receipt, reorder to twice the reorder point | They stay in force as built | [R-030](RISKS.md#r-030--a-wrong-delivery-cannot-be-reversed-only-adjusted), [R-032](RISKS.md#r-032--purchase-movements-carry-the-recording-time-not-the-delivery-time) |
| 16 | Should a wrongly recorded delivery be reversible as a whole (a reverse-receipt that also restores the earlier cost), instead of a stock adjustment plus a cost edit? | Corrections stay an adjustment with a reason; a wrong actual cost stays the product's cost until someone with costs fixes it | [R-030](RISKS.md#r-030--a-wrong-delivery-cannot-be-reversed-only-adjusted) |
| 17 | Should buying a unique item (a frame, a bike) from a supplier go through a purchase order? | Unique items are registered one by one in Stock with their cost; no supplier or order is recorded for them | [R-033](RISKS.md#r-033--unique-items-bought-from-a-supplier-have-no-purchase-order) |
| 18 | Confirm the email sign-in build defaults D70–D72 ([ADR-019](decisions/ADR-019-staff-email-sign-in.md)): 6-digit codes valid 10 minutes, resend after 60 s, the same screen for unknown emails; deactivation ends sessions at once; the Admin's own limits per address and per email | They stay in force as built | [R-037](RISKS.md#r-037--auths-otp-endpoint-reveals-whether-an-address-has-a-login), [R-038](RISKS.md#r-038--a-visitor-who-knows-a-staff-email-can-delay-its-sign-in) |
| 19 | Which email provider (SMTP) and sender address send the sign-in codes on the hosted projects, and who owns that account? | Nobody can sign in on a hosted project | [R-039](RISKS.md#r-039--hosted-email-delivery-and-auth-settings-are-unverified) |
| 20 | Confirm the staff-roles build defaults D92 (a role change removes the extra access the new role includes; a demotion does not restore it; an exception the role already includes is refused) and D93 (a non-admin who manages staff acts on mechanics only, also for rename, deactivate and reactivate; such a person can still rename themselves) ([ADR-021](decisions/ADR-021-staff-roles.md)) | They stay in force as built | [R-053](RISKS.md#r-053--the-staff-roles-build-defaults-d92-and-d93-are-unconfirmed) |
| 21 | Confirm the reporting build defaults D100–D105 ([ADR-022](decisions/ADR-022-reporting.md)): four date bases, restatement without period close, refunds shown separately with no Cult Commons claw-back, lead-mechanic attribution, shop-currency totals, stock valued at last cost (shop-owned only, NULL cost not valued) | They stay in force as built | [R-055](RISKS.md#r-055--past-report-periods-change-after-a-reopen-a-back-dated-sale-or-a-back-dated-receipt), [R-056](RISKS.md#r-056--stock-value-uses-each-products-last-cost-not-the-cost-of-the-units-on-hand), [R-021](RISKS.md#r-021--reports-overstate-net-sales-after-a-refund-or-restock) |

Assumed, not confirmed: one shop, one time zone (Asia/Singapore) and one
currency (SGD) ([ADR-012](decisions/ADR-012-shop-time-zone-and-currency.md)).

## Provenance

- [SPEC.md](SPEC.md): the authoritative brief, v1.0 of 3 October 2026, kept
  verbatim as a historical record and still the requirement.
- [PLAN.md](PLAN.md): phases and the decision index, from 4 October 2026.
- The owner decisions of 5 October 2026, recorded in PLAN §6 and the
  records above.
