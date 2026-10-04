# BICII Admin — Implementation plan

This is the working plan for building the BICII Admin PWA in this repository.
It is derived from the authoritative brief in [SPEC.md](./SPEC.md); the brief
wins on any conflict. The design it implements is in
[ADR-001](./ADR-001-architecture.md) and [DATA-MODEL.md](./DATA-MODEL.md);
tests per phase are in [TESTING.md](./TESTING.md).

Read order for an implementing agent: SPEC.md → this file → ADR-001 →
DATA-MODEL.md → TESTING.md → the Next.js 16 docs in
`node_modules/next/dist/docs/` for anything touching routing, actions,
caching or proxy.

## 0. Ground truth established before planning

- Public site repo `abhishekcheriangeorge-ops/bicii`: Next.js 16.2.12,
  React 19.2.4, Tailwind 4, TypeScript, Vercel, static, no backend. Design
  tokens live in `src/app/globals.css` (`@theme`: ink/paper, red/yellow/sky/
  indigo/green accents, dust neutral ramp with documented WCAG contrast,
  Archivo display + Inter body, spring easings). Primitives: `Button`
  (44px floor, press-compress), `Section`, `Reveal`, `PageShell`,
  `SiteHeader` (sticky, sheet nav with `inert`), `.gutter`, `.eyebrow`,
  `.measure`.
- Admin repo `abhishekcheriangeorge-ops/bicii-book`: empty, no commits.
- Toolchain available to the cloud agent: Node 22, npm 10, Supabase CLI via
  `npx supabase`, Postgres 16 locally (no Docker, so no `supabase start`
  there; the Docker-free devstack in `scripts/devstack/` runs the real
  Supabase Auth, PostgREST and Storage instead; see TESTING.md).
- Next.js 16 specifics that change how code is written are listed in
  ADR-001 "Context".

## 1. Working rules for the implementing agent

1. Every phase ends with the app runnable (`npm run dev` against the local DB
   with seed), `npm run check` and `npm test` green, and a PR. No giant
   branch.
2. Schema and RPC first, then domain service, then UI. A screen that renders
   without its invariant tests is not done (SPEC §32).
3. Do not change business semantics. The items in §6 "Open decisions" are
   the ones already identified; if a new one appears, stop and surface it in
   the PR rather than improvising (SPEC §33).
4. Never commit secrets. `.env.example` lists every variable; `.env.local`
   is git-ignored.
5. Follow the Next.js 16 docs in `node_modules/next/dist/docs/`, not
   training-data conventions: `proxy.ts` not `middleware.ts`; await
   `cookies()`, `params`, `searchParams`; `revalidateTag(tag, 'max')` or
   `updateTag`; ESLint from the CLI.
6. Money arithmetic that matters happens in Postgres. TypeScript formats and
   previews only.
7. Commit messages describe the business rule the change enforces, not the
   file touched.

## 2. Phases

Phase numbers match SPEC §29. Each phase lists its deliverables, the tests
that gate it, and its PR. Estimates are in agent working sessions, not days.

### Phase 0 — Foundation (this plan's PR + the scaffold PR)

Deliverables:

- Next.js 16 scaffold: `create-next-app@latest --ts --tailwind --eslint --app
  --src-dir --import-alias "@/*"`, then prettier, `vitest.config.mts`,
  `playwright.config.mts`, `.github/workflows/ci.yml`, `.env.example`,
  `.nvmrc` (22).
- `supabase init`; `supabase/config.toml`; migration `0001_extensions_and_
  helpers.sql` (pgcrypto, citext, `private` and `reporting` schemas,
  `money_amount` domain, `set_updated_at()` trigger function,
  `private.next_short_id()` and sequences, `private.current_staff_id()` and
  the other staff helpers, `private.require_permission()`;
  `private.current_customer_id()` moves to Phase 1, with the customers table
  it reads); migration `0002_staff.sql` (staff, staff_permissions,
  permission enum, RLS) — shipped as `20261004000100_foundation.sql` and
  `20261004000200_staff.sql` (CLI timestamp names), plus staff management
  (`…0300_staff_management.sql`), `NaN`-proof money and rate domains
  (`…0400_money_not_nan.sql`) and staff history with the delegation ceiling
  (`…0500_staff_history.sql`: `staff_events`, RPC-only staff writes,
  `update_staff`, `staff_history`, D11); the Docker-free devstack (`scripts/devstack/`,
  `supabase/devstack/roles.sql`) in place of the auth shim;
  `tests/db/harness.ts` (`asUser`, `asAnon`, `asServiceRole`, rollback per
  test).
- Design tokens: copy `globals.css` theme from the public site; add
  operational tokens (status → accent mapping, surface levels, tap target
  utilities). Primitives `Button`, `Input`, `Field`, `Sheet`, `Toast`,
  `EmptyState`, `Skeleton`, `IconButton`, `SearchPicker` shell.
- App shell under `src/app/(staff)/layout.tsx`: bottom tab bar on phones
  (Today, Jobs, Scan, Inventory, More), side rail on ≥ md, persistent Scan
  button, header with global search field. `manifest.ts`, icons from the
  public site's `brand/logo-source.png`, `public/sw.js` (app-shell cache).
