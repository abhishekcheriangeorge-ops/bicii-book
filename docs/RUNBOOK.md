# BICII Admin — Runbook

Owner: Abhishek Cherian George. Audience: technical operator. Last
exercised, per section (as of 2026-10-05):

- Hosted sections (hosted projects, migrations, first admin, key rotation,
  Vercel): never; no hosted project exists.
- Local Supabase with Docker (Supabase CLI): never exercised here; the
  build environment has no Docker.
- The camera scanner on phones and iPads: not exercised (no LAN device
  test, no HTTPS dev server, no flag); `tests/e2e/scan.spec.ts` covers
  scanning on localhost with a stubbed camera and manual entry.
- Appointments: schedule before go-live: not run as a go-live procedure;
  its screens are exercised by `tests/e2e/appointment-settings.spec.ts`.
- Purchasing: suppliers and reorder points before go-live: not run as a
  go-live procedure; its screens are exercised by
  `tests/e2e/purchasing.spec.ts`.
- Labels (the QR address, label printers): the address and printing are
  exercised on localhost by `tests/e2e/labels.spec.ts`, `print-view.spec.ts`
  and journeys 3 and 4 with `window.print` stubbed or the PDF fetched;
  never on a real label printer
  ([R-075](RISKS.md#r-075--label-output-is-unverified-on-a-real-label-printer-and-on-ios)).
- CI: the `e2e` label exists, and PRs #2–#7 carry it, each with a
  successful `e2e` workflow run (e.g.
  [PR #7 e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37276834195/job/111655595521));
  branch protection is unverified
  ([R-010](RISKS.md#r-010--e2e-is-not-a-required-check-and-branch-protection-is-unverified)).

Environment overview, administration and recovery: [OPERATIONS.md](OPERATIONS.md).

Operational how-tos that are not part of day-to-day development. For the
everyday local setup (the Docker-free devstack) see [ENGINEERING.md](ENGINEERING.md).

- [Local Supabase with Docker (Supabase CLI)](#local-supabase-with-docker-supabase-cli)
- [Hosted Supabase projects: staging and production](#hosted-supabase-projects-staging-and-production)
- [Applying migrations to a hosted project](#applying-migrations-to-a-hosted-project)
- [Creating the first admin in a hosted project](#creating-the-first-admin-in-a-hosted-project)
- [Rotating keys and passwords](#rotating-keys-and-passwords)
- [Vercel environment setup](#vercel-environment-setup)
- [Appointments: schedule before go-live](#appointments-schedule-before-go-live)
- [Purchasing: suppliers and reorder points before go-live](#purchasing-suppliers-and-reorder-points-before-go-live)
- [Labels: the QR address before the first print](#labels-the-qr-address-before-the-first-print)
- [Label printers](#label-printers)
- [CI](#ci)

The demo data is relative to the shop day (Singapore) the database was
last reset with `npm run db:reset` or `supabase db reset`: reset again to
move the demo's "today" (Today, the daily summary and the board read it);
E2E global setup reads that anchor day once into `E2E_SEED_ANCHOR`.

Pin the CLI version the repo uses (`supabase@2.119.0`, the one that ran
`supabase init` and generates `src/lib/database.types.ts`). Every command
below is written as `npx supabase@2.119.0 …`; `supabase …` from a global
install of the same version is equivalent.

## Local Supabase with Docker (Supabase CLI)

Use this instead of the devstack on macOS or Windows, or wherever Docker is
available and you prefer the official stack. It reads `supabase/config.toml`
and serves the same URL layout on the same port (API on
`http://127.0.0.1:54321`), with the same well-known local demo keys.

```sh
npx supabase@2.119.0 start        # first run pulls images; applies migrations + seed.sql
npx supabase@2.119.0 status -o env  # API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL
npx supabase@2.119.0 db reset     # re-apply supabase/migrations and supabase/seed.sql
npx supabase@2.119.0 stop
```

Point the app at it with `.env.local` (copy from `.env.example`):

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from status>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from status>
NEXT_PUBLIC_PUBLIC_SITE_URL=http://localhost:4000
```

The scripts and tests do not read `.env.local`: give them the database in
the shell (`DATABASE_URL=…` or `BICII_TEST_DATABASE_URL=…` before the
command, as below), or they use the devstack default
(`postgres:postgres@127.0.0.1:5432/bicii_dev`).

Differences from the devstack:

- **Do not run `npm run db:reset` or `devstack:*` against it.** Those build
  the platform layer themselves (roles, Auth and Storage migrations) and
  expect a real superuser. Use `supabase db reset` and `supabase migration
  up` instead.
- **DB tests** run in existing-database mode, inside rolled-back
  transactions; the tests that must commit or that consume sequence values
  (short IDs are never reused) skip themselves:
  `BICII_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db`.
- **Types:** `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run db:types`
  (or `npx supabase@2.119.0 gen types typescript --local --schema public,reporting`,
  then `npx prettier --write src/lib/database.types.ts`). `-- --fresh`
  needs the devstack.
- **Sign-in codes:** Auth's emails (staff sign-in codes, PLAN D10) go to
  the CLI's Mailpit, not the devstack's mail catcher: open
  `http://127.0.0.1:54324` to read a code. `config.toml` gives it the same
  templates (`supabase/templates`), 6-digit codes valid for 600 s and raised
  local rate limits.
- **E2E:** `npx supabase@2.119.0 db reset && E2E_EXTERNAL_STACK=1 BICII_MAIL_KIND=mailpit npm run test:e2e`.
  Playwright then skips its own reset and devstack start and only checks
  that the seeded admin can sign in (and reads the seed's anchor day);
  `BICII_MAIL_KIND=mailpit` makes the tests read codes from Mailpit
  (`scripts/devstack/mail-client.mjs`; written from Mailpit's API
  documentation and not yet run, as there is no Docker in the build
  container).
- `config.toml` sets `[db] major_version = 17`, so Docker runs Postgres 17
  while the devstack and CI run 16. Keep migrations to SQL both accept.
  When the hosted projects exist, set `major_version` to theirs (`show
  server_version;`).

## Hosted Supabase projects: staging and production

Two projects (PLAN §4): `bicii-staging` (Vercel previews, manual testing)
and `bicii-prod`. The owner creates them; agents never see production keys.

1. supabase.com → New project, in the shop's organisation. Name
   `bicii-staging` (then repeat for `bicii-prod`). Region: Southeast Asia
   (Singapore). Generate a strong database password and store it in the
   password manager; it is needed for `supabase link` and `db push`.
2. Authentication: staff sign in with emailed one-time codes (PLAN D10,
   D70), so email delivery is part of signing in. Set up, in this order:
   - **Emails → SMTP Settings: a custom SMTP provider is REQUIRED.**
     Supabase's built-in sender only mails the project's team members and
     is heavily rate-limited, so staff would get no codes. Enter the
     provider's host, port, user, sender name and sender address; the SMTP
     password is typed into the dashboard only (never into the repository,
     an env file or a chat).
   - **Emails → Templates → Magic Link** (and **Confirm signup**): paste
     `supabase/templates/magic_link.html` (and `confirmation.html`), which
     contain `{{ .Token }}` and no link (codes only: a link would open in
     the mail app's browser, not the installed Admin). Subjects: "Your BICII
     sign-in code" (Magic Link) and "Your BICII code" (Confirm signup), as
     in `supabase/config.toml`.
   - **Sign In / Providers → Email**: enabled; OTP length **6**; OTP expiry
     **600** seconds (`OTP_LENGTH`, `OTP_EXPIRY_MINUTES` in
     `src/lib/auth/otp.ts`). Turn **off** "Allow new users to sign up" until
     the public site's customer accounts go live
     ([The public site: customer accounts](#the-public-site-customer-accounts)): invites create logins through the Auth admin API, which
     works with sign-ups off, and sign-in asks for a code with
     `shouldCreateUser: false`, so it never creates an account.
   - **Rate Limits**: the minimum interval between emails to one address
     **60** seconds (it matches "Send a new code", `RESEND_COOLDOWN_SECONDS`).
     The Admin asks Auth from its server, so Auth's per-IP limits count the
     Admin's server address for every staff member and visitor together:
     they are one shared bucket, not a per-person limit. The Admin applies
     its own per-client and per-email limits first (PLAN D72: per 5
     minutes, 10 code requests and 20 verifications per client address, 5
     and 10 per email), so set Auth's **sign-ins and sign-ups** and **token
     verifications** (per 5 minutes per IP) well above those, at least
     **150** each, so one visitor cannot fill them; emails per hour sized
     for the staff with headroom (the provider's own sending limit is the
     real ceiling). Auth's per-address interval and hourly email cap are
     shown on the sign-in screen as "Check your email" (only an address with
     a login can reach them, D70), and logged as warnings
     (`auth.request_code`, code `over_email_send_rate_limit`): watch for
     them if staff report missing codes.
   - **Sign In / Providers → Email → Secure password change: ON.** The
     Admin has no password path, but Auth's password change is reachable
     with any session; with this on, a session older than 24 h needs an
     emailed nonce to set a password (config.toml `secure_password_change`,
     the devstack's `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION`).
   - The Admin's server must see each visitor's own address in
     `x-forwarded-for` (Vercel sets it and overwrites what the client sent).
     A host that passes on a client's own `x-forwarded-for` would let a
     visitor pick a fresh per-client bucket for every attempt (the
     per-email limits still hold).
   - **Configure SMTP and test it with the owner's own address BEFORE
     deploying the release that switches sign-in to codes**: on the Users
     page, "Send magic link" to the owner's login must deliver a mail with a
     6-digit code and no link. Without working email nobody can sign in.
   - **REQUIRED before deploying the release that switches sign-in to
     codes: replace every staff login's password and end its sessions.**
     The Admin has no password form, but Supabase Auth's password grant
     (`/auth/v1/token?grant_type=password`, callable with the public anon
     key while the Email provider is on, which codes need) still signs a
     login in with its password. Logins created by the old invite flow have
     the temporary password their inviter saw (PLAN D11). In the SQL editor
     (runs as `postgres`), once per project:

     ```sql
     begin;
     -- The hash of a random secret nobody holds, as the seed and Auth's
     -- own passwordless createUser store.
     update auth.users u
     set encrypted_password = extensions.crypt(
           encode(extensions.gen_random_bytes(48), 'base64'),
           extensions.gen_salt('bf', 10)),
         updated_at = now()
     where u.id in (select s.auth_user_id from public.staff s);
     -- Sessions signed in with an old password end; everyone signs in
     -- again with a code.
     delete from auth.sessions where user_id in (select auth_user_id from public.staff);
     delete from auth.refresh_tokens
     where user_id in (select auth_user_id::text from public.staff);
     commit;
     ```

     The update must report as many rows as there are staff (`select
     count(*) from public.staff;`). Run it after SMTP works (step above):
     everyone, the owner included, then signs in with a code.
   - Accepted residual risk (D70): Auth's own `/otp` endpoint, callable by
     anyone with the public anon key, answers an unknown email with 422
     `otp_disabled`, so a direct API caller can learn whether an address
     has a login. The Admin's screens never reveal it.
3. Authentication → URL Configuration: Site URL is the Admin's URL on that
   environment (production domain, or the staging alias). Add redirect URLs
   for Vercel previews on staging, e.g. `https://*-<vercel-team>.vercel.app/**`.
4. Data API: exposed schemas `public` and `reporting` (plus the default
   `graphql_public`); never `private`. `reporting` is exposed from Phase 4
   because `reporting.public_items` is the anonymous surface of the public
   site's QR pages (DATA-MODEL §14, §15), and staff read the stock views
   (`stock_levels`, `product_stock`, `low_stock`) there; the migrations
   grant `authenticated` USAGE and `anon` USAGE (anon can select
   `public_items` only); the stock views are security_invoker over the
   staff-only tables and `public_items` is a definer view that shows
   published rows and public columns only, so nothing else in the schema
   is reachable. This is
   the same list as `supabase/config.toml` `[api] schemas` and the
   devstack's PostgREST `db-schemas`. Hosted Supabase
   grants ALL on every new `public` table, sequence and function to
   `anon`/`authenticated`/`service_role`; our migrations revoke and grant
   explicitly on every object so those defaults never reach the API. The
   devstack recreates the same defaults (`supabase/devstack/roles.sql`), and
   the meta DB tests ("API surface", `tests/db/meta.test.ts`) compare what
   `anon` and `authenticated` can reach with the allow-list in
   `tests/fixtures/api-surface.ts`, so a forgotten revoke fails CI instead of
   reaching production.
5. Do **not** run `supabase/seed.sql` on a hosted project: it is test data
   with fixed, published UUIDs and `.test` logins, not the shop's. Create
   the first admin as below.
   The inventory migration (`…1800_inventory`) inserts one stock location,
   'Shop floor' (SPEC §11: the MVP starts with one shop), so stock can be
   counted and parts used without the seed; add more in Settings →
   Locations.
6. Storage: do not create buckets by hand. The `…0800_media_storage`
   migration creates `media-internal` (private) and `media-public` (public),
   photo types only, 20 MiB, plus their `storage.objects` policies; it
   keeps an existing bucket of the same name as it is (`on conflict do
   nothing`), so a hand-made one would keep its own settings. After the
   first `db push`, check both under Storage → Buckets.
   `record_attachment` checks that an upload exists by reading
   `storage.objects` as the function owner (`postgres`), which relies on
   `postgres` bypassing RLS there, as it does on hosted Supabase:
   `select rolbypassrls from pg_roles where rolname = 'postgres';` → `t`.
   `media-public` has no select policy for anon on purpose (public URLs
   need none; one would let anyone list the bucket): if the Supabase
   advisor or a dashboard prompt offers to add "public read" there, don't.
   Leftover objects from a failed Storage cleanup are removed by the app
   whenever the record is shown (`attachment_stray_objects`); to look for
   any by hand, as an admin in the SQL editor: `select o.bucket_id, o.name
   from storage.objects o where o.bucket_id in ('media-internal',
   'media-public') and not exists (select 1 from public.attachments a where
   a.storage_bucket = o.bucket_id and a.storage_path = o.name);` (recent
   ones may be uploads or moves still running).

## Applying migrations to a hosted project

From a clean checkout of the commit you are deploying (`main` for
production), after CI is green:

```sh
npx supabase@2.119.0 login                          # once per machine (access token)
npx supabase@2.119.0 link --project-ref <project-ref>   # prompts for the DB password
npx supabase@2.119.0 migration list                 # local vs remote history
npx supabase@2.119.0 db push --dry-run              # what would be applied
npx supabase@2.119.0 db push                        # apply pending migrations, in order
```

- `<project-ref>` is in the project URL (`https://<project-ref>.supabase.co`).
  `SUPABASE_DB_PASSWORD` can supply the password non-interactively.
- `db push` records each file in `supabase_migrations.schema_migrations`,
  the same table the devstack writes, so history agrees everywhere.
- Never pass `--include-seed`. Never edit an applied migration; add a new
  one.
- Order: staging first, check the app on a preview, then production.
  Deploy the app after the migration when the app needs the new schema;
  migrations should stay backward compatible with the running app.
- Re-link to switch projects (`supabase link --project-ref <other-ref>`), and
  check `migration list` before every push so you know which project you
  are pointed at.

### From GitHub Actions (the hosted project)

[`migrate.yml`](../.github/workflows/migrate.yml) runs the same `db push`
from GitHub, so nobody needs the database password on their machine. It
runs on manual dispatch (Actions → "Migrate hosted database" → Run
workflow, branch `main`) and on every push to `main` that changes
`supabase/migrations/`, one run at a time. Each run prints the migration
history, a `--dry-run`, applies the pending files and prints the history
again.

- The owner sets one GitHub Actions secret, `SUPABASE_DB_URL`: the
  project's **session pooler** connection string (Project Settings →
  Database → Connection string → Session pooler), with the database
  password percent-encoded. It is never printed; never paste it into an
  issue, a pull request or a chat.
- It never passes `--include-seed` or `--include-all`. Hosted migrations
  are append-only: a file that sorts before the newest applied migration
  makes `db push` refuse. Rename such a file to a later timestamp (keeping
  the order among its siblings) and check every object it redefines against
  the live definition, then merge.
- After a run that applied something, check Storage buckets (step 6 above)
  and the Supabase advisors (security and performance).

### If `20261005005000_staff_session_revocation` refuses to apply

Deactivating a staff member deletes their Supabase Auth sessions at once
(PLAN D71). The trigger function that does it runs with the rights of the
role that applies migrations, so the migration checks first and fails
loudly, before it changes anything, with "role … cannot delete from
auth.sessions and auth.refresh_tokens" when that role lacks DELETE on
either table.

- Do not edit the migration, and do not drop the check. Resolve the grant
  with Supabase (support or the project's database settings) so the
  migration role (`postgres` on hosted projects) may delete from
  `auth.sessions` and `auth.refresh_tokens`, then run `db push` again. The
  migration runs in one transaction, so nothing half-applied is left
  behind.
- Until it is resolved, deactivation still blocks every page, Server
  Action and RPC for the deactivated person (`requireStaff` answers 403;
  RLS and the RPC guards check `staff.active`), but their devices can keep
  refreshing their session, so they keep seeing the 403 page instead of
  the sign-in page. Later migrations stay blocked behind this one.
- Even when it is applied, a hosted project that verifies JWTs locally
  (asymmetric signing keys) accepts an access token already issued until
  it expires: at most `jwt_expiry` (Authentication > Sessions, 3600 s
  here). The inactive check covers that window; nothing else needs doing.

## Creating the first admin in a hosted project

Every later staff member is invited from Settings → Staff by an admin. The
very first admin has to be created by hand:

1. Authentication → Users → Add user → Create new user. Enter the owner's
   email, tick **Auto Confirm User**, and give no usable password: staff
   sign in with emailed codes (PLAN D10). If the dashboard insists on a
   password, use a long random one and discard it without storing it.
2. SQL Editor (runs as `postgres`, which owns the tables, so RLS does not
   block it), with the same email:

   ```sql
   insert into public.staff (auth_user_id, display_name, email, role)
   select u.id, 'Owner Name', lower(u.email), 'admin'
   from auth.users u
   where u.email = lower('owner@example.com')
   returning id, display_name, email, role, active;
   ```

   One row must come back. Zero rows means the email does not match an
   Auth user; a unique violation means that login or email is already
   staff. The staff email must be the login's email (a trigger refuses
   anything else, `staff_email_mismatch`). The insert is recorded in staff
   history as "created" with no actor ("set up outside the app").
3. Sign in to the Admin with a code (enter the email, then the 6-digit
   code from the email; custom SMTP must already work, step 2 above), and
   invite everyone else from Settings → Staff.

The `staff_keep_an_active_admin` trigger then refuses any change that would
leave the shop without an active admin, so this is needed only once per
project.

## Rotating keys and passwords

Rotate on a schedule, when someone with access leaves, and immediately if a
key may have leaked. Order is always: create the new value, deploy it
everywhere it is used, verify, then revoke the old one.

| Secret | Used by | How to rotate |
|---|---|---|
| Service-role / secret API key | Vercel (server only), never CI | Project Settings → API Keys: create a new secret key (or, on legacy JWT keys, rotate the JWT secret, see below). Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel for that environment, redeploy, then from a fresh private browser window sign in with an email code (every sign-in needs this key, D72: a missing or wrong key locks everyone out) and check Settings → Staff → Invite works; only then delete the old key. |
| Anon / publishable key | Vercel (public), the public site | New publishable key in API Keys; update `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel **and** the public site's env; redeploy both (the value is inlined at build time); then delete the old key. |
| JWT secret (legacy keys) | signs every session and the legacy anon/service keys | Rotating it invalidates the legacy anon and service-role keys and signs every user out. Prefer moving to asymmetric JWT signing keys and publishable/secret keys, which rotate one at a time. If you must, do it in a quiet hour and update both keys everywhere straight after. |
| Database password | `supabase link` / `db push` on admins' machines | Project Settings → Database → Reset database password. Store the new one; re-run `supabase link`. The app does not use it. |
| SMTP password (sign-in codes) | Supabase Auth's mailer (dashboard only) | Create a new credential at the mail provider, paste it in Authentication → Emails → SMTP Settings, send a code to the owner's address (Users → Send magic link) and check it arrives, then revoke the old credential. Until mail works nobody can sign in. |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Vercel | `openssl rand -base64 32`, set it, redeploy. Open browser tabs holding pages built before the deploy get a failed Server Action once and must reload. |
| Shopify tokens (Phase 10) | Vercel | Rotate the Admin API token and webhook secret in the Shopify custom app; update Vercel; redeploy. |

Local devstack keys and the demo JWT secret are public, well-known values
and are never used outside a developer's machine or CI.

## Vercel environment setup

One Vercel project for the Admin, connected to this repository.

1. Framework preset Next.js; build command `npm run build`; install command
   `npm ci`; Node.js version 22.x (Settings → Build and Deployment).
2. Environment variables (Settings → Environment Variables). Production
   points at `bicii-prod`, Preview at `bicii-staging`. Mark the server-only
   ones Sensitive.

   | Variable | Production | Preview | Notes |
   |---|---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | prod project URL | staging project URL | public |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod anon/publishable key | staging key | public |
   | `NEXT_PUBLIC_PUBLIC_SITE_URL` | public site production URL | public site URL | QR base (PLAN D9) |
   | `SUPABASE_SERVICE_ROLE_KEY` | prod service/secret key | staging key | Sensitive; server only; required: without it nobody can sign in (D72) |
   | `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | own value | own value | Sensitive; `openssl rand -base64 32` |
   | `LOG_LEVEL` | `info` | `debug` | optional |
   | `SHOPIFY_*` | Phase 10 | Phase 10 | Sensitive |

   The CLI equivalent is `vercel env add <NAME> production` (or `preview`).
   Do not `vercel env pull` into `.env.local` for everyday work: local
   development uses the devstack, not staging.
3. `NEXT_PUBLIC_*` values are inlined at build time: after changing one,
   redeploy (a new build, not a rollback).
4. Add the production domain and the staging alias to the matching Supabase
   project's Auth URL configuration (Site URL and redirect URLs).
5. Deploy order for a change with a migration: `supabase db push` to
   staging → preview check → `db push` to production → promote or merge to
   `main`.
6. After every deploy and every change to a server-only variable: from a
   fresh private browser window, sign in with an email code. Every sign-in
   counts its attempt with `SUPABASE_SERVICE_ROLE_KEY` first (PLAN D72), so
   a missing or wrong key shows "Sign-in is unavailable right now" to
   everyone ([OPERATIONS](OPERATIONS.md) incident table).

## The public site: customer accounts

Phase 11 (ADR-023, D120–D125). The public site (repository `bicii`, its own
Vercel project) signs customers in against this project's Auth and reads
the customer RPCs and public projections. Do these steps once per hosted
project, in this order, when the public site's account pages are deployed
against it. Until then the site's account pages show that online accounts
are not open, and nothing below affects staff.

1. Migrations: `20261006103000_public_site` must be applied (it is part of
   `main`; [Applying migrations](#applying-migrations-to-a-hosted-project)).
2. Authentication → Emails → Templates → **Magic Link**: paste the current
   `supabase/templates/magic_link.html` again. It now says "the BICII
   sign-in screen", because customers receive it too.
3. Sign In / Providers → Email → **Allow new users to sign up: ON**
   (D120). Staff sign-in is unaffected: the Admin asks for codes with
   `shouldCreateUser: false`, and a login without an active staff row is
   refused by the Admin and sees nothing through RLS. The public site asks
   with `shouldCreateUser: true`, so a customer's first code creates their
   login.
4. Rate limits: no change. The public site calls Auth from each visitor's
   browser, so Auth's per-IP limits count each visitor separately.
5. URL configuration: no change. Emails carry codes only, never links.
6. The public site's Vercel project, Settings → Environment Variables
   (Production; Preview only if previews may use this project):
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (this
   project's URL and anon or publishable key, the same values the Admin
   uses), and `NEXT_PUBLIC_ADMIN_URL` (the Admin's production address, for
   the Staff link on item pages). **Never** give the public site the
   service-role key: it needs none. Redeploy after changing any of them
   (they are inlined at build time).
7. Check, from a private browser window on the public site: an item page
   `/q/<short ID>` of a published product shows it; an unknown ID shows
   "not listed"; sign in with a test address you control (a code arrives),
   book a time with your name, see it under your account, cancel it. Then
   archive the test customer in the Admin.

Customer support, in the Admin and the SQL editor:

- "We can't link your account" (`customer_link_ambiguous`, D121): two or
  more unarchived customers share the customer's email. Archive the
  duplicate or correct its email in the Admin; the customer signs in again.
- "Your account is closed" (`customer_archived`): the login belongs to an
  archived customer. Unarchive the customer in the Admin if they should be
  back.
- A login linked to the wrong customer
  ([R-065](RISKS.md#r-065--a-mistyped-customer-email-lets-someone-else-claim-that-record)):
  in the SQL editor, `update public.customers set auth_user_id = null where
  id = '<customer id>';`, then correct the customer's email in the Admin.
  There is no screen for this yet.

## The camera scanner on phones and iPads

The Scan screen (`/scan`) uses the camera, which browsers allow only in a
secure context: HTTPS, or `localhost` on the same machine. Over plain
`http://192.168.x.x:3000` the scanner says "The camera only works over a
secure connection" and only manual entry ("Or type the code on the label")
works; that is expected, not a bug. Production and Vercel previews are
HTTPS, so scanning works there once camera access is allowed (iPhone:
Settings → Safari → Camera → Allow).

To try scanning on an iPad or phone on the LAN:

- Easiest: a Vercel preview on staging (HTTPS end to end).
- Locally: `npx next dev --experimental-https -H 0.0.0.0` serves the app over
  HTTPS with a self-signed certificate (accept it on the device, or pass a
  trusted one with `--experimental-https-key` / `--experimental-https-cert`,
  e.g. made with mkcert and its CA installed on the device). The browser
  also refuses plain-http requests from an HTTPS page, so
  `NEXT_PUBLIC_SUPABASE_URL` must point at the devstack gateway through an
  HTTPS address the device can reach (a TLS proxy in front of
  `:54321`), not `http://127.0.0.1:54321`.
- Android Chrome only: `chrome://flags` → "Insecure origins treated as
  secure" with the LAN URL lets the camera work over http for testing.

Printed labels encode `{shop_settings.public_site_url}/q/{short_id}` (PLAN
D9, decided in Phase 8: [ADR-017](decisions/ADR-017-labels-and-qr-base.md));
the database computes it (`private.qr_payload`) and refuses to print
(`public_site_url_invalid`, "Labels are off until an admin sets a valid
public website address") while the address is unset or invalid. The
scanner accepts `NEXT_PUBLIC_PUBLIC_SITE_URL`, the Admin's own `/q/…` URLs
and bare short IDs, and shows anything else as "Not a BICII label" without
opening it; Phase 8 step 2 adds the database QR base to the accepted list
(`src/lib/qr.ts`), keeping the environment's base so earlier labels still
scan.

## Appointments: schedule before go-live

The seed's schedule is demo data. Before the shop takes real bookings
(staff or online), an admin sets, in the app under Settings:

1. **Shop hours and closures → Weekly hours.** Tap each weekday: switch
   "Open on <day>" and enter up to four stretches (a lunch break is two).
   A closing time of 00:00 means midnight.
2. **Booking capacity → Edit.** The slot length (5 to 240 minutes and
   dividing the day evenly, e.g. 15, 20, 30, 45 or 60; bookings start on
   that grid from midnight)
   and how many bikes the shop takes in per slot (one shared pool, PLAN
   D2). The online booking rules (D37): minimum notice (default 120
   minutes), how far ahead customers may book (60 days), how many upcoming
   online bookings one customer may hold (3; staff bookings never count)
   and the online cancellation cutoff (120 minutes before the start; after
   it the customer calls the shop). Staff bookings ignore the online rules
   but never the hours, closures or capacity.
3. **Appointment types.** Name, description, duration (steps of 5
   minutes), capacity units (at most the shop's capacity), "Public"
   (customers can book it on the website) and Active. Types are never
   deleted: switch one off to stop new bookings.

**Closures and short days.** Settings → Shop hours and closures → Add
closure. "Closed" closes whole days (first to last day) or, with "Only part
of the day", a few hours of one day; "Short day" opens only the hours
given on those days, instead of the weekly hours. A reason is required
(staff see it; customers only see that no times are free). Deleting a
closure asks for a reason too and is kept in the schedule history.

**Existing bookings never move** (D38). Changing hours, closures, the slot
length, the capacity or a type's length or units leaves every appointment
already booked as it is. After a save the toast says how many upcoming
appointments no longer fit, with a link to the first such day; each
closure shows "N appointments affected"; the appointments day view marks
them "Outside opening hours" or "Shop closed" and its capacity bars turn
red over capacity. Call those customers and cancel and rebook (there is no
reschedule and no automatic customer message in the MVP).

**Fixed settings.** The shop's time zone is Singapore and its currency SGD
(D35): no screen or RPC changes them.

## Labels: the QR address before the first print

`shop_settings.public_site_url` is the QR base (D9): every label encodes
`{public_site_url}/q/{short_id}`, and nothing prints while it is unset or
invalid. Before the first real label, an admin sets it to the public
site's address (http or https, a host and an optional path, no `?` or `#`,
at most 200 characters; for example `https://bicii.sg`) in Settings →
Labels and printers → Change address (it calls `update_shop_settings`,
which checks the same rule).
The seed sets `http://localhost:4000`. Do not change it casually: labels
already printed keep the old address
([R-013](RISKS.md#r-013--changing-the-qr-base-leaves-printed-labels-on-the-old-address));
after a move, keep the old site redirecting `/q/*` or reprint. The
migration ships the default 58 × 40 mm templates and the "This device
(browser print)" and "PDF download" printers, so a new database can print
once the address is set.

The product, unit and bike pages show "QR address not set" or a disabled
Print label with the reason while the address is unusable ("Labels are off
until an admin sets the public website address in Labels and printers
settings."). The QR address is that setting only: the environment's
`NEXT_PUBLIC_PUBLIC_SITE_URL` never changes what is printed or shown; it
only adds an address the Admin scanner accepts. After a move, put the OLD
address there so its labels still open in the Admin, and keep the old
public site redirecting `/q/*`.

Hosted projects: the public side of a label (an anonymous scan) reads
`reporting.public_items`, so `reporting` stays in the Data API's exposed
schemas ([step 4 above](#hosted-supabase-projects-staging-and-production),
required since Phase 4). Phase 8 adds no other anonymous surface.

## Label printers

Phase 8 prints through the browser or a PDF; there is no printer driver
or hardware adapter until Phase 12
([R-012](RISKS.md#r-012--label-printer-hardware-is-unknown)). Nothing below
has been tried on the shop's printer yet
([R-075](RISKS.md#r-075--label-output-is-unverified-on-a-real-label-printer-and-on-ios)).

1. Prerequisite: the public website address is set (previous section);
   until then every Print label is disabled.
2. Browser print ("This device (browser print)", the default printer):
   add the label printer to the iPad or iPhone through AirPrint (or to a
   desktop's printers). In the print dialog choose that printer, paper 58
   × 40 mm (or the template's size), margins None, scale 100%, and no
   headers or footers. Each label prints on its own page.
3. PDF ("PDF download"): for a printer without AirPrint, or when Safari
   scales the page. Open PDF opens the job's PDF (exact page size,
   standard fonts) in a new tab; then Share → Print, or print from the
   printer's own app, at 100%.
4. Calibration: print one label and compare. If it is shifted, Settings →
   Labels and printers → the printer → offsets (0.5 mm steps, −5 to 5 mm,
   per printer); print again. Other label stock: add a template with its
   size (the editor's preview refuses a layout that does not fit).
5. Confirm every job: "Yes, all printed" or "Something went wrong…" with
   the reason. Unconfirmed jobs wait under Labels → To confirm
   ([R-076](RISKS.md#r-076--print-success-is-confirmed-by-hand)). A wrong
   print is marked failed and printed again from the record (Print again
   makes a new job); a finished job's PDF answers 409 by design.

Record the first real test print of each built-in template, with both
printers, here (date, device, printer model, result).

## Purchasing: suppliers and reorder points before go-live

The seed's suppliers and purchase orders (Velo Parts, Tropic Tyre, Old
Spoke; PO-000001 to PO-000005) are demo data and never reach a hosted
project. Before the shop orders through the Admin:

1. **Who buys.** Give the people who order and receive Manage purchasing
   (Settings → Staff); it shows them purchase costs on purchasing screens
   (D60; [OPERATIONS](OPERATIONS.md#product-administration)).
2. **Suppliers.** Purchasing → Suppliers → New supplier for each real
   supplier: name, contact, phone, email, website and BICII's account
   number with them.
3. **Links and reorder points.** On each counted, shop-owned product the
   shop buys: Suppliers & orders → Add supplier (supplier SKU, lead days,
   Preferred), and a reorder point on the product (Edit), so Reorder can
   suggest quantities (D66). Consigned products are never linked or
   ordered.
4. **Opening costs.** A product's cost becomes the actual cost of its
   latest delivery (D5, D63); check the costs entered before go-live,
   because the first deliveries overwrite them.

## CI

`.github/workflows/ci.yml` runs `check`, `test` and `build` on every pull
request and every push to `main`. `.github/workflows/e2e.yml` runs `e2e`
on manual dispatch, nightly, and on pull requests labelled `e2e`. Neither
needs secrets: every job runs against a Postgres 16 service container and
the devstack with its local demo keys. See TESTING.md "CI" for what each
job checks.

- Create the label once: `gh label create e2e --description "Run Playwright in CI"`.
- Branch protection on `main`: require `check`, `test (unit + db)` and
  `build`. They live in `ci.yml`, which never runs on `labeled`: a
  label-triggered run would post *skipped* check runs under those names on
  the head commit, and GitHub treats a skipped required check as passing.
  Keep it that way; anything label-driven goes in its own workflow with its
  own job names.
- Adding other labels while `e2e` runs does not cancel it (they get their
  own concurrency group); a new push, or removing and re-adding `e2e`,
  restarts it.
- The devstack components (about 1 GB, mostly Storage's `node_modules`) are
  cached under a key made of their pinned versions
  (`scripts/devstack/cache-key.mjs`) and a hash of `setup.mjs`. Bumping a
  version in `scripts/devstack/config.mjs` rebuilds the cache on the next
  run (a few minutes).
- A failed `e2e` uploads the Playwright HTML report, traces and devstack
  logs as an artifact for 14 days.
