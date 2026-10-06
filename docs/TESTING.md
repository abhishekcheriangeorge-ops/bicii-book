# BICII Admin — Testing strategy

Commands: [ENGINEERING.md](ENGINEERING.md#commands); current results: [NOW.md](../NOW.md).

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
the gateway with supabase-js as `admin@bicii.test` the way staff do (PLAN
D10, D70: `signInWithOtp` with `shouldCreateUser: false`, the code read
from the devstack's mail catcher with `scripts/devstack/mail-client.mjs`,
`verifyOtp` with type `email`), checks the email carries our subject ("Your
BICII sign-in code") and template, calls `rpc('my_staff_profile')`, and
round-trips an object through Storage with the service key. It also pins
the code rules Auth enforces: an unknown address with `shouldCreateUser:
false` gets 422 `otp_disabled` (the Admin will show it as sent, D70),
creates no `auth.users` row and receives no email; asked again while Auth's
per-address interval is held open (`recovery_sent_at` set ahead, as the
hosted 60 s would), an address with a login gets 429
`over_email_send_rate_limit` and an unknown one 422 `otp_disabled` again,
and `classifyCodeRequestError` makes "sent" of every one of them (D70); a
code works once (the second `verifyOtp` is 403 `otp_expired`); a newer
code voids the older one; and setting a password on a session aged past
24 h is refused with `reauthentication_needed` (secure password change,
PLAN D10).
Those cases use unique throwaway `.test` logins made with the admin API and
deleted after the file. Every other live test signs in with
`tests/db/stack.ts`: `otpClient(email)` gets the code from the service-role
admin API (`auth.admin.generateLink({ type: 'magiclink' })` returns
`properties.email_otp` and sends no email) and verifies it with
`verifyOtp`; `staffClient(who)` is `otpClient` for a seeded login and
`serviceClient()` is the service-role client.
`tests/db/staff-sessions.stack.test.ts` invites a uniquely named throwaway
staff login, signs it in and deactivates it (PLAN D71); staff rows are
history and are never deleted, so it stays, deactivated, until the next
`npm run db:reset`. `tests/db/sign-in-throttle.stack.test.ts` drives the
Admin's own sign-in limits (PLAN D72) through the app's module
(`countSignInAttempt` in `src/lib/admin/sign-in-throttle.ts`) and
PostgREST with the real limits: an email past its limit is refused from
any client while other emails and its verifications are not; a client
past its limit is refused for any email while other clients are not; a
staff email reaches its limit no later than an unknown one; the anon key
and a staff session get 42501, and the anon key in the service role's
place makes `checkSignInAttempt` answer "unavailable" with the cause the
login actions log (`rpc_error`, 42501, never the email). `tests/db/photo-moves.stack.test.ts` runs the app's own
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

Phase 9 helpers (`tests/db/period-report-fixtures.ts`): `buildPeriodScenario`
builds, inside the test's transaction, the March 2025 week the period-report
tests assert (3 March 2025 is a Monday; Singapore time): jobs A–E through
Phase 5's `insertJob` (which takes an optional `leadMechanicId`, set through
a lead assignment at check-in), with their own services SV200, SV120, SV80
(cost 0.00) and a quantity product QP (50.00 / 30.00), a free 0.00 / 0.00
line, a voided line, a loss line, a cancelled job and a midnight completion;
a consigned bike received 20 February, sold as S1 on Tuesday (1,000.00 /
500.00 / 500.00 / 150.00) and settled 200.00 on Thursday, through the real
RPCs as the admin. `PERIOD_EXPECTED` holds the literal figures, worked out
by hand and never recomputed with the code under test. The scenario
consumes J-, B-, C-, P-, U- and S- sequence values, so those tests skip in
existing-database mode.

Phase 2 helpers (`tests/db/appointment-fixtures.ts`): booking tests set
the schedule they need as the owner inside their rolled-back transaction
(`standardSchedule`, `setSettings`, `setHours` replaces every weekly row
for the transaction, `addClosure`, `makeType` with a fresh name,
`insertAppointment` for any status without the booking checks), on a clear
Tuesday-Friday at least 21 days ahead (`futureDay`) unless the case is
about today (`currentSlot`: today's grid slot containing `now()`, under an
all-day custom-hours override), so the seeded settings, hours, types,
closures (within 14 days, never covering the seed day) and appointments
(at most 14 days ahead) never change a result; capacity on today's slot is set relative to
`unitsUsed`. The shared data fixtures are
`tests/fixtures/appointment-slot-cases.ts` (slot and booking-rule cases,
fixed 2031 dates) and `tests/fixtures/appointment-transitions.ts` (the
status machine); step 3's TypeScript mirror uses both. Check-in tests
(`appointment-check-in.test.ts`) build their own customer, bike, type and
appointment as the owner and call `check_in_appointment` as staff. One
customer login is seeded (`CUSTOMER_LOGIN.chloe`, Chloe Lim, no usable
password since the email sign-in integration): read-only customer checks may act as her
(`customerClaims(CUSTOMER_LOGIN.chloe.authUserId)`); tests that change a
customer's login or bookings link a fresh login to a fresh customer
(`linkCustomerLogin`), never to `CUSTOMER.chloe`.

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

The devstack and database commands (`devstack:setup`, `devstack:start` /
`stop` / `status`, `devstack:env`, `db:reset`, `db:migrate`, `db:types`)
are described in one place:
[ENGINEERING.md "Commands"](ENGINEERING.md#commands).

### The devstack mail catcher

Staff sign in with emailed codes (PLAN D10, D70), so the devstack runs a
mail catcher, `scripts/devstack/mailcatcher.mjs` (dependency-free; Phase 11
reuses it for customer codes). It listens on 127.0.0.1 only: SMTP on
`BICII_SMTP_PORT` (2525) and a JSON API on `BICII_MAIL_HTTP_PORT` (8025).
Supabase Auth sends to it (`GOTRUE_SMTP_*` in `scripts/devstack/services.mjs`:
no credentials, no TLS, sender `no-reply@bicii.test`) and fetches its email
templates from it (`GOTRUE_MAILER_TEMPLATES_*` point at
`/templates/<name>.html`, served from `supabase/templates`). The devstack's
Auth also gets 6-digit codes valid for 600 s (`GOTRUE_MAILER_OTP_*`), a 1 s
per-address interval and local-only rate limits of 100000
(`GOTRUE_RATE_LIMIT_EMAIL_SENT`, `_VERIFY`, `_OTP`, `_TOKEN_REFRESH`) so
E2E can sign in hundreds of times. Messages are kept in `.devstack/mail/`
as `<id>.json` (parsed) and `<id>.eml` (raw); ids keep increasing across
restarts and the newest 1000 are kept.

| Request | Answer |
|---|---|
| `GET /health` | `{ok:true}` |
| `GET /messages?to=&after=&limit=` | `{messages:[…]}`, newest first: id, receivedAt, envelopeFrom, envelopeTo, from, to, subject, code |
| `GET /messages/latest?to=&after=` | the newest full message (adds text and html) to that recipient with id > after, else 404 `{error:'not_found'}` |
| `GET /messages/:id`, `GET /messages/:id/raw` | one message as JSON, or its raw `.eml` |
| `DELETE /messages[?to=]` | `{deleted:n}` |
| `GET /templates/<name>.html` | a template file; only `^[a-z0-9_-]+\.html$`, anything else 404 |

`to` matches the envelope recipients (RCPT TO), case-insensitively. `code`
is the first standalone run of 6–10 digits in the text part, else in the
tag-stripped HTML (`scripts/devstack/mail-parse.mjs`), so templates must
not contain another run of six or more digits. By hand:
`curl "http://127.0.0.1:${BICII_MAIL_HTTP_PORT:-8025}/messages/latest?to=admin@bicii.test"`.

Tests read codes with `scripts/devstack/mail-client.mjs`: take
`mailCursor(email)` before asking for a code, then
`waitForCode({ to: email, after: cursor })` (or `waitForMessage` for the
whole message; both poll every 200 ms for up to 15 s and name the address
and mail URL when nothing arrives); `clearMail(to?)` deletes. The base URL
is `BICII_MAIL_URL`, else the devstack's. With `supabase start`
(`E2E_EXTERNAL_STACK=1`) set `BICII_MAIL_KIND=mailpit`: the client then
reads Mailpit on :54324 through its documented API (`GET
/api/v1/search?query=to:"<addr>"`, `GET /api/v1/message/<ID>`). That
adapter is written from Mailpit's documentation and has **not been run**
(no Docker here).

Verification of the mail catcher step (2026-10-05, OTP phase step 1, in
a second worktree with the ports moved by `BICII_*_PORT`):

- `npm run devstack:stop && npm run devstack:start`: mail on its HTTP and
  SMTP ports, then Auth, PostgREST, Storage, gateway; `devstack:status`
  all ok: **pass**.
- A code requested by hand (`POST /auth/v1/otp`, `create_user: false`)
  arrived with subject "Your BICII sign-in code", our template and a
  6-digit code; an unknown address got 422 `otp_disabled`: **pass**.
- 40 rapid code requests for 40 new throwaway addresses: all 200, 40
  emails, no 429: **pass**.
- `npm run check`: **pass**.
- `BICII_REQUIRE_STACK=1 npm test` with the devstack up: 71 files, 942
  tests: **pass**.
- `npm run test:e2e -- tests/e2e/auth.spec.ts` (global setup signs in with
  a generated code and needs the mail catcher; the password form is still
  the app's sign-in until the next step): 24 tests: **pass**.
- `BICII_MAIL_KIND=mailpit` with `supabase start`: **not run** (no
  Docker).

Verification of the code sign-in step (2026-10-05, OTP phase step 2: the
`/login` form asks for an emailed code, invites create no password, the
password paths are gone), same worktree and ports:

- Established on the devstack (Auth 2.178) before writing the specs: a
  login made by `auth.admin.createUser` without a password stores the
  bcrypt hash of a random secret (`$2a$10$…`, not `''` or NULL; the seed
  now writes the same shape); a wrong code leaves the real one usable; an
  email code's expiry is read from `auth.users.recovery_sent_at` (ageing
  `auth.one_time_tokens.created_at` alone left the code valid); an unknown
  email gets 422 `otp_disabled`.
- `npm run check`: **pass**.
- `BICII_REQUIRE_STACK=1 npm test` with the devstack up: 71 files, 951
  tests: **pass**.
- `npm run build`: **pass**.
- `npm run test:e2e` (phone and tablet, every spec signing in with codes
  from the mail catcher): 98 tests: **pass**.
- `BICII_MAIL_KIND=mailpit` with `supabase start`: **not run** (no
  Docker).

Verification of the deactivation step (2026-10-05, OTP phase step 3:
deactivation deletes the person's Auth sessions, PLAN D71; final sweep of
the phase), same worktree and ports:

- Established on the devstack before writing the specs: after the
  trigger deletes the sessions, Auth 2.178 answers the old access token
  with 403 `session_not_found` (supabase-js turns it into
  `AuthSessionMissingError`) and the refresh token with
  `refresh_token_not_found`; PostgREST still accepts the unexpired token
  on its own. `staff-sessions.test.ts` fails (3 of its tests) with the
  migration removed.
- `npm run devstack:status` lists mail, auth, rest, storage and gateway,
  all ok: **pass**.
- The final sweep's grep (password, temporary, `SEED_PASSWORD`,
  `signInWithPassword`, `grant_type=password`, "Change password",
  "one-time password" over `src/`, `tests/`, `scripts/`, `supabase/`,
  `docs/`, README and `.github/`) finds only generic secret handling,
  `PGPASSWORD`/`POSTGRES_PASSWORD`, the `roles.sql` service-role
  passwords, the invite's "No password needed." copy, Auth's own password
  settings in `config.toml` and the devstack (commented: unused) and
  history in these notes: **pass**.
- `npm run check`: **pass**.
- `BICII_REQUIRE_STACK=1 npm test` with the devstack up: 73 files, 960
  tests: **pass**.
- `npm run build`: **pass**.
- `npm run test:e2e` (phone and tablet): 98 tests: **pass**.
- `BICII_MAIL_KIND=mailpit` with `supabase start`: **not run** (no
  Docker).

Verification of the review fixes (2026-10-05, OTP phase: per-address
limit shown as sent, D70; the Admin's own sign-in limits, D72; the
inactive-session 403 tests, D71; secure password change; devstack
restarts on a changed configuration), same worktree and ports:

- Established on the devstack before the fix (`POST /auth/v1/otp`,
  `create_user: false`, twice in a row): an address with a login got 200
  then 429 `over_email_send_rate_limit`, an unknown one 422 `otp_disabled`
  both times.
- `npm run devstack:start` after the change restarted every service whose
  recorded configuration differed (here all five, none had a record yet);
  a second run left all five running; with `rest` and `auth` marked stale
  it restarted them and the services after them, gateway first: **pass**.
  (Before stopping the clients first, a restarted PostgREST failed to bind
  its port: TIME_WAIT from the gateway's connections.)
- Mutation checks: with `guard()`'s `!staff.active` removed,
  `session-guard.test.ts` (2 tests) and the E2E "hosted window" test
  fail; with the per-address code classified as before, the E2E "asking
  twice in a row" test fails: **pass** (both restored).
- `npm run check`: **pass**. `npm run check:types` (fresh database):
  **pass**.
- `BICII_REQUIRE_STACK=1 npm test` with the devstack up: 77 files, 986
  tests: **pass**.
- `npm run build`: **pass**.
- `npm run test:e2e` (phone and tablet): 102 tests: **pass**.
- Hosted steps (password reset SQL, "Secure password change", Auth's
  per-IP limits): **not run** (no hosted project; owner's step).

Verification of the integration with main and purchasing (2026-10-06,
`origin/feat/p7-purchasing` merged into `feat/auth-email-otp`; second
worktree, database `bicii_dev_wt`, `E2E_PORT=3200`):

- Before the gates: main's `tests/e2e/api.ts` `signInApi(email,
  password)` (Auth's password grant, used by `appointments.spec.ts` and
  `appointment-settings.spec.ts` for the admin and the seeded customer)
  became `signInApi(email)` with a generated code; Chloe Lim's seeded
  login got a random secret's hash. A grep over `src/`, `tests/`,
  `scripts/` and `supabase/` for `SEED_PASSWORD`, `signInWithPassword`,
  `grant_type=password` and `bicii-dev-password` finds only
  `seed-logins.test.ts`, which asserts that the former password matches
  no seeded login: **pass**.
- `npm run db:reset`: 44 migrations, `44|20261005006000`, seed applied;
  `npm run db:types`: no diff: **pass**.
- `npm run check`: **pass**. `npm run check:types` (fresh database):
  **pass**.
- `BICII_REQUIRE_STACK=1 npm test` with the devstack up: 111 files, 1585
  tests (unit 56 / 686, database 55 / 899): **pass**.
- `npm run build`: **pass**.
- `npm run test:e2e` (phone and tablet, every spec signing in with codes):
  152 passed in 18.2 min, no failures, flaky or skipped: **pass** (run
  before `seed-logins.test.ts` and the documentation were added; neither
  touches the app or the specs).
- Docs link check: **pass** (counts in [NOW.md](../NOW.md)).
- After the integration review fixes (the sign-in throttle's logged
  `cause`, the stack test's wrong-key case, docs): `npm run check`
  **pass**, `npm run check:types` **pass** (no diff),
  `BICII_REQUIRE_STACK=1 npm test` 111 files / 1585 tests **pass**,
  `npm run build` **pass**, `npm run test:e2e` 152 passed in 15.7 min
  **pass** (the first run, while the other worktree's E2E suite shared the
  CPUs, had 151 passed and 1 failed: the phone run of
  `consignment.spec.ts` "a consigned bike is received…" timed out because
  the click on "Void… the charge" right after "Charge added" did not open
  the reason field; the rerun passed unchanged), docs link check **pass**.

Verification of the staff roles (2026-10-06, step 4 of 4, the integration
review, on `feat/staff-roles` in the second worktree, database
`bicii_dev_wt`, `E2E_PORT=3200`; one command at a time):

- Review: `record_sale_refund` in
  `20261006000200_staff_role_permissions.sql` diffed against
  `20261004003500_sales.sql`: only the guard and its comment differ; no
  `staff_role` literal `'staff'` remains in `supabase/`, `src/`, `tests/`
  or `scripts/` (the `'staff'` left are `appointment_source` /
  `cancelled_via` values, historic migrations and the legacy-label tests):
  **pass**.
- `npm run check`: **pass**. `npm run check:types`: **pass** (no diff).
- `BICII_REQUIRE_STACK=1 npm test` with the devstack up: 113 files, 1680
  tests (unit 57 / 737, database 56 / 943): **pass**.
- `npm run build`: **pass**.
- `npm run test:e2e` (phone and tablet, with the new 375 px side-scroll
  checks in `roles.spec.ts`): 158 passed in 16.8 min, no failures, flaky
  or skipped: **pass**.
- Docs link check: 37 files / 690 links / 0 problems: **pass**.

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
- Permission resolution (`auth-helpers.test.ts`; D91: `admin` implies
  all, `manager` all but `manage_staff`, `mechanic` none, exceptions on top;
  inactive staff has none) and the refund role check (`consignment.test.ts`;
  D94: an active admin or manager; a mechanic holding every permission as
  exceptions cannot).
- The Staff screens' role wording (`staff-roles-screens.test.ts`, D90-D93):
  `describeStaffEvent` (src/lib/staff-events.ts) reads "Added as <Role>",
  "Role changed from <From> to <To>" (the pre-D90 payload value "staff"
  reads Mechanic) and "Extra access: <Permission> granted/removed";
  `roleWithArticle` ("an Admin", "a Manager"); and `roleChangeSummary`
  (src/lib/auth/role-change.ts): which exceptions a new role includes and
  so removes (D92), which stay, and what is lost (permissions, Record
  refunds, Admin settings), for mechanic to manager, manager to mechanic,
  manager to admin and admin to manager.
- Staff sign-in codes (PLAN D10, D70): `otp.test.ts` (6 digits, 10
  minutes, 60 s cooldown; `normaliseCode` drops spaces and hyphens from a
  pasted code and refuses anything else; `resendSecondsLeft` rounds up and
  never exceeds the cooldown; the countdown text) and
  `sign-in-errors.test.ts` (asking for a code: Auth's per-address
  `over_email_send_rate_limit` counts as sent, exactly like 422
  `otp_disabled` for an unknown email and every other 4xx; per-IP
  `over_request_rate_limit`, a bare 429 and outages say so; verifying:
  every other 4xx is one invalid-code failure; the agreed messages).
- The Admin's own sign-in limits (PLAN D72, `sign-in-limits.test.ts`):
  the client address (first `x-forwarded-for` entry, else `x-real-ip`;
  IPv6 per /64, IPv4-mapped as IPv4, ports dropped, anything else null),
  buckets per client and per email holding SHA-256 digests (email
  lower-cased; no address in clear; clients without an address share one
  bucket), requests and verifications apart, the multiplier, and "over the
  limit" only past it. `env.test.ts`: `SIGN_IN_LIMIT_MULTIPLIER` defaults
  to 1 and takes whole numbers 1-100000.
- The staff guard (PLAN D71, `session-guard.test.ts`, with Next's
  `forbidden`/`redirect` and the Supabase client mocked): `authorizeStaff`,
  `requireStaff` and `requireAdmin` answer 403 for an inactive person
  whose session still verifies, even with no permission required and even
  for an inactive admin; a login with no staff row is 403, a signed-out
  caller goes to `/login`, active staff pass.
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
- OTP phase, the devstack mail catcher: `mail-parse.test.ts` (pure:
  folded headers, RFC 2047 B and Q words, quoted-printable with soft
  breaks, nested multipart with base64 and iso-8859-1 parts, attachments
  skipped, raw 8-bit utf-8, `htmlToText`, `extractCode` taking only
  standalone 6–10 digit runs from the text part, else the tag-stripped
  HTML, never a colour or a digit inside a tag) and `mailcatcher.test.ts`
  (node environment, ports 0, a temp directory: two messages on one raw
  SMTP connection, pipelined and split mid-terminator, with a dot-stuffed
  line and mixed-case recipients; EHLO without STARTTLS, AUTH PLAIN and
  LOGIN, 503 / 502 / 252 replies, 552 above 10 MB with the connection kept;
  `/messages/latest` with and without `after`, `/messages`, `/raw`,
  `/templates` refusing traversal, ids continuing after a restart,
  `DELETE`, and `mail-client.mjs` cursors, `waitForCode` and its timeout
  error, `clearMail`).
- Phase 2 (appointments, step 3): the slot mirror's parity with SQL
  (`appointment-slots.test.ts`): every `slotCases` case of
  `tests/fixtures/appointment-slot-cases.ts` through `availableSlots`
  gives exactly the slots and remaining units `tests/db/appointment-slots.test.ts`
  asserts for `private.available_slots_at`, and every `problemCases` row
  through `slotProblem` the same first code, with `SLOT_PROBLEM_ORDER`
  equal to the database's order (misaligned, outside hours, closed,
  capacity); plus `ignoreCapacity`, the reinstatement's `excludeId`, the
  D2 `capacityForWindow` extension point, `windowUsage` (used over
  capacity after a settings change, windows outside the hours that still
  hold units), `openStretches` and `scheduleWarning` (closure first, grid
  ignored, D38). Status actions (`appointment-status.test.ts`):
  `availableActions` for every status against `MARK_STATUS`, `CANCEL` and
  `CHECK_IN` of `tests/fixtures/appointment-transitions.ts`, no-show only
  once started, reinstate on the appointment's own Singapore day and not
  the next (D39), staff cancel after the start (D37), never "complete"
  (D36); `primaryAction`, labels, tones, `isLate` at 15 minutes and the
  history sentences ("Reinstated as arrived by …", "Cancelled online by
  the customer", "Job J-… opened", "Linked to job J-…"). Zone helpers
  (`appointment-time.test.ts`): Singapore wall times, '24:00' as the next
  midnight, London and New York across daylight saving, `weekStart`
  (Monday), HH:MM parsing including Postgres's seconds.
- Phase 2 (appointments, step 4): `workshop-timeline.test.ts` reads
  `appointment_linked` as "Opened from the appointment on Tue 6 Oct 10:00
  (Service drop-off)" when check-in created the job and "Linked to the
  appointment on …" otherwise, with `href` `/appointments/<id>` (none for a
  malformed id, and a plain sentence for an incomplete payload, D40);
  `job-timeline.test.tsx` renders an entry with an `href` as a link.
  `today-appointments.test.tsx`: `AppointmentsSection`'s three D41 tiles
  and their wording (the placeholder only for a null row) and
  `TodayArrivals` (rows link to `/appointments/<id>` named "10:30, Hafiz
  Rahman, Service drop-off, late", "Still expected" links to the day,
  "N more expected later", "No more arrivals expected today" with Book).
  `schedule.test.ts`: the weekday order, hours, capacity and cutoff
  sentences and closure labels; `shopSettingsSchema` (slot lengths that
  divide the day, every bound of the `shop_settings` checks, no time zone,
  D35, D38), `shopHoursSchema` (four ordered intervals up to 24:00,
  overlaps, an open day needs hours, a closed day keeps them),
  `closureSchema` (whole days drop typed times, part of ONE day, short-day
  times in order, day order, reason 1–200), `deleteClosureSchema` and
  `appointmentTypeSchema` (5–480 minutes in steps of 5, units, names).

- Phase 6 step 4 (sales screens): `sales.test.ts` (unit) runs `previewSale`
  over the shared Cult Commons fixture table ("Cult Commons formula
  reference implementation agrees with the fixture table") and the cases
  1000/500 → 500/150, 140/70 → 21.00, 70/35 → 10.50, 1000/620 → 380/114
  and a loss → 0.00 share, per-line summing and 0 as a known price and
  cost (D1, D24); `priceWarnings` (D53: below asking for everyone, below
  cost only with a cost, 0 read as a price); the status words; `saleRange`
  around Singapore midnight and the 7- and 30-day spans; `readSaleRange`;
  `refundableAmount` (D49); and the `saleSchema`, `restockSchema` and
  `refundSchema` inputs. `ids.test.ts`, `search.test.ts` and
  `reports.test.ts` cover `S-` → `/sales/[id]` and the sale search group;
  `reports.test.ts` reads Today's consignment figures as numbers (a
  missing value is 0); `auth-helpers.test.ts` lists Sales after
  Consignment in More.

- Phase 6 step 3 (consignment screens): `consignment.test.ts` mirrors D48
  and D49 (`canViewConsignmentMoney`, `canViewSaleCosts`, `canRecordRefund`
  for an admin, inactive staff, each single permission and a
  `view_financial_reports`-only member, which reveals neither); the status
  pills (a sold item says paid or not only when the outstanding is
  visible); `outstandingLabel` / `outstandingTone` ("$300.00 owed",
  "Settled", "Overpaid $40.50 (consignor owes the shop)", never credit,
  D46); the bearer labels and explanations (D4); the item history titles
  ("Sold on J-…", "Job J-… reopened", "Restocked", "Returned to consignor",
  "N returned to consignor"); `autoAllocate` (zero, partial, exact, an
  overpayment left unallocated, items with nothing or a negative
  outstanding skipped, ties by date keep their order, unsold last);
  `allocationProblems` (sum mismatch named, override needs a reason, a
  negative outstanding caps at 0, zero and malformed amounts refused,
  D47); `paidAtFromDate` (null for today, noon Singapore otherwise, around
  Singapore midnight and month ends). `consignment-forms.test.ts`: an
  agreed amount of 0 is accepted (D24) and a missing one refused; a
  consignor or a new one is required; a single item is one at a time and
  only it may link a bike (D51); a charge needs an explicit bearer and an
  amount above 0 (D4); returns need a reason; settlements need positive
  allocations and keep an override reason. `attachments.test.ts`:
  `consignment_item` holds photos and offers Internal with Customer and
  Public blocked by D52's sentence. `ids.test.ts` / `search.test.ts`: `C-`
  opens `/consignment/items/{id}`; the `consignor` and `consignment_item`
  search kinds, labels and links (sales are not a search kind until their
  page exists). `segmented-control.test.tsx`: `value={null}` checks
  nothing, submits nothing and keeps one Tab stop on the first enabled
  segment.
- Period reports (Phase 9 step 2; D100–D105): `period-reports.test.ts`
  checks the vocabulary built from the generated enums and the cost-gated
  columns (D30); ISO Monday–Sunday weeks (a Sunday anchor included),
  month ends (29 February 2028), year boundaries, `shiftPeriod` by the
  first of the month (31 January → 1 February), `shiftRange`, the
  `autoGrain` thresholds (1 / 31 / 32 / 184 / 185 days), the range and
  bucket labels, `parseReportParams` defaults and fallbacks for every
  invalid value, custom ranges refused with `BUSINESS_ERRORS`'
  `report_range_invalid` / `report_range_too_long` (731 days pass, 732
  do not), a today taken at 23:30 UTC being the next Singapore day,
  `reportHref` keeping parameters but dropping cursors, and the breakdown
  row links. `csv.test.ts`: BOM, CRLF, RFC 4180 quoting, nulls as empty
  fields, the formula-injection quote on text cells only (a negative
  money cell stays `-50.00`), shop-local datetimes, unicode names.
  `report-exports.test.ts`: the export kind table (every financial kind
  needs View financial reports, `mechanics` any staff, `manage_purchasing`
  alone never opens a financial export, D60), cost-gated columns dropped
  without View costs, the TOTAL row written from the summary, the file
  name and link.

### Database (SPEC §27.2 and §23)

Each invariant from SPEC §23 has at least one test, named after it:

| Invariant | Test |
|---|---|
| Unique unit cannot be sold twice | `record_retail_sale` twice on one unit → second raises; one `sold` movement. Built in Phase 6 step 2: `sales.test.ts` "A unique inventory unit cannot be sold twice" (`unit_already_sold`, one `retail_sale` movement, an owner insert of a second live line → 23505 `sale_lines_unit_sells_once`, resale only after `restock_unit`) and `consignment-concurrency.test.ts` "…, concurrently". |
| Stock-consuming line consumes once | call `add_inventory_line` with the same idempotency key twice → one line, one movement; concurrent calls (two connections) → one movement. |
| Void creates reversal, never deletes | `void_line` → original movement intact, one `reversal` row with `reversal_of_id`; second `void_line` → no-op. |
| Duplicate Shopify webhook has one effect | insert the same `integration_events` twice (unique violation) and call `process_shopify_order_paid` twice → one sale, one movement per line. |
| Snapshots do not change with catalog edits | add service line, update `services.default_sale_price` → line totals unchanged. Phase 3: `update_service` price, cost and name → the earlier line keeps 180.00/20.00/"Full Service", the next one uses the new values. |
| Sale liability ≠ settlement | sell a consigned bike → `consignor_ledger.outstanding = agreed_amount_owed`, `paid = 0`. Built in Phase 6 step 2: `settlements.test.ts` "Consignment sale liability and consignment settlement are separate facts" and "Consignment outstanding balance and partial settlements" (200.00 then 300.00 → 0.00). |
| Settlement cannot exceed owed | `record_settlement` over-allocating without override → raises; with override by `manage_consignments` → succeeds and stores reason. Built in Phase 6 step 2: `settlements.test.ts` "Settlement allocations cannot exceed the amount owed without an explicit override" (600.00 against 500.00 → `settlement_exceeds_outstanding`; with a reason it stores the trimmed reason and leaves −100.00; an unsold item needs one too) and the concurrent case in `consignment-concurrency.test.ts`. |
| Customers cannot read internal data | as customer A: select from `work_order_line_items`, `products`, `inventory_movements`, `customers.internal_notes` → zero rows or column permission error; `work_order_totals` returns no cost columns. |
| completed_at ≠ collected_at | status walk → both stamped at different times; `collected` cannot precede `completed`. |
| Booking cannot exceed capacity | fill a slot to capacity → next `book_appointment` raises; two concurrent bookings for the last unit → exactly one succeeds. Also: outside hours, inside closure → raise. Built in Phase 2: `appointments.test.ts` "SPEC §23 Booking cannot exceed capacity (D2)" (a full window → `appointment_capacity_exceeded`; a 60-minute type blocked by either window; a 2-unit type needs two free units in every window; cancelled and no-show appointments free their units) and `appointment-concurrency.test.ts` (committed, real connections: two bookings for the last unit, a 60- and a 30-minute booking racing for their shared window, a staff and a customer booking racing, the same id twice → one row and one `booked` event, a no-show reinstated as arrived racing a booking for its freed unit, one customer booking two days at once with one booking left → exactly one each; the used units equal the capacity afterwards; and two concurrent check-ins of one appointment → one work order, the second returning `created` false with the same `work_order_id`). |
| Bookings respect shop hours and closures (Phase 2, D38) | `appointments.test.ts`: before opening, at closing, crossing closing time, crossing a lunch gap and an inactive weekday → `appointment_outside_hours`; a whole-day and a partial closed override → `appointment_closed`; custom hours shorter and longer than the weekly hours; a start off the grid (or with seconds) → `appointment_slot_misaligned`. `appointment-slots.test.ts` runs every case of `tests/fixtures/appointment-slot-cases.ts` through `private.available_slots_at` (exact local slots and remaining units: split days, adjacent intervals, inactive Monday, closures, custom hours with and without a closure, 2-unit types, cancelled/no-show freeing units, 10:15 opening, 15-minute grid, staff mid-day, public notice and horizon, non-public and inactive types, 24:00 closing) and every `problemCases` row through `private.appointment_slot_problem` (each code and their order); `public.available_slots` as anon and as a customer returns remaining_units NULL and public types only, staff see the units. Step 3's TypeScript mirror runs the same cases. |
| Self-booking rules (Phase 2, D37) | `appointments.test.ts`: inactive type → `appointment_type_unavailable`; staff `appointment_in_past` for an appointment that is over, but a started one may be booked, without notice or the public flag; customers (`book_my_appointment`): `appointment_too_soon`, `appointment_too_far_ahead`, a non-public type; the per-customer limit (precondition asserted; a staff booking first does not count; customer bookings up to the limit; the next → `appointment_customer_limit`; a replay is not a new booking; a staff booking still succeeds; cancelling frees a place); bike not owned / archived / unknown, archived or unknown customer. `appointment-customer-access.test.ts`: cancel cutoff (inside it, after the start, once arrived → `appointment_not_cancellable` and `can_cancel` false; outside it `can_cancel` true; the cutoff follows `customer_cancel_cutoff_minutes`), the default reason 'Cancelled by the customer' in `cancellation_reason` and the event, `cancelled_via` customer, a replay adds no event, a staff-made appointment is theirs to cancel; staff without a customers row → 42501. |
| Booking is idempotent; snapshots never move (Phase 2, SPEC §2, D38) | `appointments.test.ts`: the same id and arguments → the same row and one `booked` event; another start, customer, type or day under the id → `appointment_conflict`; a replay after the type is deactivated (and the day closed) returns the original row with no event, and a customer's replay after the type stops being public too; changing the type's duration and units, the slot length and the hours leaves `ends_at`, `capacity_units` and the status as booked, and `ends_at` is immutable for the owner. `schedule-settings.test.ts`: slot length, hours, a closure and a type edit leave a booked appointment untouched (same `updated_at`). |
| Appointment status machine (Phase 2, D39) | `appointments.test.ts`, table-driven from `tests/fixtures/appointment-transitions.ts`: `mark_appointment_status` for all 49 pairs (ok with one event, replay without, or the code: `appointment_use_check_in`, `appointment_use_cancel`, `appointment_transition_invalid`); `appointment_not_started` before the start; no_show → arrived on its own date refused while its place is taken (`appointment_capacity_exceeded`) and allowed once a unit frees, on another date `appointment_transition_invalid`; the trigger refuses the same off-diagonal pairs for the owner and needs a reason to cancel; `cancel_appointment` from every status; reason first (`reason_required` even for an unknown id, `reason_too_long`), P0002, `cancelled_via` staff, a replay returns the row without an event. |
| Appointment changes leave history (Phase 2, SPEC §2, §22) | `appointments.test.ts`: booking, confirming and each bike or note change append exactly one `appointment_events` row with actor staff, auth user, reason and the request's correlation ID; replays and no-op updates append none; `details_changed` payloads carry only the changed fields; the bike changes only before check-in and stays the customer's; the customer's note freezes once the appointment is over; `appointment_events` refuse UPDATE/DELETE for the owner (`appointment_history_append_only`); mechanic2 (no permissions) books, marks, updates and cancels; customers and anon get 42501 from the staff RPCs and nobody writes the tables directly. |
| Check-in creates or links exactly one work order (Phase 2, D36, D40) | `appointment-check-in.test.ts`: check-in creates a job with `appointment_id`, the job number, P3's `checked_in` then `appointment_linked` (created true) then the lead's assignment, actor the caller (mechanic2, no permissions); the appointment is checked_in with `checked_in_at`, `arrived_at` and the bike, its history `booked, checked_in, work_order_linked`; requested work defaults to the customer's note, blank both → `requested_work_required` with the appointment unchanged; a replay with the same or another `work_order_id` returns the same link (created false) and creates nothing; another job's id → `work_order_conflict`, appointment unchanged; `link_existing` to an open unlinked job of the same customer and bike sets only `appointment_id` and writes `appointment_linked` (created false); another customer's or bike's job, a completed / ready / collected / cancelled job or an already linked one → `appointment_work_order_mismatch`, an unknown one P0002; changing or clearing a set link → `work_order_immutable` (P3's detail); from cancelled or no_show → `appointment_transition_invalid`, from checked_in or completed → the existing link; someone else's bike or a shop bike → `appointment_bike_not_owned`, archived → `appointment_bike_archived`; nulls 22004, unknown appointment P0002; an owner insert or `private.create_work_order` with an appointment not checked in → `appointment_not_checked_in`, of another customer or bike → `appointment_work_order_mismatch`, the same on the null → value update; a second job for one appointment → 23505 `work_orders_appointment_id_key`; walk-ins unaffected; D36: completing the job completes the appointment once at the job's `completed_at` with the actor, ready and collected add nothing, a reopen and re-completion leave it, a cancelled job leaves it checked_in; customers never see `appointment_linked` in `my_work_order_timeline`; customers and anon 42501. `work-orders.test.ts` (P3's link-once case) uses real checked_in appointments. |
| Appointment counts (Phase 2, D30, D41) | `appointment-reporting.test.ts`: `public.appointment_daily` over the seeded days (anchor −10 … +21) equals the counts the appointments table implies by scheduled shop day and current status, zero-filled, and `reporting.appointment_daily` (owner) holds exactly the days with appointments; `daily_summary`'s three appointment columns equal its booked / arrived / no_shows for every seeded day; `today_dashboard(null)` gives mechanic2 the same counts as the admin; customers (Chloe's login) and anon 42501; the range rules match `daily_summary`; booking, arriving, a no-show and a cancel today move today's counts exactly, and a no-show marked now on an older appointment counts on its own day; every checked_in or completed appointment has exactly one work order with its customer and bike. `reporting.test.ts` checks the columns against `appointment_daily` on test days with appointments; `reporting-access.test.ts` lists the RPC and the view. |
| Seeded schedule and appointments (Phase 2) | `appointment-seed.test.ts` (reads only, days from the anchor): settings, the eight weekly rows (inactive Monday, split Saturday), the four types (one staff-only; anon sees the three public ones in order), the two closures as whole days within 14 days; each appointment's customer, bike, type snapshot, day, time, status and source as in `ids.ts`, booked ahead; nothing beyond 14 days, upcoming days Tuesday–Friday off the closures; Daniel has no upcoming booked/confirmed appointment, Chloe at most two upcoming online bookings, today at most three expected arrivals; Tan's appointment linked to J-000014 and completed at its completion, J-000014's timeline `checked_in, appointment_linked, …`; each status reached one update at a time; Chloe's login linked and `my_appointments()` exactly her upcoming rows with the D42 keys. |
| Schedule configuration (Phase 2, D35, D38) | `schedule-settings.test.ts`: only admins call `update_shop_settings`, `set_shop_hours`, `save_closure_override`, `delete_closure_override`, `save_appointment_type` (mechanic1, mechanic2, anon → 42501); no time zone or currency parameter and an owner write of an unknown time zone → `shop_timezone_invalid`; null keeps, values round-trip (`customer_cancel_cutoff_minutes`; 10081 → `shop_settings_cancel_cutoff_check`; a slot length not dividing 1440 → `shop_settings_slot_minutes_check`); `shop_capacity_below_type` (inactive types ignored); the row cannot be deleted; `set_shop_hours` replaces atomically, rejects overlaps (also for the owner), bad JSON and weekdays (22023) and inverted intervals, a replay appends nothing; closure shapes store the documented Singapore instants; `closure_custom_hours_overlap`; `closure_invalid_range` and reason rules; is_new replays, `closure_conflict` / `appointment_type_conflict` after an edit (the edit survives), P0002 for a missing edit; deletion needs a reason and is kept in `schedule_events`; `appointment_type_capacity_too_large`, names unique ignoring case; one `schedule_events` row per real change with its actor, append-only. `appointments.test.ts`: `private.shop_timezone()` / `shop_currency()` follow the settings row. |
| Duplicate receipt cannot double stock | Phase 7, proven at every layer. Database (`purchasing.test.ts`, `purchasing-concurrency.test.ts`): `receive_purchase` with the same idempotency key twice → the first receipt back, one receipt, one line, one movement, stock +18 once and the cost set once; the same key with other lines or on another PO → `purchase_receipt_key_reused` and nothing written; a replay that omits the cost matches the stored cost (an omitted cost is the PO line's); the same key from two connections at once → one receipt, stock added once; `purchase_receipt_by_key` returns that receipt (zero or one row). Ledger backstop: Phase 4's unique index `inventory_movements_receipt_line_once` (one `purchase_received` movement per receipt line, the only unique index on the column). App: `receive-form.test.ts` (the key is kept across reloads and refusals, an unknown outcome locks the form until the lookup, a retry reuses the key and the values, a new key only with fresh values). E2E (`purchasing.spec.ts`): a double-clicked "Receive 18 items" makes one receipt and one `Received +18` movement; a lost response (server committed, connection dropped) is found by the lookup and shown as recorded, one receipt, stock +6 once; a lost request (never sent) is checked, not recorded, and retried with the same key, one new receipt. |
| Partial receipt adds the right stock (Phase 7) | 18 of 20 → `partially_received`, on hand +18, outstanding 2 in `reporting.purchase_order_progress`; the remaining 2 → `received` with `received_at`; quantities reduced to what arrived complete the PO; seeded PO-000002 is SPEC §14's 20/18/2, overdue (`purchasing.test.ts`, `purchasing-seed.test.ts`; E2E "18 of 20 received · 2 to come"). |
| Over-receipt is refused and a received PO is closed (D65) | more than outstanding (summed per PO line across a receipt's locations) → `purchase_over_receipt`, nothing written; draft → `purchase_order_not_submitted`; received or cancelled → `purchase_order_closed`; two racing keys each receiving 18 of 20 → one succeeds, one over-receipt; receipts and their lines refuse UPDATE/DELETE (`purchase_receipt_immutable`). App: typing more than is to come shows "Only 2 still to come. Raise the ordered quantity on the order first." and blocks the commit; the receive page of a received PO shows the closed state with "Start a new order for this supplier" (E2E). |
| Last cost by received_at; 0 is a known cost; snapshots untouched (D5, D63, D24 as amended) | a receipt sets `products.default_direct_cost` and the supplier link's `last_unit_cost` only when no later-received receipt holds the product (a back-dated receipt entered after a newer one changes no cost; ties by created_at then id; within a receipt the highest line number); `last_received_at` is the greatest; receiving upserts the supplier link; a 0 line cost and a 0 actual cost are accepted and become the last cost; the cost change is Phase 4's `cost_changed` event with "Received on PO-… (delivery note …)"; earlier `work_order_line_items` and `inventory_movements` snapshots are unchanged (`purchasing.test.ts`, concurrency file for racing receipts). E2E: received at $12.50 → the product's supplier shows "Last cost $12.50". Unit: `buildReceiptLines` keeps "0.00", `receivePurchaseSchema` accepts 0. |
| Back-dated receipt dating (D64) | `received_at` defaults to now; up to 30 days back accepted, older → `purchase_receipt_too_old`; more than 5 minutes ahead → `purchase_receipt_in_future`; before `submitted_at` → `purchase_receipt_before_submission`; the movement's reason carries the shop-time delivery date. Unit: `receivedAtBounds` and `receivedAtForSubmit` (sent only when changed, from shop time); the three codes land on the Received field (reducer test). |
| Purchase cost visibility (D60) | `purchasing-access.test.ts`: mechanic2 reads suppliers, PO quantities, statuses and dates, but no cost column (42501 on the base tables' cost columns, 0 rows from the four `*_staff` views, no history) and writes nothing; mechanic1 (view_costs) reads costs and history but writes nothing; a manage_purchasing-only holder reads purchase costs and writes, gets the `purchase_cost_defaults` prefill only for an orderable product (a unique, consigned, customer-owned, inactive or archived product's id returns no row), and the Phase 3/4/5 cost surfaces stay closed to them (`products.default_direct_cost`, `product_costs`, `inventory_unit_costs`, `inventory_movement_costs`, `inventory_movements.unit_cost_snapshot`, `services_staff`, `work_order_line_items_staff`, `work_order_totals_staff`, `work_order_yield`, `financial_lines`, the money in `daily_summary` / `today_dashboard`). E2E: mechanic2's PO page has no "$", no Totals or History, no Receive link; the receive and reorder routes are a real 403. |
| Purchase history is append-only (Phase 7) | every PO change appends one `purchase_order_events` row with actor, correlation ID and reason (cancel and line changes after submission need one); replays append none; UPDATE/DELETE refused for the owner too (`purchase_order_history_append_only`). |
| Reorder suggestions (D66) | `purchasing-reorder.test.ts`: `suggested_reorder_quantity` = max(2 × reorder point − on hand − on order, 0); `reorder_suggestions` lists shop-owned `reporting.low_stock` products only, on order counts submitted and partially received POs (never drafts), names drafts holding the product, carries no cost; `create_purchase_order_from_low_stock` makes one draft, a 0 suggestion ordered at 1, cost = supplier last cost, else product cost (0 included), else 0, replay by id adds nothing; manage_purchasing only. E2E: after receiving 18 of 20 and using 1, the product is pre-ticked with on order 2 and suggestion 21, and the draft has it × 21 at $12.50. |
| Consigned stock is never purchased (Phase 7 integration with Phase 6, D45, D62) | `purchasing.test.ts` "Phase 6's consigned stock is never purchased": the seeded consignment-owned jerseys (counted, active, in stock) are refused as a PO line, in `create_purchase_order_from_low_stock` and as a supplier link (`purchase_line_not_shop_owned`), and `purchase_cost_defaults` returns no row for them. For `reorder_suggestions` the test first gives the jersey a reorder point above its stock and proves it is in `reporting.low_stock`, then that the suggestions (with and without a supplier) still return no row: only its ownership keeps it out. |
| Manual adjustment records actor/time/reason | `adjust_stock` without reason → raises; with reason → row has `created_by`, `reason`. |
| Public QR exposes only published | `public_items` as anon: draft/internal rows absent; public row shows no cost; sold unique shows `sold`. Built in Phase 4: `inventory-publication.test.ts` (row below). |
| Archived entities stay referenceable | archive a service used on a historical job → job line still joins. Phase 3: the service, the job's bike and its customer archived → the line still joins the service and the job its bike and customer; the archived service is refused for new lines. |
| Money is numeric | information_schema check that no money column is `real`/`double precision`; money and rate domains reject `NaN` (23514). |
| Staff changes leave history (SPEC §2, §22) | each grant, revoke, deactivation, reactivation, creation, role change and rename appends exactly one `staff_events` row with its actor; replays append none; deactivation without a reason raises `reason_required`; `staff_events` refuses update/delete (`staff-history.test.ts`). |
| Staff rules hold for every writer | no direct staff writes for API roles; staff.email must equal the login's email even for the owner; nobody signed in deactivates their own row; a manage_staff holder grants only permissions they hold, never manage_staff, never on themselves or admins (PLAN D11). |
| Three staff roles (D90–D94) | `staff-roles.test.ts`. The enums are `admin \| manager \| mechanic` and the seven permissions in the app's order; `private.role_implies` equals `roleImplies()` from `src/lib/auth/permissions.ts` for every role × permission (parity), a null role implies nothing, and no API role may execute `role_implies` or `can_record_refunds`; `staff.role` and `create_staff`'s role default to `mechanic`. The role × permission matrix: for the admin, the seeded manager, the manager with a `manage_staff` exception, mechanic2, mechanic1 (`view_costs` exception), a throwaway mechanic granted each single permission in turn, a mechanic holding all seven as exceptions, an inactive manager and an inactive admin, `private.has_permission` and `my_staff_profile().permissions` give exactly the expected set, plus `can_record_refunds` and `is_admin`. One gate per family, called as each of them (42501 for refused callers, anything else for allowed ones with bogus ids): `work_order_yield`, rows of `product_costs` and `services_staff` (view_costs); `create_service` and a `categories` insert under RLS (manage_inventory); `adjust_stock`, `write_off_unit`; `consignor_payout_details`, `create_consignment_item`; `create_purchase_order`, `purchase_cost_defaults`; `financial_lines`; `staff_roster`, `staff_history`, `grant_permission`, `create_staff`, `set_staff_active`, `update_staff` (manage_staff); `record_sale_refund` (admin and manager only); `update_shop_settings`, `schedule_cult_commons_rate` (admin only). Exceptions (D92): granting a permission the role implies (manager + any of six, admin + any) is `permission_implied_by_role`, also for a direct superuser insert; an admin grants `manage_staff` to a manager, who then holds all seven; promoting a mechanic with `view_costs` + `manage_purchasing` to manager deletes both rows and appends `role_changed` then two `permission_revoked` events with the admin and the reason; a replayed role change appends nothing; demoting brings nothing back; promoting to admin drops every row, and a role change by SQL drops implied rows too; after the migrations and the seed no row is implied by its person's role; the roles migration's one-time clean-up (`private.drop_implied_exceptions()`, run by `20261006000200`) removes implied rows written before the roles (built with triggers off: an admin's `view_costs`, a manager's `adjust_stock`), each with a `permission_revoked` event with no actor and the fixed reason, keeps real exceptions (the manager's `manage_staff`, Marcus's `view_costs`), and a later demotion brings nothing back. `staff-concurrency.test.ts` (two committed connections, its own database): a direct insert that waits on a concurrent promotion is refused (`permission_implied_by_role`) once it commits, and a promotion that waits on a concurrent direct insert deletes that row once it commits (`permission_granted`, `role_changed`, `permission_revoked`, in that order); both fail if the refusal trigger's `FOR SHARE` is weakened to `FOR KEY SHARE` (checked once by hand). Administration (D93): only an admin invites a manager or an admin (a mechanic and a manager holding `manage_staff` invite mechanics only); a non-admin `manage_staff` holder grants only what they hold to a mechanic and is refused (42501) on a manager's or an admin's row for grant, revoke, rename, deactivate and role change, and on their own row; the admin renames, deactivates, reactivates and demotes a manager; nobody changes their own role; the last active admin cannot be demoted (55000); a role change whose `expected_role` is not the current role (a stale confirmation) is `staff_role_changed`, changes nothing and appends no event, and goes through with the current role; a role-change reason over 500 characters is `reason_too_long`. `sales.test.ts`: a manager records a refund; mechanics, with `view_financial_reports` or all seven exceptions, are refused (D94). `staff-history.test.ts`: promoting Marcus to admin appends `role_changed`, then the `permission_revoked` of his `view_costs` with the same actor and reason, then the rename. |
| The Admin's sign-in limits (PLAN D72) | `sign-in-throttle.test.ts`: `note_sign_in_attempt` adds one per bucket per call (a bucket named twice counts once) and returns the counts; a new window starts a new count, windows are aligned, counters older than a day are deleted; 6 concurrent committed calls count 6; anon and staff get 42501 on the function and the table, the service role on the table; malformed arguments (no, 0 or 9 buckets, an empty, null or 201-character key, a window under 60 s, over 3600 s or null) are 22023. Live: `sign-in-throttle.stack.test.ts` (above). |
| No seeded login has a usable password (PLAN D10) | `seed-logins.test.ts`: every seeded staff login and the seeded customer login store a bcrypt hash (cost 10) that is not the shared local password the seed used before email codes, and no two share a hash. |
| Deactivation ends Auth sessions (PLAN D71) | `staff-sessions.test.ts`, with sessions and refresh tokens inserted for mechanic1 and mechanic2: the admin deactivating mechanic2 (with a reason) deletes mechanic2's sessions and refresh tokens (with and without a session) and leaves mechanic1's; a replayed deactivation (with or without a reason) neither errors nor deletes; reactivation deletes nothing; a `manage_staff` holder who is not an admin deactivating a non-admin has the same effect; a refused deactivation (P0001 `reason_required`) leaves the sessions intact; a direct superuser `update staff set active = false` revokes too (false over false and updates of other columns do not); the migration's first statement passes for the migration role and fails, naming RUNBOOK, for a role without DELETE on `auth.sessions`. Live (`staff-sessions.stack.test.ts`): a throwaway staff login (admin API without a password, then `create_staff` as the admin) signs in with a code and is deactivated by the admin; Auth then answers its access token with 403 `session_not_found` (supabase-js: `AuthSessionMissingError`), its refresh token gets `refresh_token_not_found`, PostgREST still accepts the unexpired token but `my_staff_profile` says `active = false` (the hosted window), and a fresh code still verifies at Auth while `my_staff_profile` says `active = false`, which the Admin's `verifyCode` and `requireStaff` refuse. |
| RLS: customer A cannot read B | bikes, appointments, work orders, attachments. Phase 1 (`customer-access.test.ts`): a signed-in customer reads zero rows from every base table; `my_customer_profile`, `my_bikes`, `my_bike_attachments` return only their own rows, never `internal_notes` or `internal` photos; another customer's bike id returns nothing; PLAN D12: after a transfer the new owner sees photos taken before it and the previous owner none (also on the seeded sale), and an archived bike's photos disappear. Phase 3: a signed-in customer reads nothing of their own job (job, assignments, events, lines, line and totals views, services, categories, rates) and cannot call the workshop RPCs (42501); their projection is tested in `workshop-customer-access.test.ts` (row below). Phase 2 (`appointment-customer-access.test.ts`): a signed-in customer with their own booking reads zero rows from `appointments`, `appointment_events`, `appointment_types`, `shop_hours`, `closure_overrides`, `shop_settings` and `schedule_events`; `my_appointments()` returns only their own upcoming rows soonest first and `my_appointments(true)` the past ones after them, latest first, with exactly the `my_appointment` keys (D42: never `internal_note`, `cancellation_reason`, capacity units, source or actors); after the bike is archived or transferred (D12) its fields are NULL for them; `book_my_appointment` books for themselves only (source customer, their login), another customer's or an unknown bike → `appointment_bike_not_owned` with a neutral detail; `cancel_my_appointment` on someone else's id → NULL and nothing changes. |
| Ownership changes preserve history (SPEC §5) | `transfer_bike_ownership` appends one event with actor, reason and correlation ID and leaves earlier events untouched; empty/blank reason → `reason_required`; replay → no event; plain updates of `customer_id` refused (42501 for staff, `reason_required` for the owner); events append-only; concurrent transfers form one chain (`customers-bikes.test.ts`). |
| Stable physical identity | bike short IDs are server-assigned `B-######`, increasing, unique, never client-supplied (42501) and immutable (`bike_short_id_immutable`). |
| Storage enforces visibility (SPEC §8) | `media-internal`: anon, customers and inactive staff read/write nothing, active staff read and add; `media-public`: only active staff read or list it through the API, only staff add; nobody overwrites; staff delete only objects no attachment points at (`media-storage.test.ts`); live signed-upload round trip with anon download refused, a bare Storage remove of a recorded photo refused, `delete_attachment` replay is `[]` (`stack.smoke.test.ts`). |
| Attachment visibility move (PLAN Phase 1) | The app's own domain code against real Storage (`photo-moves.stack.test.ts`): internal → public → internal → deleted, a stranger's fetch of the public URL succeeding only while public and the original removed each time; refused moves (customer record, undecoded original) copy nothing; a failed cleanup reports `cleanupPending`, Finish removes the leftover, and a leftover nobody finishes is swept when the record is shown. E2E does the same through the viewer. |
| Lists and search name records alike | `customerLabel` (TypeScript, used by table-backed lists) equals `private.customer_label` for every fallback case, and `bikeTitle`/`bikeSubtitle` equal `staff_search`'s title and subtitle for every seeded bike (`display-parity.test.ts`). |
| Attachments describe real objects | `record_attachment` rejects a path that is not `{entity_type}/{entity_id}/{id}.{ext}`, a missing object, the wrong bucket, a non-photo, an unknown entity; replay-safe; delete needs a reason and is kept in `attachment_events`; an undecoded original (no dimensions) is never public; `attachment_stray_objects` lists only what no row points at and is old enough (`attachments.test.ts`). |
| Anonymous cannot read costs/notes | every table in the RLS matrix: anon select returns 0 rows or is denied. |
| Anonymous sees public appointment types only (PLAN Phase 2, D37) | `appointment-customer-access.test.ts`: as anon, `public_appointment_types()` lists active public types only, with exactly `id, name, description, duration_minutes` (no capacity units); `public_shop_hours()` the active weekly rows in order; `available_slots` works for a public type and is empty for a non-public one; every staff, admin and my_* appointment RPC and every appointment and schedule table → 42501. |
| Mechanic permission boundaries | staff without `view_costs` cannot select cost columns; without `adjust_stock` cannot call `adjust_stock`; admin can. Phase 3: mechanic2 `select cost_total` / `unit_direct_cost_snapshot` / `cult_commons_share` / `*` on `work_order_line_items` → 42501, `work_order_line_items_staff` and `work_order_totals_staff` → 0 rows, `work_order_totals` → sale columns only; mechanic1 sees costs, yield and Cult Commons. |
| Consignment sale yields correctly | $1,000 sale, $500 owed → yield 500, CC 150. Built in Phase 6 step 2: `sales.test.ts` "Consignment sale creates correct liability and yield" (cost 500.00, yield 500.00, CC 150.00, payout 500.00, liability 500.00, item sold with one active→sold event, no settlement written; a 120.00 shop charge → 620.00 / 380.00 / 114.00; a 45.00 consignor charge leaves the line and lowers owed) and the seeded S-000003 in `consignment-reporting.test.ts`. |
| Cult Commons rate snapshot | insert a new rate effective tomorrow; lines today use 0.30, lines after use the new rate; old lines unchanged. Phase 3 (`work-order-lines.test.ts`): a rate scheduled for tomorrow leaves today's lines at 0.30; an owner-inserted 0.25 rate effective now gives the next line 0.25 while the earlier line keeps 0.30. |
| Cult Commons is 30% of positive yield after direct costs (SPEC §10, D1) | every row of `tests/fixtures/cult-commons.ts` through `add_manual_line` equals the generated columns (rates other than 0.30 through an owner-inserted rate row), and both job fixtures equal `work_order_totals_staff` (the D1 job: 180.00, not 171.00); the same table runs through `src/lib/cult-commons.ts` in the unit project. |
| Cult Commons rates are effective-dated and append-only (D21) | `workshop-catalog.test.ts`: the base 0.3000 row from 1970 ships with the migration; `cult_commons_rate_at` at, just before and before any rate (`cult_commons_rate_missing`); UPDATE/DELETE refused for the owner too; schedule/cancel admin only (view_costs is not enough), never backdated (`rate_backdated`), duplicate start 23505; cancelling a future rate restores the previous one, replays, frees its start time; a rate in effect cannot be cancelled (`cult_commons_rate_in_effect`), not even by the owner, and nobody un-cancels. |
| Services' costs are gated (SPEC §4.2, D14) | mechanic2: `select default_direct_cost` / `select *` from `services` → 42501, `services_staff` → 0 rows; mechanic1 and admin read costs; create/update/archive need manage_inventory; a cost needs view_costs (null on update keeps it); a manage_inventory holder without view_costs making `update_service` fail a check (negative price, blank or long name, long description) gets 23514 with the constraint and no DETAIL, never the stored cost; replay by id, `service_conflict`, `category_kind_mismatch`, active-name uniqueness and reuse after archive; categories: staff read, manage_inventory writes. |
| Work order status machine (D15, D16) | `work-orders.test.ts`: `private.work_order_transition_rule` equals `transitionRule` (src/lib/workshop.ts) for all 121 pairs; `set_work_order_status` accepts exactly the allowed 110 off-diagonal pairs (a fresh job driven to each from-state, each move tried in a rolled-back savepoint) and refuses the rest with `work_order_transition_invalid`; reason-required moves refuse a blank note; the trigger alone (the owner's direct UPDATE, which the RPC's own checks never reach) refuses the same 110 pairs the same way and a reopen or cancel without `private.set_change_reason` (`reason_required`); the 11 same-status calls are replay no-ops (row unchanged, no event); reopen needs a reason, clears completed_at/ready_for_collection_at, keeps started_at and the earlier `completed` event; cancel needs a reason and no live line (`work_order_has_lines`, also for the owner); stamps, number, customer, bike, check-in time and lead are immutable without the proper path (`work_order_immutable`); `appointment_id` is linked at most once (D40, with real checked_in appointments: null → a value succeeds once with nothing else changed and exactly one `appointment_linked` event (created false), leaving it equal is a no-op, another appointment, a random id or null → `work_order_immutable`, also when `private.create_work_order` stored it at check-in with `checked_in` then `appointment_linked` (created true)); backwards `status_changed_at` is 22023. |
| Check-in is atomic and replay-safe (SPEC §2, §7.1) | `create_work_order` writes the job (J-######, increasing), `checked_in`, assignment and `line_added` events in that order with actor, auth user and the request's correlation ID; a bad service line rolls everything back and the burned number is never reused; replay by id returns the same row with no new event, line or assignment, even after the bike changed hands, the customer was archived and the job completed (and burns no number); another bike under the same id → `work_order_conflict`; archived customer/bike, D18 `bike_owner_mismatch` (shop bikes accepted), blank requested work, customers and inactive staff refused; no direct writes. |
| Timeline events carry no costs (SPEC §7.3, §4.2) | one event per action with its documented payload; no-ops write nothing; `add_work_order_note` replays on its note id (same event back, `note_conflict` on another job); `set_approval_flag` with a null note keeps the stored note, '' clears it; after a full scenario with a manual line costing 62.00 (sold at 95.00), a recursive walk of every payload finds no key matching /cost\|yield\|cult\|commons\|rate/i and no value equal to 62, while 95 appears; `work_order_events` refuses UPDATE/DELETE for the owner (`work_order_history_append_only`); `work_order_timeline` names actors and assignment subjects, newest first, clamps max_rows to 1..2000. |
| Assignments (D22) | one active lead per job; a new lead closes the previous lead's row (not demoted); additional → lead switch; replay no-op; unassign returns null on replay; `staff_inactive`; `work_order_closed` on collected/cancelled jobs; `lead_mechanic_id` equals the active lead after every operation; rows are immutable except closing once (`assignment_immutable`). |
| Job photos are never public (D19) | `record_attachment` on a job writes `photo_added`; `delete_attachment` writes `photo_removed` with the reason; unknown job P0002; `product` and `inventory_unit` accepted from Phase 4 and `consignment_item` from Phase 6 (unknown → P0002); public via `record_attachment` or `set_attachment_visibility` → `attachment_work_order_never_public`; CHECK `attachments_work_order_never_public` exists. |
| Lines (D14, D15) | `work-order-lines.test.ts`: sale-price overrides by anyone, cost overrides only with view_costs (42501); a manual line with no cost (mechanic2's always, an admin's left empty) is `cost_pending` with cost 0 while one with cost 0 entered is not, `work_order_totals_staff.cost_pending_count` counts the live ones and drops a voided one once it is re-added with its cost, the flag is immutable for the owner and the CHECK keeps it to costless manual lines; mechanic2's bad quantity or price on `add_service_line` / `add_manual_line` / `create_work_order` services gets 23514 with the constraint and no DETAIL (the service's cost never appears); inactive/archived service `service_unavailable`; quantity 0/10000/negative price 23514, NaN quantity refused, overflowing totals 22003; lines locked once completed (`work_order_locked` for a new add and for void) and unlocked after reopen; replays of add_* after completion return the original id with no new event; void needs a reason, keeps the row, replays without a second event and leaves the totals; owner edits, un-voids and deletes → `line_immutable`; Phase 4: voiding an inventory line writes its linked reversal and restores stock (`line_type_unsupported` is gone); same line id on another job or type → `line_conflict`; line and service RPCs return ids only. |
| Workshop concurrency (SPEC §25, D18, D22) | `workshop-concurrency.test.ts` (committed, real connections): same-id check-ins → one job, one `checked_in`; a check-in waiting on a bike being transferred fails with `bike_owner_mismatch`; a transfer is still pending (and waiting on a lock in `pg_stat_activity`) while a check-in holds the bike, and succeeds once it commits; two leads at once → one active lead mirrored on the job; a line racing completion is either before `completed_at` or refused with `work_order_locked` (both orders and a free race); same line id twice → one line, one event; two collections → one `collected`; two voids → one `line_voided`. |
| Customer job projection (SPEC §4.2, §23; D8, D17, D19) | `workshop-customer-access.test.ts`, on the seeded jobs: a signed-in customer reads 0 rows from `work_orders`, `work_order_assignments`, `work_order_events`, `work_order_line_items`, `services`, `categories`, `cult_commons_rates`, `work_order_totals` and the three `_staff` views; `my_work_orders` returns exactly their non-cancelled jobs newest first (Tan: J-000001, not the cancelled J-000008) with exactly the documented keys and the coarse status (Priya's diagnosing J-000009 reads `received`, its voided line out of the total); `private.customer_job_status` maps all 11 statuses; `my_work_order_lines` has exactly description, quantity, unit price, total, currency and id, live lines only; `my_work_order_timeline` is check-in plus customer-status changes only (received → diagnosing, notes, approvals, assignments, lines and in_progress ↔ paused add nothing; completing and reopening do) plus customer photos still on the job (internal, re-hidden and deleted ones absent); `my_work_order_attachments` never internal; cancelled jobs and another customer's job return nothing; D17: after a transfer the previous owner keeps the job and the new owner does not see it (also on the seeded Bianchi sale), a job on a bike archived afterwards is still listed; staff without a customers row and archived customers get nothing; anon is refused (42501). |
| Jobs in staff search (SPEC §7.2, §20) | `staff-search.test.ts`: "J-000004", "j000004", "J000004" rank 1.0 with Chloe's Giant as title, "customer · requested work" as subtitle and the job number as short_id; "000004" contains-match at 0.6; at least three characters; cancelled and collected jobs found; the kinds filter keeps jobs in or out; `archived = true` returns no jobs; an unknown kind is 22023 (`supplier` since Phase 4 made `product` known). |
| The seed's timelines read true (TESTING "Seed data") | `workshop-seed.test.ts`: J-000001…J-000009 with their customer, bike, status, lead (= the active lead assignment) and stamps at their exact offsets from check-in; J-000001/J-000002 totals exactly as documented through `work_order_totals_staff`; J-000009's voided line out of its total; exactly one D20-overdue job at seed time (J-000006, through `isOverdue` with `now` pinned to J-000007's check-in, so an existing seeded database that has aged still passes); for every job: events in id order strictly increasing in time, exactly the expected events by type, nothing but J-000007 stamped within 30 minutes of the seed, every trigger-written actor equal to the row's `created_by` / `assigned_by` / `voided_by` and every status change by the job's lead, costed lines added by a view_costs holder, no line event after completion; J-000007 checked in after the Bianchi's `transferred` event. |
| Stock-consuming line consumes once (Phase 4) | `inventory-ledger.test.ts` "a stock-consuming work-order line cannot consume inventory twice": a replay of `add_inventory_line` → one line, one `job_consumption`, stock decremented once, `replayed = true`, also after completion; the same line id with other arguments or on another job → `line_conflict`; concurrent (committed) for a quantity part and a unique unit → one line and one movement, the second call `replayed = true`. |
| Void creates reversal, never deletes (Phase 4) | `inventory-ledger.test.ts`: original intact, one `reversal` with `reversal_of_id`, stock restored, `stock_reversed` and `line_voided` once each, second void a no-op, two concurrent voids one reversal; "voiding is never blocked by publication rules" (photo removed and price cleared after the sale, then reopen and void → unit available, product public). `work-order-lines.test.ts` proves the same through Phase 3's void path. |
| Unique unit cannot be consumed or sold twice (Phase 4) | `inventory-ledger.test.ts`: a unit on a line, written off or held → `unit_not_available`; one unit on two jobs at once → exactly one succeeds; ledger sum per unit in {0, 1}; owner forgeries (a second +1, a location change without a movement, +1/−1 across locations for a sold unit, a linked bike that does not point back, an in-stock unit whose bike a customer owns) → `unit_ledger_inconsistent` at `set constraints all immediate`. Every ledger test ends with `assertLedgerConsistent`. |
| Parts on jobs (D23-D25, D27, D15, D16) | `inventory-ledger.test.ts`: consumption may go negative and shows in `low_stock` with `negative_locations` (also when the total stays positive), manual changes never go below zero; `part_price_missing`, `part_cost_missing`, the default price is `private.selling_price` (unit over product), an override wins, `cost_pending` false; customer-owned stock → `ownership_not_saleable` ("customer-owned stock is never a job part"; consigned parts are `consignment-job-parts.test.ts` since the owner's D27 change); held on add, available after a void, sold at completion with `sold_at = completed_at` (cause `job_completed`); adds and voids on completed or ready jobs → `work_order_locked`; complete → reopen → void (held, no movement, product stays sold, then reversal and public); complete → reopen → re-complete (sold again, one consumption); complete → `transfer_bike_ownership` to the buyer → reopen refused with `bike_with_customer` (unit stays sold, `sold_at` kept, product sold), after the bike returns to the shop reopen → void works (D29); `void_line` on a unit whose bike has a customer (forged) → `bike_with_customer`; cancel with a live part → `work_order_has_lines`, after the void it succeeds; committed races: add vs complete, add vs cancel, two jobs selling a product's last two units at once → `sold`. |
| A consigned unit cannot exist without its consignment item (Phase 6, D9, D45, D50) | `consignment.test.ts`: a unique intake creates a `C-` item, an available consigned `U-` unit (cost = agreed, price = asking), a draft consignment product and one `consignment_received` +1 movement (item, `request_id`, cost snapshot = agreed) and one `received` event; quantity intake (+6, a second item reuses the product); validation (`product_not_consignment`, `consignment_unique_quantity_one`, `consignment_quantity_invalid`, `consignment_tracking_mismatch`, `consignment_received_in_future`, `consignment_product_required`, `consignor_archived`, P0002, 23514 for negative and NaN amounts, 22004, mechanic2 42501); D24: 0 agreed and asking stored as 0; a replayed intake ("500" then "500.00") → one item, unit and movement, other terms → `consignment_item_conflict`, a replay after the consignor is archived returns the item; review fix "intake with a new consignor: one transaction": an intake with `new_consignor` refused (`location_inactive`) leaves no consignor, the retry with the edited name stores the edited name, a double tap returns the same item, another new consignor under the same item id is `consignment_item_conflict`, and an existing consignor with that id and other details is `consignor_conflict` (the same details, email in any case, are accepted); owner inserts fail `inventory_units_consignment_shape`, `inventory_units_consignment_item_ownership` and the deferred FK; ownership and item are immutable. |
| Consigned stock moves only by its own paths (D50, D45) | `consignment.test.ts`: after two items on one product, a job part, a partial return and a transfer keep Σ on-hand = Σ `remaining_qty`; `adjust_stock` (+, −, damaged), an owner `purchase_received` and `create_unique_unit` → `consignment_stock_adjust_blocked`; `write_off_unit` → `consignment_unit_write_off_blocked`; `product_ownership_immutable`; `inventory-split.test.ts` refuses splitting an intake-created product (`ownership_not_saleable`). |
| One selling price (D45) | `consignment.test.ts`: a consigned unit's `private.selling_price` = its asking price before and after `update_consignment_terms`, and `reporting.public_items` shows the same after publishing; a quantity product returns the older item's price, then the newer one's after the older is returned; shop-owned prices unchanged. |
| Terms, charges and history (D4, D45) | `consignment.test.ts`: a new agreed amount needs a reason and writes `terms_changed` with from/to; the unit's cost and price follow; `consignment_item_not_active` after a return; `charge_bearer_required`, `shop_charge_unique_only`, `shop_charge_unit_not_available` while the unit is on a job (add and void), a consignor charge on a sold item, replay by id and `consignment_charge_conflict`, void needs a reason and is idempotent, no other update or delete (`consignment_charges_immutable`), `charge_added` / `charge_voided` events; item identity, short ID and history are immutable. |
| Consignors (D47, D48) | `consignment.test.ts`: mechanic2 cannot insert; a `manage_consignments`-only member can, and archives one with no active item by a plain UPDATE; `consignor_has_open_items`; `payout_details` 42501; 23505 `consignors_customer_id_key`; `customer_archived`; `consignors_display_name_check`. |
| Agreement photos are internal only (D52) | `consignment.test.ts`: internal works on `consignment_item`; customer or public → `attachment_consignment_internal_only` from `record_attachment` and `set_attachment_visibility`; an owner update with triggers off fails the CHECK; D13 and D19 still hold. |
| Consigned bikes (D51, D29) | `consignment.test.ts` "a consigned bike links a shop bike record both ways; a customer's, archived or already linked bike is refused": link both ways and `bike_id` in the `received` payload; `bike_has_owner`, `bike_archived`, `bike_already_linked`, P0002, `consignment_bike_requires_unique`; `bike_in_stock` while in stock; after a return the link stays, the bike can go to the consignor, and the same record is refused again (RISKS R-020). |
| Partial returns are recorded once (D50) | `consignment.test.ts`: a unique return writes one `consignment_returned` −1 with its `request_id`, unit `returned_to_consignor`, item `returned` with date and reason, `stock_returned` and `status_changed` events, product `archived`; replay no-op; `consignment_item_not_active`, `consignment_return_conflict`, `reason_required`; 2 of 6 replayed → one movement and event, remaining and on-hand 4, item active; `consignment_return_quantity_invalid`, 22004 without a location, `insufficient_stock` at the location; a unit on a job → `unit_not_available` until its line is voided. |
| Consigned job parts (D44, the owner's D27 change; D1, D4, D6/D25, D24) | `consignment-job-parts.test.ts`: a consigned unit is held on add with cost = payout = agreed, item active and nothing owed; completion sells unit and item (`status_changed` with the job context), liability 500.00, line 1000.00 / 500.00 / 500.00 / CC 150.00, BICII after CC 350.00; a 120.00 shop charge → cost 620.00, yield 380.00, CC 114.00, a consignor charge changes nothing; a loss line has CC 0.00; reopen → held, active, liability 0.00; re-completion → 500.00 once; void on the open job → a linked reversal carrying the item, unit available, item active; replayed add → one movement; quantity parts FIFO across two consignors at each item's asking price, an override wins, `consignment_quantity_unavailable`, `insufficient_stock` (no negative consigned stock); customer-owned unit and product refused by `add_inventory_line` and the backstop trigger; `line_consignment_mismatch`; `line_immutable`; D24 zeros accepted, not `cost_pending` (RISKS R-006). Review fixes: a part at a location where the only item with enough stock is elsewhere is `consignment_quantity_unavailable` (D54); a completed job whose consigned part's consignor was settled and archived is not reopened (`consignor_archived`; the job stays completed and the item sold) until the consignor is unarchived (D47). |
| Consignment access (SPEC §23 "Customers cannot read internal notes, costs, yield, consignor or Cult Commons data"; D48, D30) | `consignment-access.test.ts`: a linked customer (also the consignor) reads 0 rows from the four tables and gets 42501 from the five RPCs and the position view; anon has no privilege; mechanic2 reads consignors, items and a line's `consignment_item_id` but gets 42501 on `payout_details`, `agreed_amount_owed`, `request_fingerprint` and `consignor_payout_snapshot`, and 0 charges, events and `work_order_line_items_staff` rows; `can_view_sale_costs` / `can_view_consignment_money` are true/true for mechanic1, false/true for a `manage_consignments`-only member, false/false for `view_financial_reports`-only and mechanic2, with charges and history visible exactly when the second is true; view_costs cannot read payout details. |
| Consignment concurrency (SPEC §25; D44, D50) | `consignment-concurrency.test.ts` (committed, real connections; each case proves the second call waits on a lock in `pg_stat_activity`): a replayed intake → one item, unit, movement and event; a replayed partial return → one movement and one `stock_returned`; one consigned unit on two jobs → one wins (`unit_not_available`); a job part racing a return, either way round → exactly one succeeds; two completions → one liability and one `status_changed`; a shop-owned part waits on an `adjust_stock` of the same product (shared stock lock). Step 2: a sale of one unit on two connections → one sale; the last quantity → one sale, the other `insufficient_stock`; a replayed sale id → one sale; a sale racing a return and a sale racing a job part of the same unit → exactly one succeeds; two 300.00 settlements against 500.00 owed → the second `settlement_exceeds_outstanding`; a replayed settlement id → one settlement. Review fixes: two refunds of one sale whose sum exceeds its total → the second waits on the sale row and is `refund_exceeds_sale` (refunded ≤ total); a replayed refund id → one row; two restocks of one sale line → one `return` movement; a restock racing a new sale of the same unit → the sale waits and sells the restocked unit, one live line. |
| Each consignor's stock where it is (D54, the Phase 6 review) | `consignment-locations.test.ts` (per-file clone), two consignors' items of one product, the older at the Workshop store and the newer on the Shop floor: `saleable_stock` offers each only where its stock is (10 offered against 10, never 20); a sale on the Shop floor with no item named is the newer consignor's at their price and payout, naming the older there is `consignment_quantity_unavailable`; a job part draws FIFO among the items at its location; a transfer moves the oldest item with the whole quantity at the source and both rows name it, then a sale there takes it, and a quantity no single consignor has there is `consignment_quantity_unavailable`; a return gives back only that consignor's stock at that location (by default all of it) and never another's; a consigned unit's transfer takes its item; an owner-inserted consigned movement without an item is `movement_invalid`; after every case the items' on-hand sums to the product's at every location and no movement lacks its item. |
| In-store sales (Phase 6 step 2; D9, D24, D26, D45, D48, D53) | `sales.test.ts` (per-file clone): a shop-owned unit sale (an `S-` number, price = `selling_price`, cost and generated totals, one linked `retail_sale` −1, the unit `sold` with `sold_sale_line_id` and `sold_at = recognized_at`, a public unique product → `sold`, `shopify_line_item_id` immutable); quantity sales (on-hand drops, `insufficient_stock` here and at another location, `sale_product_is_unique`, `ownership_not_saleable`, `product_inactive`, `sale_price_required`, an override supplying it, `sale_cost_missing`); D24: price 0 and cost 0 snapshot as 0; D45 FIFO across two consignors (oldest that covers it at its own price = `selling_price`, a named item at its own price, `consignment_quantity_unavailable` when no single item covers the line, `consignment_item_not_active`); a partly sold, partly returned item stays `sold` either way round; "Historical line price/cost/yield snapshots do not change with catalog edits" (product price and cost, new terms, a rate from tomorrow); a backdated sale takes the rate then in force; idempotency ("1000", 1000, "1000.00" one request; replay after the customer is archived and after the unit was sold by it; `sale_conflict`); validation (`sale_lines_required`, `sale_too_many_lines`, `sale_duplicate_unit`, `sale_recognized_in_future`, NaN 23514, malformed 22P02, negative price 23514, `sale_line_invalid`, `sale_quantity_invalid`, 22004, P0002); mechanic2 sells, a customer and anon 42501; immutability. Review fixes: "when a sale may be dated (D55)": mechanic2's sale of a consigned unit dated 400 days back, or an hour before its intake, is `sale_before_stock` and leaves the item active, at the intake instant it is recorded; a consigned quantity line (named or FIFO) before its item's intake is refused; a restocked unit cannot be sold again before its restock, while a shop unit registered now may still be sold two days back; mechanic2 cannot put a `shopify_line_item_id` on an in-store sale (quantity or unit → `sale_line_invalid`, no line stored). |
| Restocks and refunds (Phase 6 step 2; D7, D29, D44, D46, D49) | `sales.test.ts`: `restock_unit` needs `adjust_stock` (mechanic2 42501) and a reason; a `return` +1 movement linked by `sale_line_id` beside the line's `retail_sale`; the unit available at the chosen location, the product sold → public, the line restocked, the sale untouched; a replay writes nothing; "A delayed restock never restocks a later sale"; `restock_line_mismatch` (another unit's line, a unit sold by a job); `unit_not_sold`; a consigned unit also needs `manage_consignments`, then the item is active again with the reason and liability 0.00 and sells again; `bike_with_customer`; review fix "an archived consignor (D47)": a restock of a consigned unit whose consignor was settled and archived is `consignor_archived` (item and unit stay sold) and goes through after unarchiving. "Refunds are financial only (D7, D49)": partially refunded then refunded, movements and units untouched, `refund_exceeds_sale`, reason required, mechanic1, mechanic2 and a `view_financial_reports`-only member 42501, replay and `sale_refund_conflict`. |
| Settlements and the ledgers (Phase 6 step 2; D4, D44, D46, D47) | `settlements.test.ts` (per-file clone): separate facts; partial settlements; consignor charges reduce owed and voiding one restores it; the override rule; a consigned job part's liability settled the same way and removed by a reopen (overpaid) until re-completion; validation codes; mechanic1 and mechanic2 42501, a `manage_consignments`-only member records and reverses; `consignor_archived`; replay ("200" vs "200.00", allocations reordered, after the outstanding changed, `settlement_conflict`; NULL `paid_at` records now() and a NULL replay matches); reversal (paid drops, rows stay, replay, `settlement_already_reversed`, `settlement_reversal_conflict`, reason rules) and `settlement_immutable`; D46 (a restock after a settlement → −500.00, a resale → 0.00); "Owed, paid and outstanding are derived, never stored" (no base-table column of those names); consignor ledger = Σ item ledgers; archiving (`consignor_has_balance` owed or overpaid; at 0 a `manage_consignments`-only member archives and the ledgers and old lines still join: "Archived entities remain available to historical references"). |
| Sales and consignment in the reports (Phase 6 step 2; D1, D30, D44, D46, D48, D49) | `consignment-reporting.test.ts` (reads the seed; one block on a per-file clone): "Cult Commons is 30% of positive yield after the consignor payout": each seeded sale's `financial_lines` entry equals `EXPECTED_SALE` on its shop day (S-000003: source sale, channel retail, its document, line, `recognized_at`, null lead mechanic, ownership consignment); refunds not netted; `entry_key` unique; work-order entries carry their line's item; the reading path (admin costs; a `view_financial_reports`-only member with cost columns and `new_consignor_liability` NULL; mechanics as in Phase 5); `daily_summary`'s consignment columns on S-000004's and S-000003's days by Phase 5's day bucket, equal to the consigned entries' sums on every day, and `today_dashboard` agreeing; a consigned job part counts on its completion day; the seeded ledger = `EXPECTED_CONSIGNOR_LEDGER` = Σ items; `list_consignors` (since the review its awaiting-payment count is NULL without consignment money access and `sold_items` is for everyone), `consignor_statement` (22023), `list_sales`, `sale_lines_detail`, `saleable_stock`, `consignor_payout_details` with the D48 gating per role (NULL, never omitted); a customer and anon refused all six; snapshots survive catalogue edits. |
| Consigned stock and sales in staff search (Phase 6 step 2) | `staff-search.test.ts`: `C-000002`, `c000002`, `C 000002` → the item at 1.0; product and consignor words find items; `kelvin`, phone digits and the exact email find consignors; `S-000003`, `s000003` → the sale at 1.0 with "Hafiz Rahman · date" (a walk-in reads "Walk-in"); archived consignors only with `archived` true; items and sales never. |
| Manual adjustment records actor/time/reason (Phase 4) | `inventory-ledger.test.ts` "every manual stock adjustment records actor, timestamp and reason": null/blank reason → `reason_required`; `created_by`, trimmed reason, `created_at`; damaged positive → `quantity_invalid`; other types → `movement_type_not_manual`; `insufficient_stock`; request-id replay and `request_conflict`, concurrent same request → one movement; mechanics 42501, admin succeeds; a unit cost needs view_costs. Write-off replays by request id, no-op when already written off, again after a restore; transfers pair rows by request id, `insufficient_stock`, `transfer_same_location`, concurrent draining → one succeeds, unit transfers move the unit (`moved`), held units refused. |
| Current stock is derivable from the ledger (Phase 4) | `inventory-ledger.test.ts`: `reporting.stock_levels` equals the per-product/location movement sums after transfers, parts, voids and damage; seeded `low_stock` is P-000009, P-000008, P-000012 by shortfall; `product_stock` totals. Snapshots do not change when product and unit prices and costs change; the ledger and both histories are append-only for the owner too; an archived product keeps its movements and lines. |
| Catalog, cost gating and boundaries (Phase 4) | `inventory-catalog.test.ts`: P-/U- IDs server-assigned, increasing, immutable; `tracking_type` immutable; SKU unique ignoring case and punctuation; manage_inventory needed for products and locations; mechanic2 cannot select any cost column (42501), the cost views return nothing to them and rows to mechanic1/admin (product 02: yield 37.00, Cult Commons 11.10); the invoker cost-write guards refuse direct cost writes without view_costs, including a write of the stored value or null (no equality oracle), and let mechanic1 and the owner through; publication requirements, slug and `item` fallback; archive rules (`product_published`, `product_has_stock`, `unit_in_stock`, `location_has_stock`); `bike_in_stock` for transfer and archive until the unit is written off, `bike_has_owner`, `bike_already_linked`; anon denied and customers read zero rows on every stock table and view; event payloads exact, with actor, never a cost key or value (product, unit and work-order events); the publication and unit-status matrices equal `src/lib/inventory.ts` for all 25 and 36 pairs. `attachments.test.ts`: product and unit photos internal/public, never customer (`attachment_stock_never_customer`, CHECK backstop). |
| Public QR pages expose only explicitly published records (Phase 4, SPEC §23) | `inventory-publication.test.ts` "public QR pages expose only explicitly published records": as anon, `reporting.public_items` has no draft, internal_only or archived product and no unit of an unpublished product (unknown and unpublished short IDs equally absent); its columns equal the documented list exactly (no cost, serial, SKU, internal note or location; a unit's cost and serial never appear in the rows); `sale_price` equals `private.selling_price` for product and unit rows and follows a price change; a product row shows only its public photos, oldest first, as `{bucket, path, width, height, caption}`; a unit row shows the unit's, then the product's, then the bike's; held units and their product read `unavailable`, a sold unit and its product `sold`, a quantity product without stock `sold_out`; a written-off unit and every unit of a sold-then-archived product are absent; a linked bike's photos created before `sold_at` appear and those at or after it never do; a bike photo taken after the first handover to a buyer stays hidden after the bike returns to the shop and the job is reopened and completed again (D29); signed-in customers and staff see the same rows; anon calling `private.selling_price` directly gets 42501. |
| Publication by hand (Phase 4, D26) | `inventory-publication.test.ts` "set_publication_status": for quantity products and unique products with and without an available unit, from every state, the targets the RPC accepts equal `manualPublicationTargets` and every refusal has its code (`publication_transition_invalid`, `publication_sold_by_sale`, `publication_requires_available_unit`); a manual `sold` and sold → public/internal_only refused, sold → archived allowed; a unit registered on a sold product restores it to public (`publication_changed` {sold → public}, both rows `available` to anon), so 'sold' with an available unit is unreachable and skipped in the matrix; same status is a no-op without an event; `publication_requires_photo` (none, or internal only) and `publication_requires_price` (a unique product with no price on product or unit); the slug is assigned once and survives unpublish, rename, archive and republish, `item-p-…` for a name without letters or digits; `publication_changed` events carry `{from, to}`, the actor and the trimmed reason; `reason_too_long`; mechanic1, mechanic2 and anon 42501; unknown product P0002. |
| Split to a unique item (Phase 4, D28) | `inventory-split.test.ts`: the source loses one at the location and a draft unique product (name, description, brand, category and currency from the source; price from the source unless given) gets an available shop-owned unit there, both costs equal the source's default cost (read through the cost views as the admin), one `stock_adjustment` each side with "Split to U-…: reason", cost snapshot and request_id = unit id, `created` event with actor and reason; replay with the same ids returns the same result with one pair of movements, a reused unit or product id is `unit_conflict`; `insufficient_stock` (empty or other location), `location_inactive`, `product_not_quantity`, `product_archived`, `ownership_not_saleable`, `reason_required`, `reason_too_long` (> 480), a blank name 23514 without DETAIL; needs both adjust_stock and manage_inventory (42501 otherwise, anon too); mechanic2 with both but no view_costs splits and the carried costs equal the source's while their direct cost UPDATEs on the new product and unit are 42501; committed concurrency: the same unit id twice → one result, one pair of movements; two splits racing for the last item → one succeeds, the other `insufficient_stock`. |
| Products and units in staff search (Phase 4) | `staff-search.test.ts`: the SKU typed as "shi l05a rf", "shil05arf" or in mixed case finds P-000001 at rank 1.0 with subtitle "SHI-L05A-RF · Shimano · 34 in stock"; SKU contains (≥ 3 characters) 0.7; exact P- and U- IDs rank 1.0 with or without the dash; name and brand words 0.45-0.85; on-hand from the ledger across locations (road tube 60), "Unique item" for unique products, "Inactive" appended for an inactive product; units by exact serial (1.0), part of it (0.7) and product-name words, subtitle "Available · Shop floor · S/N …"; the shop Brompton's serial finds both the bike and its unit at 1.0; the archived chain and an archived unit are left out and are the only hits with `archived = true`; "brompton" across all kinds adds products P-000005, P-000014 and unit U-000002 (the bike assertion is scoped to `['bike']`); 'product' and 'inventory_unit' are known kinds. |
| Cult Commons end to end (Phase 5; SPEC §10, §31; D1) | `reporting.test.ts` "Cult Commons is 30% of positive yield after direct costs, per line": every `LINE_FIXTURES` row on its own job completed on its own isolated `TEST_DAY` equals the line's generated columns, its `financial_lines` entry (owner) and `daily_summary(day, day)` (admin); every `JOB_FIXTURES` row equals `work_order_yield` and the day's totals; the seeded loss-line job's Cult Commons is 12.00, not 7.50 (the Phase 5 fixture rows run through `cult-commons.test.ts` and `work-order-lines.test.ts` too). |
| Negative yield never pays negative Cult Commons (Phase 5; SPEC §10; D32) | `reporting.test.ts`: as owner, every `financial_lines` entry's share is ≥ 0 and equals its line's share, `is_loss` matches the line's yield; every `daily_summary` row has `cult_commons_share` ≥ 0 and `loss_total` ≤ 0; a day with two loss lines and a 40.00 line: CC 12.00, yield −5.00, loss −45.00. |
| Reports derived, never a second truth (Phase 5; SPEC §19.2) | `reporting.test.ts`: `reporting` holds views only (also `meta.test.ts`); over three test days with service, part, voided-part, collected, cancelled and open jobs, `daily_summary` money equals Σ `financial_lines` by day (both admin RPCs), each job's entries equal `work_order_totals_staff` and `work_order_yield`, the `jobs_*` counts equal the `work_order_activity_on` rows with the matching `*_on_day` flag, parts consumed/returned equal ledger sums, an empty day is a zero row, the appointment columns equal `appointment_daily` (d1 two scheduled and one no-show, d3 one arrived, 0 elsewhere) and the consignment placeholders are NULL; catalog price/cost edits and archiving the service leave the days and entries unchanged (snapshots). |
| Only completed jobs recognised; reopen restates (D32) | `reporting.test.ts`: open jobs, cancelled jobs (lines voided first, D16) and voided lines have no entry; a line added on one day of a job completed on the next is recognised on the completion day; 23:59 vs 00:01 SGT land on consecutive days; adds and voids on completed, ready and collected jobs → `work_order_locked` (RPC and owner); complete → reopen (the earlier day drops by exactly the job, no entry left) → void one line, add another → complete: the new day has exactly the current live lines once each, `started_at` kept, two `completed` events and one `reopened`. |
| Completion recognised once (replay, concurrency) (Phase 5) | `reporting.test.ts`: a second `set_work_order_status(…, 'completed')` returns the row unchanged, no event, one entry per line. `reporting-concurrency.test.ts` (committed): two connections complete the same job; the second waits on the row lock and gets the unchanged row; one `completed_at`, one `completed` event, one entry per line, today's sales rise by the job's sale once; a third reader before the commit sees the old totals. |
| Shop-day boundaries (D35) | `reporting.test.ts`: `completed_at` 2025-06-01 15:59:59Z → 2025-06-01, 16:00:00Z → 2025-06-02; `daily_summary` inclusive on both ends; identical results under `set local timezone` UTC and America/Los_Angeles; `shop_today()` = Singapore's date of `now()`; no reporting view or Phase 5 function contains `current_date`. |
| Financial reports gated (D30) | `reporting-access.test.ts` "Mechanic permission boundaries" and "Customers cannot read internal data": mechanic2 → `financial_lines` / `work_order_yield` 42501, counts with every money column NULL (`can_see_financials` false), `value_at_cost` NULL; mechanic1 (view_costs) → `financial_lines` 42501, `work_order_yield` works, summary money NULL; mechanic2 + view_financial_reports → rows and gross sales with every cost column NULL (`can_see_costs` false); admin → everything; customers, anon and inactive staff → 42501 from all seven RPCs; selecting the four Phase 5 reporting views as anon or authenticated → 42501. |
| Today flows vs snapshot (D31) | `reporting.test.ts`: inserting a job with today's check-in, start, line and completion raises today's flows by exactly those milestones and the money by its line; the `*_now` counts equal direct status counts grouped as `BOARD_GROUPS`, D20 overdue via `isOverdue` and `low_stock` rows; a past day has `is_today` false and every `*_now` NULL; tomorrow → `report_range_invalid`. Range rules: `daily_summary` from > to and 367 days raise, 366 pass; `financial_lines` 31 pass, 32 and from > to raise; null bounds mean today. |
| Significant adjustments (D33) | `reporting.test.ts`: `private.is_significant_adjustment` cases (−6, +5, −1, 4 × 24.99 vs 4 × 25.00, a unit, 2 × 60.00, non-adjustment types false); `stock_adjustments_on(TEST_DAY)` over owner-inserted movements returns the day's six (00:00 and 23:59:59 in, the neighbouring days out), newest first, with `significant`, `actor_name` and `reason` for mechanic2 and `value_at_cost` NULL; the admin sees \|delta\| × unit cost (snapshot, else product default, else 0). |
| Operational exceptions incl. 7-day overdue boundary (D34, D20) | `reporting.test.ts`: an open job checked in exactly `OVERDUE_AFTER_DAYS` days ago is not `overdue_job`, one second earlier is; a collected job checked in 30 days ago is neither; `work_order_activity.is_overdue` equals `isOverdue` for the same rows; a ready job completed 7 shop days ago is `uncollected_job`, 6 days ago not; a forced negative on-hand is `negative_stock` (danger, all danger rows first); an owner-held unit with no live line is `unit_hold_stale`, a unit held by `add_inventory_line` on an open job is not; a completed USD job's line is `currency_mismatch` and out of the day's totals; `exceptions_now` equals the row count; max_rows clamped to 1..200. Phase 9 step 3 appended six columns to the RPC's result (a documented contract change): `OPERATIONAL_EXCEPTIONS_COLUMNS` in `reporting-fixtures.ts` lists them after Phase 5's nine, and every other Phase 5 assertion is unchanged. |
| Seeded history reconciles (Phase 5; SPEC §10 examples, SEED_DAYS) | `reporting-seed.test.ts` (reads only; days counted back from the seed's anchor, `seedToday()`): H1–H4 (and H5's rounding) through `work_order_yield` (admin) and Σ `financial_lines(anchor−6, anchor)` per job equal `SPEC_EXAMPLE_JOBS` / `ROUNDING_JOB`, recognised on their days, H4's CC 12.00 not 7.50; `daily_summary(anchor−n, anchor−n)` equals `SEED_DAYS[n]` exactly for n = 0…6 (every column: the D41 appointment counts, consignment placeholders NULL); Σ entries by `recognized_day` equal each day's money columns; every completed seeded job (Phase 3, 4, 5) has entries equal to `work_order_totals_staff` and `work_order_yield` on its completion day, open and cancelled ones none; parts consumed/returned and adjustment counts equal the ledger's sums; every seeded entry's share ≥ 0 and equals its line's (H4's tyre a loss at 0); `stock_adjustments_on(anchor−n)` gives A1–A3 as `SEED_ADJUSTMENTS` (A2 significant, `value_at_cost` NULL for mechanic2, 30.00 for the admin). When the anchor is the shop's today (else skipped with a message): `today_dashboard(null)` is the anchor, `is_today`, flows = `SEED_DAYS[0]`, the `*_now` snapshot equals direct counts and `SEED_SNAPSHOT` (exactly in a fresh per-file database, at least otherwise); `operational_exceptions` has `SEED_EXCEPTIONS` and not H5, J-000002, J-000003 or J-000005. `display-parity.test.ts`: `private.shop_timezone()` = `SHOP_TIME_ZONE`, and `work_order_activity_on`'s `bike_title` / `customer_label` equal `bikeTitle()` / `customerLabel()` for every seeded job of days 0–6. |
| Seeded ledger consistent (Phase 5) | `reporting-seed.test.ts` "The seeded ledger is consistent": every seeded inventory line has exactly one `job_consumption` movement (−quantity, cost snapshot = the line's unit cost), at the line's own time for the Phase 5 lines (J-000010's, written by `add_inventory_line`, just after); no line created at or after its job's completion; no stock level below zero and the Phase 5 products' on-hand as documented; no seeded job, line, event, assignment or movement later than `now()`, and no Phase 5 row later than J-000007's seed-time check-in. |
| Cost-pending lines flagged (D14) | `reporting.test.ts`: a `cost_pending` manual line on a completed job is recognised at cost 0 with `cost_pending` true; `today_dashboard(day).cost_pending_lines` and `work_order_yield.cost_pending_count` count it. |
| No float money in function results (Phase 5) | `meta.test.ts`: no money-named OUT/TABLE argument of a function in `public` or `private` is `real` or `double precision`; every reporting RPC compiles and answers with exactly its documented columns (`reporting.test.ts`). |
| Period reports are built from source records only (Phase 9; SPEC §19.2; D100) | `period-reports.test.ts` "Reports are built from source records only": every day of the March 2025 scenario (`period-report-fixtures.ts`) and of the seed's last week, each `daily_summary` column equals its counterpart in `report_period_summary(d, d, 'sale')` (money, consignment) or `report_activity(d, d)` (job flows, appointments, parts, adjustments), and the job flows equal independent counts over the jobs' own stamps (`loss_total` equals the loss lines of `report_line_items`); the series summed by day, week and month over the week, March 2025 and the seed's week equals the summary on every basis; `report_lines`' recognised rows are exactly `financial_lines` and its work-in-progress money equals the lines' generated columns; `entry_kind` is only 'line', no `financial_lines` row has a NULL channel and no sale has source `work_order` |
| The date basis decides the day (Phase 9; SPEC §19.2, §23; D100, D35, D1) | `period-reports.test.ts`: each day and the week on all four bases equal `PERIOD_EXPECTED` (check-in 800.00 / 4 jobs, completion 680.00 / 3, collection 300.00 / 1, sale 1,680.00 / 710.00 / 970.00 / Cult Commons 306.00 / after 664.00); retail only on sale, work in progress only on check-in, the cancelled job nowhere; completion equals the workshop channel of the sale basis for any range; 23:59:30 counts Friday and 00:00:00 Saturday; ISO weeks and clipped, flagged month buckets; inline bucketing equals `private.shop_day` at the boundaries; job B's Cult Commons is 60.00, not 45.00, and a loss-only day shows −50.00 and 0.00 |
| Every breakdown partitions its period (Phase 9; D100, D103) | `period-reports.test.ts`: for every dimension and basis, on the scenario week and the seed's last 7 days, paging at `p_max_rows` 2 with the (sale_total, key) cursor covers every group once and the groups sum to the summary; channel keys are derived from `pg_enum`'s `sale_source` values (a new value fails the test); job rows equal `work_order_totals_staff`; `p_key` returns the same row; a key's line items (keyset, 2 per page) sum to its row and never include a voided line; line items without a key page through every line once past tied instants and a document without a counted line; the free line and the services' 0.00 cost come back as 0.00 (D14, D24 as amended) |
| Snapshots, restatement, refunds, currency, mechanic (Phase 9; SPEC §23; D21, D101–D104) | `period-reports.test.ts`: new catalogue prices and costs and a 50% Cult Commons rate leave March 2025 unchanged, archived services, products and staff appear by name; reopening job B, voiding its loss line and completing it on 11 March moves it (200.00 / 0.00 / 200.00 / 60.00); a manager's refund counts on its recording day in `refunds_total` / `refund_count` and changes no gross, cost, yield or Cult Commons (restocked line kept), NULL on other bases; a USD line is excluded and counted in `excluded_foreign_line_count`; the by-mechanic breakdown and `report_activity_by_mechanic` credit the lead, 'unassigned' and 'not_workshop'; `report_activity` for the week |
| Purchases and stock value (Phase 9; D105, D60) | `period-reports.test.ts`: a receipt today adds 1 receipt, 4 units and 30.00 purchases (deltas); `report_stock_value` adds 50.00 for +4 at 12.50, counts a NULL-cost product as uncosted and does not value it, values a 0.00 cost at 0, ignores a location below zero, counts a consigned unit and never values it |
| Report arguments and access (Phase 9; D30, D91, D92) | `period-reports.test.ts`: reversed or NULL bounds `report_range_invalid`, 732 days `report_range_too_long` (731 pass) on all six ranged RPCs; bad keys, keys of another dimension and half or conflicting cursors `report_key_invalid`; a mechanic with only `view_financial_reports` as an exception (granted by the admin) gets gross, counts, refunds and consignment counts with every cost column NULL, full figures with `view_costs` added, as do a manager and the admin; mechanic1 (view_costs only) and mechanic2 get 42501 from the financial RPCs and may read activity; a customer gets 42501 from all seven; anon has no EXECUTE; no report RPC returns a float; each period-report column leads a valid index |
| The app's report reads and export pagers (Phase 9 step 2; D30, D100) | `period-report-exports.stack.test.ts` (through PostgREST on the devstack, as the app calls it): walking `report_breakdown` two groups at a time with the cursor passed back as received visits every group once, in one page's order (job, product and mechanic); the breakdown export's groups add up to the summary's `line_count` and end with the summary's own TOTAL row; the lines export of the period and of J-000013 number their counts, newest first; mechanic1 (View costs only) and mechanic2 get 42501 from the summary; the by-mechanic rows are for any staff, the lead-less one "Unassigned" |
| Stock reconciles with the ledger (Phase 9 step 3; SPEC §12, §23, §26; D106) | `stock-reconciliation.test.ts`: the seed has no unit or stock issue (no seeded negative_on_hand) and every unit's ledger equals the on-hand its status implies; running both RPCs and the exceptions writes nothing (movement, unit, unit-event and consignment row counts and stamps unchanged); the exact columns, none a cost, the 1..1000 clamp. Every RPC-reachable unit state reconciles after EVERY step, with the expected disposition: unit 1 held (`add_inventory_line`), voided back to available, held again, sold at completion, reopened to held (D25), sold again; unit 2 sold by `record_retail_sale`, refunded (still sold_by_sale, D7), restocked (in_stock while the old sale line still names it), transferred (ledger location = the new one); unit 3 held, voided, job cancelled (D16); unit 4 a consigned unit sold on a job (D44, item sold); unit 5 consigned and returned; unit 6 written off; none of them is an exception, and Phase 4's deferred check agrees. Each corruption, written as the owner with `session_replication_role = replica` and rolled back, gives exactly its code and the same `issue` in `operational_exceptions` (as the admin): an extra +1 at a second location `ledger_out_of_range`; a sold unit set available `sale_without_sold_status`; a sold unit given a later +1 `sold_without_sale`; a held unit whose job is cancelled without a void `held_without_open_job`, listed once as Phase 5's `unit_hold_stale`; an available unit given −1 `in_stock_without_ledger`; set written_off without a movement `ledger_without_stock_status`; location changed without movements `location_mismatch`; the item set sold while its unit is available `consignment_status_mismatch`; a quantity product below zero `negative_on_hand`, mirrored by exactly one `negative_stock` row; a unitless unique-product movement `unique_movement_without_unit` (the unit itself still clean); a moved unit `unit_count_mismatch` at both locations. `unit_expected_on_hand` equals `assert_unit_consistent`'s rule for all six statuses (consistent at net 1 exactly when it says 1, at net 0 exactly when it says 0). Access: every seeded staff member may call both RPCs; a customer gets 42501, anon has no EXECUTE, no API role selects the three views; a mechanic without `view_costs` reads the same unit row as the admin. |
| Operational exceptions, extended (Phase 9 step 3; D34, D104, D107, D108) | `operational-exceptions.test.ts`: with one row of each Phase 5 kind, the first nine columns of `reporting.operational_exceptions` for Phase 5's kinds equal exactly what Phase 5's own view body (read from `20261004002500_daily_summary.sql`) returns, and the appended columns are `issue` (the kind; `negative_on_hand` for negative_stock), `short_id` = `title` = `entity_label`, `detail` = `subject_label`, `amount` and `currency` NULL; the RPC returns `OPERATIONAL_EXCEPTIONS_COLUMNS` (Phase 5's nine, then the six appended). D107: an item received 60 and sold 45 shop days ago is raised for the admin with amount 300.00, currency SGD, days 45, since = the sale and the consignor's name in subject and title; the threshold hides it at 60 and 45 and shows it at 44 and 30; the current value again writes no `schedule_events` row and a change writes one with `{from, to}`; 0, 366 and NULL are `alert_days_out_of_range`; a direct UPDATE as the admin is 42501 and changes nothing; a mechanic with `manage_consignments`, mechanic2, mechanic1 and the manager get 42501; a partial settlement leaves 200.00, a full one clears it, a restock clears another item, and a sale 5 days ago is not raised. D108: the admin, the manager, mechanic1 (`view_costs`) and a mechanic with `manage_consignments` see the unsettled row, a mechanic with only `view_financial_reports` and mechanic2 do not; everyone sees a `unit_state_mismatch`; for each of the six, `report_exception_counts` per kind equals the list per kind and `today_dashboard(null).exceptions_now` its length. `private.integration_exceptions()` has exactly Phase 10's nine-column signature (from the catalogue), is definer, stable, `search_path=""`, executable by no API role and returns no rows; `exception_visible` gives the per-kind rule for the admin and mechanic2. D104: an owner-written USD work-order line and a two-line USD sale are listed (`work_order_line` and `sale`, with S- number, description · USD and since = `recognized_at`), and they are exactly the documents `private.report_rows(…, true)` returns and `excluded_foreign_line_count` counts (1, 2 and 3). |

### End-to-end (SPEC §27.3)

Harness (`playwright.config.mts`, `tests/e2e/`): Chromium only, two projects
— `phone` (iPhone 13, 390 px: bottom tab bar) and `tablet` (iPad gen 7,
810 px: side rail). `webServer` runs `npm run build && next start -p $E2E_PORT`
(default 3100) with the devstack URL and local demo keys passed explicitly
(so `.env.local` does not matter). `tests/e2e/global-setup.mts` resets and
seeds the dev database, `PGDATABASE` (default `bicii_dev`; `E2E_RESET=0`
skips), starts the devstack if needed, and waits until the
seeded admin can sign in through the gateway and call `my_staff_profile`
(with an email code: the service-role admin API generates it, Auth
verifies it, no email is sent) and the mail catcher answers `GET /health`
(skipped for `E2E_EXTERNAL_STACK=1` unless `BICII_MAIL_KIND` is set).
Tests run serially (one shared database). The browser is
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` when set, else `/opt/pw-browsers/chromium`
when it exists (the build agent's container, where browsers are never
downloaded), else Playwright's own Chromium, installed once with
`npx playwright install --with-deps chromium`
([ENGINEERING.md](ENGINEERING.md#prerequisites-and-access)).

```sh
npm run test:e2e                       # build + start on E2E_PORT (3100), reset PGDATABASE (bicii_dev), run
E2E_REUSE_SERVER=1 npm run test:e2e    # reuse an app already on E2E_PORT (3100)
E2E_RESET=0 npm run test:e2e           # keep the dev database as it is
```

A second checkout (README "Postgres somewhere else?") sets its own
`PGDATABASE`, `BICII_*_PORT` and `E2E_PORT` first, so its E2E run resets
only its own database and serves on its own port.

The seed's history is relative to the day it was reset (DATA-MODEL §18
"Phase 5 part"). Global setup reads that anchor day once, from the seeded
T3 job's check-in, into `E2E_SEED_ANCHOR` ('YYYY-MM-DD'; the workers
inherit it); specs use `seedAnchor()` and `anchorDay(n)` from
`tests/e2e/helpers.ts`, never the wall clock, because with `E2E_RESET=0`,
`E2E_EXTERNAL_STACK=1` or a run across Singapore midnight the anchor is not
today.

Signing in (PLAN D10, D70; `tests/e2e/helpers.ts`): every spec signs in
through the real `/login` form with an emailed code. `signIn(page, who,
next?)` and `signInOnForm(page, who)` (seeded staff) and `signInAs(page,
email, next?)` / `signInOnFormAs(page, email)` (any login) all end off
`/login`. Underneath, `requestCodeOnForm(page, email)` takes a mail cursor
(`mailCursor`) BEFORE pressing "Email me a code", expects "Check your
email" and returns `waitForCode({ to, after: cursor })` from the mail
catcher, so an older email to the same address is never used. Auth sends
at most one email per address per second (`max_frequency` 1s, kept in the
devstack and config.toml) and the Admin shows a refusal there as "Check
your email" (D70), so the helper waits until 1.1 s have passed since this
worker last asked for that address, and if no email arrives within 5 s it
goes back with "Use a different email", waits again and asks again, up to
5 times. The app runs with `SIGN_IN_LIMIT_MULTIPLIER=1000`
(`playwright.config.mts`): the suite signs in hundreds of times from one
address, past the Admin's own limits (D72), which the unit and stack
tests cover. Specs reach the mail client through
`tests/e2e/mail.ts` (a dynamic import: Playwright compiles specs to
CommonJS) and the database through `tests/e2e/db.ts` (`sql()` on
`devDatabaseUrl()`, for the two assertions no screen can make).

Phase 0 specs (`auth.spec.ts`, `staff.spec.ts`): signed-out `/` redirects to
`/login`; `?next=` deep links survive sign-in and cannot leave the origin
(absolute, `//host`, `/\host`, dot segments such as `/.//host`, including
the server-side redirect a signed-in visit to `/login` makes); an unknown
email (`e2e-unknown-<project>-<time>@bicii.test`) gets exactly the "Check
your email" text a staff email gets (compared with the address
substituted), no `auth.users` row and no email within 2 s; a wrong code
(a six-digit value that differs from the real one) gets the one
invalid-code message, keeps the email, is not echoed and puts focus back
on Code, and the real code (pasted as "123 456") then signs in (Auth
2.178 does NOT void a code after a wrong attempt); an expired code is
refused (the spec moves `auth.users.recovery_sent_at` back 11 minutes:
for an email code to an existing confirmed login Auth 2.178 times the
code from `recovery_sent_at` and ignores `auth.one_time_tokens.created_at`,
established on the devstack by ageing each separately); a used code is
refused in a second browser context that asked for a newer code; "Send a
new code" is disabled with a live countdown ("Send a new code in 0:59"),
"Use a different email" returns to the email step with the email kept
and focused, and after the countdown (the page clock fast-forwarded)
"Send a new code" announces "We've sent a new code.", restarts the
countdown, and only the newest code works; a confirmed login with no
staff row gets the not-staff message after its code and keeps no session;
the admin lands on Today with the tab bar (phone) or rail (iPad);
sign-out ends the session; mechanic2 gets a real 403 on
`/settings/staff`; asking twice in a row ("Use a different email", then
the same address) gives an address with a login and an unknown address
the same "Check your email" screen both times (the main region's markup
compared with the address, React ids and countdown digits normalised,
plus the focused field), while Auth's per-address interval is held open
for the login (`recovery_sent_at` set ahead; a direct `/otp` call then
gets 429 `over_email_send_rate_limit`, D70); a permission the admin grants shows on mechanic2's
profile and in the staff history (then is revoked), and on a phone the
confirmation toast leaves the Scan tab tappable; a rejected invite keeps
the typed name and email; the invite's success view says how to sign in
and shows no credential; the invited colleague (unique per project and
run) signs in with an emailed code as active staff with no granted
permissions (Today opens; `/settings/staff` is 403), and when the admin
deactivates them (a reason is required and shows in their history) their
open session ends at once (PLAN D71: the deactivation deleted their Auth
sessions, and on the devstack's HS256 keys `getClaims` asks Auth, so their
next navigation lands on `/login?next=…`); they can still ask for a code
and see the same "Check your email" screen, but after typing the emailed
code they stay on `/login` with the not-staff message, and `/` still
redirects to `/login`. The hosted window of D71 is driven too: a second
invited colleague signs in, is deactivated with `staff_revoke_sessions`
disabled inside that one transaction (`sqlTransaction` in
`tests/e2e/db.ts`), so their session still verifies at Auth, and `/` and
`/settings/profile` (no permission needed) show the 403 page ("403 · No
access", "You can't open this") and none of their data. The HTTP status
is not asserted there: a page whose shell has started streaming keeps
200 (Next's `forbidden()` docs).

Period reports spec (`reports.spec.ts`, Phase 9 step 2, D30,
D100–D105; read-only, on the seeded Phase 5 history counted from the seed's
anchor with `anchorDay(n)`, asserting J-000013's membership, never
emptiness or totals): **an admin** opens Reports from More (phone) or the
rail (iPad) on Week and Sale date with a Gross sales amount and a Yield
tile; on `?period=day&date=anchorDay(4)` steps Previous day and Next day
once each, and the page has no horizontal scroll; J-000013 is in the Job /
sale breakdown only under Check-in on anchorDay(4), under Completed and
Sale date on anchorDay(3) and under Collected on anchorDay(2), each basis
change keeping `period` and `by` in the URL; the Custom sheet refuses a
reversed range in place (values kept), then 2020-01-01 to 2020-01-07 on
Completed shows both empty-state sentences. **The drill-down**: the
J-000013 row opens `/jobs/<id>`; Product then the wheelset row opens
`/reports/lines` with a J-000013 line and a back link keeping the basis.
**The export**: the breakdown's Export CSV link has `target=_blank` and
`rel=noopener`; `page.request.get` returns 200, `text/csv`,
`attachment; filename="bicii-breakdown-completion-<day>_<day>.csv"` and
`no-store`; the body starts with the BOM, its header includes `cost`, and
it has the J-000013 row and a TOTAL row. **A manager** sees Yield and Cult
Commons (the role implies View costs, D91). **mechanic2** sees Activity
and the permission sentence, no Gross sales and no basis control; the
breakdown export answers 403 "Forbidden", `/reports/lines` the 403 screen
with a 403 status (no `loading.tsx` above it), and `kind=mechanics` a
200 CSV.

Staff roles spec (`roles.spec.ts`, D90-D94; every record it creates
carries `tagFor(testInfo)`, seeded records are only read): **a manager**
(the seeded Kavya Menon) sees the Money section on Today and the seeded
job J-000002's Cost and Cult Commons, has no Staff row in Settings and a
403 on `/settings/staff`, creates and stocks a product (manage_inventory,
adjust_stock), sells it with the cost preview, records a partial refund
with a reason ("Refund of $6.00 recorded"), and their profile shows the
Manager badge, View costs, View financial reports and Record refunds but
not Manage staff or Admin settings. **A mechanic** (mechanic2) sees no
Money, no cost on J-000002, no Record refund on the seeded S-000004, a 403
on `/settings/staff`, and a profile reading Mechanic and "Workshop access
only". **An admin** finds their own row's role picker disabled with "You
can't change your own role." and nothing extra to grant; invites a
colleague (unique per project and run) with the Role picker offering
Admin, Manager, Mechanic and Mechanic chosen; grants Extra access "Manage
purchasing" (seven switches for a mechanic); changes the role to Manager
through the sheet (it names the extra access the role includes, and
focus starts on Cancel) with a reason; then sees "<name> is now a Manager", the Manager badge, one switch
left (Manage staff) under "Included in the Manager role: …", and in
History one "Role changed from Mechanic to Manager" with the admin and the
reason and "Extra access: Manage purchasing removed" with the same reason;
the list row reads "Every permission except Manage staff"; the colleague
signs in and their profile shows Manager and Record refunds; the admin
then deactivates them so no extra active staff remain. On the phone
project that test runs at 375 px wide (an iPhone SE) and checks that the
admin's own row, the invite form, the colleague's page and the change-role
sheet do not scroll sideways (`expectNoSideScroll`); on the iPad at its own
width. `staff.spec.ts`'s
invite test also checks "They join as a Mechanic." and "Set extra access".

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

Phase 2 spec (`appointments.spec.ts`, step 3; API helpers in
`tests/e2e/api.ts`: `signInApi(email)` signs in with an email code
without sending email (the service-role admin API generates it, Auth
verifies it, as `tests/db/stack.ts` `otpClient` does; it tells the UI
helper the address just had a code, so the next form request waits out
Auth's per-address interval), `rpc(token, name, args)` and
`select(token, pathAndQuery)` through PostgREST as that user, throwing
with PostgREST's error; global setup hands them the gateway URL and keys
as `E2E_GATEWAY_URL`, `E2E_ANON_KEY` and `E2E_SERVICE_ROLE_KEY`, because
specs load as CommonJS and cannot import `scripts/devstack/config.mjs`.
Until the email sign-in integration (2026-10-06) it used Auth's password
grant with the shared seed password; no password path remains). These tests use the live shop day
(`shopToday()`), not the seed's anchor: a customer books ahead of now.
`beforeAll`, as the admin through the API and idempotent for the second
project or a retry, sets the online notice to 0 and the capacity to 4,
opens today 00:00–24:00 with custom hours under the fixed id
`e4000000-0000-4000-8000-0000000000e2` (inserted with `is_new` when
missing, else saved again), and cancels today's leftovers from earlier
runs (customer note "Gears skipping…" or internal note "E2E no-show…",
still booked, confirmed or arrived; this also keeps Chloe under her three
online bookings, D37). `afterAll` always restores notice 120 and capacity
2 and deletes the custom hours with a reason. Journey 2: Chloe (her
seeded login) reads `available_slots` for today (remaining units null for
her) and books the first one with `book_my_appointment` on her Giant with
a tagged note; if no slot is left (the last half hour of the Singapore
day) the test is skipped with that reason, the only allowed skip;
`my_appointments()` lists it without internal fields. The admin opens
today's list and clicks the row by its href (Chloe has a seeded booking
today too), sees "Booked online", taps Arrived (pill and toast), Check
in: the Giant preselected, the note as requested work, Marcus Tan as lead,
"Check in and open job" lands on the new job with a J- number (and the
toast); the job's timeline shows "Checked in as J-…" and the link
"Opened from the appointment on … <time> (Service drop-off)" to the
appointment, and the job's chip "Booked appointment · … · Service
drop-off" links back too; back on the appointment: Checked in, the job card linking
to the job, history "Booked online by the customer", "Marked as arrived
by Asha Admin", "Checked in by Asha Admin", "Job J-… opened". "No-show
and late arrival" makes its own data: the admin books Daniel through the
API at now rounded down to the 30-minute grid (staff may book a slot that
has not ended), marks it a no-show, and in the UI "Reinstate as arrived"
turns the pill to Arrived with "Reinstated as arrived by Asha Admin" in
the history. Walk-ins and every earlier spec are unaffected; Today's spec
reads deltas, so the extra appointment today changes nothing it asserts.

Step 4 adds to journey 2, before the staff list: Today (`/`) shows the
booking in "Arrivals" as a link with href `/appointments/<id>` whose
accessible name starts with the booked time and Chloe Lim, "Still
expected" is at least 1, and Arrived is read; after check-in Today's
Arrived is exactly one higher (read before and after with `readCount`,
never absolute counts, D41) and the booking left the arrivals list. Chloe
Lim (`CUSTOMER_LOGIN.chloe`, signed in with `signInApi`, an email code) is the one
seeded customer login, used here and in the customer-access tests. "Staff
book for a customer and capacity closes the slot": mechanic2 (no
permissions), on the first Tuesday at least 21 days after `shopToday()`
(+7 on the tablet project, `clearDay`), with the capacity set to 2 through
the API at the start (4 again in `finally`, the spec's `beforeAll` value),
books Tan and Priya into 11:00 "Service drop-off" from each customer's
page (the Book sheet with the customer preset and locked) with a tagged
internal note; a third booking (Daniel) is not offered 11:00 (11:30 is);
both are cancelled through "Cancel appointment…" with a reason and 11:00
is offered again; `finally` also cancels the test's own tagged bookings.
`appointment-settings.spec.ts` (each day +7 on the tablet; `afterEach`
restores, through the replay-safe admin RPCs, Sunday's seeded
09:00–13:00, deletes the test's closures by their tagged reason with
"E2E cleanup" and deactivates its own type, so a failure never leaks):
an admin adds a whole-day closure on the first Wednesday at least 35 days
ahead → the day view says "Closed: <reason>", the Book sheet has no
times and "Next day with free times" moves on → deleting it (ReasonConfirm
with a reason) brings 10:00 back; a short day 12:00–16:00 on the first
Thursday at least 35 days ahead offers exactly 12:00–15:30 for the
30-minute type, then is deleted; a staff-only "E2E fit <tag>" (45 min, 1
unit) appears in the Book sheet with "Staff only" until it is deactivated,
and stays listed as Inactive; Sunday gets 14:00–16:00 (listed, and offered
on a Sunday at least 21 days ahead), then the seeded hours are restored in
the UI; mechanic2 reads both settings pages (Singapore time, the D2
sentence, the week, the types with Public / Staff only) without any Edit,
Add, New type or Delete control. Helpers: `clearDay`, `openBookSheet`
(the phone's floating Book or the md+ button) and `pickTime` (taps a time
chip) in `tests/e2e/helpers.ts`.

Phase 6 step 3 (`consignment.spec.ts`, phone and tablet, every record
tagged): an admin creates "Consignor <tag>" with a phone; receives one item
"Colnago Master <tag>" (serial, owed 500, asking 1000) → the item page
shows a `C-` number, a `U-` link and "For sale"; an agreement photo is
uploaded and its viewer has Internal checked with Customer and Public
`aria-disabled` and D52's sentence; a 120.00 charge cannot be added until
"Shop pays" is chosen (D4), then is voided with a reason, and the
"Timeline" shows Received, Charge added and Charge voided; a job made
through `createJobViaIntake` (lead Marcus Tan) takes the consigned bike
from Add part (the option reads "Consigned · Consignor <tag>" and
$1,000.00) and is started and completed → the item reads "Sold, awaiting
payment" with "Job J-…" and "Sold on J-…", and the consignor's Balance
reads Outstanding $500.00 with the item under Awaiting payment (D44);
mechanic2, in a second context, sees the consignor's item under Sold but
no "Outstanding", "Owed", "Paid", "$500.00", Record payment, Show payout
details or Receive item, and on the item page the asking price but no
Money card, no Timeline and no "$500.00" (D48); the admin records $200.00
with "PayNow <tag>" → Outstanding $300.00 and the payment listed; 350
against $300.00 reveals "Why pay more than is owed?" and keeps "Record
payment of $350.00" disabled until it is answered (D47); 300 is then
recorded → Outstanding $0.00, "Settled", and the item reads "Settled". A
second test receives "Several identical" (3) for a consignor created from
the picker's "New consignor" row, sees "3 of 3 left", returns 1 with a
reason → "2 of 3 left" and "1 returned to consignor" with the reason in
the Timeline. Review fixes: the Receive item sheet has no fieldset, input,
textarea or radiogroup past its right edge, on open and after "Several
identical" (phone and iPad); before anything sells the consignor's Balance
reads "Nothing owed yet", not "Settled"; mechanic2's consignor list row
reads "1 sold" and never "awaiting payment", the admin's "1 awaiting
payment".

Phase 6 step 4 (phone and tablet, every created record tagged, stock
asserted relative to a reading taken first):
`consignment-journey.spec.ts` is journey 4 below without the label step
(labels are Phase 8): an admin creates "Consignor <tag>", receives
"Colnago Master <tag>" (owed 500, asking 1000; `C-`, `U-` link, "For
sale"), uploads a listing photo and makes it Public while the agreement
photo offers no Public (D52), makes the product internal and publishes
it, and "What the public sees" shows it Available at $1,000.00 with no
"$500.00" (D45); Sell on the item page prefills 1000.00 and records
"S-…"; the sale page shows $1,000.00, Direct cost (incl. consignor payout)
$500.00, Yield $500.00, Cult Commons (30% of positive yield) $150.00 and
BICII after Cult Commons $350.00 with "owed $500.00, paid separately"; the
public preview then reads Sold (D26); the consignor shows Outstanding
$500.00 with the item under Awaiting payment; mechanic2 sees $1,000.00 but
no "Yield", "Cult Commons", "Direct cost" or "$500.00" on the sale, and no
"Outstanding", "Owed", "$500.00", Record payment or Show payout details on
the consignor (D48); $200.00 ("PayNow <tag>") leaves $300.00 and $300.00
settles it ("Settled", D47); Today's "Consignment sales" tile is at least
$1,000.00, says "sales or jobs with consigned items", and opens
`/sales?day=<today>`, which lists the sale. `sales.spec.ts`: an
admin sells one "Dry chain lube 120ml" through New sale and the picker
(price 16.00, a Preview with the $9.00 yield) → the product has one less
in stock; a $5.00 partial refund with a reason marks it Partly refunded
on the sale and in the list and leaves the stock unchanged (D7, D49); a
tagged unique "Frameset <tag>" made in New product is sold from its unit
page (450 warns "Below the asking price" and "Below cost: this sale loses
money", D53; "Sold earlier?" with a time next year marks Sold at with
"Enter a date and time that is not in the future." and aria-invalid and
records nothing), the unit reads "Sold on S-…", and Restock… with a reason
from the sale line → "Restocked" and the unit Available again (D46);
mechanic2 sells one "DSP 3.2mm bar tape" (only "Below the asking price"
warns; no Preview, cost, yield or Cult Commons in the sheet or on the
sale, no "$26.00", no Record refund) and the stock drops by one.

Phase 7 (`purchasing.spec.ts`, phone and iPad; suppliers, products and
orders tagged with `tagFor`, the seeded orders `PURCHASE_ORDER` only read;
helpers in `tests/e2e/purchasing-helpers.ts`: `createSupplier`,
`startOrderFromSupplier`, `addOrderLine`, `submitOrder`,
`createSubmittedOrder`, `openReceive`, `receiveLine` and
`interceptReceiveActions`, which drops the receive page's Server Action
POSTs (`next-action` header) on purpose). Suppliers and orders: a buyer
adds a supplier (tel: and https links), orders from it with the supplier
preset, changes a line, submits and finds the PO from the header search
however typed; mechanic2 follows PO-000002 (18 of 20, Overdue, DN-5531)
without any cost or control; a cancel needs a reason and keeps it in the
history; a received PO is closed. Journey 3's receiving step: a counted
product (reorder point 20, cost 12.00) and a tagged supplier; an order of
20 × $12.00 submitted and received: the line defaults to 20, 18 at an
actual cost of $12.50 ("Differs"), the default location, the commit
button DOUBLE-CLICKED; the order shows the toast "Received 18 items. 2
still to come.", Partially received and "18 of 20 received · 2 to come"
with one receipt; the product shows 18 in stock before and after a reload,
exactly one `Received +18` movement, the supplier with "Last cost $12.50"
and "On order: 2"; one part used on a job → 17; `/purchasing/reorder` for
the supplier lists it ticked with on order 2 and "Suggested 21", and
Create draft order opens a draft with it × 21 at $12.50. Lost response:
the receive POST reaches the server and the connection is then reset →
the error toast, the form read-only while checking, then "This delivery
was recorded … (6 items)" with no Retry; one receipt, stock +6 once;
"Receive another delivery" shows 4 to come with an empty delivery note,
and typing the same note (any case) shows the duplicate warning with the
commit disabled until "This is a different delivery" is ticked. Lost
request: the next POST is reset before it leaves → checking → "It was not
recorded. Retrying is safe…" → Retry → "Order fully received.", exactly
two receipts, 10 in stock. The receive page of PO-000001 shows the closed
state; mechanic2 gets a real 403 on `/purchasing/receive/<PO-000002>` and
`/purchasing/reorder` and sees no Receive or Reorder link; the admin sees
Receive on an open PO, "Submit the order before receiving" on a draft,
and Reorder on the Inventory low-stock filter. Phase 4's journey-3 spec
still seeds its stock by an opening count; Phase 8 adds the labels step.

Critical journeys, added with the phases that build them, against the seeded
database, signed in as the seeded admin and mechanic:

1. Walk-in: new customer + bike → intake photo (fixture image upload) → job →
   add service + part → stock badge decrements → complete → ready → collected;
   timeline shows every step; Today shows the job and its money (complete
   with M1.5: `workshop.spec.ts` for the timeline, `today.spec.ts` for the
   milestone run ending on Today).
2. Appointment: book (as seeded customer via RPC) → appears on Today → arrive →
   check in → work order linked (`appointments.spec.ts`: Today's arrivals
   list and counts, the appointments list, check-in, the job's link back).
3. Bulk product: create → receive PO (partial) → print 10 labels (PDF adapter
   produces 10 identical QR payloads) → consume one on a job → stock −1.
4. Consignment: create consignor + unique bike → label → public page (hitting
   `public_items` through the app's preview route) → record sale → yield and
   CC shown to admin, hidden from mechanic → consignor outstanding → partial
   settlement → full settlement → outstanding 0 (`consignment-journey.spec.ts`
   since Phase 6 step 4, without the label step until Phase 8).
5. Shopify: publish product → simulate `orders/paid` POST to the webhook route
   with a valid HMAC → stock −1 once; POST the same payload again → unchanged.
6. (Later, in the public-site repo) customer sign-in sees only own data.

## Seed data

`supabase/seed.sql` is both the demo dataset and the test fixture. Fixed
UUIDs are exported from `tests/fixtures/ids.ts` so tests never query by name.
Four staff logins (D90): `admin` (role admin), `manager` (Kavya Menon, role
manager, no exceptions), `mechanic1` (role mechanic, `view_costs` as an
exception) and `mechanic2` (role mechanic, none); tests that list or count
staff expect all four.
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
(`workshop-customer-access.test.ts`). Seed realism, which the schema does
not enforce, is pinned in `reporting-seed.test.ts`: no bike has two seeded
jobs open at once (check-in to completion or cancellation) and none is
collected while another job on it is open; the bikes that carry more than
one job are listed (a bike awaiting collection may take a newer job).

Since Phase 2 the seed also holds the shop's schedule (settings, weekly
hours with an inactive Monday and a split Saturday, four appointment types
with one staff-only, two closures within 14 days), **one customer login**
(Chloe Lim, `CUSTOMER_LOGIN.chloe`: chloe.lim@example.com, no usable
password like every seeded login, `seed-logins.test.ts`; linked to `CUSTOMER.chloe`, for E2E journey 2 and read-only
customer checks) and nine appointments from three days back to at most 14
days ahead (`APPOINTMENT`; Tan's linked to J-000014 and completed with it).
`SEED_DAYS` carries their D41 counts. Guarantees other tests rely on,
pinned in `appointment-seed.test.ts`: nothing seeded beyond 14 days (tests
book on clear Tuesday–Fridays ≥ 21 days ahead), no seeded closure covers
the anchor day, Daniel has no upcoming booked/confirmed appointment, Chloe
at most two upcoming online bookings (under the limit of 3), today at most
three expected arrivals.

Since Phase 6 step 2 the seed ends with **consignment and sales** written
through the RPCs: three consignors (`CONSIGNOR`), four items C-000001…
C-000004 (`CONSIGNMENT_ITEM`, `CONSIGNMENT_ITEM_SHORT_ID`), their products
and units, two charges, four sales S-000001…S-000004 on days 5, 4, 3 and 0
(`SALE`, `SALE_NUMBER`), a return, a reversed settlement and its
replacement and a refund. The figures are written by hand in
`tests/fixtures/ids.ts` (`EXPECTED_CONSIGNOR_LEDGER`, `EXPECTED_SALE`,
`EXPECTED_JERSEYS_POSITION`) and in `SEED_DAYS` (sales in the money
columns; real consignment columns, 0 on days without). Two Phase 4
assertions that read shared seed rows were made robust rather than the seed
changed: the Brompton tube's on-hand counts S-000002 (`inventory-ledger`),
and the "colnago" product search picks the shop's Colnago by id because the
consigned Colnago now matches too (`staff-search`). Phase 6 helpers live in
`tests/db/consignment-fixtures.ts` (`recordSale`, `saleLines`, `restock`,
`refund`, `settle`, `reverseSettlement`, `itemLedger`, `consignorLedger`,
plus step 1's intake, charge, return and position helpers); `saleLines`,
`itemLedger` and `consignorLedger` read as the owner because costs, payouts
and the ledger views have no API grant.

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
  traces, devstack logs and the mail catcher's messages (`.devstack/mail/`,
  local codes only) are uploaded as an artifact. `devstack:start` brings the
  mail catcher up in both workflows; `ci.yml`'s "Devstack logs" step prints
  `mail.log` with the others.

Secrets in CI: none. E2E runs against the devstack (real Supabase Auth,
PostgREST and Storage with the local demo keys), not staging, so it works
on forks and needs no staging credentials.