- Auth: `/login` (email + password via Supabase Auth), `proxy.ts` session
  refresh + redirect, `src/lib/auth/session.ts` with `requireStaff()`,
  `forbidden.tsx`, `unauthorized.tsx`. `experimental.authInterrupts: true`.
- `instrumentation.ts`, `src/lib/logger.ts`, `src/lib/env.ts`.
- `docs/RUNBOOK.md`: how to run locally with and without Docker, how to
  create the staging project, how to rotate keys.

Tests: harness runs; `staff` RLS (inactive staff sees nothing; admin has all
permissions; `require_permission` raises); staff history (one event per
change, with actor and reason) and the D11 ceiling; the API-surface meta
tests with their allow-list fixture; env schema; login E2E smoke.

### Phase 1 — Customers, bicycles, attachments

- Migrations: customers, bikes, bike_ownership_events, attachments, enums,
  RLS, storage buckets + policies (via migration on `storage.objects`);
  `private.current_customer_id()` (security definer, stable,
  `search_path = ''`; the active customers row for `auth.uid()`) with
  EXECUTE granted to `authenticated` only; the new RPCs and tables added to
  `tests/fixtures/api-surface.ts`. Shipped as `20261004000600`–`001100`
  (customers, bikes, media storage, attachments, customer access, staff
  search). "C own" is implemented as staff-only base-table RLS plus
  customer `my_*` security-definer RPCs that project customer-safe columns
  (DATA-MODEL §15 "Customer access pattern"), because staff and customers
  share the `authenticated` role; every later phase follows it.
- Domain: `customers.ts` (search by name/phone/email, create, update,
  archive), `bikes.ts` (create, link to customer, transfer ownership with
  event, search by brand/model/serial/short ID), `attachments.ts` (signed
  upload URL action, record row, change visibility = move bucket).
- UI: Customers list + detail; Bike detail with photo grid and (empty)
  service history; new-customer and new-bike sheets reachable from intake;
  camera capture component (`CaptureButton`) used everywhere photos are taken.
  Shipped (M1.2): domain modules `customers.ts`, `bikes.ts`,
  `attachments.ts`, `search.ts`; Server Actions per section; `/customers`,
  `/customers/[id]`, `/bikes`, `/bikes/[id]`, `/search` and the header
  search; the sheets open from customer and bike pages (intake reuses them
  in Phase 3). DESIGN.md "Domain components" describes the screens.

Tests: RLS customer A/B; anon denied; attachment visibility move; serial
search; ownership change preserves history; `current_customer_id()` is null
for anonymous callers and for staff without a customers row. Database side
in `customers-bikes`, `customer-access`, `attachments`, `media-storage` and
`staff-search` `.test.ts`, plus a live signed-upload round trip in
`stack.smoke.test.ts`. App side: unit tests for the pure helpers
(downscale sizing, search params, naming, recent searches, photo rules),
`display-parity.test.ts`, and E2E `customers-bikes.spec.ts` (phone + iPad).

### Phase 2 — Appointments, shop hours, capacity, check-in

- Migrations: shop_settings, shop_hours, closure_overrides,
  appointment_types, appointments; `book_appointment`,
  `cancel_appointment`, `mark_appointment_status`, `check_in_appointment`
  (creates the work order; depends on Phase 3 tables, so this RPC lands in
  Phase 3 and Phase 2 ships "arrived" only).
- Domain: slot generation (SQL function `available_slots(date, type_id)`
  mirrored by a TS pure function for the UI), booking, cancellation,
  calendar queries.
- UI: Appointments list (day view, week strip), create for walk-in-ahead
  bookings by staff, shop-hours and closures settings, appointment types
  settings, "Arrived" action.

Tests: capacity under concurrency; hours/closures; statuses; customer sees
only own appointments; anon sees public appointment types only.

### Phase 3 — Workshop

- Migrations: work_orders, work_order_assignments, work_order_events,
  categories, services, cult_commons_rates, work_order_line_items
  (generated columns), views `work_order_totals` / `_staff`;
  RPCs `create_work_order`, `assign_staff`, `unassign_staff`,
  `set_work_order_status`, `add_service_line`, `add_manual_line`,
  `void_line` (inventory branch stubbed until Phase 4),
  `check_in_appointment`, `add_work_order_note`, `flag_approval`.
- Domain: `workshop.ts`, `lines.ts`, timeline reader with human-readable
  rendering of each event type.
- UI: Intake flow (find/create customer → find/create bike → photos →
  condition + requested work → lead mechanic → optional services → create),
  Workshop board (columns or filtered list by status; filters mechanic,
  status, date, age, customer, bike, job number), My Jobs, Job detail
  (header, status actions, assignments, timeline, photos, line table with
  running totals; cost/yield only with `view_costs`), Services settings.

Tests: status machine; completed ≠ collected; snapshot immutability;
Cult Commons fixtures through generated columns; rate effective-dating;
assignment uniqueness; customer projection has no costs; E2E journey 1
without the part line.

Scope notes (no business change; decisions D14–D22 in §6):

