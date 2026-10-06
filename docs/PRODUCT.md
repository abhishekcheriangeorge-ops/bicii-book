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
| Admin (owner/manager; `staff.role = 'admin'`) | Everything, including staff, shop settings, hours, closures, appointment types, Cult Commons rates and the Shopify integration (settings, the queue of online orders and syncs that need a person, the received webhooks, linking Shopify variants and customers; D86) | `private.require_admin()` / RLS; [ADR-001 A3](ADR-001-architecture.md#a3-authentication-and-authorization) |
| Staff and mechanics (`role = 'staff'`) | Customers, bikes, photos, jobs, lines, appointments, check-in, stock lookups, in-store sales (D48) and reading consignment items; sale prices and sale totals but no costs | RLS `private.is_staff()` and RPC guards |
| Staff with a permission (enum `public.permission_key`, `20261004000200_staff.sql`) | `view_costs`: see and enter costs, yield and Cult Commons on lines, services, products, units and movements. `manage_inventory`: products, units, locations, categories, services, publication, stock transfers, Publish online and Sync now (Shopify, D86). `adjust_stock`: stock adjustments, write-offs, splitting a unit from stock. `view_financial_reports`: money on Today and the financial lines (cost figures also need `view_costs`). `manage_staff`: invite, edit and deactivate staff and grant permissions within the D11 ceiling ([ADR-005](decisions/ADR-005-staff-sign-in-and-delegation.md)). `manage_consignments`: consignors, intake, charges, returns, settlements, payout details, and (with `adjust_stock`) restocking a consigned unit; consignment money is visible with it or with `view_costs` (D48). Retail refunds are for admins only (D49). `manage_purchasing` exists but gates nothing yet: Phase 7 uses it | `private.require_permission` / `private.has_permission` in the RPCs; `requireStaff(permission)` in pages and actions |
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
| A webhook replay has one business effect | Shopify redelivers | Ten deliveries of one order make one event and one sale; the same order under another webhook id is a duplicate of the first sale, and recording it closes its other failed deliveries; an order or refund an admin dismissed is never recorded later, even under a new webhook id (D87) | `tests/db/shopify-webhooks.test.ts` ("Duplicate Shopify webhook has one effect", with concurrent deliveries; the two-webhook-id and dismiss-then-redeliver cases) (Phase 10 step 1, review fixes) |
| An online order is recorded whole at Shopify's prices, or not at all (D80, D82) | The shop's sales must match the money Shopify took; a partial order hides a problem | A 3 × 40.00 line with 20.00 off becomes 2 × 33.33 and 1 × 33.34 (Σ 100.00); an order with one line BICII cannot link, a unit that already sold in the shop, or too little stock at the online location records nothing and waits for an admin with a message saying what to do | `tests/db/shopify-webhooks.test.ts` ("Online prices equal Shopify's totals exactly", "Unmapped variants go to the retry queue and nothing is partial", "Online stock follows the ledger rules") |
| An online sale is recognised when Shopify processed the order (D80) | A retried webhook must not move a sale to another day | Two deliveries a day apart: one sale on the order's day | `tests/db/shopify-webhooks.test.ts` ("Recognition date") |
| A Shopify refund is money only (D7, D85) | A refund and a return are different facts | A refund with shipping records the sale total and keeps the shipping in the event; stock, units and consignment are untouched; reports are unchanged (D49) | `tests/db/shopify-webhooks.test.ts` ("Refunds are financial only") |
| Test and POS orders are not sales; tax-exclusive orders are refused (D89) | In-store sales are recorded in BICII; BICII never adds or drops tax | A Shopify test order is kept but skipped unless test orders are switched on (development only) | `tests/db/shopify-webhooks.test.ts` ("Test and POS orders are not sales", "Tax basis is explicit") |
| An online listing shows BICII's one price and stock (D81, D83, D84) | The label, the public page, the shop and Shopify must agree | A consigned bike's Shopify price is its consignment asking price, like its label; the online quantity is the stock at the online location only; a unique product with units at different prices is not pushed until they agree | `tests/db/shopify-sync.test.ts` ("What the sync worker reads") |
| Publishing online needs a public, priced product; every change queues one sync (D84, D86, D24) | Nothing half-ready goes online; Shopify follows BICII | Publishing an internal-only, archived, customer-owned or unpriced product is refused (a price of 0 is a price); ten stock changes queue one sync; a product only linked to an item made in Shopify is not pushed until published | `tests/db/shopify-sync.test.ts` ("Publish online", "Changes queue one sync per product") |
| Buy online appears only while the online listing is live, and only where it sells what the page shows (D84, D81) | Never send a shopper to a missing or sold-out page, another bike or another price | The public link exists only for an available item that is published online, synced, created by BICII in Shopify, with the storefront set; of a unique product's units only the one an online order takes (the oldest at the online location) has it, and the product's own page only when its price is the online price | `tests/db/shopify-sync.test.ts` ("Buy online link", "links only what Shopify sells") |
| Shopify customers are linked by an admin, never by email (D86) | An email is not proof of identity (SPEC §17.2) | A matching email leaves the online sale without a customer until an admin links the Shopify customer; earlier sales keep their Shopify customer id | `tests/db/shopify-webhooks.test.ts` ("Customer linking is explicit") |
| Online selling is run from the Admin, and a problem is never silent (D82, D86, D87; SPEC §26) | Staff must see what Shopify did and fix it without a developer | Publish online is a switch on the product (manage_inventory) that shows the sync status to every staff member; an order BICII cannot record appears on admins' Today as "Shopify needs attention" and in the Shopify queue with the reason; the admin links the product and retries, or refunds in Shopify and dismisses with a reason; a forged delivery is refused and kept without its body. The Shopify pages are admin-only, so More and the iPad rail list Shopify for admins only; with Publish online on, the product card says why an item that is not public, active or unarchived is not listed | `tests/e2e/shopify.spec.ts` (journey 5, the unmapped variant, the bad signature, the boundaries), `tests/unit/auth-helpers.test.ts` (navigation), `tests/unit/shopify-queue-sheet.test.tsx` (Phase 10 step 4, review fixes) |
| Consignment liability is separate from settlement | The shop owes a consignor until it pays | A partial payment leaves the rest owed; a restock after payment leaves the consignor overpaid, never in credit | `tests/db/settlements.test.ts` (Phase 6 step 2); on screen, `tests/e2e/consignment.spec.ts` ($500 owed, $200 then $300 paid, Outstanding $0.00) and `tests/unit/consignment.test.ts` (the Overpaid label) |
| A consigned item used on a job is sold when the job is completed (D44) | The owner's D27 change: consigned stock may be a job part | The consignor is owed the agreed amount exactly while the line is live on a completed job; a reopen removes it, a void returns the stock | `tests/db/consignment-job-parts.test.ts`; `tests/e2e/consignment.spec.ts` |
| Every charge names who bears it (D4) | A consignor-paid charge comes off what they are owed; a shop-paid one is a direct cost | The charge sheet cannot be submitted until Consignor pays or Shop pays is chosen; Shop pays only on a single available item (D45) | `tests/db/consignment.test.ts`; `tests/e2e/consignment.spec.ts` |
| Paying more than is owed needs a reason; mistakes are reversed whole (D47) | Settlements are evidence of money paid | $350 against $300 owed waits for "Why pay more than is owed?" | `tests/db/settlements.test.ts`; `tests/unit/consignment.test.ts`; `tests/e2e/consignment.spec.ts` |
| Consignment money is for manage_consignments or view_costs only (D48) | Amounts owed to consignors are commercial terms | A mechanic sees the item and its asking price, not what is owed or paid | `tests/db/consignment-access.test.ts`; `tests/e2e/consignment.spec.ts` |
| Any staff member may sell in store; sale costs are for view_costs only (D48) | Selling is front-desk work; cost and yield are not | A mechanic records a sale and sees its total, never its cost, yield or Cult Commons | `tests/db/sales.test.ts`; `tests/e2e/sales.spec.ts`, `tests/e2e/consignment-journey.spec.ts` |
| A refund is money only; a returned unit is restocked separately (D7, D49) | A refund and a return are different facts | A partial refund marks the sale Partly refunded and leaves the stock as it was; only admins refund | `tests/db/sales.test.ts`; `tests/e2e/sales.spec.ts` |
| A sale price may be overridden with no floor; the sheet warns (D53) | Staff negotiate at the counter | Below the asking price warns everyone; below cost warns View costs holders | `tests/unit/sales.test.ts`; `tests/e2e/sales.spec.ts` |
| A label carries only public details and the shop's QR address (D9, D58) | The QR and label are what an anonymous scan sees; costs, consignors and notes stay private | The bar tape label reads name, $49.00, P-000011, SKU; a price of 0 prints $0.00, a missing price prints no price; the QR is `{shop public address}/q/P-000011`, from the database, never from the app's environment | `tests/db/labels.test.ts` (including the source of `private.label_content` and the `print_jobs_content_keys` check); `tests/unit/printing/schemas.test.ts` (a `cost` key is refused), `compose.test.ts`, `label-svg.test.tsx` (the QR decodes to exactly the payload); `tests/e2e/print-view.spec.ts`; journey 4 in `tests/e2e/consignment-journey.spec.ts` (the consigned bike's label shows the asking price, never the $500 owed, and equals the unit's "What the public sees" price) |
| The QR address comes from Labels and printers; nothing prints until it is set (D9) | A label is printed once and scanned for years; one address, owned by an admin | With no or a malformed public website address, Print label is disabled and says "Labels are off until an admin sets the public website address in Labels and printers settings."; the environment's address only adds an accepted scan address; changing the address leaves printed labels on the old one (keep a redirect) | `tests/db/labels.test.ts` (`public_site_url_invalid`); `tests/unit/qr-base.test.ts`, `qr-base-sources.test.ts`; `tests/e2e/labels.spec.ts` ("the QR address shown is the one printed") |
| One print job prints 1–500 labels of a product, or 1–10 of a unit or bike (D56) | A per-job cap against mistakes, not a limit on labels | 600 labels are two jobs; the sheet says how many remain | `tests/db/labels.test.ts`; `tests/unit/printing/job.test.ts`, `print-sheet.test.ts`; journey 3 in `tests/e2e/inventory.spec.ts` (ten identical labels through the PDF) |
| Unique items are labelled per unit (D57) | Each physical item has its own identity and public row | A unique product has no P- label (`label_unique_product_needs_unit`); a unit linked to a bike shows its size and colour; a bike tag (B-) scans to "not found" publicly | `tests/db/labels.test.ts`; `tests/e2e/labels.spec.ts` |
| A print counts as printed only when staff confirm it (D59) | Browsers cannot report printer success | An unconfirmed job stays under To confirm; a finished job is never re-rendered: Print again makes a new job | `tests/db/labels.test.ts`; `tests/unit/print-job-controls.test.tsx`; `tests/e2e/print-view.spec.ts` (409 for a finished job's PDF), `labels.spec.ts`; journeys 3 and 4 confirm their jobs printed |
| A consignor is charged only for stock that was where it was sold (D54) | The consignor ledger must follow the goods | Alpha's jerseys in the workshop store and Beta's on the shop floor: a sale on the shop floor is Beta's, at Beta's price and payout; a transfer moves one consignor's stock | `tests/db/consignment-locations.test.ts` |
| A sale is never dated before its stock was with the shop (D55) | A sale before the item arrived is an impossible record | "Sold earlier?" may go back, but not before a consigned item's intake or a unit's restock, and not into the future | `tests/db/sales.test.ts`; `tests/e2e/sales.spec.ts` (a future date is marked on Sold at) |
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
| 9 | Confirm the consignment and sales build defaults D44–D55 ([ADR-016](decisions/ADR-016-consignment-and-sales.md)), each "Accepted: build default, owner to confirm" (D54 and D55 came from the Phase 6 review) | They stay in force as built | [R-020](RISKS.md#r-020--a-bike-record-consigned-once-cannot-be-consigned-again), [R-021](RISKS.md#r-021--reports-overstate-net-sales-after-a-refund-or-restock), [R-025](RISKS.md#r-025--a-transfer-of-consigned-stock-cannot-choose-whose-stock-moves) |
| 10 | D53: should a sale price below the agreed amount plus shop charges on a consigned item need manage_consignments? | Any staff member may sell below it; the sheet warns "Below the asking price" and, for View costs, "Below cost" | [R-024](RISKS.md#r-024--a-consigned-item-can-be-sold-below-what-the-consignor-is-owed) |
| 11 | Are a consignment's agreement photos consignment money (manage_consignments or view_costs only, D48) or ordinary internal photos? | The app shows them to money users only; the database lets any staff read them | [R-022](RISKS.md#r-022--agreement-photos-are-hidden-by-the-app-not-by-the-database) |
| 12 | Refunds in reports (D49 points here): should refunds and restocks be netted out of gross sales, yield and Cult Commons, and should Cult Commons be clawed back? Decided by Phase 9's refund-reporting row (in D100–D119), for retail and online refunds together (online refunds follow D85: financial only, netted by nothing yet) | Reports keep every sale line at its snapshot | [R-021](RISKS.md#r-021--reports-overstate-net-sales-after-a-refund-or-restock) |
| 13 | D55: should dating an in-store sale more than a few days back (for example 7) need a permission such as view_financial_reports or admin? | Any staff member may backdate a sale to when its stock came in, changing that past day's figures | [R-027](RISKS.md#r-027--a-sale-can-be-backdated-without-limit-by-any-staff-member) |
| 14 | How long are consignors' personal and payout details kept, and should changes to payout details be recorded? | Kept indefinitely; a changed bank detail leaves no history | [R-026](RISKS.md#r-026--consignor-personal-and-payout-details-are-kept-indefinitely-with-no-change-history) |
| 15 | Confirm the label build defaults D56–D59 and D9's QR base ([ADR-017](decisions/ADR-017-labels-and-qr-base.md)): the shop's public address with no fallback, 1–500 labels per job for a product and 1–10 for a unit or bike, labels per unit for unique items, the selling price on the label (none when unknown, 0.00 when 0), and staff confirming each print. Changing the public website address later orphans every printed label unless the old address redirects | They stay in force as built (Phase 8, complete on `feat/p8-labels`) | [R-013](RISKS.md#r-013--changing-the-qr-base-leaves-printed-labels-on-the-old-address), [R-012](RISKS.md#r-012--label-printer-hardware-is-unknown) |
| 16 | Which numbers do new main-line decisions take now that D43–D59 is used up? Answered 2026-10-06 by the orchestrator's allocation: each track has its own range (D80–D89 Shopify, D90–D99 roles, D100–D119 reporting, D120–D139 public site, D140 and up later; [PLAN §6](PLAN.md#6-open-decisions-for-the-owner)) | Answered | [R-028](RISKS.md#r-028--the-main-line-decision-range-d43d59-is-exhausted) (resolved) |
| 17 | D89: is the Shopify store configured tax-inclusive, and are in-store prices GST-inclusive? BICII records Shopify's tax-inclusive line prices and refuses an order charged tax on top (`shopify_tax_basis_unsupported`) | Online orders from a tax-exclusive store are refused and must be recorded by hand | [R-011](RISKS.md#r-011--shopify-is-not-built-and-will-be-fixture-tested-only) |
| 18 | D89: does the shop use Shopify POS for any sale BICII must record? Orders with `source_name` 'pos' are skipped because in-store sales are recorded in BICII | A POS sale would be missing from BICII's sales and stock | [R-011](RISKS.md#r-011--shopify-is-not-built-and-will-be-fixture-tested-only) |
| 19 | Confirm the Shopify build defaults D80–D88 ([ADR-020](decisions/ADR-020-shopify.md)): Shopify's discounted line prices split exactly and recognised at the order's processed time; the oldest unit sells online; an order the ledger cannot fulfil records nothing and waits for staff; one online location; what Publish online pushes; refunds as financial facts only; integration administration admin-only and customers linked only by hand; the retry policy; rejected deliveries kept as evidence and purged by hand | They stay in force as built | [R-011](RISKS.md#r-011--shopify-is-not-built-and-will-be-fixture-tested-only) |

Assumed, not confirmed: one shop, one time zone (Asia/Singapore) and one
currency (SGD) ([ADR-012](decisions/ADR-012-shop-time-zone-and-currency.md)).

## Provenance

- [SPEC.md](SPEC.md): the authoritative brief, v1.0 of 3 October 2026, kept
  verbatim as a historical record and still the requirement.
- [PLAN.md](PLAN.md): phases and the decision index, from 4 October 2026.
- The owner decisions of 5 October 2026, recorded in PLAN §6 and the
  records above.
