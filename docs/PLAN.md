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

Phase 2 owns the whole appointment surface: the schedule configuration,
booking, capacity, status, check-in and the customer booking RPCs that the
public site (Phase 11) consumes. Phase 11 creates none of these objects; it
adds only the public-site screens and a thin `bookable_slots` range wrapper
over `private.available_slots_at`. Built after Phases 3–5 (it depends on
Phase 3's work orders), in four steps.

- Migrations: shop_settings (single row; the time zone is fixed at
  Asia/Singapore, D35, and `private.shop_timezone()` /
  `private.shop_currency()` now read it), shop_hours, closure_overrides,
  appointment_types, schedule_events, appointments, appointment_events;
  admin RPCs `update_shop_settings`, `set_shop_hours`,
  `save_closure_override`, `delete_closure_override`,
  `save_appointment_type`; public reads `public_appointment_types`,
  `public_shop_hours`, `available_slots(date, type_id)`; staff RPCs
  `book_appointment`, `mark_appointment_status`, `cancel_appointment`,
  `update_appointment`; customer RPCs `my_appointments`,
  `book_my_appointment`, `cancel_my_appointment` (D37, D42);
  `check_in_appointment` lands in Phase 2 (step 2), built on Phase 3's
  `private.create_work_order` for a new job or linking one open, unlinked
  job (D40), with the `work_orders.appointment_id` foreign key, the
  automatic completion (D36) and the appointment counts in
  `daily_summary` (D41).
- Domain: slot generation (`private.available_slots_at`, mirrored by a TS
  pure function for the UI, step 3, proven against
  `tests/fixtures/appointment-slot-cases.ts`), booking, cancellation,
  calendar queries.
- UI: Appointments list (day view, week strip), create for walk-in-ahead
  bookings by staff, shop-hours and closures settings, appointment types
  settings, Arrived / No-show / Cancel, Check in (steps 3–4).
- Decisions D36–D42 (§6). Reschedule is cancel + rebook (no reschedule RPC);
  no customer notifications in the MVP.

Tests: capacity under concurrency; hours/closures; statuses; customer sees
only own appointments; anon sees public appointment types only.

Shipped (database, step 1): migrations `…2700_appointment_enum_values`
(the `appointment_linked` job event), `…2800_schedule`,
`…2900_appointments`, `…3000_appointment_customer_access`; the error codes
in `src/lib/db-errors.ts`; the shared fixtures
`tests/fixtures/appointment-slot-cases.ts` and
`tests/fixtures/appointment-transitions.ts`; database tests
`appointments`, `appointment-slots`, `schedule-settings`,
`appointment-customer-access` and `appointment-concurrency` (helpers in
`tests/db/appointment-fixtures.ts`).

Shipped (database, step 2): `…3100_appointment_check_in` (the
`work_orders.appointment_id` foreign key and partial unique index; the
`work_orders_appointment_rules`, `work_orders_sync_appointment_link` and
`work_orders_sync_appointment_completion` triggers; `check_in_appointment`
returning `appointment_check_in`, D36, D40; P3's null -> value-once rule is
relied on, not replaced) and `…3200_appointment_reporting`
(`reporting.appointment_daily`, `public.appointment_daily`, and
`daily_summary`'s three appointment columns filled by D41 with no RPC
change); the Phase 2 seed (settings, hours, four types, two closures,
Chloe Lim's customer login, nine appointments, Tan's appointment linked to
J-000014); database tests `appointment-check-in`, `appointment-reporting`,
`appointment-seed` and the check-in race. So the Phase 2 database is
complete: migrations `…2700`–`…3200`, every RPC above, D36–D42. Steps 3–4
build the app.

Shipped (app core, step 3): the pure mirror `src/lib/appointments/`
(`slots.ts` = `private.available_slots_at` / `appointment_slot_problem`
exactly, proven on the shared fixtures; `status.ts` actions = the status
machine; `history.ts`, `time.ts`, `format.ts`), `src/lib/domain/appointments.ts`
(`listDay`, `listWeek`, `loadSchedule`, `getAppointment`, `bookAppointment`,
`markStatus`, `cancel`, `update`, `checkIn`, `openUnlinkedJobs`;
the bike pickers reuse P3's `listIntakeBikes`), the Server Actions, `/appointments` (day/week),
`BookAppointmentSheet`, `/appointments/[id]` and its check-in, the shared
`LeadPicker`, and `appointments.spec.ts` (journey 2 and the no-show
reinstatement).

Shipped (Phase 2 as a whole, step 4 completing the app): migrations
`20261004002700_appointment_enum_values`, `…2800_schedule`,
`…2900_appointments`, `…3000_appointment_customer_access`,
`…3100_appointment_check_in` and `…3200_appointment_reporting` (Phase 5's
SQL untouched except `private.shop_timezone()` / `shop_currency()`, same
signatures, now reading `shop_settings`, D35). Routes: `/appointments`
(day/week, with a link to the schedule), `/appointments/[id]`,
`/appointments/[id]/check-in`, `/settings/schedule` and
`/settings/appointment-types` (readable by every staff member, each with
its own `loading.tsx`; edit controls for admins), plus Today's appointment
tiles with "Still expected" and the arrivals list (D41 counts, D30: every
staff member), the customer page's Appointments card with Book (customer
locked, not for archived customers) and the job's "Booked appointment"
chip and "Opened from / Linked to the appointment on …" timeline line
linking back (D40). Domain modules: `src/lib/domain/appointments.ts`
(adds `todaySummary` over `public.appointment_daily` and
`customerAppointments`) and `src/lib/domain/schedule.ts`
(`getShopSettings`, `getWeeklyHours`, `listClosures` with the bookings
each affects, `getClosure`, `listAppointmentTypes`, `affectedBySchedule`,
and the admin writes `updateShopSettings`, `setShopHours`, `saveClosure`,
`deleteClosure`, `saveAppointmentType`); the pure `src/lib/schedule.ts`
(wording and the form schemas mirroring the database checks) and
`src/lib/appointments/`. Actions: `appointments/actions.ts`,
`settings/schedule/actions.ts` and `settings/appointment-types/actions.ts`
(admin). Components: `BookAppointmentSheet` / `BookAppointmentButton`, the
appointment list, actions, edit and check-in components, `LeadPicker`,
`TodayArrivals`, `CustomerAppointmentRows`, the schedule settings sheets
and `AppointmentTypeSheet`. Decisions D36–D42 (§6) with D2, D8, D9, D12,
D18, D30 and D35. Tests: the database files `appointments`,
`appointment-slots`, `schedule-settings`, `appointment-customer-access`,
`appointment-concurrency`, `appointment-check-in`, `appointment-reporting`
and `appointment-seed`; unit tests for the slot mirror, statuses, times,
the timeline text and link, Today's appointment components and the
schedule forms; E2E `appointments.spec.ts` (journey 2 through Today and the
job, the no-show reinstatement, capacity closing a slot) and
`appointment-settings.spec.ts`. Phase 11 consumes `available_slots`,
`public_appointment_types`, `public_shop_hours`,
`my_appointments(include_past)`, `book_my_appointment` and
`cancel_my_appointment`, and wraps `private.available_slots_at` (keep its
signature) in its `bookable_slots` range RPC; Phase 8 decides whether
`shop_settings.public_site_url` or `NEXT_PUBLIC_PUBLIC_SITE_URL` is the QR
base (D9); Phase 9's activity report uses the D41 basis
(`public.appointment_daily`).

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

Shipped (app, Step 4): the publication card on `/products/[id]`
(`PublicationControls`: status, `publicationActions` over
`manualPublicationTargets`, the D26 checklist with Publish disabled and
naming what is missing, the QR URL with Copy, and `PublicPreviewPanel`,
the `reporting.public_items` row or "Not public. Anonymous scans show
nothing."; read-only preview and QR URL on `/units/[id]`); actions
`setPublication` and `splitToUnique` (manage_inventory, plus adjust_stock
in the handler); `SplitToUniqueSheet` (D28) on counted products for staff
with both permissions; `/settings/locations` (list for all staff with the
"Default" pill, `LocationSheet` and the `LocationActiveSwitch` for
manage_inventory; `location_has_stock` snaps the switch back) and the "No
active stock location" empty states linking to it; the bike page's
"In stock as U-… · Available" card (`getBikeStockUnit`); the scanner
(`src/components/domain/scanner.tsx`: BarcodeDetector or a lazily imported
`@zxing/browser`, `interpretScan` in `src/lib/scan.ts`, never following a
foreign code), `resolveShortId` (`src/lib/domain/scan.ts`) behind the only
Admin /q route `/q/[shortId]`, `hrefForRecord` in `src/lib/ids.ts`, and the
header short-ID jump (`shortIdJump`). The QR base comes from one server
helper, `src/lib/qr.ts` (`getQrBase`, `qrUrl`, `scanBases`), which Phase 8
points at the database QR base.

Shipped (M1.4, Phase 4 as a whole): migrations
`20261004001800_inventory`, `…1900_inventory_jobs`,
`…2000_inventory_reporting`, `…2100_inventory_publication` and
`…2200_inventory_search`; RPCs `adjust_stock`, `transfer_stock`,
`create_unique_unit`, `write_off_unit`, `add_inventory_line`, the
`void_line` stock reversal, `set_publication_status`,
`split_unit_from_stock` and the `product` and `inventory_unit` kinds of
`staff_search`; trigger `work_orders_sell_held_units` (D25); views
`public.selling_prices`, `product_costs`, `inventory_unit_costs`,
`inventory_movement_costs`, `reporting.stock_levels`, `product_stock`,
`low_stock` and the anonymous `reporting.public_items`. Routes:
`/inventory`, `/inventory/movements`, `/products/[id]`, `/units/[id]`,
`/settings/locations`, `/scan` and `/q/[shortId]`, plus Add part on
`/jobs/[id]`, the stock card on `/bikes/[id]` and Products and Units in
`/search`. Components: `StockBadge`, `AddPartSheet`, `AdjustStockSheet`,
`StockTransferSheet`, `ProductSheet`, `UnitSheet` / `WriteOffUnitControl`,
`MovementList` / `HistoryList`, `PublicationControls`,
`PublicPreviewPanel`, `CopyText`, `SplitToUniqueSheet`, the location
controls, `NoActiveLocation`, `CameraPermission` and `Scanner`. Decisions
D23-D28 (§6; D6 now ends "Refined by SOLD-AT-COMPLETION (D25)"). Tests:
the database files `inventory-ledger`, `inventory-catalog`,
`inventory-publication`, `inventory-split` and the Phase 4 cases of
`staff-search`, `work-order-lines`, `attachments` and `meta`; unit tests
for `inventory.ts`, `inventory-forms.ts`, `ids.ts` (`hrefForRecord`),
`scan.ts`, `search.ts` (`shortIdJump`) and the camera states; E2E
`inventory.spec.ts` (journey 3 without labels, one job per unit, the
permission boundary), `inventory-publish.spec.ts` (publication,
locations, split, bike link), `scan.spec.ts` (manual entry, /q, the camera
stub, foreign codes, the header jump) and journey 1 complete with its part
line. New dependency: `@zxing/browser` with its `@zxing/library` peer,
loaded only by the scanner's fallback.

### Phase 5 — Financial engine

Mostly landed inside Phases 3–4 by design (generated columns, rate table).
This phase adds `reporting.financial_lines`, `reporting.daily_summary`,
`reporting.work_order_activity`, the "Today" dashboard's financial tiles,
job-level yield panel, and the `view_financial_reports` gate. Tests: fixture
table reconciles end to end from seed; a staff user without the permission
gets no financial rows.

Shipped (M1.5, Phase 5 as a whole): migrations
`20261004002300_reporting_calendar`, `…2400_financial_lines`,
`…2500_daily_summary` and `…2600_dashboard_rpcs` (read-only: no table and
no change to a Phase 3 or 4 function); `private.shop_timezone`,
`shop_currency`, `shop_day`, `shop_today`, `shop_day_start` and
`is_significant_adjustment`; views `reporting.financial_lines`,
`work_order_activity`, `daily_summary` and `operational_exceptions`
(granted to no API role); security definer read RPCs `daily_summary`,
`today_dashboard`, `work_order_activity_on`, `stock_adjustments_on`,
`operational_exceptions`, `financial_lines` (view_financial_reports) and
`work_order_yield` (view_costs), and the error code
`report_range_invalid`. A seed spanning a week of shop days relative to
the reset day (the SPEC §10 examples, a loss line, rounding, overdue,
uncollected and cancelled jobs, stock adjustments;
`tests/fixtures/reporting.ts`). App: `src/lib/reports.ts` and
`src/lib/domain/reports.ts`; the Today dashboard at `/` (flows, the
current snapshot linked to the board, appointment and consignment
placeholders, Money, stock, low stock, what needs attention, activity and
the last 7 days; any earlier day by `?day=`); the job yield panel as an
extension of P3's `TotalsSummary` (snapshot rate range, loss note,
recognition day). Decisions D30-D35 (§6). Tests: the database files
`reporting`, `reporting-access`, `reporting-concurrency` and
`reporting-seed` plus `meta` checks; unit tests for `reports.ts`, the new
`dates.ts` helpers and `TotalsSummary`; E2E `today.spec.ts` (the
milestone journey on phone and iPad, the mechanics' boundaries, the
seeded history, low stock, adjustments and exceptions).

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

Shipped (Phase 6 as a whole, on `feat/p6-consignment`): migrations
`20261004003300_consignment`, `…3400_consignment_job_parts`,
`…3500_sales`, `…3600_consignment_settlements` and
`…3700_consignment_reporting`. Tables `consignors`, `consignment_items`,
`consignment_item_charges`, the append-only `consignment_item_events`,
`sales`, `sale_lines`, `sale_refunds`, `consignment_settlements`,
`settlement_lines` and `consignment_settlement_reversals`, each with its
RLS policies (D48). RPCs `create_consignment_item`,
`update_consignment_terms`, `add_consignment_charge`,
`void_consignment_charge`, `return_consignment_item(item_id, return_id,
reason, quantity, location_id)`, `record_retail_sale(sale_id, lines,
customer_id, recognized_at, notes)`, `restock_unit(unit_id, sale_line_id,
location_id, reason)`, `record_sale_refund`, `record_settlement`,
`reverse_settlement`, the read RPCs `list_consignors`,
`consignor_statement`, `consignor_payout_details`, `list_sales`,
`sale_lines_detail` and `saleable_stock`, and the `consignor`,
`consignment_item` and `sale` kinds of `staff_search`;
`add_inventory_line` keeps its signature and accepts consigned stock
(Phase 6 implemented the owner's D27 change through D44). Private
helpers: `private.sell_line`, the single sale-line writer Phase 10 calls
with `online_sale`; `private.record_linked_movement`, the twin of
`private.record_movement` that writes `sale_line_id` and
`consignment_item_id`; `private.can_view_sale_costs` and
`private.can_view_consignment_money`; a replaced `private.selling_price`
(D45). Views `reporting.consignment_item_position`,
`consignor_item_ledger` and `consignor_ledger`; `reporting.financial_lines`
gains a sale branch and `daily_summary` / `today_dashboard` fill
`consignment_sales`, `consignment_sales_total` and
`new_consignor_liability`. Scope notes: at most one live sale line per
unit is a partial unique index (`sale_lines_unit_sells_once`) that
replaces DATA-MODEL §8's plain `unique` (D46); `restock_unit` and
`return_consignment_item` deviate from DATA-MODEL §16's original
signatures (the sale line, and a return id, are the replay keys); no new
exception kind (D34). Seed: consignors, consigned items and S-000001 to
S-000004. Routes: `/consignment` (consignors and items),
`/consignment/consignors/[id]`, `/consignment/items/[id]`, `/sales` and
`/sales/[id]`; Sell on the consignment item, unit and product pages,
"Sold on S-…" with Restock on the unit page, consigned stock in Add part,
`C-` and `S-` in `/q` and `/search`, Sales in the More menu and the
Today consignment tiles linked to the sales and consignment pages.
Components: `ConsignorSheet`, `ConsignorPicker`,
`ConsignmentIntakeSheet`, `ChargeSheet`, `SettlementSheet`, the
consignment item controls, `ConsignmentItemRow`, `RecordSaleSheet`,
`SaleablePicker`, `RefundSheet` and `RestockControl`. Decisions D44-D55
(§6; D54 and D55 came from the Phase 6 review), with D4 implemented, D7
implemented for retail and D27 changed. The review also replaced
`transfer_stock` (same signature, D54), gave `create_consignment_item` a
`new_consignor` argument (a new consignor is created in the intake's own
transaction) and added `sold_items` to `list_consignors`.
Tests: the database files `consignment`, `consignment-access`,
`consignment-concurrency`, `consignment-job-parts`,
`consignment-locations` (the review, D54), `sales`,
`settlements` and `consignment-reporting`, plus the Phase 6 cases of
`inventory-ledger`, `reporting`, `staff-search`, `attachments` and
`work-orders`; unit tests for `consignment.ts`, `consignment-forms.ts`,
`sales.ts` and `sales-forms.ts`; E2E `consignment.spec.ts`,
`sales.spec.ts` and `consignment-journey.spec.ts` (journey 4 without the
label step, which is Phase 8).

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
- The QR base: replace the body of `getQrBase()` in `src/lib/qr.ts` with
  the database QR base (`shop_settings.public_site_url`, as `label_preview`
  reads it) and add it to `scanBases()`, keeping the environment's base so
  earlier labels still scan. Every QR shown (publication card, unit page)
  and every scan goes through that file.

Tests: QR payload equals public URL; N labels same payload; unique label
distinct; E2E journey 3 labels step.

Shipped so far (Phase 8 step 1 of 4, database, on `feat/p8-labels`):
migration `20261004003800_labels` (`label_templates`, `printer_profiles`,
`print_jobs`, `private.qr_payload`, `private.label_content`, RPCs
`label_preview`, `create_print_job`, `set_print_job_status`,
`set_default_label_template`, `set_default_printer_profile`; the built-in
58 × 40 mm template per kind and the browser and PDF profiles are inserted
by the migration, not the seed); the seed's five print jobs; decisions D9
(base), D56–D59 ([ADR-017](decisions/ADR-017-labels-and-qr-base.md));
tests `tests/db/labels.test.ts`, `tests/db/labels-concurrency.test.ts`.
Steps 2–4 (`src/lib/qr.ts`, `src/lib/printing/`, screens, E2E) are not
built. The purchase receive screen's "Print N labels" shortcut waits for
the integration with Phase 7
([RISKS R-029](RISKS.md#r-029--the-purchase-receive-screen-has-no-print-n-labels-shortcut-yet)).

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

This is the planning-time list. Live risks, with status, evidence and next
actions, are in [RISKS.md](RISKS.md); update them there.

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
Status (2026-10-05) says whether the owner has confirmed, amended or changed
each default, and Record links its decision record in
[decisions/](decisions/README.md); new rows on this main line took D43–D59,
because D60 and up are used by the purchasing track; Phase 8's D56–D59 used
the last of them, so the next main-line decision needs a new range
([RISKS R-028](RISKS.md#r-028--the-main-line-decision-range-d43d59-is-exhausted)).

| ID | Decision | Default in plan | Used from | Status (2026-10-05) | Record |
|---|---|---|---|---|---|
| D1 | Rate of Cult Commons when a line has negative yield within a job whose total yield is positive | Per-line: share is computed per line with `max(yield, 0)`; a loss-making line contributes 0, it does not offset other lines. Job total CC = Σ line CC. | Phase 3 | Accepted: build default, not individually confirmed by the owner | [ADR-004](decisions/ADR-004-cult-commons.md) |
| D2 | Appointment capacity unit | One `intake_capacity_units` pool per `intake_slot_minutes` window across the shop; appointment types consume `capacity_units` for their whole duration. | Phase 2 | Accepted: build default, not individually confirmed by the owner | [ADR-013](decisions/ADR-013-appointments.md) |
| D3 | Recognition date for workshop revenue in reports | `work_orders.completed_at` (not collected_at, not check-in). Reports also offer check-in and collection as alternative bases. | Phase 5 | Accepted: build default, not individually confirmed by the owner; refined by D32 | [ADR-011](decisions/ADR-011-recognition-and-financial-reporting.md) |
| D4 | Consignment charges (services done on a consigned bike before sale) | Entered per charge with an explicit bearer: `consignor` (deducted at settlement) or `shop` (added to direct cost). No default bearer; the UI requires a choice. | Phase 6 | Accepted: build default, not individually confirmed by the owner; implemented by Phase 6 (`consignment_item_charges.bearer` has no default, `charge_bearer_required`; D44, D45, D46) | [ADR-014](decisions/ADR-014-defaults-for-unbuilt-phases.md), [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D5 | What a purchase receipt does to `products.default_direct_cost` | Sets it to the latest actual unit cost received (last-cost). No averaging. | Phase 7 | Accepted: build default, not individually confirmed by the owner; not implemented on this branch (Phase 7 is on the parallel track) | [ADR-014](decisions/ADR-014-defaults-for-unbuilt-phases.md) |
| D6 | Unique unit added to a job as a part | Unit becomes `held_for_customer` on add, `sold` when the job is completed; voiding before completion returns it to `available`. Interacts with D15 (reopen): the unit follows `completed_at`, with no stock movement — whenever `completed_at` goes from non-null to null (a reopen) every unit on a non-voided inventory line of the job goes sold -> held_for_customer, and whenever it goes from null to non-null (including re-completion after a reopen) they go held_for_customer -> sold. Refined by SOLD-AT-COMPLETION (D25). | Phase 4 | Accepted: build default, not individually confirmed by the owner | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md) |
| D7 | Refund of an online sale | Financial `sale_refunds` row only; stock and unit status untouched until staff runs `restock_unit`. | Phase 10 | Accepted: build default, not individually confirmed by the owner; implemented for retail refunds by Phase 6 (`record_sale_refund` never moves stock; `restock_unit` is separate; D49); online refunds not implemented (Phase 10 not built) | [ADR-014](decisions/ADR-014-defaults-for-unbuilt-phases.md) |
| D8 | Customer-visible timeline | Customers (later, public site) see status changes, completion, collection and `customer`/`public` photos; never notes, lines' costs, or assignments. | Phase 11 | Accepted: build default, not individually confirmed by the owner | [ADR-006](decisions/ADR-006-customer-and-public-visibility.md) |
| D9 | Short ID format and QR base URL | `B-/J-/P-/U-/C-/PO-/S-` + 6 digits; QR = `{public_site_url}/q/{short_id}`. The Admin also answers `/q/{short_id}` for staff and redirects to the record (`resolveShortId`, Phase 4); it is the only Admin /q route. Phase 2 stores `shop_settings.public_site_url` (nullable, informational): Phase 8 decides whether it or `NEXT_PUBLIC_PUBLIC_SITE_URL` is the QR base; until then the env var is. | Phase 1 | Accepted: build default, not individually confirmed by the owner; 2026-10-05: QR base decided in Phase 8: shop_settings.public_site_url, no fallback (ADR-017) | [ADR-007](decisions/ADR-007-short-ids-and-qr-base.md), [ADR-017](decisions/ADR-017-labels-and-qr-base.md) |
| D10 | Staff login method | Supabase email + password for staff; invitations by admin from Staff settings. No magic links in MVP. | Phase 0 | Changed by the owner 2026-10-05: staff sign-in moves to Supabase email OTP, built on the parallel track and not on this branch; this branch still signs in with email + password | [ADR-005](decisions/ADR-005-staff-sign-in-and-delegation.md) |
| D11 | What a `manage_staff` holder who is not an admin may change (SPEC §4.2 asks for granular permissions but does not say who may grant them) | Delegation ceiling: they may grant or revoke only permissions they hold themselves, never `manage_staff` (admins only), never on their own row and never on an admin's row; they may invite (role staff only) and deactivate/reactivate non-admins. Admins are unrestricted. Residual risk to confirm: an inviter sees the new login's temporary password, so a manager could keep a second login at their own permission level; closing that fully needs invite links or a forced password change on first sign-in (not in MVP). | Phase 0 | Accepted: build default, not individually confirmed by the owner; ceiling unchanged in code; the temporary-password residual risk is expected to close with email OTP (unverified until it merges); owner asked to confirm that the 2026-10-05 note "D11 changed" meant the sign-in method (D10 here) | [ADR-005](decisions/ADR-005-staff-sign-in-and-delegation.md) |
| D12 | Who sees a bike's customer-visible photos after it changes hands (SPEC §5 "Ownership changes preserve history" does not say what a new or previous owner sees) | The current owner sees every `customer`/`public` photo of the bike, including ones taken before they owned it; a previous owner stops seeing the bike and its photos once it is transferred (`my_bikes`, `my_bike_attachments` read current ownership). Staff history (`bike_ownership_events`) keeps every owner. Alternative to confirm before Phase 11: limit each owner to photos taken during their ownership. | Phase 1 (enforced), Phase 11 (shown) | Owner-confirmed 2026-10-05 | [ADR-006](decisions/ADR-006-customer-and-public-visibility.md) |
| D13 | Can a photo on a customer record be public? (SPEC §8 allows `public` visibility without saying for which records) | Never: attachments whose `entity_type = customer` may be `internal` or `customer` only (check constraint and RPC error `attachment_customer_never_public`). Bike photos may be public (shop and consigned bikes for sale need them); staff choose per photo. | Phase 1 | Accepted: build default, not individually confirmed by the owner | [ADR-006](decisions/ADR-006-customer-and-public-visibility.md) |
| D14 | Line pricing | Any active staff member may set or override a line's unit sale price (>= 0) when adding it; entering or overriding a unit direct cost (service-line override or manual-line cost) requires `view_costs` (42501 otherwise); no negative-price or discount lines in MVP (a discount is a lower unit price on the line). A manual line added without a cost (always, for staff without `view_costs`) is stored with unit cost 0 and marked `cost_pending`. **Consequence for Cult Commons, owner to confirm:** until it is corrected, that line's yield is its whole sale and its Cult Commons share is 30% of the whole sale, so the job's cost is understated and its yield and Cult Commons overstated (SPEC §10 deducts direct cost first). Safe default: the line shows "Cost pending" to every staff member, `work_order_totals_staff.cost_pending_count` counts such live lines and the job's totals are labelled provisional for `view_costs` holders; the correction is that a `view_costs` holder voids the line and adds it again with the cost (snapshots stay immutable; reopen first if the job is completed). Nothing blocks completion. Labour belongs on a service line (which snapshots the service's cost); parts become inventory lines in Phase 4. Options for the owner: block completing a job with a pending cost, let a `view_costs` holder enter a pending cost once, or have Phase 5 reports exclude or flag pending lines. | Phase 3 | Owner-confirmed 2026-10-05, clarified: a line's totals use the line's own cost, including 0; zero-price lines are valid (free parts) | [ADR-009](decisions/ADR-009-line-pricing-and-cost-pending.md) |
| D15 | Work order status machine | Transitions follow the table in DATA-MODEL §4; completed only from in_progress or paused; collected only from completed or ready_for_collection; collected and cancelled are final; nothing returns to received; reopening (completed or ready_for_collection -> in_progress) requires a reason and clears completed_at and ready_for_collection_at (started_at is kept; the timeline keeps the earlier `completed` event); lines can be added or voided only while the job is open (before completed). DEVIATION, owner to confirm before Phase 5: reopen clears completion stamps, which deviates from DATA-MODEL §4's original "stamps exactly once, never clearing an earlier stamp" and moves D3 recognition to the final completion. Phase 4 returns sold units to held_for_customer on reopen (whenever completed_at goes from non-null to null every unit on a non-voided inventory line of the job goes sold -> held_for_customer; whenever completed_at goes from null to non-null, including re-completion after a reopen, they go held_for_customer -> sold), with no stock movement (D6). Phase 3 keeps the reopen rule in `private.work_orders_enforce_rules` (commented as the Phase 4 extension point) so Phase 4 can create or replace it starting from Phase 3's body, or add its own `work_orders` trigger. | Phase 3 | Owner-confirmed 2026-10-05, including the reopen deviation | [ADR-008](decisions/ADR-008-work-order-lifecycle.md) |
| D16 | Cancelling a job | Only from an open status, reason required, refused while any non-voided line exists with P0001 `work_order_has_lines` (void lines first, which in Phase 4 writes the stock reversals). This is the single cancel-with-lines rule: it already covers inventory lines, so Phase 4 adds no separate parts rule or code. | Phase 3 | Accepted: build default, not individually confirmed by the owner | [ADR-008](decisions/ADR-008-work-order-lifecycle.md) |
| D17 | Which jobs a customer sees | The jobs where they are `work_orders.customer_id`, regardless of who owns the bike now (a new owner does not see the previous owner's jobs) and regardless of whether the bike is archived (the job is the customer's history); cancelled jobs are hidden; status is shown as a coarse customer status (received, awaiting_customer, awaiting_parts, in_progress, completed, ready_for_collection, collected); lines show description, quantity, unit price and total only; requested work, notes, approval, assignments, actors and all costs are never shown. Enforced by Phase 3 RPCs (built in step 2), shown in Phase 11. | Phase 3 | Accepted: build default, not individually confirmed by the owner | [ADR-006](decisions/ADR-006-customer-and-public-visibility.md) |
| D18 | A job's customer and the bike's owner | A job's customer must be the bike's current owner, or the bike must have no owner (shop bike); otherwise staff transfer the bike first (P0001 `bike_owner_mismatch`). Checked under FOR SHARE locks on the customer and bike, so it holds against a concurrent transfer. | Phase 3 | Accepted: build default, not individually confirmed by the owner | [ADR-008](decisions/ADR-008-work-order-lifecycle.md) |
| D19 | Can a photo on a work order be public? | Photos on a work order may be internal or customer, never public (P0001 `attachment_work_order_never_public`, CHECK `attachments_work_order_never_public` as backstop; the app refuses before copying anything to media-public), mirroring D13. | Phase 3 | Accepted: build default, not individually confirmed by the owner | [ADR-006](decisions/ADR-006-customer-and-public-visibility.md) |
| D20 | Overdue | A job is overdue while it is open (before completed: received … paused) and `now() - checked_in_at > interval '7 days'` (7 × 24 hours) (board badge and age filter; `OVERDUE_AFTER_DAYS = 7` and `isOverdue` exported from `src/lib/workshop.ts`; Phase 5's overdue_job exception and Today tile and Phase 9 reporting import or reuse exactly this rule). | Phase 3 | Accepted: build default, not individually confirmed by the owner | [ADR-008](decisions/ADR-008-work-order-lifecycle.md) |
| D21 | Cult Commons rate changes | Admin only, effective now or in the future (never backdated); rate rows are append-only except that an admin may cancel a rate whose effective_from is still in the future (`cancel_cult_commons_rate` sets cancelled_at/cancelled_by; cancelled rows are ignored by `private.cult_commons_rate_at`); every line snapshots the rate in force when it is added, so history never changes. The base 0.30 row (effective 1970-01-01) ships in the migration, not the seed. | Phase 3 | Accepted: build default, not individually confirmed by the owner | [ADR-004](decisions/ADR-004-cult-commons.md) |
| D22 | Assignments | Any active staff member may assign or unassign anyone on a job that is not collected or cancelled; making someone lead removes the previous lead from the job (not demoted to additional); only active staff can be assigned. | Phase 3 | Accepted: build default, not individually confirmed by the owner | [ADR-008](decisions/ADR-008-work-order-lifecycle.md) |
| D23 | NEG-CONSUMPTION: can a job part take stock below zero? | Yes: adding a quantity part to a job may take a location's ledger on-hand below zero, because the part was physically used; the UI warns. Negative balances show in `reporting.low_stock` and `reporting.product_stock.negative_locations` regardless of reorder_point. Manual adjustments and transfers may never leave a location below zero (`insufficient_stock`). | Phase 4 | Accepted: build default, not individually confirmed by the owner | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md) |
| D24 | PART-PRICE-COST: a part with no known price or cost | A part can be added to a job only when its sale price (default `private.selling_price`: the unit price, else the product default; any staff may override it, as D14 allows for every line) and its direct cost (the unit cost, else the product default; never overridden) are known. Missing values raise `part_price_missing` or `part_cost_missing`, because a silent zero cost would overstate yield and Cult Commons (SPEC §10). Inventory lines are therefore never `cost_pending` (D14's `cost_pending` is for manual lines only). | Phase 4 | Amended by the owner 2026-10-05: 0 is a known price or cost; only NULL counts as missing. The code already behaves this way; no test proves it yet (RISKS R-006) | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md) |
| D25 | SOLD-AT-COMPLETION (refines D6): when a unit on a job is sold | A unit on a job is `held_for_customer` on add and becomes `sold` whenever `work_orders.completed_at` goes from null to set, including re-completion after a reopen (trigger `work_orders_sell_held_units`, AFTER UPDATE WHEN completed_at changes). On reopen (completed_at cleared) every unit on the job's non-voided inventory lines goes sold -> held_for_customer, with inventory_unit_events and no stock movement; the product's publication stays 'sold' until the line is voided (`private.refresh_unique_publication` then restores public) or the job completes again. `add_inventory_line` and `void_line` refuse on a job that is not open (D15, `work_order_locked`); to return a part from a completed job, reopen it, then void the line. Both lock the work order FOR UPDATE through `private.lock_work_order`, so completion, reopen and cancellation cannot race an add or a void. Cancelling a job with parts follows D16. | Phase 4 | Accepted: build default, not individually confirmed by the owner | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md) |
| D26 | PUBLICATION-MACHINE: publication states | Transitions draft -> internal_only, archived; internal_only -> public, archived; public -> internal_only, sold, archived; sold -> public, archived; archived -> internal_only. 'sold' is set only by sale paths (job completion now; Phases 6 and 10 later), never manually, and only for unique products; leaving 'sold' manually is allowed only to archived. sold -> public is a system restore by `refresh_unique_publication` that skips the requirements, so a void is never blocked. Any other entry into public requires a name, a selling price (`private.selling_price`), at least one public photo (product, unit or linked bike) and, for unique products, an available unit; the products trigger enforces this for every writer. `public_slug` is assigned at first publish (name slug + short ID, with an 'item' fallback) and never changes. low_stock means on_hand <= reorder_point, or any negative stock. | Phase 4 | Accepted: build default, not individually confirmed by the owner | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md) |
| D27 | SHOP-OWNED-ONLY: whose stock can be a job part | Whose stock can be a job part: consignment stock may be a job part; customer_owned never (`ownership_not_saleable`); consigned units are created only by `create_consignment_item` | Phase 4 | Changed by the owner 2026-10-05; implemented in Phase 6 (D44) | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md), [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D28 | SPLIT-COST: turning one counted item into a unique item | One RPC, `split_unit_from_stock` (Phase 4 step 2). It decrements the source by one (a `stock_adjustment` with a reason) and creates a new draft unique product and unit at the same location; the new unit's direct cost is the source's `default_direct_cost`. | Phase 4 | Accepted: build default, not individually confirmed by the owner | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md) |
| D29 | BIKE-WITH-CUSTOMER: a sold shop bike after it reached its buyer | Once `transfer_bike_ownership` has given a sold unit's bike to a customer, the unit never goes back into stock while the bike has a customer. Reopening the job that sold it is refused with `bike_with_customer` (the reopen would hold the unit again, clear `sold_at` and let a void make a customer's bike available and public); `void_line` refuses the same state, and `private.assert_unit_consistent` fails an available, reserved or held_for_customer unit whose bike has a customer. Safe default: to correct that job, transfer the bike back to the shop (with a reason), reopen, correct, complete, transfer again. `reporting.public_items` cuts a unit's bike photos at the earlier of `sold_at` and the bike's first transfer to a customer after the unit was registered. | Phase 4 | Owner-confirmed 2026-10-05 ("confirmed, revisit later"; no revisit trigger set) | [ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md) |
| D30 | FIN-ACCESS: who sees financial reports | Financial report ROWS (`financial_lines`, the money columns of `daily_summary` / `today_dashboard`, Today's Money section) need `view_financial_reports` (`financial_lines` raises 42501 without it). Every cost-derived figure in them also needs `view_costs`; without it the figure comes back NULL and the UI says it is hidden: COGS, unit cost, yield, Cult Commons share and rate, BICII yield after CC, losses and loss counts, value at cost and (Phase 6) consignor liability. The job-level yield panel (P3's totals summary on the job page, `work_order_yield`) needs `view_costs` only (job costing, SPEC §4.2/§22). Operational counts (jobs, parts used, adjustments and whether one is significant, low stock, exceptions) are visible to all active staff. Adopted by every later phase (P6 sales/consignment, P9 reports). | Phase 5 | Accepted: build default, not individually confirmed by the owner | [ADR-011](decisions/ADR-011-recognition-and-financial-reporting.md) |
| D31 | TODAY-TILES: Today's job tiles | Checked in, started, completed, ready for collection, collected and cancelled are FLOWS: the jobs whose CURRENT stamp falls on that shop day (a reopened job leaves its earlier Completed/Ready flow until it is completed again, D15). Received (received + diagnosing), waiting (awaiting_customer + awaiting_parts + paused), ready to start, in progress, awaiting collection (completed + ready_for_collection) and overdue (D20) are the CURRENT SNAPSHOT, from status, returned only for today and grouped as P3's `BOARD_GROUPS`; past-day snapshots would need status replay (Phase 9 may add it). | Phase 5 | Accepted: build default, not individually confirmed by the owner | [ADR-011](decisions/ADR-011-recognition-and-financial-reporting.md) |
| D32 | RECOGNITION: workshop revenue recognition (refines D3 as modified by D15; **owner to confirm, with D15**) | A workshop line is recognised when it is not voided and its job has a `completed_at`, on the shop day of the job's CURRENT `work_orders.completed_at`: completed, ready-for-collection and collected jobs count, open and cancelled jobs never do. Phase 3 freezes a job's lines once it is completed (no add, no void), so the only correction is a reopen: it removes the whole job from its earlier completion day until it is completed again, when its then-current live lines are recognised on the new completion day. Past days CAN change after a reopen; there are no reversal entries for workshop lines. Each entry's Cult Commons share is the line's own share (≥ 0), so a day's and a job's Cult Commons are always ≥ 0 and no negative Cult Commons payment arises (SPEC §10); gross sales ≥ 0 (D14 forbids negative prices); `loss_total` ≤ 0. Lines with `cost_pending` (D14) are recognised as stored (cost 0) and FLAGGED, never excluded or estimated (`financial_lines.cost_pending`, `today_dashboard.cost_pending_lines`, `work_order_yield.cost_pending_count`), so the UI can label the figures provisional (D14's safe default). Phase 9 reports restate earlier periods the same way. | Phase 5 | Owner-confirmed 2026-10-05, with D15 | [ADR-011](decisions/ADR-011-recognition-and-financial-reporting.md) |
| D33 | SIGNIFICANT-ADJ: significant stock adjustment | A `stock_adjustment` or `damaged` movement is significant when \|quantity_delta\| ≥ 5, or it is on a unique unit, or \|quantity_delta\| × unit cost ≥ 100.00 SGD; unit cost = `unit_cost_snapshot`, else `products.default_direct_cost`, else 0. One function, `private.is_significant_adjustment`, holds the rule; Phase 9 or shop settings may replace it. The flag is shown to all staff (it reveals only that a value reached the threshold, never the value); the value at cost needs `view_costs`. | Phase 5 | Accepted: build default, not individually confirmed by the owner | [ADR-011](decisions/ADR-011-recognition-and-financial-reporting.md) |
| D34 | EXCEPTIONS: operational exception rules (the Phase 5 set) | `overdue_job`: exactly D20 (`private.work_order_status_is_open(status)` and `now() - checked_in_at > interval '7 days'`, 7 = `OVERDUE_AFTER_DAYS`; exactly 7 × 24 h is not yet overdue). `uncollected_job`: status completed or ready_for_collection and completed ≥ 7 shop days ago. `negative_stock`: any product/location with on-hand < 0. `unit_hold_stale`: a `held_for_customer` unit with no non-voided inventory line on an OPEN job referencing it (D6/D25). `currency_mismatch`: a line that would be recognised but whose currency is not the shop currency; such entries are excluded from totals. Kinds are text; Phases 6, 9 and 10 add kinds (unit_state_mismatch, unsettled_consignment, integration_failed) by create or replace of the view, keeping these columns first. | Phase 5 | Accepted: build default, not individually confirmed by the owner | [ADR-011](decisions/ADR-011-recognition-and-financial-reporting.md) |
| D35 | SHOP-TZ: shop time zone and currency before Phase 2 | `private.shop_timezone()` returns 'Asia/Singapore' and `private.shop_currency()` returns 'SGD'; Phase 2 replaces both bodies (create or replace, same signatures) to read `shop_settings` (timezone, default_currency) with those fallbacks, and Phases 7 and 9 call these functions and create no alternatives. Every shop-day computation in SQL goes through `private.shop_day()` / `private.shop_today()` / `private.shop_day_start()`: never `current_date`, never `ts::date` without `at time zone`; the app lets the database decide which day is today. Totals sum the shop currency only. | Phase 5 | Accepted: build default, not individually confirmed by the owner | [ADR-012](decisions/ADR-012-shop-time-zone-and-currency.md) |
| D36 | APPT-COMPLETION: when an appointment is completed | An appointment becomes `completed` automatically when its linked work order first reaches completed, ready_for_collection or collected (a trigger on `work_orders`, Phase 2 step 2); staff never mark `completed` by hand (`mark_appointment_status` refuses it); reopening the job does not reopen the appointment; a cancelled job leaves the appointment `checked_in`. | Phase 2 | Accepted: build default, not individually confirmed by the owner | [ADR-013](decisions/ADR-013-appointments.md) |
| D37 | APPT-SELF-BOOKING: customer booking and cancelling rules (final; Phase 11 references this row and defines no booking or cancel rules of its own) | Customers book only active AND public types; `starts_at >= now() + booking_min_notice_minutes` (default 120); `starts_at <= now() + booking_horizon_days` (default 60); at most `customer_max_active_bookings` (default 3) upcoming (`starts_at > now()`) booked/confirmed appointments with `source = 'customer'` per customer, enforced under a per-customer advisory lock (staff-made bookings never count). A customer may cancel their own booked/confirmed appointment (whoever booked it) until `customer_cancel_cutoff_minutes` (default 120) before its start; after that they contact the shop. `appointments.cancelled_via` records whether staff or the customer cancelled. Staff bookings are exempt from notice, horizon, limit, the public flag and the cutoff, never from hours, closures or capacity, and cannot book an appointment that has already ended (`appointment_in_past`); staff may cancel any booked/confirmed/arrived appointment at any time with a reason. Available slots are readable anonymously (no sign-in needed to see times). | Phase 2 | Accepted: build default, not individually confirmed by the owner | [ADR-013](decisions/ADR-013-appointments.md) |
| D38 | APPT-GRID: the slot grid and what settings changes do | Capacity windows are aligned to shop-local midnight in steps of `intake_slot_minutes`; a booking starts on the grid; the whole `[starts_at, ends_at)` lies inside one continuous open stretch of one shop-local date; a `custom_hours` override replaces ALL weekly intervals on each date it covers; a `closed` override blocks any overlapping appointment and beats custom hours. Settings changes (hours, closures, slot length, capacity, type duration/units) never move, shrink or cancel existing appointments (appointments snapshot `ends_at` and `capacity_units`; screens flag the affected ones). | Phase 2 | Accepted: build default, not individually confirmed by the owner | [ADR-013](decisions/ADR-013-appointments.md) |
| D39 | APPT-LATE-ARRIVAL: the status machine's edges | `no_show -> arrived` is allowed only on the appointment's own shop-local date and re-checks capacity; cancelled and completed are final (rebook instead); `arrived -> cancelled` is allowed with a reason (left before check-in); `no_show` only once `starts_at` has passed (`appointment_not_started`). | Phase 2 | Accepted: build default, not individually confirmed by the owner | [ADR-013](decisions/ADR-013-appointments.md) |
| D40 | APPT-CHECK-IN: what check-in needs and does | Check-in needs a bike owned by the appointment's customer (transfer it first otherwise; shop bikes refused); it either creates a new work order (through Phase 3's `private.create_work_order`) or links one existing OPEN work order (`private.work_order_status_is_open`, i.e. before completed) of the same customer and bike that has no appointment; `work_orders.appointment_id` goes null -> value once and never changes afterwards. Built in Phase 2 step 2. | Phase 2 | Accepted: build default, not individually confirmed by the owner | [ADR-013](decisions/ADR-013-appointments.md) |
| D41 | APPT-COUNTS: how Today and reports count appointments | Today and report counts of appointments, arrivals and no-shows are by the appointment's scheduled shop-local date and its CURRENT status (not by when staff tapped): `appointments_scheduled` = non-cancelled appointments starting that shop day; `appointments_arrived` = of those, currently arrived/checked_in/completed; `appointments_no_show` = of those, currently no_show. The basis of `daily_summary`'s appointment columns (Phase 2 step 2) and of Phase 9's activity report. Operational counts: every active staff member sees them (D30). | Phase 2 | Accepted: build default, not individually confirmed by the owner | [ADR-013](decisions/ADR-013-appointments.md) |
| D42 | APPT-CUSTOMER-FIELDS: what customers see of their appointments (extends D8) | Type name, times, status, their bike (short ID + brand/model) only while it is still theirs and not archived (D12), their own note, `cancelled_at`, `cancelled_via` (a channel, never a person) and whether they may cancel online (`can_cancel`). Never `internal_note`, `cancellation_reason`, capacity units, source or who acted (D8). One projection (`public.my_appointment`) serves `my_appointments`, `book_my_appointment` and `cancel_my_appointment`. | Phase 2 | Accepted: build default, not individually confirmed by the owner | [ADR-006](decisions/ADR-006-customer-and-public-visibility.md) |
| D43 | DOCS-STACK: documentation standard | Follow Vibe Code Docs Stack v0.2.0 (owner directive 2026-10-05) keeping the existing document names: one canonical home per responsibility (README, NOW, AGENTS, docs/PRODUCT, SPEC as the historical requirement, PLAN with this index, ADR-001 at its path, docs/ARCHITECTURE, docs/decisions/, DATA-MODEL as the DATA document, TESTING, DESIGN, docs/ENGINEERING, docs/OPERATIONS with RUNBOOK for procedures, docs/RISKS, docs/USER-GUIDE). New main-line rows take D43–D59; D60 and up belong to the purchasing track. No issue tracker: the backlog is the §2 phases plus the RISKS next actions, and NOW names the next action. | Docs retrofit (after Phase 2) | Accepted (owner directive 2026-10-05) | [ADR-015](decisions/ADR-015-documentation-stack.md) |
| D44 | CONS-JOB-PART: how consigned stock is used as a job part (implements the owner's D27 change) | `add_inventory_line` keeps its signature and now accepts consignment stock; customer_owned stays refused with `ownership_not_saleable`. A consigned unit's line snapshots `unit_direct_cost` = the item's `agreed_amount_owed` + its non-voided shop-borne charges (D4); a consigned quantity line snapshots the item's `agreed_amount_owed` (shop charges exist only on unique items, D45). The line also stores `consignment_item_id` and `consignor_payout_snapshot` = the agreed amount per unit. A quantity part draws from exactly one item, chosen FIFO (the oldest active item of the product by `received_at`, then `short_id`, whose remaining quantity covers the part; none → `consignment_quantity_unavailable`); its default price is that item's asking price, else the product default, and any staff member may override it (D14). Consigned stock never goes below zero (`insufficient_stock`): D23 does not apply, because on-hand must equal the consignors' remaining quantity (D50). The unit is held on add and sold at completion (D6/D25). The item counts as sold, and the consignor liability (quantity × payout snapshot) exists, exactly while the line is live and its job has a `completed_at`: a reopen removes both until the job is completed again; a void (open job) returns the stock through Phase 4's linked reversal. Liability is derived, never stored, so a replay or a repeated completion never creates a second liability. A consigned part is returned by reopen + void, never by `restock_unit` (which needs a sale line; D6 interplay). Alternative considered: keep refusing consigned parts and record them as retail sales (the default before the owner's change). | Phase 6 | Accepted: build default, owner to confirm; implemented by Phase 6 | [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D45 | CONS-QTY-FIFO: quantity consignment and the single selling price | Consigned quantity stock lives on dedicated consignment-owned products: a product is never mixed shop-owned and consigned, and its `ownership_type` cannot change once it has a unit or a movement. `remaining = quantity − (sold on live sale lines − restocked) − quantity on live job lines − returned`. Each sale line draws from exactly one item: the one named, else FIFO as in D44; a line is priced at its own item's asking price unless overridden, so two consignors' items on one product each sell at their own price. `private.selling_price` stays the single selling price (public page, labels, Shopify, sale and part defaults): for a consigned unit, its item's asking price; for a consigned quantity product, the asking price of the FIFO-head item (the oldest active item with remaining > 0), else the product default; a line drawn from a later item sells at that item's asking price. Shop-borne charges are allowed only on unique items, and only while the unit is available (its cost is snapshotted when it goes on a job or a sale). | Phase 6 | Accepted: build default, owner to confirm; implemented by Phase 6 | [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D46 | CONS-RESTOCK: liability, restock and overpayment | Liability = Σ quantity × `consignor_payout_snapshot` over live, non-restocked consigned sale lines plus live consigned job lines of completed jobs; owed = liability − non-voided consignor charges; paid = Σ settlement allocations of settlements that are not reversed; outstanding = owed − paid. Nothing stores owed, paid or outstanding. `restock_unit` reverses a sale line's liability; for a consigned unit it needs `manage_consignments` as well as `adjust_stock`. A unit may be sold again only after `restock_unit` marks its previous line restocked: at most one live (non-restocked) sale line per unit, a partial unique index that replaces DATA-MODEL §8's plain `unique` (a recorded deviation). A unit sold through a job is not restocked (D44). Restock refuses a unit whose bike a customer now owns (`bike_with_customer`, D29). Money already paid stays paid, so outstanding can go negative: it is shown as "Overpaid $x (consignor owes the shop)", never "credit", and is cleared only by a later sale, by voiding a consignor charge or by reversing a settlement, never recovered automatically. A refund alone does not change the liability (D7). | Phase 6 | Accepted: build default, owner to confirm; implemented by Phase 6 | [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D47 | SETTLEMENT-RULES | A settlement's amount equals the sum of its allocations (each > 0, one per item, all items of that consignor). An allocation may exceed the item's current `max(outstanding, 0)` only with an override reason; every caller holds `manage_consignments`. Mistakes are corrected by reversing the whole settlement with a reason (`consignment_settlement_reversals`), never by editing or deleting it. A consignor can be archived only with no active item (`consignor_has_open_items`) and an outstanding of exactly 0 (`consignor_has_balance`; the detail names the remedies of D46). | Phase 6 | Accepted: build default, owner to confirm; implemented by Phase 6 | [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D48 | SALES-ACCESS (follows D30) | Any active staff member may record an in-store sale and see sale headers, lines, quantities, prices and sale totals. Sale cost, yield, Cult Commons, rate and payout snapshots need `view_costs` (`private.can_view_sale_costs()`). Consignment money (agreed amount owed, charges, item events, liability, ledger, settlements, a job line's payout snapshot) needs `manage_consignments` or `view_costs` (`private.can_view_consignment_money()`). `view_financial_reports` alone reveals neither. Payout details (bank, PayNow) need `manage_consignments` only. It revises these DATA-MODEL §15 rows: `sales, sale_lines, sale_refunds` (was P(view_financial_reports) or P(view_costs) per row; now rows to all staff with the cost columns gated by `view_costs`); `consignors, consignment_items, charges` (charges and the new events table are row-gated by the money helper); `consignment_settlements, settlement_lines` (was P(manage_consignments); now readable with `manage_consignments` or `view_costs`, written with `manage_consignments`). | Phase 6 | Accepted: build default, owner to confirm; implemented by Phase 6 | [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D49 | RETAIL-REFUND | Retail refunds are recorded by admins only (`view_financial_reports` is a read permission and does not authorise money going out), capped at the sale total minus earlier refunds, and financial only (D7). Phase 6 reports every sale line at its snapshot and nets neither refunds nor restocks out of `reporting.financial_lines` or `daily_summary`; refunds and restocks show on the sale, the Sales list and the consignor ledger. Refund netting and Cult Commons claw-back are decided by Phase 9's refund-reporting row (working name DR5), the single PLAN row for retail and online refunds; Phase 6 adds no separate row or open question for them. | Phase 6 | Accepted: build default, owner to confirm; implemented by Phase 6 | [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D50 | CONS-STOCK-MOVES | Stock of a consignment-owned product moves only through intake (`consignment_received`), return to the consignor (`consignment_returned`), sale (`retail_sale` / `online_sale` with a sale line), restock (`return` with a sale line), job consumption (D44) and the reversal that voiding it writes, and transfers (and the reversal of a transfer). `adjust_stock` (adjustment, damaged), write-off, `create_unique_unit`, `split_unit_from_stock` and purchase receipts are refused (`consignment_stock_adjust_blocked`; a write-off also raises `consignment_unit_write_off_blocked`), so on-hand of a consigned product always equals the consignors' remaining quantity. Damaged or lost consigned stock and customer returns of consigned quantity lines are out of MVP: staff return the item to the consignor or sell it. | Phase 6 | Accepted: build default, owner to confirm; implemented by Phase 6 | [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D51 | CONS-BIKE-LINK | A consigned complete bike keeps its bike record. Intake of a unique item may link an existing bike under Phase 4's rules for stock bikes: not archived (`bike_archived`), no owner (`bike_has_owner`), not already a unit (`bike_already_linked`). A bike registered to the consignor's customer record is first transferred to the shop with `transfer_bike_ownership` and a reason (for example "Consigned by Daniel Ong"), because a unit whose bike a customer owns cannot be in stock (D29). Unit and bike are linked both ways (`private.register_unit`). Ownership is not transferred on sale: staff transfer it to the buyer, as for a sold shop bike. On return to the consignor the link stays (as for any unit that left stock) and staff transfer the bike back to the consignor's customer record; that bike record cannot be consigned a second time (`bike_already_linked`), a known limitation recorded in RISKS. | Phase 6 | Accepted: build default, owner to confirm; implemented by Phase 6 | [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D52 | CONS-PHOTOS-INTERNAL (the D13/D19 pattern) | Photos on a consignment item (`entity_type = 'consignment_item'`: the signed agreement, ID or condition notes showing terms and amounts) are internal only: trigger `attachments_consignment_item_internal_only` raises P0001 `attachment_consignment_internal_only` for `customer` or `public`, and a CHECK of the same name is the backstop. Listing photos belong to the product or unit and may be public (D26). | Phase 6 | Accepted: build default, owner to confirm; implemented by Phase 6 | [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D53 | PRICE-OVERRIDE | Any active staff member may change a sale line's price (as D14 allows for job lines), with no database floor. The sale sheet warns "Below the asking price" when the price is under the database selling price and, for `view_costs` users, "Below cost: this sale loses money". Open question for the owner: should a price below the agreed amount plus shop charges on a consigned item need `manage_consignments`? | Phase 6 | Accepted: build default, owner to confirm; implemented by Phase 6 | [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D54 | CONS-ITEM-LOCATION: where each consignor's quantity stock is | Every movement of a consignment-owned product names its consignment item (a unit's movement takes its unit's item; `movement_invalid` otherwise), so `private.consignment_item_on_hand(item, location)` derives each item's stock per location, and at every location the items' on-hand sums to the product's. A sale or a job part with no item named draws FIFO (D44, D45) only among the items that have the whole quantity at that location; a named item must have it there (`consignment_quantity_unavailable`). A return gives back only that item's stock at that location (by default all of it). `transfer_stock` keeps its signature; a transfer of consigned quantity stock moves one item's stock, the oldest active item with the whole quantity at the source location (`consignment_quantity_unavailable`: move one consignor's stock at a time); staff cannot pick which consignor's stock moves (a recorded limitation). `saleable_stock` offers each item only where it has stock. Found by the Phase 6 review: without it, a sale at one location could be charged to a consignor whose stock was at another, putting the liability on the wrong consignor. Alternative considered: one location per consigned quantity item (transfers refused). | Phase 6 | Accepted: build default, owner to confirm; implemented by Phase 6 (review fixes) | [ADR-016](decisions/ADR-016-consignment-and-sales.md) |
| D55 | SALE-DATE: how far back an in-store sale may be dated | Any active staff member may date a sale in the past ("Sold earlier?"), never more than 5 minutes ahead (`sale_recognized_in_future`) and never before its stock was with the shop: a consigned item's `received_at`, a unit's latest restock (`sale_before_stock`, in `private.sell_line`, so Phase 10's online sales follow it too). Shop-owned stock has no other lower bound, because its registration date is when it was entered, not when it arrived. A backdated sale is recognised on its own shop day and takes the Cult Commons rate in force then (D21, D32). There is no period lock (none exists in the brief), so a backdated sale changes a past day's figures. Open question for the owner: should backdating beyond a window (for example 7 days) need a permission such as `view_financial_reports` or admin? | Phase 6 | Accepted: build default, owner to confirm; open question below; implemented by Phase 6 (review fixes) | [ADR-016](decisions/ADR-016-consignment-and-sales.md), [RISKS R-027](RISKS.md#r-027--a-sale-can-be-backdated-without-limit-by-any-staff-member) |
| D56 | LABEL-QUANTITY: label quantity per print job | One job prints 1–500 labels of a quantity-tracked product, or 1–10 of a unit or bike (default 1). A per-job cap, not a limit on labels (SPEC §31 "arbitrary quantity"): more labels = another job, and the sheet says how many remain (`label_quantity_out_of_range`). | Phase 8 | Accepted: build default, not individually confirmed by the owner | [ADR-017](decisions/ADR-017-labels-and-qr-base.md) |
| D57 | UNIQUE-LABELS: labels for unique items | Unique-tracked products are labelled per unit (U-); `reporting.public_items` exposes published units as their own U- rows, so a U- label resolves publicly once published; a P- label for a unique product is refused (`label_unique_product_needs_unit`); a unit linked to a bike shows the bike's size/colour as an identity line and keeps its U- QR; a bike tag (B-) may be printed for any non-archived bike and resolves to "not found" publicly. | Phase 8 | Accepted: build default, not individually confirmed by the owner | [ADR-017](decisions/ADR-017-labels-and-qr-base.md) |
| D58 | LABEL-PRICE: the price on a label | Exactly `private.selling_price(product_id, inventory_unit_id)`, the single function `reporting.public_items`, the in-store sale default (`private.sell_line`), `add_inventory_line` and later Shopify use (latest definition `20261004003300_consignment.sql`: consigned unit, the item's asking price, else the unit price, else the product default; consigned quantity product, the FIFO item's asking price; shop stock, the unit price, else the product default); never reproduced inline. NULL → no price line (never "$0.00" for a missing price); 0 → "0.00" (D24 as amended: 0 is a known price). The printed price is a snapshot; record pages warn when the current price differs from the last printed label's. | Phase 8 | Accepted: build default, not individually confirmed by the owner | [ADR-017](decisions/ADR-017-labels-and-qr-base.md) |
| D59 | PRINT-CONFIRMED: when a print counts as printed | Browsers cannot report printer success, so staff confirm each job as printed, or failed with a reason; unconfirmed jobs stay `rendered` and are listed under "To confirm". Only open jobs (queued/rendered) can be rendered for printing (print view, PDF route); printed and failed jobs are history, and "Print again" always creates a new job linked by `reprint_of_id` from the record page with a fresh preview. D59 is the last main-line number ([RISKS R-028](RISKS.md#r-028--the-main-line-decision-range-d43d59-is-exhausted)). | Phase 8 | Accepted: build default, not individually confirmed by the owner | [ADR-017](decisions/ADR-017-labels-and-qr-base.md) |

## 7. Out of scope (restated from SPEC §30)

Payments, accounting ledger, automated customer approval, Shopify SSO,
customer mechanic selection, labour time clock, bulk→unique conversion
machinery, multi-location optimisation, native apps, hard-coded Bluetooth
printing, marketing CRM.