- Built in four steps on `feat/m1.3-workshop`: (1) database core —
  migrations `20261004001200_workshop_catalog` (categories, services,
  `services_staff`, `cult_commons_rates` with the base 0.30 row,
  `private.cult_commons_rate_at`, service and rate RPCs),
  `…1300_work_orders` (status machine, work orders, assignments, timeline,
  job photos), `…1400_work_order_lines` (lines with generated economics,
  `work_order_totals`, `work_order_totals_staff`,
  `work_order_line_items_staff`) and `…1500_workshop_rpcs`, the pure
  mirrors `src/lib/workshop.ts` and `src/lib/cult-commons.ts`, error
  mapping and database tests; (2) the customer job projection (D17), job
  search and the seed; (3)–(4) the app (intake, board, My Jobs, job detail,
  Services settings; assignments, approval, notes and details editing in
  step 4).
- `check_in_appointment` moves to Phase 2, built on
  `private.create_work_order` (the single creation path) for a new job, or
  linking an existing open, unlinked job by setting
  `work_orders.appointment_id` once: the column may go from null to a value
  exactly once and never changes or clears afterwards
  (`work_order_immutable`, enforced in `private.work_orders_enforce_rules`;
  Phase 2 adds the foreign key).
- `add_inventory_line` and the `void_line` reversal branch land in Phase 4
  (`work_order_line_items.source_product_id` / `source_inventory_unit_id`
  have no foreign keys until then; `void_line` refuses inventory lines with
  `line_type_unsupported`). Both call `private.lock_work_order` (FOR
  UPDATE), then the replay lookup, then `private.require_open_work_order`,
  keeping the lock order: the `work_orders` row before any of its line rows.
- The anonymous/customer services listing lands with Phase 11 through a
  separate customer-safe projection; until then services are staff-only.
- `flag_approval` is built as `set_approval_flag`.
- The customer job projection is built now, in step 2, for Phase 11 to
  show: `my_work_orders`, `my_work_order_lines`, `my_work_order_timeline`,
  `my_work_order_attachments` with the `customer_job_status` enum (D8, D17;
  migration `20261004001600_workshop_customer_access`). Nothing in the
  staff app calls them. Step 2 also adds the `work_order` kind to
  `staff_search` (`…1700_workshop_search`; the app shows it from step 4)
  and the Phase 3 seed (DATA-MODEL §18 "Phase 3 part").
- Intake photos are taken right after the job is created, because
  `record_attachment` requires the job row to exist.
- Shipped (M1.3): migrations `20261004001200_workshop_catalog`,
  `…1300_work_orders`, `…1400_work_order_lines`, `…1500_workshop_rpcs`,
  `…1600_workshop_customer_access` and `…1700_workshop_search`; RPCs
  `create_service`, `update_service`, `set_service_archived`,
  `schedule_cult_commons_rate`, `cancel_cult_commons_rate`,
  `create_work_order`, `set_work_order_status`, `update_work_order`,
  `add_work_order_note`, `set_approval_flag`, `assign_staff`,
  `unassign_staff`, `add_service_line`, `add_manual_line`, `void_line`,
  `work_order_timeline`, the customer projection `my_work_orders`,
  `my_work_order_lines`, `my_work_order_timeline`,
  `my_work_order_attachments`, and the `work_order` kind of `staff_search`;
  views `work_order_totals`, `work_order_totals_staff`,
  `work_order_line_items_staff`, `services_staff`. Routes: `/jobs` (the
  board and My Jobs: All / My jobs / Unassigned, group chips with counts,
  status multi-select, mechanic, customer, bike, check-in date, age and job
  number in the URL; open jobs oldest first, the newest 300 with a
  partial-counts notice past that; Closed = the last 30 days, 50 at a time),
  `/jobs/new` (intake), `/jobs/[id]` (status actions, lines and totals,
  photos, assignments, approval, notes, details editing, timeline),
  `/settings/services` (services, categories, the Cult Commons rate card),
  plus service history on `/bikes/[id]` and `/customers/[id]` and Jobs in
  `/search`. Decisions D14–D22 (§6); D15's reopen deviation (clearing
  completion stamps) awaits owner confirmation before Phase 5. Tests: the
  database files listed in TESTING.md, unit tests for `workshop.ts` (incl.
  the board filters), `workshop-timeline.ts`, `cult-commons.ts` and the
  intake draft, and E2E `workshop.spec.ts` (journey 1 without the part
  line, the intake draft) and `workshop-board.spec.ts` (board filters,
  mechanic cost boundary, search and service history, reassignment and
  notes). `check_in_appointment` moves to Phase 2 (built on
  `private.create_work_order`, or linking an existing open job by setting
  `appointment_id` once); `add_inventory_line` and the `void_line`
  reversal branch land in Phase 4 (via `private.lock_work_order`, the replay
  lookup, then `private.require_open_work_order`), and Phase 4 returns sold
  units to held_for_customer on reopen and sells them again on
  re-completion (D6, D15). The board's group for `ready_to_start`
  is labelled "Ready", as SPEC §7.2 names it. Shared helpers for later
  phases to extend, not recreate: `tests/e2e/helpers.ts`
  (`createJobViaIntake`, `nextIntakeStep`, `section`, `tagFor`),
  `tests/db/workshop-fixtures.ts` (Phase 5's `reporting-fixtures.ts` builds
  on it), `src/lib/cult-commons.ts` with the fixture table
  `tests/fixtures/cult-commons.ts`, and `OVERDUE_AFTER_DAYS` / `isOverdue`
  in `src/lib/workshop.ts` (D20).

