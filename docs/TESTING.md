# BICII Admin — Testing strategy

Maps SPEC.md §27 onto concrete harnesses. A feature is done when the tests in
its row of PLAN.md pass in CI.

## Harnesses

| Layer | Tool | Runs against | Command |
|---|---|---|---|
| Unit (pure TS) | Vitest | nothing | `npm run test:unit` |
| Database (invariants, RLS, RPCs) | Vitest + `pg` | Postgres with migrations + seed | `npm run test:db` |
| End-to-end | Playwright | `next start` + Postgres + Supabase Auth (local stack or staging) | `npm run test:e2e` |
| Static | `tsc --noEmit`, `eslint`, `prettier --check`, type-gen diff | — | `npm run check` |

`npm test` = unit + db. CI runs `check`, `test`, then `build`; E2E runs on a
nightly schedule and on PRs labelled `e2e`.

## Database test harness

Supabase's local stack needs Docker. Where Docker exists (developer laptops)
`supabase start` provides a real stack and `DATABASE_URL` points at it. Where
it does not (the cloud agent container, some CI runners) the harness uses any
Postgres 16:

1. `supabase/tests/auth-shim.sql` creates the `auth` schema with a minimal
   `auth.users` table, the functions `auth.uid()`, `auth.jwt()`,
   `auth.role()` reading `request.jwt.claims`, and the roles `anon`,
   `authenticated`, `service_role`. It is idempotent and a no-op on a real
   Supabase database (guarded by `if not exists`).
2. Migrations are applied in order with `psql` (the test runner does this, so
   the CLI is not required to run tests).
3. `supabase/seed.sql` is applied.
4. Each test file runs inside a transaction that is rolled back, so tests are
   independent and the seed is reused.

Acting as a user in a test:

```ts
await asUser(client, { sub: STAFF_MECHANIC_ID, role: 'authenticated' }, async (tx) => {
  // tx has `set local role authenticated` and
  // `select set_config('request.jwt.claims', '{"sub":"…","role":"authenticated"}', true)`
});
await asAnon(client, async (tx) => { … });
await asServiceRole(client, async (tx) => { … });
```

The same helper works unchanged against a real Supabase database, which is
how the staging smoke run proves the shim is faithful.

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

Playwright, mobile viewport (iPhone 13) and iPad, against the seeded database,
signed in as the seeded admin and mechanic:

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

GitHub Actions, `ci.yml`:

- `check`: install, `tsc`, `eslint`, `prettier --check`, regenerate types
  against a migrated Postgres service container and `git diff --exit-code`.
- `test`: Postgres 16 service container → shim → migrations → seed → Vitest
  unit + db.
- `build`: `next build`.
- `e2e` (label/nightly): `next build && next start` with the service DB and
  Supabase Auth from staging; Playwright with traces on failure.

Secrets in CI: none for `check`/`test`/`build`. Staging keys for `e2e`
only, from repository secrets.
