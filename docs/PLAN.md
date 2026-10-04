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
  EXECUTE granted to `authenticated` only, for the "C own" policies; the new
  RPCs and tables added to `tests/fixtures/api-surface.ts`.
- Domain: `customers.ts` (search by name/phone/email, create, update,
  archive), `bikes.ts` (create, link to customer, transfer ownership with
  event, search by brand/model/serial/short ID), `attachments.ts` (signed
  upload URL action, record row, change visibility = move bucket).
- UI: Customers list + detail; Bike detail with photo grid and (empty)
  service history; new-customer and new-bike sheets reachable from intake;
  camera capture component (`CaptureButton`) used everywhere photos are taken.

Tests: RLS customer A/B; anon denied; attachment visibility move; serial
search; ownership change preserves history; `current_customer_id()` is null
for anonymous callers and for staff without a customers row.

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
| D6 | Unique unit added to a job as a part | Unit becomes `held_for_customer` on add, `sold` when the job is completed; voiding before completion returns it to `available`. | Phase 4 |
| D7 | Refund of an online sale | Financial `sale_refunds` row only; stock and unit status untouched until staff runs `restock_unit`. | Phase 10 |
| D8 | Customer-visible timeline | Customers (later, public site) see status changes, completion, collection and `customer`/`public` photos; never notes, lines' costs, or assignments. | Phase 11 |
| D9 | Short ID format and QR base URL | `B-/J-/P-/U-/C-/PO-/S-` + 6 digits; QR = `{public_site_url}/q/{short_id}`. | Phase 1 |
| D10 | Staff login method | Supabase email + password for staff; invitations by admin from Staff settings. No magic links in MVP. | Phase 0 |
| D11 | What a `manage_staff` holder who is not an admin may change (SPEC §4.2 asks for granular permissions but does not say who may grant them) | Delegation ceiling: they may grant or revoke only permissions they hold themselves, never `manage_staff` (admins only), never on their own row and never on an admin's row; they may invite (role staff only) and deactivate/reactivate non-admins. Admins are unrestricted. Residual risk to confirm: an inviter sees the new login's temporary password, so a manager could keep a second login at their own permission level; closing that fully needs invite links or a forced password change on first sign-in (not in MVP). | Phase 0 |

## 7. Out of scope (restated from SPEC §30)

Payments, accounting ledger, automated customer approval, Shopify SSO,
customer mechanic selection, labour time clock, bulk→unique conversion
machinery, multi-location optimisation, native apps, hard-coded Bluetooth
printing, marketing CRM.
