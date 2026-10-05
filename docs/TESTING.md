# BICII Admin — Testing strategy

Maps SPEC.md §27 onto concrete harnesses. A feature is done when the tests in
its row of PLAN.md pass in CI.

## Harnesses

| Layer | Tool | Runs against | Command |
|---|---|---|---|
| Unit (pure TS) | Vitest | nothing | `npm run test:unit` |
| Database (invariants, RLS, RPCs) | Vitest + `pg` | Postgres with migrations + seed | `npm run test:db` |
| End-to-end | Playwright | `next start` + the devstack (or `supabase start` with `E2E_EXTERNAL_STACK=1`) | `npm run test:e2e` |
| Static | `next typegen` + `tsc --noEmit`, `eslint`, `prettier --check` | — | `npm run check` |
| Generated DB types | `supabase gen types` from a throwaway database built from the migrations, then `git diff --exit-code -- src/lib/database.types.ts` | Postgres (devstack cache) | `npm run check:types` |

`npm test` = unit + db. CI runs `check` (with `check:types`), `test`, then
`build` (`ci.yml`); E2E runs on a nightly schedule and on PRs labelled
`e2e` (`e2e.yml`).

## Database test harness

The DB tests run against the real Supabase schemas without Docker. Any
Postgres 16 will do (the cloud agent container's, a CI service container, a
laptop's); the Supabase parts come from the devstack cache
(`npm run devstack:setup`, once per machine):

1. **Global setup** (`tests/db/global-setup.ts`) builds one template
   database per run with the same code as `npm run db:reset`
   (`scripts/devstack/database.mjs`):
   `supabase/devstack/roles.sql` (the platform roles and schemas hosted
   Supabase already has; never a migration) → Supabase Auth v2.178.0's own
   migrations (`auth migrate`: the real `auth.users`, `auth.identities`,
   `auth.uid()`, `auth.jwt()`) → Supabase Storage v1.79.31's own migrations
   (the real `storage` schema) → `supabase/migrations/*.sql` in filename
   order, each in a transaction, recorded in
   `supabase_migrations.schema_migrations` as the Supabase CLI does →
   `supabase/seed.sql`. About one second.
2. **Per file** (`tests/db/setup.ts`): a fresh database is cloned from the
   template (`create database … template …`) and dropped afterwards, so files
   are independent and concurrency tests can open several real connections
   (`openConnections(n)`) and commit.
3. **Per test**: the `as*` helpers run their body in a transaction that is
   rolled back unless the test passes `{ commit: true }`.

Files run one at a time (`fileParallelism: false`). Connection: the server
from `DATABASE_URL` (or `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`), taken from
the shell environment (no `.env` file is loaded), default
`postgres:postgres@127.0.0.1:5432`; the user must be able to create
databases and roles.

Acting as a user in a test (`tests/db/harness.ts`):

```ts
await asUser(conn, { sub: AUTH_USER.mechanic1, role: 'authenticated' }, async (tx) => {
  // tx has `set local role authenticated` and
  // `select set_config('request.jwt.claims', '{"sub":"…","role":"authenticated"}', true)`
});
await asStaff(conn, STAFF.mechanic1, async (tx) => { … });  // looks up the auth user
await asAnon(conn, async (tx) => { … });
await asServiceRole(conn, async (tx) => { … });
await withClaims(conn, claims, async (tx) => { … });  // claims, but stay the owner: for private.* helpers
await actAs(tx, claims);  // switch identity inside an open transaction
```

The helpers do exactly what PostgREST does, so they work unchanged against a
real Supabase database: set `BICII_TEST_DATABASE_URL` to an already migrated
and seeded database (for example `supabase start`'s) and the harness uses it
directly instead of cloning; tests that commit or move sequences skip
themselves in that mode (`isolatedDatabase()`): the staff concurrency file,
the workshop files that create jobs (`work-orders`, `work-order-lines`,
`workshop-concurrency`; job numbers come from a sequence), and every
short-ID test that calls `nextval` or `setval` (sequence values
are consumed even inside a rolled-back transaction, and short IDs are never
reused, so they would burn IDs in a database you keep).

`tests/db/stack.smoke.test.ts` goes one step further when the devstack is
running (`npm run db:reset && npm run devstack:start`): it signs in through
the gateway with supabase-js as `admin@bicii.test`, calls
`rpc('my_staff_profile')`, and round-trips an object through Storage with
the service key. `tests/db/photo-moves.stack.test.ts` runs the app's own
photo domain code (`src/lib/domain/attachments.ts`, loaded with
`server-only` aliased to its empty module in the db project) as mechanic2
against real Storage: moves between buckets, deletes, refused moves and
failed cleanups (a client whose Storage `remove` fails), checked by
fetching public URLs with no key; it ages objects through the devstack's
database to stand in for the sweep's 10-minute grace. Both use
`tests/db/stack.ts` and skip with a message when the gateway is not
reachable, unless `BICII_REQUIRE_STACK=1` (CI), where that fails the file.

Phase 1 helpers (`tests/db/customer-fixtures.ts`): `linkCustomerLogin`
gives a seeded customer an Auth login inside the test's transaction (no
customer has one in the seed), `customerClaims` acts as them, and
`putStorageObject` leaves the `storage.objects` row an upload would. Tests
that insert bikes consume `private.seq_short_id_b` and skip in
existing-database mode, like the short-ID tests.

Phase 3 helpers (`tests/db/workshop-fixtures.ts`, the shared workshop
fixture module that later phases extend; Phase 5's
`tests/db/reporting-fixtures.ts` builds on it): tests of the workshop
rules make their own records, so `makeCustomer`, `makeBike`,
`makeCustomerWithBike` and `makeService` insert as the owner inside the
test. The seed has workshop data too (nine jobs, categories, services: see
"Seed data" below), so a service or category a test creates needs a name
the seed does not use (active names are unique), and a count must be
scoped to the test's own job or customer. `createWorkOrder`, `setStatus`, `walkTo` (drives a received job to
any status through allowed moves), `addServiceLine`, `addManualLine`,
`voidLine` and `events` call the RPCs as whoever the transaction is;
`ownerMode` (`reset role`) returns to the owner mid-transaction and
`failsWith` / `tryAndUndo` run a call in a savepoint so one transaction can
check many refusals.

Catalogue meta tests (`tests/db/meta.test.ts`) cover every future migration
automatically: RLS enabled on every `public` table, no function in
`public`/`private` executable by PUBLIC, security-definer functions pin
`search_path`, no money-like column is `real`/`double precision`, every
numeric table column uses a domain and every numeric domain rejects `NaN`
(`money_amount`, `rate_fraction`).

**API surface** (the RLS-matrix fixture, PLAN §5): hosted Supabase grants
ALL on every new `public` table, sequence and function to `anon`,
`authenticated` and `service_role`, and the devstack's `roles.sql`
recreates those default privileges, so a migration that forgets its
explicit revoke is exposed locally exactly as it would be in production.
The meta tests then compare, for `anon` and for `authenticated`, every
function they can EXECUTE and every privilege they hold on a table, view,
materialized view or sequence in `public`/`reporting` with the allow-lists
in `tests/fixtures/api-surface.ts` (anon: empty in Phase 0; from Phase 4
SELECT on `reporting.public_items` only), and require every view an API
role can read to be `security_invoker` unless it is listed as a definer
view. anon may execute exactly `ANON_PRIVATE_FUNCTIONS` in `private`
(`private.selling_price`, which `public_items` calls as the caller) and
holds USAGE on `reporting` but never on `private`; PUBLIC holds nothing on
either schema. A new RPC or table means a new line in that fixture, in the
same PR.

### Devstack commands