### Phase 4 — Inventory

- Migrations: locations, products, inventory_units, inventory_movements with
  partial unique indexes, `reporting.stock_levels`, `reporting.low_stock`,
  `supplier_products`; RPCs `add_inventory_line` (full), `void_line`
  inventory branch, `adjust_stock`, `transfer_stock`, `create_unique_unit`,
  `set_publication_status`; `reporting.public_items`.
- Domain: `inventory.ts` (products CRUD, unit lifecycle, stock queries,
  movement history), scanner URL parsing in `ids.ts`.
- UI: Products list with stock badges and search picker; Product detail
  (stock by location, movements, labels, publication); Unit detail; Stock
  adjustment sheet with mandatory reason; Movements list; Scan screen using
  the camera, deep-linking by short ID; adding a part to a job shows live
  stock.

Tests: consume once (idempotent + concurrent); reversal; unit cannot sell
twice; adjustments need reason; anon `public_items` only; publication state
machine; E2E journeys 1 (complete) and 3 (without labels).

Scope notes (decided while building; none changes business semantics):

- The database layer is built in two steps (ledger, jobs, stock RPCs and
  seed; then `set_publication_status`, `reporting.public_items`,
  `split_unit_from_stock` and product/unit search), so Phase 4 has four
  build steps.
- `supplier_products` moves to Phase 7: `suppliers` does not exist until
  then.
- `inventory_movements.request_id` replaces DATA-MODEL's
  `transfer_group_id`: it is each RPC call's idempotency key and a
  transfer's pairing key. No RPC reuses another entity's id or another
  call's key as its request_id; `create_unique_unit` and
  `split_unit_from_stock` use the client's new unit id, created for that
  one call.
- Phase 3's option "Phase 4 replaces `private.work_orders_enforce_rules`"
  is resolved with a separate AFTER trigger, `work_orders_sell_held_units`
  (`AFTER UPDATE … WHEN (old.completed_at is distinct from
  new.completed_at)`), so the Phase 3 function stays as it is.
- `reporting` is exposed to PostgREST (config.toml, devstack, type
  generation, RUNBOOK) because `reporting.public_items` is the anonymous
  surface DATA-MODEL §15 names; `private` stays unexposed.
- The inventory migration inserts the bootstrap location 'Shop floor'
  (SPEC §11: one shop), so a hosted database works without the seed.

Shipped (database, part 1): migrations `20261004001800_inventory.sql`
(enums, locations, products, inventory_units, the ledger with its
idempotency indexes and deferred unit-consistency check, product and unit
history, the cost views and `public.selling_prices`, the private helpers,
the stock-photo rule, the shop-bike guard and `adjust_stock`,
`transfer_stock`, `create_unique_unit`, `write_off_unit`),
`20261004001900_inventory_jobs.sql` (line FKs and
`work_order_line_items_unit_once`, `add_inventory_line`, the `void_line`
inventory branch, `work_orders_sell_held_units`) and
`20261004002000_inventory_reporting.sql` (`reporting.stock_levels`,
`product_stock`, `low_stock`); the Phase 4 seed; `src/lib/inventory.ts`
(state machines); tests `tests/db/inventory-ledger.test.ts` and
`tests/db/inventory-catalog.test.ts` on `tests/db/inventory-fixtures.ts`.
Decisions D23-D28.

Shipped (database, part 2): migrations
`20261004002100_inventory_publication.sql` (`set_publication_status`
returning `publication_result`, D26's manual rules on top of the products
trigger; `split_unit_from_stock` returning `split_unit_result`, D28;
`reporting.public_items`, the anonymous /q projection, with anon USAGE on
`reporting` and EXECUTE on `private.selling_price`, which the view calls as
the caller) and `20261004002200_inventory_search.sql`
(`private.search_products`, `private.search_units`, `staff_search` with the
`product` and `inventory_unit` kinds); error code `product_not_quantity`;
tests `tests/db/inventory-publication.test.ts`,
`tests/db/inventory-split.test.ts` and the Phase 4 cases of
`tests/db/staff-search.test.ts`. Until Step 3 adds product and unit pages,
the app's search asks `staff_search` for the kinds it can open
(`SEARCH_KINDS`). A public unique product whose units are all written off
stays `public` and shows `unavailable` on its page until staff unpublish it
(write-offs do not change publication; D26 has no automatic exit except
the sale).

