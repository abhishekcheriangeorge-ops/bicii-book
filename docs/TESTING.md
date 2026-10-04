# BICII Admin — Testing strategy

Maps SPEC.md §27 onto concrete harnesses. A feature is done when the tests in
its row of PLAN.md pass in CI.

## Harnesses

| Layer | Tool | Runs against | Command |
|---|---|---|---|
| Unit (pure TS) | Vitest | nothing | `npm run test:unit` |
| Database (invariants, RLS, RPCs) | Vitest + `pg` | Postgres with migrations + seed | `npm run test:db` |
| End-to-end | Playwright | `next start` + the devstack (or `supabase start` with `E2E_EXTERNAL_STACK=1`) | `npm run test:e2e` |
| Static | `tsc --noEmit`, `eslint`, `prettier --check`, type-gen diff | — | `npm run check` |

`npm test` = unit + db. CI runs `check`, `test`, then `build`; E2E runs on a
nightly schedule and on PRs labelled `e2e`.

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
from `DATABASE_URL` (or `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`), default
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
themselves in that mode (`isolatedDatabase()`).

`tests/db/stack.smoke.test.ts` goes one step further when the devstack is
running (`npm run db:reset && npm run devstack:start`): it signs in through
the gateway with supabase-js as `admin@bicii.test`, calls
`rpc('my_staff_profile')`, and round-trips an object through Storage with
the service key. It skips with a message when the gateway is not reachable,
unless `BICII_REQUIRE_STACK=1` (CI), where that fails the file.

Catalogue meta tests (`tests/db/meta.test.ts`) cover every future migration
automatically: RLS enabled on every `public` table, no function in
`public`/`private` executable by PUBLIC, security-definer functions pin
`search_path`, no money-like column is `real`/`double precision`.

### Devstack commands

| Command | What it does |
|---|---|
| `npm run devstack:setup` | Download/build PostgREST, Supabase Auth, Node 24 and Supabase Storage into `~/.cache/bicii-devstack` (`BICII_DEVSTACK_CACHE`). Idempotent. |
| `npm run db:reset` | Drop and rebuild the dev database (`bicii_dev`): roles → Auth → Storage → migrations → seed. |
| `npm run db:migrate` | Apply only pending app migrations. |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` (`-- --fresh` builds a throwaway database first). |
| `npm run devstack:start` / `stop` / `status` | Auth :9999, PostgREST :3001, Storage :5000, gateway :54321; pids and logs in `.devstack/`. `start` builds the database if it does not exist yet, and restarts services that were started against a different database. |
| `npm run devstack:env` | Write `.env.local` with the gateway URL, local anon/service keys and `DATABASE_URL`. |

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

### Database (SPEC §27.2 and §23)

Each invariant from SPEC §23 has at least one test, named after it:

| Invariant | Test |
|---|---|
| Unique unit cannot be sold twice | `record_retail_sale` twice on one unit → second raises; one `sold` movement. |
| Stock-consuming line consumes once | call `add_inventory_line` with the same idempotency key twice → one line, one movement; concurrent calls (two connections) → one movement. |
| Void creates reversal, never deletes | `void_line` → original movement intact, one `reversal` row with `reversal_of_id`; second `void_line` → no-op. |
| Duplicate Shopify webhook has one effect | insert the same `integration_events` twice (unique violation) and call `process_shopify_order_paid` twice → one sale, one movement per line. |
| Snapshots do not change with catalog edits | add service line, update `services.default_sale_price` → line totals unchanged. |
| Sale liability ≠ settlement | sell a consigned bike → `consignor_ledger.outstanding = agreed_amount_owed`, `paid = 0`. |
| Settlement cannot exceed owed | `record_settlement` over-allocating without override → raises; with override by `manage_consignments` → succeeds and stores reason. |
| Customers cannot read internal data | as customer A: select from `work_order_line_items`, `products`, `inventory_movements`, `customers.internal_notes` → zero rows or column permission error; `work_order_totals` returns no cost columns. |
| completed_at ≠ collected_at | status walk → both stamped at different times; `collected` cannot precede `completed`. |
| Booking cannot exceed capacity | fill a slot to capacity → next `book_appointment` raises; two concurrent bookings for the last unit → exactly one succeeds. Also: outside hours, inside closure → raise. |
| Duplicate receipt cannot double stock | `receive_purchase` same idempotency key twice → one receipt, stock +18 once; partial then remainder → PO `received`; over-receipt → raises. |
| Manual adjustment records actor/time/reason | `adjust_stock` without reason → raises; with reason → row has `created_by`, `reason`. |
| Public QR exposes only published | `public_items` as anon: draft/internal rows absent; public row shows no cost; sold unique shows `sold`. |
| Archived entities stay referenceable | archive a service used on a historical job → job line still joins. |
| Money is numeric | information_schema check that no money column is `real`/`double precision`. |
| RLS: customer A cannot read B | bikes, appointments, work orders, attachments. |
| Anonymous cannot read costs/notes | every table in the RLS matrix: anon select returns 0 rows or is denied. |
| Mechanic permission boundaries | staff without `view_costs` cannot select cost columns; without `adjust_stock` cannot call `adjust_stock`; admin can. |
| Consignment sale yields correctly | $1,000 sale, $500 owed → yield 500, CC 150. |
| Cult Commons rate snapshot | insert a new rate effective tomorrow; lines today use 0.30, lines after use the new rate; old lines unchanged. |

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

Phase 0 specs (`auth.spec.ts`, `staff.spec.ts`): signed-out `/` redirects to
`/login`; `?next=` deep links survive sign-in and cannot leave the origin
(absolute, `//host`, `/\host`); wrong password gives one generic error; the
admin lands on Today with the tab bar (phone) or rail (iPad); sign-out ends
the session; mechanic2 gets a real 403 on `/settings/staff`; a permission the
admin grants shows on mechanic2's profile (then is revoked); an invited
colleague signs in with the one-time password and has no staff access.

Critical journeys, added with the phases that build them, against the seeded
database, signed in as the seeded admin and mechanic:

1. Walk-in: new customer + bike → intake photo (fixture image upload) → job →
   add service + part → stock badge decrements → complete → ready → collected;
   timeline shows every step.
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
  `npm run db:types -- --fresh` (a throwaway database built from the
  migrations) and `git diff --exit-code -- src/lib/database.types.ts`.
- `test` (every PR and push): `npm run db:reset` and `npm run
  devstack:start`, then `npm test` (unit + db; the db project builds its own
  template: roles → Auth → Storage → migrations → seed). With
  `BICII_REQUIRE_STACK=1` the live-stack smoke test fails instead of
  skipping if the gateway is down.
- `build` (every PR and push): `next build` with placeholder public env.
- `e2e` (manual dispatch, nightly at 02:23 Singapore time, and PRs labelled
  `e2e`): `npx playwright install --with-deps chromium`, the devstack on the
  service database, then `npm run test:e2e` (production build on :3100,
  phone + iPad projects, one retry in CI). On failure the HTML report,
  traces and devstack logs are uploaded as an artifact.

Secrets in CI: none. E2E runs against the devstack (real Supabase Auth,
PostgREST and Storage with the local demo keys), not staging, so it works
on forks and needs no staging credentials.