| Command | What it does |
|---|---|
| `npm run devstack:setup` | Download/build PostgREST, Supabase Auth, Node 24 and Supabase Storage into `~/.cache/bicii-devstack` (`BICII_DEVSTACK_CACHE`). Idempotent. |
| `npm run db:reset` | Drop and rebuild the dev database (`bicii_dev`): roles → Auth → Storage → migrations → seed. |
| `npm run db:migrate` | Apply only pending app migrations. |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` (`-- --fresh` builds a throwaway database first). |
| `npm run devstack:start` / `stop` / `status` | Auth :9999, PostgREST :3001, Storage :5000, gateway :54321; pids and logs in `.devstack/`. `start` builds the database if it does not exist yet, and restarts services that were started against a different database. |
| `npm run devstack:env` | Write `.env.local` with the gateway URL and the local anon/service keys (what the app reads). The scripts and tests never read `.env.local`: `DATABASE_URL` / `PG*` come from the shell. |

## What is tested where

### Unit (SPEC §27.1)

- `money.ts`: formatting and display arithmetic in decimals; no float paths.
- Cult Commons formula reference implementation in TS (used only for display
  previews) agrees with a fixture table that is also run through the database
  generated columns: services (cost 0), parts, consignment, combined job,
  negative yield (loss, share 0), and rate change over time.
- Appointment slot generation from shop hours + closures + capacity (pure
  function mirrored from the SQL, tested against the same fixtures).
- Publication state machine transitions.
- Permission resolution (`admin` implies all; inactive staff has none).
- Label template rendering (QR payload is exactly the public URL).
- Shopify payload mapping (variant → product; unmapped → structured error).
- Short ID formatting and scanner URL parsing.
- Phase 1 (M1.2): photo downscale sizing (`fitWithin`: longest edge 2048,
  never upscaled, never 0px) and photo type detection by MIME type or
  extension (`images.test.ts`); list search params (`readQuery`,
  `readFlag`, `withParam`); customer naming (mirror of
  `private.customer_label`), `tel:`/`mailto:` links; search grouping and
  bike naming; recent searches in `localStorage` (dedupe, cap, malformed
  data, storage that throws); photo bucket/path/visibility rules incl.
  PLAN D13 (`attachments.test.ts`); client UUIDs without
  `crypto.randomUUID`; the upload-progress fetch (`upload-progress.test.ts`,
  fake XHR); `SegmentedControl` disabled segments and the toast action.
- Phase 3 (M1.3): the status machine mirror (`workshop.test.ts`:
  `transitionRule`, open/closed statuses, D20 overdue at exactly 7 × 24 h);
  Cult Commons previews (`cult-commons.test.ts`) over the shared fixture
  table `tests/fixtures/cult-commons.ts` (SPEC §10 examples, loss, half-up
  and per-line rounding, another rate, the D1 job); every P0001 code, and
  every named check and unique index in `supabase/migrations`, mapped in
  `db-errors.ts` (`db-errors.test.ts` reads the migrations), a check
  re-raised without its row still mapped by constraint, and 22003. Step 3:
  status labels, tones, board groups (every status in exactly one),
  `allowedTransitions` equal to `transitionRule` with reopen/cancel kinds,
  `primaryActions` only ever allowed no-reason moves (`workshop.test.ts`);
  `describeEvent` for every `work_order_event_type`
  (`workshop-timeline.test.ts`); the intake draft (de)serialiser and its
  guarded storage, and a restored draft pruned of archived services and
  inactive staff with a sentence saying so (`intake-draft.test.ts`); job
  photos never public, D19
  (`attachments.test.ts`); `CustomerSheet` / `BikeSheet` hand a new record
  to `onCreated` instead of navigating, and navigate as before without it
  (`record-sheets.test.tsx`, actions mocked). Review fixes: the status
  row disabled for 400 ms after each status change, Collected confirmed in
  a second step (job and customer named, focus on Back, confirm armed after
  400 ms), the Change status sheet with nothing pre-selected and its submit
  hidden while a cancel reason is open, "Keep job" beside "Cancel job"
  (`job-status-actions.test.tsx`, action mocked); the timeline saying when
  earlier events were left out (`job-timeline.test.tsx`); decimal
  quantities and fraction-keeping steppers (`number-input.test.tsx`);
  `ChipRadioGroup`'s single Tab stop and Arrow / Home / End
  (`chip.test.tsx`).
  Step 4: the board's filters from the URL (`workshop.test.ts`: defaults,
  every filter read, unknown views, groups, statuses, dates, ages and limits
  dropped, job numbers however typed, `boardQuery` round-trips and leaves
  defaults out), the Singapore check-in presets and the Over 3 days /
  Overdue windows (`checkedInSince`, `checkedInBefore`, the overdue window
  agreeing with `isOverdue`),
  `groupBoardJobs` and `visibleGroups`; Cult Commons rates typed as
  percentages (`cult-commons.test.ts`: `percentToRate` exact to 4 dp and
  refusing anything else, `formatRate`, `classifyRates` current / scheduled /
  past / cancelled as `private.cult_commons_rate_at` reads them);
  `shopDayStart`, `fromShopLocal`, `toShopLocal` (`dates.test.ts`); jobs in
  search (`search.test.ts`: an exact J- number puts Jobs first, `/jobs/{id}`).
- Phase 4 (M1.4) app: the stock display helpers (`inventory.test.ts`:
  `stockTone` danger at 0 or with a location below zero, waiting at the
  reorder point; `stockLabel` and `signedQuantity` with a real minus sign;
  unit status and publication labels and tones; `movementLabel` incl.
  transfer in/out and "Returned from job"; the movement filters;
  `defaultLocation` = active, sort order, then name, like
  `add_inventory_line`; `adjustmentPreview`; the D23 `overdrawWarning`);
  the action schemas and history wording (`inventory-forms.test.ts`:
  part quantities 1..999, adjustments never 0 and within ±100,000,
  Damaged only removing, a cost only on stock added, money parsed to
  fixed-point strings, required and capped reasons, transfers between two
  locations, blank optional fields to null; product and unit events read
  without ever a cost, "Sold when J-… was completed" / "Back on hold: J-…
  was reopened"; the D25 reopen note); products and units in search
  (`search.test.ts`: `/products/{id}`, `/units/{id}`, an exact SKU puts
  Products first); stock photos offer Internal and Public only
  (`attachments.test.ts`); the Inventory tab active on `/products` and
  `/units` (`auth-helpers.test.ts`); stock events in the timeline
  (`workshop-timeline.test.ts`: "Used 2 × Road inner tube (P-000003) from
  Shop floor", "Returned … to Shop floor", no cost). No product or unit
  subtitle is rebuilt in TypeScript, so `display-parity.test.ts` is
  unchanged.
- Phase 4 Step 4: `hrefForRecord` (`ids.test.ts`: B/J/P/U to their pages,
  C, PO and S null until Phases 6 and 7, every kind covered);
  `interpretScan` (`scan.test.ts`: bare IDs in any case, the public QR URL
  of each accepted base, the Admin's own /q URL, other hosts and paths,
  `http` against an `https` base, javascript:, data:, file: and Wi-Fi
  codes, empty input, all foreign; `truncateScan`); the publication card's
  buttons (`inventory.test.ts`: `publicationActions` names every manual
  move, a sold product offers only Archive listing and nothing offers
  Sold, a unique product without an available unit has no Publish;
  `publicationChecklist`, `missingRequirements`,
  `publicAvailabilityLabel`); the header jump (`search.test.ts`:
  `shortIdJump` opens an exact short ID in any case through /q, anything
  else goes to the results); the camera states (`camera.test.ts`:
  getUserMedia errors to denied / insecure / unsupported / failed, Phase
  0's messages kept).

- Phase 5 (M1.5) app: shop days for people (`dates.test.ts`: today
  flips at 16:00:00Z, `shopDayToDate` is noon Singapore time and reads back
  as the same day in any zone, `formatShopDay` "Sat, 3 Oct 2026",
  `formatShopDayLong`, `formatShopDayShort`; `parseShopDay` and
  `shiftShopDay` from step 2, plus years 0001-0099 read as themselves,
  `shiftShopDay` across the 0100/0099 boundary and refusing a result it
  could not parse back, and `EARLIEST_SHOP_DAY`); the Today DTO and wording (`reports.test.ts`:
  `toTodayDashboard` for every permission combination: no money without
  View financial reports, money without costs for it alone, costs never
  shown when the flags say hidden, no snapshot on a past day, the Phase 2/6
  placeholders null until tracked and their values once filled, losses and
  cost-pending counts carried; the loss and provisional notes
  with a real minus sign; `formatRateRange` "30%" / "25–30%";
  `exceptionCopy` for every D34 kind (overdue in the danger tone, as
  everywhere else), the overdue sentence from `OVERDUE_AFTER_DAYS`, an
  unknown kind rendered generically; `exceptionKeys` unique for a product
  below zero at two locations; `exceptionsShownNote`;
  `exceptionHref` (a line opens its job through `/q`); `weekStrip` exactly
  seven days oldest first with quiet and missing days; `TILE_LINKS` naming
  only `BOARD_GROUPS` ids and parsing back through `parseBoardFilters`;
  `groupEntries`, `documentHref`); the job yield panel
  (`totals-summary.test.tsx`: sale only without view_costs even if a report
  were passed, Phase 3's summary without a report, the rate range over the
  shared rate, the loss note, "Counted in reports on Sat, 3 Oct 2026
  (completed)", "once the job is completed" and, on a cancelled job, "Not
  counted in reports (cancelled)"); Today's components
  (`today-components.test.tsx`: StatTile's placeholder reads exactly
  `NOT_TRACKED`; MoneyTile keeps the amount on one line with the code
  free to wrap, sized by `moneySizeClass` smaller for longer amounts and
  never below 1rem; ExceptionList renders two negative_stock rows for one
  product without a duplicate key and says "Showing the N most urgent of
  M" only when capped; AdjustmentList puts significant ones first, lists
  `ADJUSTMENT_ROWS` and puts the rest behind "Show N more"). E2E
  (`today.spec.ts`) also checks that every visible box in each Money tile
  stays inside the tile's padding at the project's size, 1024 × 1366 and
  390 × 844 (the page never scrolls sideways, so nothing else catches a
  figure running into the next card), that "Right now" says "Awaiting
  collection", and that a `?day=` before `EARLIEST_SHOP_DAY` shows today.

### Database (SPEC §27.2 and §23)

Each invariant from SPEC §23 has at least one test, named after it:

| Invariant | Test |
|---|---|
| Unique unit cannot be sold twice | `record_retail_sale` twice on one unit → second raises; one `sold` movement. |
| Stock-consuming line consumes once | call `add_inventory_line` with the same idempotency key twice → one line, one movement; concurrent calls (two connections) → one movement. |
| Void creates reversal, never deletes | `void_line` → original movement intact, one `reversal` row with `reversal_of_id`; second `void_line` → no-op. |
| Duplicate Shopify webhook has one effect | insert the same `integration_events` twice (unique violation) and call `process_shopify_order_paid` twice → one sale, one movement per line. |
| Snapshots do not change with catalog edits | add service line, update `services.default_sale_price` → line totals unchanged. Phase 3: `update_service` price, cost and name → the earlier line keeps 180.00/20.00/"Full Service", the next one uses the new values. |
| Sale liability ≠ settlement | sell a consigned bike → `consignor_ledger.outstanding = agreed_amount_owed`, `paid = 0`. |
| Settlement cannot exceed owed | `record_settlement` over-allocating without override → raises; with override by `manage_consignments` → succeeds and stores reason. |
| Customers cannot read internal data | as customer A: select from `work_order_line_items`, `products`, `inventory_movements`, `customers.internal_notes` → zero rows or column permission error; `work_order_totals` returns no cost columns. |
| completed_at ≠ collected_at | status walk → both stamped at different times; `collected` cannot precede `completed`. |
| Booking cannot exceed capacity | fill a slot to capacity → next `book_appointment` raises; two concurrent bookings for the last unit → exactly one succeeds. Also: outside hours, inside closure → raise. |
| Duplicate receipt cannot double stock | `receive_purchase` same idempotency key twice → one receipt, stock +18 once; partial then remainder → PO `received`; over-receipt → raises. |
| Manual adjustment records actor/time/reason | `adjust_stock` without reason → raises; with reason → row has `created_by`, `reason`. |
| Public QR exposes only published | `public_items` as anon: draft/internal rows absent; public row shows no cost; sold unique shows `sold`. Built in Phase 4: `inventory-publication.test.ts` (row below). |
| Archived entities stay referenceable | archive a service used on a historical job → job line still joins. Phase 3: the service, the job's bike and its customer archived → the line still joins the service and the job its bike and customer; the archived service is refused for new lines. |
| Money is numeric | information_schema check that no money column is `real`/`double precision`; money and rate domains reject `NaN` (23514). |
| Staff changes leave history (SPEC §2, §22) | each grant, revoke, deactivation, reactivation, creation, role change and rename appends exactly one `staff_events` row with its actor; replays append none; deactivation without a reason raises `reason_required`; `staff_events` refuses update/delete (`staff-history.test.ts`). |
| Staff rules hold for every writer | no direct staff writes for API roles; staff.email must equal the login's email even for the owner; nobody signed in deactivates their own row; a manage_staff holder grants only permissions they hold, never manage_staff, never on themselves or admins (PLAN D11). |
| RLS: customer A cannot read B | bikes, appointments, work orders, attachments. Phase 1 (`customer-access.test.ts`): a signed-in customer reads zero rows from every base table; `my_customer_profile`, `my_bikes`, `my_bike_attachments` return only their own rows, never `internal_notes` or `internal` photos; another customer's bike id returns nothing; PLAN D12: after a transfer the new owner sees photos taken before it and the previous owner none (also on the seeded sale), and an archived bike's photos disappear. Phase 3: a signed-in customer reads nothing of their own job (job, assignments, events, lines, line and totals views, services, categories, rates) and cannot call the workshop RPCs (42501); their projection is tested in `workshop-customer-access.test.ts` (row below). |
| Ownership changes preserve history (SPEC §5) | `transfer_bike_ownership` appends one event with actor, reason and correlation ID and leaves earlier events untouched; empty/blank reason → `reason_required`; replay → no event; plain updates of `customer_id` refused (42501 for staff, `reason_required` for the owner); events append-only; concurrent transfers form one chain (`customers-bikes.test.ts`). |
| Stable physical identity | bike short IDs are server-assigned `B-######`, increasing, unique, never client-supplied (42501) and immutable (`bike_short_id_immutable`). |
| Storage enforces visibility (SPEC §8) | `media-internal`: anon, customers and inactive staff read/write nothing, active staff read and add; `media-public`: only active staff read or list it through the API, only staff add; nobody overwrites; staff delete only objects no attachment points at (`media-storage.test.ts`); live signed-upload round trip with anon download refused, a bare Storage remove of a recorded photo refused, `delete_attachment` replay is `[]` (`stack.smoke.test.ts`). |
| Attachment visibility move (PLAN Phase 1) | The app's own domain code against real Storage (`photo-moves.stack.test.ts`): internal → public → internal → deleted, a stranger's fetch of the public URL succeeding only while public and the original removed each time; refused moves (customer record, undecoded original) copy nothing; a failed cleanup reports `cleanupPending`, Finish removes the leftover, and a leftover nobody finishes is swept when the record is shown. E2E does the same through the viewer. |
| Lists and search name records alike | `customerLabel` (TypeScript, used by table-backed lists) equals `private.customer_label` for every fallback case, and `bikeTitle`/`bikeSubtitle` equal `staff_search`'s title and subtitle for every seeded bike (`display-parity.test.ts`). |
| Attachments describe real objects | `record_attachment` rejects a path that is not `{entity_type}/{entity_id}/{id}.{ext}`, a missing object, the wrong bucket, a non-photo, an unknown entity; replay-safe; delete needs a reason and is kept in `attachment_events`; an undecoded original (no dimensions) is never public; `attachment_stray_objects` lists only what no row points at and is old enough (`attachments.test.ts`). |
| Anonymous cannot read costs/notes | every table in the RLS matrix: anon select returns 0 rows or is denied. |
| Mechanic permission boundaries | staff without `view_costs` cannot select cost columns; without `adjust_stock` cannot call `adjust_stock`; admin can. Phase 3: mechanic2 `select cost_total` / `unit_direct_cost_snapshot` / `cult_commons_share` / `*` on `work_order_line_items` → 42501, `work_order_line_items_staff` and `work_order_totals_staff` → 0 rows, `work_order_totals` → sale columns only; mechanic1 sees costs, yield and Cult Commons. |
| Consignment sale yields correctly | $1,000 sale, $500 owed → yield 500, CC 150. |
| Cult Commons rate snapshot | insert a new rate effective tomorrow; lines today use 0.30, lines after use the new rate; old lines unchanged. Phase 3 (`work-order-lines.test.ts`): a rate scheduled for tomorrow leaves today's lines at 0.30; an owner-inserted 0.25 rate effective now gives the next line 0.25 while the earlier line keeps 0.30. |
| Cult Commons is 30% of positive yield after direct costs (SPEC §10, D1) | every row of `tests/fixtures/cult-commons.ts` through `add_manual_line` equals the generated columns (rates other than 0.30 through an owner-inserted rate row), and both job fixtures equal `work_order_totals_staff` (the D1 job: 180.00, not 171.00); the same table runs through `src/lib/cult-commons.ts` in the unit project. |
| Cult Commons rates are effective-dated and append-only (D21) | `workshop-catalog.test.ts`: the base 0.3000 row from 1970 ships with the migration; `cult_commons_rate_at` at, just before and before any rate (`cult_commons_rate_missing`); UPDATE/DELETE refused for the owner too; schedule/cancel admin only (view_costs is not enough), never backdated (`rate_backdated`), duplicate start 23505; cancelling a future rate restores the previous one, replays, frees its start time; a rate in effect cannot be cancelled (`cult_commons_rate_in_effect`), not even by the owner, and nobody un-cancels. |
| Services' costs are gated (SPEC §4.2, D14) | mechanic2: `select default_direct_cost` / `select *` from `services` → 42501, `services_staff` → 0 rows; mechanic1 and admin read costs; create/update/archive need manage_inventory; a cost needs view_costs (null on update keeps it); a manage_inventory holder without view_costs making `update_service` fail a check (negative price, blank or long name, long description) gets 23514 with the constraint and no DETAIL, never the stored cost; replay by id, `service_conflict`, `category_kind_mismatch`, active-name uniqueness and reuse after archive; categories: staff read, manage_inventory writes. |
| Work order status machine (D15, D16) | `work-orders.test.ts`: `private.work_order_transition_rule` equals `transitionRule` (src/lib/workshop.ts) for all 121 pairs; `set_work_order_status` accepts exactly the allowed 110 off-diagonal pairs (a fresh job driven to each from-state, each move tried in a rolled-back savepoint) and refuses the rest with `work_order_transition_invalid`; reason-required moves refuse a blank note; the trigger alone (the owner's direct UPDATE, which the RPC's own checks never reach) refuses the same 110 pairs the same way and a reopen or cancel without `private.set_change_reason` (`reason_required`); the 11 same-status calls are replay no-ops (row unchanged, no event); reopen needs a reason, clears completed_at/ready_for_collection_at, keeps started_at and the earlier `completed` event; cancel needs a reason and no live line (`work_order_has_lines`, also for the owner); stamps, number, customer, bike, check-in time and lead are immutable without the proper path (`work_order_immutable`); `appointment_id` is linked at most once (Phase 2 extension point: null → a value succeeds once with no event and nothing else changed, leaving it equal is a no-op, another value or null → `work_order_immutable`, also when `private.create_work_order` stored it at check-in); backwards `status_changed_at` is 22023. |
| Check-in is atomic and replay-safe (SPEC §2, §7.1) | `create_work_order` writes the job (J-######, increasing), `checked_in`, assignment and `line_added` events in that order with actor, auth user and the request's correlation ID; a bad service line rolls everything back and the burned number is never reused; replay by id returns the same row with no new event, line or assignment, even after the bike changed hands, the customer was archived and the job completed (and burns no number); another bike under the same id → `work_order_conflict`; archived customer/bike, D18 `bike_owner_mismatch` (shop bikes accepted), blank requested work, customers and inactive staff refused; no direct writes. |
| Timeline events carry no costs (SPEC §7.3, §4.2) | one event per action with its documented payload; no-ops write nothing; `add_work_order_note` replays on its note id (same event back, `note_conflict` on another job); `set_approval_flag` with a null note keeps the stored note, '' clears it; after a full scenario with a manual line costing 62.00 (sold at 95.00), a recursive walk of every payload finds no key matching /cost\|yield\|cult\|commons\|rate/i and no value equal to 62, while 95 appears; `work_order_events` refuses UPDATE/DELETE for the owner (`work_order_history_append_only`); `work_order_timeline` names actors and assignment subjects, newest first, clamps max_rows to 1..2000. |
| Assignments (D22) | one active lead per job; a new lead closes the previous lead's row (not demoted); additional → lead switch; replay no-op; unassign returns null on replay; `staff_inactive`; `work_order_closed` on collected/cancelled jobs; `lead_mechanic_id` equals the active lead after every operation; rows are immutable except closing once (`assignment_immutable`). |
| Job photos are never public (D19) | `record_attachment` on a job writes `photo_added`; `delete_attachment` writes `photo_removed` with the reason; unknown job P0002; `product` and `inventory_unit` accepted from Phase 4 (unknown → P0002), `consignment_item` still unsupported; public via `record_attachment` or `set_attachment_visibility` → `attachment_work_order_never_public`; CHECK `attachments_work_order_never_public` exists. |
| Lines (D14, D15) | `work-order-lines.test.ts`: sale-price overrides by anyone, cost overrides only with view_costs (42501); a manual line with no cost (mechanic2's always, an admin's left empty) is `cost_pending` with cost 0 while one with cost 0 entered is not, `work_order_totals_staff.cost_pending_count` counts the live ones and drops a voided one once it is re-added with its cost, the flag is immutable for the owner and the CHECK keeps it to costless manual lines; mechanic2's bad quantity or price on `add_service_line` / `add_manual_line` / `create_work_order` services gets 23514 with the constraint and no DETAIL (the service's cost never appears); inactive/archived service `service_unavailable`; quantity 0/10000/negative price 23514, NaN quantity refused, overflowing totals 22003; lines locked once completed (`work_order_locked` for a new add and for void) and unlocked after reopen; replays of add_* after completion return the original id with no new event; void needs a reason, keeps the row, replays without a second event and leaves the totals; owner edits, un-voids and deletes → `line_immutable`; Phase 4: voiding an inventory line writes its linked reversal and restores stock (`line_type_unsupported` is gone); same line id on another job or type → `line_conflict`; line and service RPCs return ids only. |
| Workshop concurrency (SPEC §25, D18, D22) | `workshop-concurrency.test.ts` (committed, real connections): same-id check-ins → one job, one `checked_in`; a check-in waiting on a bike being transferred fails with `bike_owner_mismatch`; a transfer is still pending (and waiting on a lock in `pg_stat_activity`) while a check-in holds the bike, and succeeds once it commits; two leads at once → one active lead mirrored on the job; a line racing completion is either before `completed_at` or refused with `work_order_locked` (both orders and a free race); same line id twice → one line, one event; two collections → one `collected`; two voids → one `line_voided`. |
| Customer job projection (SPEC §4.2, §23; D8, D17, D19) | `workshop-customer-access.test.ts`, on the seeded jobs: a signed-in customer reads 0 rows from `work_orders`, `work_order_assignments`, `work_order_events`, `work_order_line_items`, `services`, `categories`, `cult_commons_rates`, `work_order_totals` and the three `_staff` views; `my_work_orders` returns exactly their non-cancelled jobs newest first (Tan: J-000001, not the cancelled J-000008) with exactly the documented keys and the coarse status (Priya's diagnosing J-000009 reads `received`, its voided line out of the total); `private.customer_job_status` maps all 11 statuses; `my_work_order_lines` has exactly description, quantity, unit price, total, currency and id, live lines only; `my_work_order_timeline` is check-in plus customer-status changes only (received → diagnosing, notes, approvals, assignments, lines and in_progress ↔ paused add nothing; completing and reopening do) plus customer photos still on the job (internal, re-hidden and deleted ones absent); `my_work_order_attachments` never internal; cancelled jobs and another customer's job return nothing; D17: after a transfer the previous owner keeps the job and the new owner does not see it (also on the seeded Bianchi sale), a job on a bike archived afterwards is still listed; staff without a customers row and archived customers get nothing; anon is refused (42501). |
| Jobs in staff search (SPEC §7.2, §20) | `staff-search.test.ts`: "J-000004", "j000004", "J000004" rank 1.0 with Chloe's Giant as title, "customer · requested work" as subtitle and the job number as short_id; "000004" contains-match at 0.6; at least three characters; cancelled and collected jobs found; the kinds filter keeps jobs in or out; `archived = true` returns no jobs; an unknown kind is 22023 (`supplier` since Phase 4 made `product` known). |
| The seed's timelines read true (TESTING "Seed data") | `workshop-seed.test.ts`: J-000001…J-000009 with their customer, bike, status, lead (= the active lead assignment) and stamps at their exact offsets from check-in; J-000001/J-000002 totals exactly as documented through `work_order_totals_staff`; J-000009's voided line out of its total; exactly one D20-overdue job at seed time (J-000006, through `isOverdue` with `now` pinned to J-000007's check-in, so an existing seeded database that has aged still passes); for every job: events in id order strictly increasing in time, exactly the expected events by type, nothing but J-000007 stamped within 30 minutes of the seed, every trigger-written actor equal to the row's `created_by` / `assigned_by` / `voided_by` and every status change by the job's lead, costed lines added by a view_costs holder, no line event after completion; J-000007 checked in after the Bianchi's `transferred` event. |
| Stock-consuming line consumes once (Phase 4) | `inventory-ledger.test.ts` "a stock-consuming work-order line cannot consume inventory twice": a replay of `add_inventory_line` → one line, one `job_consumption`, stock decremented once, `replayed = true`, also after completion; the same line id with other arguments or on another job → `line_conflict`; concurrent (committed) for a quantity part and a unique unit → one line and one movement, the second call `replayed = true`. |
| Void creates reversal, never deletes (Phase 4) | `inventory-ledger.test.ts`: original intact, one `reversal` with `reversal_of_id`, stock restored, `stock_reversed` and `line_voided` once each, second void a no-op, two concurrent voids one reversal; "voiding is never blocked by publication rules" (photo removed and price cleared after the sale, then reopen and void → unit available, product public). `work-order-lines.test.ts` proves the same through Phase 3's void path. |
| Unique unit cannot be consumed or sold twice (Phase 4) | `inventory-ledger.test.ts`: a unit on a line, written off or held → `unit_not_available`; one unit on two jobs at once → exactly one succeeds; ledger sum per unit in {0, 1}; owner forgeries (a second +1, a location change without a movement, +1/−1 across locations for a sold unit, a linked bike that does not point back, an in-stock unit whose bike a customer owns) → `unit_ledger_inconsistent` at `set constraints all immediate`. Every ledger test ends with `assertLedgerConsistent`. |
| Parts on jobs (D23-D25, D27, D15, D16) | `inventory-ledger.test.ts`: consumption may go negative and shows in `low_stock` with `negative_locations` (also when the total stays positive), manual changes never go below zero; `part_price_missing`, `part_cost_missing`, the default price is `private.selling_price` (unit over product), an override wins, `cost_pending` false; customer-owned and consigned stock → `ownership_not_saleable`; held on add, available after a void, sold at completion with `sold_at = completed_at` (cause `job_completed`); adds and voids on completed or ready jobs → `work_order_locked`; complete → reopen → void (held, no movement, product stays sold, then reversal and public); complete → reopen → re-complete (sold again, one consumption); complete → `transfer_bike_ownership` to the buyer → reopen refused with `bike_with_customer` (unit stays sold, `sold_at` kept, product sold), after the bike returns to the shop reopen → void works (D29); `void_line` on a unit whose bike has a customer (forged) → `bike_with_customer`; cancel with a live part → `work_order_has_lines`, after the void it succeeds; committed races: add vs complete, add vs cancel, two jobs selling a product's last two units at once → `sold`. |
| Manual adjustment records actor/time/reason (Phase 4) | `inventory-ledger.test.ts` "every manual stock adjustment records actor, timestamp and reason": null/blank reason → `reason_required`; `created_by`, trimmed reason, `created_at`; damaged positive → `quantity_invalid`; other types → `movement_type_not_manual`; `insufficient_stock`; request-id replay and `request_conflict`, concurrent same request → one movement; mechanics 42501, admin succeeds; a unit cost needs view_costs. Write-off replays by request id, no-op when already written off, again after a restore; transfers pair rows by request id, `insufficient_stock`, `transfer_same_location`, concurrent draining → one succeeds, unit transfers move the unit (`moved`), held units refused. |
| Current stock is derivable from the ledger (Phase 4) | `inventory-ledger.test.ts`: `reporting.stock_levels` equals the per-product/location movement sums after transfers, parts, voids and damage; seeded `low_stock` is P-000009, P-000008, P-000012 by shortfall; `product_stock` totals. Snapshots do not change when product and unit prices and costs change; the ledger and both histories are append-only for the owner too; an archived product keeps its movements and lines. |
| Catalog, cost gating and boundaries (Phase 4) | `inventory-catalog.test.ts`: P-/U- IDs server-assigned, increasing, immutable; `tracking_type` immutable; SKU unique ignoring case and punctuation; manage_inventory needed for products and locations; mechanic2 cannot select any cost column (42501), the cost views return nothing to them and rows to mechanic1/admin (product 02: yield 37.00, Cult Commons 11.10); the invoker cost-write guards refuse direct cost writes without view_costs, including a write of the stored value or null (no equality oracle), and let mechanic1 and the owner through; publication requirements, slug and `item` fallback; archive rules (`product_published`, `product_has_stock`, `unit_in_stock`, `location_has_stock`); `bike_in_stock` for transfer and archive until the unit is written off, `bike_has_owner`, `bike_already_linked`; anon denied and customers read zero rows on every stock table and view; event payloads exact, with actor, never a cost key or value (product, unit and work-order events); the publication and unit-status matrices equal `src/lib/inventory.ts` for all 25 and 36 pairs. `attachments.test.ts`: product and unit photos internal/public, never customer (`attachment_stock_never_customer`, CHECK backstop). |
| Public QR pages expose only explicitly published records (Phase 4, SPEC §23) | `inventory-publication.test.ts` "public QR pages expose only explicitly published records": as anon, `reporting.public_items` has no draft, internal_only or archived product and no unit of an unpublished product (unknown and unpublished short IDs equally absent); its columns equal the documented list exactly (no cost, serial, SKU, internal note or location; a unit's cost and serial never appear in the rows); `sale_price` equals `private.selling_price` for product and unit rows and follows a price change; a product row shows only its public photos, oldest first, as `{bucket, path, width, height, caption}`; a unit row shows the unit's, then the product's, then the bike's; held units and their product read `unavailable`, a sold unit and its product `sold`, a quantity product without stock `sold_out`; a written-off unit and every unit of a sold-then-archived product are absent; a linked bike's photos created before `sold_at` appear and those at or after it never do; a bike photo taken after the first handover to a buyer stays hidden after the bike returns to the shop and the job is reopened and completed again (D29); signed-in customers and staff see the same rows; anon calling `private.selling_price` directly gets 42501. |
| Publication by hand (Phase 4, D26) | `inventory-publication.test.ts` "set_publication_status": for quantity products and unique products with and without an available unit, from every state, the targets the RPC accepts equal `manualPublicationTargets` and every refusal has its code (`publication_transition_invalid`, `publication_sold_by_sale`, `publication_requires_available_unit`); a manual `sold` and sold → public/internal_only refused, sold → archived allowed; a unit registered on a sold product restores it to public (`publication_changed` {sold → public}, both rows `available` to anon), so 'sold' with an available unit is unreachable and skipped in the matrix; same status is a no-op without an event; `publication_requires_photo` (none, or internal only) and `publication_requires_price` (a unique product with no price on product or unit); the slug is assigned once and survives unpublish, rename, archive and republish, `item-p-…` for a name without letters or digits; `publication_changed` events carry `{from, to}`, the actor and the trimmed reason; `reason_too_long`; mechanic1, mechanic2 and anon 42501; unknown product P0002. |
| Split to a unique item (Phase 4, D28) | `inventory-split.test.ts`: the source loses one at the location and a draft unique product (name, description, brand, category and currency from the source; price from the source unless given) gets an available shop-owned unit there, both costs equal the source's default cost (read through the cost views as the admin), one `stock_adjustment` each side with "Split to U-…: reason", cost snapshot and request_id = unit id, `created` event with actor and reason; replay with the same ids returns the same result with one pair of movements, a reused unit or product id is `unit_conflict`; `insufficient_stock` (empty or other location), `location_inactive`, `product_not_quantity`, `product_archived`, `ownership_not_saleable`, `reason_required`, `reason_too_long` (> 480), a blank name 23514 without DETAIL; needs both adjust_stock and manage_inventory (42501 otherwise, anon too); mechanic2 with both but no view_costs splits and the carried costs equal the source's while their direct cost UPDATEs on the new product and unit are 42501; committed concurrency: the same unit id twice → one result, one pair of movements; two splits racing for the last item → one succeeds, the other `insufficient_stock`. |
| Products and units in staff search (Phase 4) | `staff-search.test.ts`: the SKU typed as "shi l05a rf", "shil05arf" or in mixed case finds P-000001 at rank 1.0 with subtitle "SHI-L05A-RF · Shimano · 34 in stock"; SKU contains (≥ 3 characters) 0.7; exact P- and U- IDs rank 1.0 with or without the dash; name and brand words 0.45-0.85; on-hand from the ledger across locations (road tube 60), "Unique item" for unique products, "Inactive" appended for an inactive product; units by exact serial (1.0), part of it (0.7) and product-name words, subtitle "Available · Shop floor · S/N …"; the shop Brompton's serial finds both the bike and its unit at 1.0; the archived chain and an archived unit are left out and are the only hits with `archived = true`; "brompton" across all kinds adds products P-000005, P-000014 and unit U-000002 (the bike assertion is scoped to `['bike']`); 'product' and 'inventory_unit' are known kinds. |
| Cult Commons end to end (Phase 5; SPEC §10, §31; D1) | `reporting.test.ts` "Cult Commons is 30% of positive yield after direct costs, per line": every `LINE_FIXTURES` row on its own job completed on its own isolated `TEST_DAY` equals the line's generated columns, its `financial_lines` entry (owner) and `daily_summary(day, day)` (admin); every `JOB_FIXTURES` row equals `work_order_yield` and the day's totals; the seeded loss-line job's Cult Commons is 12.00, not 7.50 (the Phase 5 fixture rows run through `cult-commons.test.ts` and `work-order-lines.test.ts` too). |
| Negative yield never pays negative Cult Commons (Phase 5; SPEC §10; D32) | `reporting.test.ts`: as owner, every `financial_lines` entry's share is ≥ 0 and equals its line's share, `is_loss` matches the line's yield; every `daily_summary` row has `cult_commons_share` ≥ 0 and `loss_total` ≤ 0; a day with two loss lines and a 40.00 line: CC 12.00, yield −5.00, loss −45.00. |
| Reports derived, never a second truth (Phase 5; SPEC §19.2) | `reporting.test.ts`: `reporting` holds views only (also `meta.test.ts`); over three test days with service, part, voided-part, collected, cancelled and open jobs, `daily_summary` money equals Σ `financial_lines` by day (both admin RPCs), each job's entries equal `work_order_totals_staff` and `work_order_yield`, the `jobs_*` counts equal the `work_order_activity_on` rows with the matching `*_on_day` flag, parts consumed/returned equal ledger sums, an empty day is a zero row and the placeholder columns are NULL; catalog price/cost edits and archiving the service leave the days and entries unchanged (snapshots). |
| Only completed jobs recognised; reopen restates (D32) | `reporting.test.ts`: open jobs, cancelled jobs (lines voided first, D16) and voided lines have no entry; a line added on one day of a job completed on the next is recognised on the completion day; 23:59 vs 00:01 SGT land on consecutive days; adds and voids on completed, ready and collected jobs → `work_order_locked` (RPC and owner); complete → reopen (the earlier day drops by exactly the job, no entry left) → void one line, add another → complete: the new day has exactly the current live lines once each, `started_at` kept, two `completed` events and one `reopened`. |
| Completion recognised once (replay, concurrency) (Phase 5) | `reporting.test.ts`: a second `set_work_order_status(…, 'completed')` returns the row unchanged, no event, one entry per line. `reporting-concurrency.test.ts` (committed): two connections complete the same job; the second waits on the row lock and gets the unchanged row; one `completed_at`, one `completed` event, one entry per line, today's sales rise by the job's sale once; a third reader before the commit sees the old totals. |
| Shop-day boundaries (D35) | `reporting.test.ts`: `completed_at` 2025-06-01 15:59:59Z → 2025-06-01, 16:00:00Z → 2025-06-02; `daily_summary` inclusive on both ends; identical results under `set local timezone` UTC and America/Los_Angeles; `shop_today()` = Singapore's date of `now()`; no reporting view or Phase 5 function contains `current_date`. |
| Financial reports gated (D30) | `reporting-access.test.ts` "Mechanic permission boundaries" and "Customers cannot read internal data": mechanic2 → `financial_lines` / `work_order_yield` 42501, counts with every money column NULL (`can_see_financials` false), `value_at_cost` NULL; mechanic1 (view_costs) → `financial_lines` 42501, `work_order_yield` works, summary money NULL; mechanic2 + view_financial_reports → rows and gross sales with every cost column NULL (`can_see_costs` false); admin → everything; customers, anon and inactive staff → 42501 from all seven RPCs; selecting the four Phase 5 reporting views as anon or authenticated → 42501. |
| Today flows vs snapshot (D31) | `reporting.test.ts`: inserting a job with today's check-in, start, line and completion raises today's flows by exactly those milestones and the money by its line; the `*_now` counts equal direct status counts grouped as `BOARD_GROUPS`, D20 overdue via `isOverdue` and `low_stock` rows; a past day has `is_today` false and every `*_now` NULL; tomorrow → `report_range_invalid`. Range rules: `daily_summary` from > to and 367 days raise, 366 pass; `financial_lines` 31 pass, 32 and from > to raise; null bounds mean today. |
| Significant adjustments (D33) | `reporting.test.ts`: `private.is_significant_adjustment` cases (−6, +5, −1, 4 × 24.99 vs 4 × 25.00, a unit, 2 × 60.00, non-adjustment types false); `stock_adjustments_on(TEST_DAY)` over owner-inserted movements returns the day's six (00:00 and 23:59:59 in, the neighbouring days out), newest first, with `significant`, `actor_name` and `reason` for mechanic2 and `value_at_cost` NULL; the admin sees \|delta\| × unit cost (snapshot, else product default, else 0). |
| Operational exceptions incl. 7-day overdue boundary (D34, D20) | `reporting.test.ts`: an open job checked in exactly `OVERDUE_AFTER_DAYS` days ago is not `overdue_job`, one second earlier is; a collected job checked in 30 days ago is neither; `work_order_activity.is_overdue` equals `isOverdue` for the same rows; a ready job completed 7 shop days ago is `uncollected_job`, 6 days ago not; a forced negative on-hand is `negative_stock` (danger, all danger rows first); an owner-held unit with no live line is `unit_hold_stale`, a unit held by `add_inventory_line` on an open job is not; a completed USD job's line is `currency_mismatch` and out of the day's totals; `exceptions_now` equals the row count; max_rows clamped to 1..200. |
| Seeded history reconciles (Phase 5; SPEC §10 examples, SEED_DAYS) | `reporting-seed.test.ts` (reads only; days counted back from the seed's anchor, `seedToday()`): H1–H4 (and H5's rounding) through `work_order_yield` (admin) and Σ `financial_lines(anchor−6, anchor)` per job equal `SPEC_EXAMPLE_JOBS` / `ROUNDING_JOB`, recognised on their days, H4's CC 12.00 not 7.50; `daily_summary(anchor−n, anchor−n)` equals `SEED_DAYS[n]` exactly for n = 0…6 (every column, placeholders NULL); Σ entries by `recognized_day` equal each day's money columns; every completed seeded job (Phase 3, 4, 5) has entries equal to `work_order_totals_staff` and `work_order_yield` on its completion day, open and cancelled ones none; parts consumed/returned and adjustment counts equal the ledger's sums; every seeded entry's share ≥ 0 and equals its line's (H4's tyre a loss at 0); `stock_adjustments_on(anchor−n)` gives A1–A3 as `SEED_ADJUSTMENTS` (A2 significant, `value_at_cost` NULL for mechanic2, 30.00 for the admin). When the anchor is the shop's today (else skipped with a message): `today_dashboard(null)` is the anchor, `is_today`, flows = `SEED_DAYS[0]`, the `*_now` snapshot equals direct counts and `SEED_SNAPSHOT` (exactly in a fresh per-file database, at least otherwise); `operational_exceptions` has `SEED_EXCEPTIONS` and not H5, J-000002, J-000003 or J-000005. `display-parity.test.ts`: `private.shop_timezone()` = `SHOP_TIME_ZONE`, and `work_order_activity_on`'s `bike_title` / `customer_label` equal `bikeTitle()` / `customerLabel()` for every seeded job of days 0–6. |
| Seeded ledger consistent (Phase 5) | `reporting-seed.test.ts` "The seeded ledger is consistent": every seeded inventory line has exactly one `job_consumption` movement (−quantity, cost snapshot = the line's unit cost), at the line's own time for the Phase 5 lines (J-000010's, written by `add_inventory_line`, just after); no line created at or after its job's completion; no stock level below zero and the Phase 5 products' on-hand as documented; no seeded job, line, event, assignment or movement later than `now()`, and no Phase 5 row later than J-000007's seed-time check-in. |
| Cost-pending lines flagged (D14) | `reporting.test.ts`: a `cost_pending` manual line on a completed job is recognised at cost 0 with `cost_pending` true; `today_dashboard(day).cost_pending_lines` and `work_order_yield.cost_pending_count` count it. |
| No float money in function results (Phase 5) | `meta.test.ts`: no money-named OUT/TABLE argument of a function in `public` or `private` is `real` or `double precision`; every reporting RPC compiles and answers with exactly its documented columns (`reporting.test.ts`). |

### End-to-end (SPEC §27.3)

Harness (`playwright.config.mts`, `tests/e2e/`): Chromium only, two projects
— `phone` (iPhone 13, 390 px: bottom tab bar) and `tablet` (iPad gen 7,
810 px: side rail). `webServer` runs `npm run build && next start -p 3100`
with the devstack URL and local demo keys passed explicitly (so `.env.local`
does not matter). `tests/e2e/global-setup.mts` resets and seeds `bicii_dev`
(`E2E_RESET=0` skips), starts the devstack if needed, and waits until the
seeded admin can sign in through the gateway and call `my_staff_profile`.
Tests run serially (one shared database). In this container the preinstalled
`/opt/pw-browsers/chromium` is used via `launchOptions.executablePath`
(`PLAYWRIGHT_CHROMIUM_EXECUTABLE` overrides); never `playwright install` here.

```sh
npm run test:e2e                       # build + start on :3100, reset bicii_dev, run
E2E_REUSE_SERVER=1 npm run test:e2e    # reuse an app already on E2E_PORT (3100)
E2E_RESET=0 npm run test:e2e           # keep bicii_dev as it is
```

The seed's history is relative to the day it was reset (DATA-MODEL §18
"Phase 5 part"). Global setup reads that anchor day once, from the seeded
T3 job's check-in, into `E2E_SEED_ANCHOR` ('YYYY-MM-DD'; the workers
inherit it); specs use `seedAnchor()` and `anchorDay(n)` from
`tests/e2e/helpers.ts`, never the wall clock, because with `E2E_RESET=0`,
`E2E_EXTERNAL_STACK=1` or a run across Singapore midnight the anchor is not
today.

Phase 0 specs (`auth.spec.ts`, `staff.spec.ts`): signed-out `/` redirects to
`/login`; `?next=` deep links survive sign-in and cannot leave the origin
(absolute, `//host`, `/\host`, dot segments such as `/.//host`, including
the server-side redirect a signed-in visit to `/login` makes); wrong
password gives one generic error; the admin lands on Today with the tab
bar (phone) or rail (iPad); sign-out ends the session; mechanic2 gets a
real 403 on `/settings/staff`; a permission the admin grants shows on
mechanic2's profile and in the staff history (then is revoked), and on a
phone the confirmation toast leaves the Scan tab tappable; a rejected
invite keeps the typed name and email; an invited colleague signs in with
the temporary password as active staff with no granted permissions (Today
opens; `/settings/staff` is 403), must give the current password to change
it, and when the admin deactivates them (a reason is required and shows in
their history) their open session loses access.

Phase 1 spec (`customers-bikes.spec.ts`; every record it creates carries a
tag made of the project name and a timestamp, so the phone and iPad runs and
repeated runs never see each other's data): the admin creates two
customers in sheets (the contact card dials `tel:`), adds a bike from one
customer's page (owner preset; it gets a B- number and a `registered`
history entry), uploads the fixture JPEG (`tests/e2e/fixtures/bike-photo.jpg`)
with `setInputFiles` and sees the thumbnail load (640px wide: downscaling
leaves small photos alone), opens it and shares it with the customer
(badge on the tile, still set after a reload), makes it public (a fetch of
its public URL with no session succeeds; the private original's signed
link stops working) and internal again (the public URL stops working),
deletes it with a reason after checking Cancel returns focus (its signed
link stops working), finds the bike from the
header search by its serial number typed lower-case with spaces for dashes
and by its B- number, transfers it to the other customer with a reason (the
history shows both names, the reason and the actor), archives the first
customer (Add bike disabled; gone from search, listed under Archived);
mechanic2, with no permissions, creates a customer, adds a photo to the
customer record whose Public option is disabled with the D13 explanation
(and looks it: muted colour, not-allowed cursor), and registers a shop bike
with no customer. A search test slows every `/customers` result by 700 ms:
what is typed while "tan" loads is kept ("tan wei", not "tani"), and opening
a result while a search is still waiting to be sent keeps the record open.

Phase 3 E2E helpers live in `tests/e2e/helpers.ts`, not a workshop
module, because later phases' specs create jobs too: `tagFor(testInfo)`,
`section(page, title)` (the Card headed `title`),
`nextIntakeStep(page, expectStep)` and
`createJobViaIntake(page, {tag, requestedWork?, lead?, additional?, services?})`
→ `{id, jobNumber}` (a tagged customer and bike from the intake's sheets,
the wizard walked to Create job, intake photos skipped; signs nobody in).
`workshop-board.spec.ts` creates its job with it.

Phase 3 spec (`workshop.spec.ts`, `tagFor` from `helpers.ts`): SPEC §27.3
journey 1 (its part line came with Phase 4, below), as the admin: /jobs → New job → a new
customer and a new bike from the intake's sheets → requested work and
condition → Marcus Tan lead, Nur Aisyah additional → Full Service →
Review → Create job; the job opens on its J- number with the Intake photos
card, the fixture photo uploads and shows, Done drops `?intake`; People
lists both; Wheel True × 2 gives $270.00, cost $0.00, yield $270.00, Cult
Commons $81.00, after Cult Commons $189.00; a manual "Valve core" 1 × $5.00
costing $2.00 (after Phase 4's part line) gives $284.00 and $83.46; voiding
it with "Not needed" (two steps, 400 ms guard) brings $279.00 back and the voided line shows its
reason; Start work → Complete (Add service now disabled with the lock
explanation) → Ready for collection → Collected, with Completed and
Collected as separate dated rows; the timeline lists check-in, both
assignments, the photo, the four lines, the part's stock use, the void and its reason, work
started, completed, ready for collection and collected. Collected is the
second step of "Collected…" (the job named, focus on Back). A reload mid-intake
offers the draft back (Continue restores step and customer; Discard starts
afresh). mechanic2 (no view_costs) opens J-000002 and sees its $300.00 total
but no cost, yield or Cult Commons, and the page's data holds no cost key.

Phase 4 (`inventory.spec.ts`, phone and iPad, every record tagged and
stock asserted on the test's own product): journey 3 without labels and
receiving: the admin creates a counted product (tag in name and SKU,
$12.00, cost $5.00, reorder point 3), records 10 opening stock at the Shop
floor with the "Opening stock count" chip (preview "Shop floor: 0 → 10"),
finds it by SKU on /inventory with "10 in stock", adds 1 to a walk-in job
from Add part (the option reads "10 at Shop floor · 10 total"; toast
"Added 1 × …. 9 left at Shop floor."), the line shows the P- number and
"9 left at Shop floor", the product 9, the movements list "Used on job"
with the J- link; voiding the line (the confirmation says it returns 1 to
the Shop floor) toasts "Returned to stock", the timeline shows "Used 1 × …
(P-…) from Shop floor" and "Returned 1 × … to Shop floor", stock is 10
again and "Returned from job" links "Reverses #n" to the original's
"Reversed by #m"; adding it again gives 9. A tagged unique item with its
first unit goes on job A ("It is on hold for this job"), the unit page
says "On job J-…" and job B's picker offers nothing. mechanic2 sees the
road tube's stock with no Adjust stock, Transfer, Edit details, Add unit,
Archive, cost, yield or Cult Commons (and no "3.80" in the page), and still
adds 1 to a job. Journey 1 (`workshop.spec.ts`) now adds 1 × the seeded
road tube (P-000003) after Wheel True: the toast's count is the picker's
Shop floor count minus 1 (relative, the database is shared), totals
$279.00 / cost $3.80 / yield $275.20 / Cult Commons $82.56 / after $192.64,
and the timeline shows the line and its `stock_consumed` entry.

Phase 4 Step 4 (`inventory-publish.spec.ts` and `scan.spec.ts`, phone and
iPad). Publication: the admin creates a tagged counted product with stock
and a price and makes it internal; Publish is disabled with "Still needed:
A public photo." and the checklist marks the photo missing and the price
done, the preview reads "Not public. Anonymous scans show nothing." and
the QR URL ends in `/q/P-…`; a photo through "Choose photos" made Public in
the viewer (which offers no Customer level on stock) enables Publish; once
published the pill reads Public and the preview shows the name, $25.00,
Available and "1 public photo"; Unpublish brings "Not public" back.
Locations: a tagged location with sort order 900 is added from
/settings/locations (Shop floor keeps the "Default" pill), is offered in
the Adjust stock sheet, and once its switch is off it reads Inactive and is
no longer offered. Split: one of a tagged product's 5 is split off with a
reason; the new unit page shows its U- number and Available, and the
source reads 4. Bike link: B-000011's page reads "In stock as U-000001 ·
Available", archiving it toasts the `bike_in_stock` message, and the link
opens the unit. Scanning: typing P-000001 opens the product, `b-000001`
the bike, "hello" gives "Enter a code like P-000123", P-999999 shows "No
record with P-999999" whose "Scan again" returns to /scan, and
`/q/U-000001` (also lower case) redirects to the unit. The camera is
stubbed in an init script with the permission granted:
`navigator.mediaDevices.getUserMedia` returns `canvas.captureStream(10)` of
a canvas repainted every 100 ms in alternating colours (so the video
really plays and `requestVideoFrameCallback` fires), and
`window.BarcodeDetector` is a fake class whose `getSupportedFormats`
resolves `['qr_code']` and whose `detect` resolves the chosen
`rawValue`; `navigator.permissions.query` reports camera granted. With
`${E2E_PUBLIC_SITE_URL}/q/U-000001` (`tests/fixtures/public-site.ts`, the
same value `playwright.config.mts` gives the web server) scanning lands on
the unit; with `https://example.com/phish` the page shows "Not a BICII
label" with the text, keeps detecting, stays on /scan and links nothing on
example.com, and typing a code still works. The header search finds
"shi-l05a-rf" as P-000001 with "N in stock", and `p-000001` + Enter opens
the product directly (`customers-bikes.spec.ts` and
`workshop-board.spec.ts` now expect the same jump for a B- or J- number,
and still check the results page for an exact J- number).

Phase 3 step 4 (`workshop-board.spec.ts`, read-only on the seeded jobs so
the phone and iPad runs share one database): as mechanic2 (Nur Aisyah, no
view_costs) My jobs lists J-000002, J-000003 (as additional), J-000005 and
J-000009 and not Marcus's J-000004, with group counts and no money on the
board; Unassigned lists J-000007; the Overdue age filter lists J-000006
with its Overdue badge (D20) and not J-000002 (ready for collection, so
never overdue however old the seed is, as with `E2E_RESET=0`); the status filter "Waiting on parts" lists
J-000005 and not J-000006 and its chip removes it; "j000004" in the job
number box finds J-000004. On J-000002 she sees Total $300.00 and no
"Cost", "Yield" or "Cult Commons" anywhere; on /settings/services prices
but no cost, no New service, no Edit and no Cult Commons card. mechanic1
sees Cult Commons $52.80 and BICII yield after Cult Commons $123.20 on
J-000002 and the 30% rate (without Schedule). The admin's header search
for "j-000004" opens J-000004 directly (Phase 4's short-ID jump), /search
for it lists Jobs first and opens J-000004, which Chloe's Giant's
Service history also lists. On a tagged service and job: the service
created in settings is offered in the job's Add service; the lead is
reassigned from Marcus Tan to Nur Aisyah in the Assign sheet (which says
Marcus leaves the job); a note, the approval switch and a details edit
(a blank requested work refused with the typed internal note kept); the
timeline shows both lead assignments, "Marcus Tan removed from the job",
the note, "Marked customer-approved" and the details change; the board
finds the job by number with Nur as lead.

Phase 5 (`today.spec.ts`, phone and iPad; today's values asserted as
deltas read just before acting, past days only from `seedAnchor()` /
`anchorDay(n)`, seeded jobs found by `REPORT_JOB_NUMBER`; Today tiles read
with `readCount` / `readMoney` from `helpers.ts`, which find a tile's
`<dt>` and read its `<dd>`). "Milestone M1.5" is a serial describe whose
job is kept per project: (1a) PLAN §3's exit criteria on a phone: as the
admin, Today's Checked in, Completed, Collected, Gross sales, Yield and
Cult Commons; a tagged customer and bike checked in through the intake with
the fixture photo, condition, requested work and Nur Aisyah as lead
(`createJobViaIntake` with `photo` and `condition`); a tagged product
(`createProduct`, moved here from `inventory.spec.ts` unchanged, as was
`pickPart`) with opening stock 10; Basic Service and one part added, the
line and product reading 9 before and after a reload; the totals panel
equal to `jobEconomics` over the two lines; start → complete → ready →
collected with separate Completed and Collected timeline entries and
stamps and "Counted in reports on <today> (completed)"; Today then reads
+1 checked in, completed and collected and gross, yield and Cult Commons
up by exactly the job's (summed with Decimal); the job under Activity →
Completed and Collected, its row opening the job; `/?entries=open` listing
its lines. (1b) mechanic2 sees the job's sale total and no cost, yield,
Cult Commons or recognition text, and on Today the workshop tiles and the
job in Activity but no Money section; mechanic1 (view_costs) sees the full
panel and no Money section. "Several days of history reconcile":
`/?day=anchorDay(3)` flows and money equal `SEED_DAYS[3]` (1000.00 /
400.00 / 600.00 / 180.00 / 420.00) with the past-day note and no "Right
now" or "Needs attention"; Previous / Next move one day; anchorDay(2)
shows the loss note with −$15.00 and Cult Commons $12.00; Last 7 days from
anchorDay(1) has seven rows, days 1–6 with the seeded completed,
collected, gross, yield and Cult Commons, the shown day `aria-current`;
`?day=garbage` is today. "Low stock and the day's significant adjustment":
P-000009, P-000008 and P-000012 listed and linking to their pages, "See
all" → `/inventory?filter=low`; A2 (P-000021 −6, "Water damage in
storage", Significant, Damaged) on anchorDay(1). "What needs attention"
(skipped with a message unless the seed's anchor is the live day, since
exceptions are relative to it): J-000017 overdue and J-000016 waiting for
collection, each opening its job.

Critical journeys, added with the phases that build them, against the seeded
database, signed in as the seeded admin and mechanic:

1. Walk-in: new customer + bike → intake photo (fixture image upload) → job →
   add service + part → stock badge decrements → complete → ready → collected;
   timeline shows every step; Today shows the job and its money (complete
   with M1.5: `workshop.spec.ts` for the timeline, `today.spec.ts` for the
   milestone run ending on Today).
2. Appointment: book (as seeded customer via RPC) → appears on Today → arrive →
   check in → work order linked.
3. Bulk product: create → receive PO (partial) → print 10 labels (PDF adapter
   produces 10 identical QR payloads) → consume one on a job → stock −1.
4. Consignment: create consignor + unique bike → label → public page (hitting
   `public_items` through the app's preview route) → record sale → yield and
   CC shown to admin, hidden from mechanic → consignor outstanding → partial
   settlement → full settlement → outstanding 0.
5. Shopify: publish product → simulate `orders/paid` POST to the webhook route
   with a valid HMAC → stock −1 once; POST the same payload again → unchanged.
6. (Later, in the public-site repo) customer sign-in sees only own data.

## Seed data

`supabase/seed.sql` is both the demo dataset and the test fixture. Fixed
UUIDs are exported from `tests/fixtures/ids.ts` so tests never query by name.
What each seeded record demonstrates is in DATA-MODEL.md §18. Tests that
create their own workshop rows pick service and category names the seed
does not use (active names are unique) and scope counts to their own job or
customer; the seed's own shape and timelines are pinned by
`workshop-seed.test.ts`.

Since Phase 5 the seed is a week of shop history **relative to the shop day
`db:reset` ran** (the anchor): every Phase 3, 4 and 5 timestamp goes through
the session-temporary `pg_temp.seed_at(days_ago, local_time)`. The figures
it must produce are written by hand in `tests/fixtures/reporting.ts`
(`SEED_DAYS` for days 0–6, `SPEC_EXAMPLE_JOBS`, `SEED_SNAPSHOT`,
`SEED_EXCEPTIONS`, `SEED_ADJUSTMENTS`) and the Phase 5 rows' ids in
`tests/fixtures/ids.ts` (`REPORT_JOB`, `REPORT_JOB_NUMBER`, `REPORT_LINE`,
`REPORT_PRODUCT`, `REPORT_PRODUCT_SHORT_ID`). The anchor rule: the anchor
need not be today (the DB test template is built once per run,
existing-database mode keeps an old seed, a run can cross Singapore
midnight), so seed assertions read it with `seedToday()`
(`tests/db/reporting-fixtures.ts`, from T3's check-in, not through the
functions under test) and use explicit days `anchor − n`, never
`shop_today()` or null bounds; assertions that need anchor = today
(`today_dashboard(null)`, `is_today`, the `*_now` snapshot, the exceptions)
compare the two first and skip with a message when they differ; tests that
take a short ID or sequence value skip when `isolatedDatabase()` is false.
E2E reads the same anchor in global setup (`E2E_SEED_ANCHOR`). Tests that
list a seeded customer's jobs list the Phase 5 jobs too
(`workshop-customer-access.test.ts`).

## CI

GitHub Actions, `.github/workflows/ci.yml` (setup shared through
`.github/actions/prepare`: Node from `.nvmrc` with the npm cache, `npm ci`,
and the devstack components restored from `actions/cache`, keyed on their
pinned versions, or built by `npm run devstack:setup`). Every job that needs
a database gets a `postgres:16` service container and reaches it through
`PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`; the scripts need only a superuser
login (no sudo, no `pg_ctlcluster`, no particular superuser name, SSL off is
fine).

- `check` (every PR and push to `main`): `npm run check` (typegen + `tsc`,
  `eslint`, `prettier --check`), `npm run tokens:contrast`, then
  `npm run check:types` (`db:types --fresh` from a throwaway database built
  from the migrations, and `git diff --exit-code -- src/lib/database.types.ts`).
- `test` (every PR and push): `npm run db:reset` and `npm run
  devstack:start`, then `npm test` (unit + db; the db project builds its own
  template: roles → Auth → Storage → migrations → seed). With
  `BICII_REQUIRE_STACK=1` the live-stack tests fail instead of skipping if
  the gateway is down.
- `build` (every PR and push): `next build` with placeholder public env.
- `e2e` (its own workflow, `e2e.yml`: manual dispatch, nightly at 02:23
  Singapore time, and PRs labelled `e2e`; `ci.yml` never runs on `labeled`,
  so a label can never post skipped required checks): `npx playwright install --with-deps chromium`, the devstack on the
  service database, then `npm run test:e2e` (production build on :3100,
  phone + iPad projects, one retry in CI). On failure the HTML report,
  traces and devstack logs are uploaded as an artifact.

Secrets in CI: none. E2E runs against the devstack (real Supabase Auth,
PostgREST and Storage with the local demo keys), not staging, so it works
on forks and needs no staging credentials.