Shipped (app core, Step 3): products and units in search
(`SEARCH_KINDS`, `/products/[id]`, `/units/[id]`); stock photos Internal or
Public only; `src/lib/domain/inventory.ts` (DTOs over RLS reads, the cost
views for view_costs only, `public.selling_prices` for every displayed
price) with the actions in `src/app/(staff)/inventory/actions.ts` and
`addPartToJob` in `jobs/actions.ts` (schemas in `src/lib/inventory-forms.ts`);
the screens `/inventory`, `/products/[id]`, `/units/[id]`,
`/inventory/movements`; the Adjust stock, Transfer, New product / Edit
details, Add unit / Edit unit and Write off sheets; Add part on the job
page with the D23 warning, part lines with their P-/U- number and stock
left, the void and D25 reopen wording, and the stock events in the
timeline; `tests/e2e/inventory.spec.ts` and journey 1's part line. Step 4
adds locations settings, the publication card, the split sheet, the
bike-page unit card, the scanner and /q, and the header short-ID jump.
Transfers and adjustments of unique products happen per unit (unit page);
the product page offers them for counted products only, as the RPCs do.

### Phase 5 — Financial engine

Mostly landed inside Phases 3–4 by design (generated columns, rate table).
This phase adds `reporting.financial_lines`, `reporting.daily_summary`,
`reporting.work_order_activity`, the "Today" dashboard's financial tiles,
job-level yield panel, and the `view_financial_reports` gate. Tests: fixture
table reconciles end to end from seed; a staff user without the permission
gets no financial rows.

### Phase 6 — Consignment

- Migrations: consignors, consignment_items, consignment_item_charges,
  consignment_settlements, settlement_lines, sales, sale_lines, sale_refunds,
  `reporting.consignor_ledger`, `reporting.consignor_item_ledger`; RPCs
  `create_consignment_item`, `return_consignment_item`,
  `record_retail_sale`, `restock_unit`, `record_settlement`.
- UI: Consignors list/detail with ledger; Consignment intake (creates unit +
  label); Record sale sheet (in-store sale of a unit or quantity product);
  Settlement sheet with allocation across sold items; Sales list.

Tests: liability vs settlement; partial settlements; over-allocation;
consignment yield; unit sold once; E2E journey 4.

### Phase 7 — Purchasing

- Migrations: suppliers, purchase_orders, lines, receipts, receipt lines,
  `reporting.purchase_order_progress`; RPC `receive_purchase`.
- UI: Suppliers; PO create/edit; Receive screen (per-line received qty,
  actual cost, location) with idempotency key per submission; PO progress.

Tests: partial receipt; duplicate receipt idempotent; over-receipt raises;
cost update per decision D5; E2E journey 3 receiving step.

### Phase 8 — QR and labels

- Migrations: label_templates, printer_profiles, print_jobs; seed a default
  58×40 mm template and a browser profile.
- `src/lib/printing/`: `LabelTemplate` renderer (SVG → print page / PDF via
  the browser print path), `PrinterAdapter` interface, `browser` and `pdf`
  adapters, `PrintJob` lifecycle.
- UI: Print Label flow (quantity, profile), bulk N identical labels, unique
  label with identity lines, print job history.

Tests: QR payload equals public URL; N labels same payload; unique label
distinct; E2E journey 3 labels step.

### Phase 9 — Reporting and reconciliation

- Views finalised; optional `inventory_balances` cache + `stock_reconciliation`
  if measurements warrant; period report pages (day/week/month/custom,
  drill-down by job, product/category, service, mechanic, ownership type),
  explicit date-basis selector (check-in / completion / collection / sale).
- Operational exceptions panel: negative stock, units in impossible states,
  unsettled consignments older than N days, failed integrations.

Tests: daily_summary reconciles with financial_lines for seed; date-basis
switch changes counts as expected.

### Phase 10 — Shopify

- Migrations: integration_events, shopify_product_sync,
  integration_retry_queue; RPCs `process_shopify_order_paid`,
  `process_shopify_refund`.
- `src/lib/integrations/shopify/`: Admin API client (GraphQL), HMAC
  verification, webhook route handler that only persists then enqueues,
  processor, outbound sync (create/update product + variant + inventory
  level), mapping tables.
- UI: Sync status per product, publish-online toggle, error queue with
  retry, event inspector.

Tests: duplicate webhook one effect; unmapped variant goes to queue, nothing
partial; refund creates no stock movement; E2E journey 5 with a signed
fixture payload.

### Phase 11 — Public-site integration (in the `bicii` repo)

Separate plan, written when Phase 6 is done: Supabase auth, `/q/[shortId]`
public item pages against `reporting.public_items`, appointments, My Bikes,
customer-visible service history, "Buy online" handing off to Shopify. No
business rules in that repo.

### Phase 12 — Hardware label adapter

After the printer models are known. Adds one adapter behind the existing
interface; no changes elsewhere.

## 3. First milestone — the vertical slice (SPEC §35)

The first milestone is Phase 0 plus the minimum of Phases 1, 3 and 4 needed
to prove the architecture, delivered as a sequence of small PRs on this
repo:

| # | PR | Contents | Gate |
|---|---|---|---|
| M1.0 | `plan` (this PR) | docs | review |
| M1.1 | `scaffold` | Next 16 app, tokens, shell, CI, env, harness, migrations 0001–0002, login, `requireStaff` | check + db tests + login E2E |
| M1.2 | `customers-bikes` | migrations, domain, Customers + Bike screens, camera upload | RLS tests |
| M1.3 | `workshop-core` | work orders, assignments, events, services, line items, status RPC, intake flow, board, job detail | status/snapshot/CC tests |
| M1.4 | `inventory-core` | locations, products (quantity only), movements, `add_inventory_line`, `void_line`, stock badge in job | consume-once + reversal tests |
| M1.5 | `today` | daily_summary view, Today dashboard, seed data for several days | reconcile test, E2E journey 1 |

Exit criteria for the milestone (all from SPEC §31 and §35): a staff user on
a phone can create a customer and bike, check a bike in with a photo, assign
a lead mechanic, add one service and one part, see the part's stock decrement
exactly once, see correct sale/cost/yield/Cult Commons on the job (admin) and
sale only (mechanic without `view_costs`), move the job to completed and then
collected with distinct timestamps, and see all of it on Today.

## 4. Environment and secrets

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app | public |
| `SUPABASE_SERVICE_ROLE_KEY` | integrations only | never in client bundles |
| `DATABASE_URL` | tests, type-gen | local Postgres or staging |
| `NEXT_PUBLIC_PUBLIC_SITE_URL` | app | QR base; also stored in `shop_settings` |
| `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_WEBHOOK_SECRET` | Phase 10 | |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Vercel | stable across instances |

Supabase projects: `bicii-staging` (previews, E2E) and `bicii-prod`. The
owner creates them and places keys in Vercel and GitHub secrets; the agent
never sees production keys.

## 5. Risks and mitigations

- **Docker-less environments cannot run `supabase start`.** Mitigated by the
  devstack (`scripts/devstack/`): the real Supabase Auth, PostgREST and
  Storage on a plain Postgres 16 behind a local gateway, so DB tests and
  login E2E run against real Supabase services without Docker or staging
  credentials.
- **Turbopack + PWA tooling.** Serwist needs webpack; a hand-written service
  worker avoids it. Offline is out of MVP scope anyway.
- **RLS and column-level grants are easy to get subtly wrong.** The RLS
  matrix test enumerates every table for anon and customer; it fails if a
  new table appears without a policy row in the matrix fixture. Its first
  half exists from Phase 0: the devstack recreates hosted Supabase's default
  grants on `public`, and the API-surface meta tests compare everything
  `anon` and `authenticated` can execute or touch with
  `tests/fixtures/api-surface.ts`. Phase 1 adds the customer rows.
- **Shopify API versions move quarterly.** The client pins a version
  constant and the sync records `api_version` per event.
- **iOS camera and PWA quirks.** `capture="environment"` input, not
  `getUserMedia`, for photos; `BarcodeDetector` with ZXing fallback for scan;
  install instructions screen for Safari (no `beforeinstallprompt`).
- **Public site integration drift.** Shared RPC and view contracts are
  documented in DATA-MODEL.md; the public site consumes `public_items` and
  the appointment RPCs only.

## 6. Open decisions for the owner

These are the places where the plan had to choose something the brief does
not state and the choice touches business meaning. Each has a default the
build proceeds with; confirm or change before the phase that uses it.

| ID | Decision | Default in plan | Used from |
|---|---|---|---|
| D1 | Rate of Cult Commons when a line has negative yield within a job whose total yield is positive | Per-line: share is computed per line with `max(yield, 0)`; a loss-making line contributes 0, it does not offset other lines. Job total CC = Σ line CC. | Phase 3 |
| D2 | Appointment capacity unit | One `intake_capacity_units` pool per `intake_slot_minutes` window across the shop; appointment types consume `capacity_units` for their whole duration. | Phase 2 |
| D3 | Recognition date for workshop revenue in reports | `work_orders.completed_at` (not collected_at, not check-in). Reports also offer check-in and collection as alternative bases. | Phase 5 |
| D4 | Consignment charges (services done on a consigned bike before sale) | Entered per charge with an explicit bearer: `consignor` (deducted at settlement) or `shop` (added to direct cost). No default bearer; the UI requires a choice. | Phase 6 |
| D5 | What a purchase receipt does to `products.default_direct_cost` | Sets it to the latest actual unit cost received (last-cost). No averaging. | Phase 7 |
| D6 | Unique unit added to a job as a part | Unit becomes `held_for_customer` on add, `sold` when the job is completed; voiding before completion returns it to `available`. Interacts with D15 (reopen): the unit follows `completed_at`, with no stock movement — whenever `completed_at` goes from non-null to null (a reopen) every unit on a non-voided inventory line of the job goes sold -> held_for_customer, and whenever it goes from null to non-null (including re-completion after a reopen) they go held_for_customer -> sold. Refined by SOLD-AT-COMPLETION (D25). | Phase 4 |
| D7 | Refund of an online sale | Financial `sale_refunds` row only; stock and unit status untouched until staff runs `restock_unit`. | Phase 10 |
| D8 | Customer-visible timeline | Customers (later, public site) see status changes, completion, collection and `customer`/`public` photos; never notes, lines' costs, or assignments. | Phase 11 |
| D9 | Short ID format and QR base URL | `B-/J-/P-/U-/C-/PO-/S-` + 6 digits; QR = `{public_site_url}/q/{short_id}`. | Phase 1 |
| D10 | Staff login method | Supabase email + password for staff; invitations by admin from Staff settings. No magic links in MVP. | Phase 0 |
| D11 | What a `manage_staff` holder who is not an admin may change (SPEC §4.2 asks for granular permissions but does not say who may grant them) | Delegation ceiling: they may grant or revoke only permissions they hold themselves, never `manage_staff` (admins only), never on their own row and never on an admin's row; they may invite (role staff only) and deactivate/reactivate non-admins. Admins are unrestricted. Residual risk to confirm: an inviter sees the new login's temporary password, so a manager could keep a second login at their own permission level; closing that fully needs invite links or a forced password change on first sign-in (not in MVP). | Phase 0 |
| D12 | Who sees a bike's customer-visible photos after it changes hands (SPEC §5 "Ownership changes preserve history" does not say what a new or previous owner sees) | The current owner sees every `customer`/`public` photo of the bike, including ones taken before they owned it; a previous owner stops seeing the bike and its photos once it is transferred (`my_bikes`, `my_bike_attachments` read current ownership). Staff history (`bike_ownership_events`) keeps every owner. Alternative to confirm before Phase 11: limit each owner to photos taken during their ownership. | Phase 1 (enforced), Phase 11 (shown) |
| D13 | Can a photo on a customer record be public? (SPEC §8 allows `public` visibility without saying for which records) | Never: attachments whose `entity_type = customer` may be `internal` or `customer` only (check constraint and RPC error `attachment_customer_never_public`). Bike photos may be public (shop and consigned bikes for sale need them); staff choose per photo. | Phase 1 |
| D14 | Line pricing | Any active staff member may set or override a line's unit sale price (>= 0) when adding it; entering or overriding a unit direct cost (service-line override or manual-line cost) requires `view_costs` (42501 otherwise); no negative-price or discount lines in MVP (a discount is a lower unit price on the line). A manual line added without a cost (always, for staff without `view_costs`) is stored with unit cost 0 and marked `cost_pending`. **Consequence for Cult Commons, owner to confirm:** until it is corrected, that line's yield is its whole sale and its Cult Commons share is 30% of the whole sale, so the job's cost is understated and its yield and Cult Commons overstated (SPEC §10 deducts direct cost first). Safe default: the line shows "Cost pending" to every staff member, `work_order_totals_staff.cost_pending_count` counts such live lines and the job's totals are labelled provisional for `view_costs` holders; the correction is that a `view_costs` holder voids the line and adds it again with the cost (snapshots stay immutable; reopen first if the job is completed). Nothing blocks completion. Labour belongs on a service line (which snapshots the service's cost); parts become inventory lines in Phase 4. Options for the owner: block completing a job with a pending cost, let a `view_costs` holder enter a pending cost once, or have Phase 5 reports exclude or flag pending lines. | Phase 3 |
| D15 | Work order status machine | Transitions follow the table in DATA-MODEL §4; completed only from in_progress or paused; collected only from completed or ready_for_collection; collected and cancelled are final; nothing returns to received; reopening (completed or ready_for_collection -> in_progress) requires a reason and clears completed_at and ready_for_collection_at (started_at is kept; the timeline keeps the earlier `completed` event); lines can be added or voided only while the job is open (before completed). DEVIATION, owner to confirm before Phase 5: reopen clears completion stamps, which deviates from DATA-MODEL §4's original "stamps exactly once, never clearing an earlier stamp" and moves D3 recognition to the final completion. Phase 4 returns sold units to held_for_customer on reopen (whenever completed_at goes from non-null to null every unit on a non-voided inventory line of the job goes sold -> held_for_customer; whenever completed_at goes from null to non-null, including re-completion after a reopen, they go held_for_customer -> sold), with no stock movement (D6). Phase 3 keeps the reopen rule in `private.work_orders_enforce_rules` (commented as the Phase 4 extension point) so Phase 4 can create or replace it starting from Phase 3's body, or add its own `work_orders` trigger. | Phase 3 |
| D16 | Cancelling a job | Only from an open status, reason required, refused while any non-voided line exists with P0001 `work_order_has_lines` (void lines first, which in Phase 4 writes the stock reversals). This is the single cancel-with-lines rule: it already covers inventory lines, so Phase 4 adds no separate parts rule or code. | Phase 3 |
| D17 | Which jobs a customer sees | The jobs where they are `work_orders.customer_id`, regardless of who owns the bike now (a new owner does not see the previous owner's jobs) and regardless of whether the bike is archived (the job is the customer's history); cancelled jobs are hidden; status is shown as a coarse customer status (received, awaiting_customer, awaiting_parts, in_progress, completed, ready_for_collection, collected); lines show description, quantity, unit price and total only; requested work, notes, approval, assignments, actors and all costs are never shown. Enforced by Phase 3 RPCs (built in step 2), shown in Phase 11. | Phase 3 |
| D18 | A job's customer and the bike's owner | A job's customer must be the bike's current owner, or the bike must have no owner (shop bike); otherwise staff transfer the bike first (P0001 `bike_owner_mismatch`). Checked under FOR SHARE locks on the customer and bike, so it holds against a concurrent transfer. | Phase 3 |
| D19 | Can a photo on a work order be public? | Photos on a work order may be internal or customer, never public (P0001 `attachment_work_order_never_public`, CHECK `attachments_work_order_never_public` as backstop; the app refuses before copying anything to media-public), mirroring D13. | Phase 3 |
| D20 | Overdue | A job is overdue while it is open (before completed: received … paused) and `now() - checked_in_at > interval '7 days'` (7 × 24 hours) (board badge and age filter; `OVERDUE_AFTER_DAYS = 7` and `isOverdue` exported from `src/lib/workshop.ts`; Phase 5's overdue_job exception and Today tile and Phase 9 reporting import or reuse exactly this rule). | Phase 3 |
| D21 | Cult Commons rate changes | Admin only, effective now or in the future (never backdated); rate rows are append-only except that an admin may cancel a rate whose effective_from is still in the future (`cancel_cult_commons_rate` sets cancelled_at/cancelled_by; cancelled rows are ignored by `private.cult_commons_rate_at`); every line snapshots the rate in force when it is added, so history never changes. The base 0.30 row (effective 1970-01-01) ships in the migration, not the seed. | Phase 3 |
| D22 | Assignments | Any active staff member may assign or unassign anyone on a job that is not collected or cancelled; making someone lead removes the previous lead from the job (not demoted to additional); only active staff can be assigned. | Phase 3 |
| D23 | NEG-CONSUMPTION: can a job part take stock below zero? | Yes: adding a quantity part to a job may take a location's ledger on-hand below zero, because the part was physically used; the UI warns. Negative balances show in `reporting.low_stock` and `reporting.product_stock.negative_locations` regardless of reorder_point. Manual adjustments and transfers may never leave a location below zero (`insufficient_stock`). | Phase 4 |
| D24 | PART-PRICE-COST: a part with no known price or cost | A part can be added to a job only when its sale price (default `private.selling_price`: the unit price, else the product default; any staff may override it, as D14 allows for every line) and its direct cost (the unit cost, else the product default; never overridden) are known. Missing values raise `part_price_missing` or `part_cost_missing`, because a silent zero cost would overstate yield and Cult Commons (SPEC §10). Inventory lines are therefore never `cost_pending` (D14's `cost_pending` is for manual lines only). | Phase 4 |
| D25 | SOLD-AT-COMPLETION (refines D6): when a unit on a job is sold | A unit on a job is `held_for_customer` on add and becomes `sold` whenever `work_orders.completed_at` goes from null to set, including re-completion after a reopen (trigger `work_orders_sell_held_units`, AFTER UPDATE WHEN completed_at changes). On reopen (completed_at cleared) every unit on the job's non-voided inventory lines goes sold -> held_for_customer, with inventory_unit_events and no stock movement; the product's publication stays 'sold' until the line is voided (`private.refresh_unique_publication` then restores public) or the job completes again. `add_inventory_line` and `void_line` refuse on a job that is not open (D15, `work_order_locked`); to return a part from a completed job, reopen it, then void the line. Both lock the work order FOR UPDATE through `private.lock_work_order`, so completion, reopen and cancellation cannot race an add or a void. Cancelling a job with parts follows D16. | Phase 4 |
| D26 | PUBLICATION-MACHINE: publication states | Transitions draft -> internal_only, archived; internal_only -> public, archived; public -> internal_only, sold, archived; sold -> public, archived; archived -> internal_only. 'sold' is set only by sale paths (job completion now; Phases 6 and 10 later), never manually, and only for unique products; leaving 'sold' manually is allowed only to archived. sold -> public is a system restore by `refresh_unique_publication` that skips the requirements, so a void is never blocked. Any other entry into public requires a name, a selling price (`private.selling_price`), at least one public photo (product, unit or linked bike) and, for unique products, an available unit; the products trigger enforces this for every writer. `public_slug` is assigned at first publish (name slug + short ID, with an 'item' fallback) and never changes. low_stock means on_hand <= reorder_point, or any negative stock. | Phase 4 |
| D27 | SHOP-OWNED-ONLY: whose stock can be a job part | Phase 4 creates shop-owned units only. Consignment and customer_owned stock is never a job part: `add_inventory_line` refuses it with `ownership_not_saleable`, and Phase 6 keeps that refusal (its backstop trigger raises the same code; it does not replace `add_inventory_line`). Consigned units are created only by Phase 6's `create_consignment_item` (through `private.register_unit`), so a consigned item never exists without its liability record. customer_owned stays reserved and never saleable. | Phase 4 |
| D28 | SPLIT-COST: turning one counted item into a unique item | One RPC, `split_unit_from_stock` (Phase 4 step 2). It decrements the source by one (a `stock_adjustment` with a reason) and creates a new draft unique product and unit at the same location; the new unit's direct cost is the source's `default_direct_cost`. | Phase 4 |

## 7. Out of scope (restated from SPEC §30)

Payments, accounting ledger, automated customer approval, Shopify SSO,
customer mechanic selection, labour time clock, bulk→unique conversion
machinery, multi-location optimisation, native apps, hard-coded Bluetooth
printing, marketing CRM.
