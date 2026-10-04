# BICII Admin — Runbook

Operational how-tos that are not part of day-to-day development. For the
everyday local setup (the Docker-free devstack) see the README quickstart.

- [Local Supabase with Docker (Supabase CLI)](#local-supabase-with-docker-supabase-cli)
- [Hosted Supabase projects: staging and production](#hosted-supabase-projects-staging-and-production)
- [Applying migrations to a hosted project](#applying-migrations-to-a-hosted-project)
- [Creating the first admin in a hosted project](#creating-the-first-admin-in-a-hosted-project)
- [Rotating keys and passwords](#rotating-keys-and-passwords)
- [Vercel environment setup](#vercel-environment-setup)
- [CI](#ci)

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
- **E2E:** `npx supabase@2.119.0 db reset && E2E_EXTERNAL_STACK=1 npm run test:e2e`.
  Playwright then skips its own reset and devstack start and only checks
  that the seeded admin can sign in.
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
2. Authentication → Sign In / Providers: Email enabled (PLAN D10: staff use
   email + password, no magic links). Turn **off** "Allow new users to sign
   up" until the public site's customer sign-in ships (Phase 11); staff
   logins are created by admins through the Auth admin API, which works with
   sign-ups off. Minimum password length: 12 (what the Admin's password
   form requires; invites generate 20-character temporary passwords that
   always contain upper and lower case, digits and symbols, so any
   "Password requirements" setting accepts them). Leave "Secure password
   change" as it is: the Admin itself requires the current password before
   a change (Settings → Profile), which also covers sessions signed in
   less than a day ago, where Supabase's reauthentication would not ask.
3. Authentication → URL Configuration: Site URL is the Admin's URL on that
   environment (production domain, or the staging alias). Add redirect URLs
   for Vercel previews on staging, e.g. `https://*-<vercel-team>.vercel.app/**`.
4. Data API: exposed schemas `public` and `reporting` (plus the default
   `graphql_public`); never `private`. `reporting` is exposed from Phase 4
   because `reporting.public_items` is the anonymous surface of the public
   site's QR pages (DATA-MODEL §14, §15), and staff read the stock views
   (`stock_levels`, `product_stock`, `low_stock`) there; the migrations
   grant `authenticated` USAGE (and, from Phase 4 step 2, `anon` USAGE
   with `public_items` only), and the views are security_invoker over the
   staff-only tables, so nothing else in the schema is reachable. This is
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
5. Do **not** run `supabase/seed.sql` on a hosted project: its logins have a
   published password. Create the first admin as below.
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

## Creating the first admin in a hosted project

Every later staff member is invited from Settings → Staff by an admin. The
very first admin has to be created by hand:

1. Authentication → Users → Add user → Create new user. Enter the owner's
   email and a strong temporary password, and tick **Auto Confirm User**.
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
3. Sign in to the Admin, change the password (Settings → Profile), and
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
| Service-role / secret API key | Vercel (server only), never CI | Project Settings → API Keys: create a new secret key (or, on legacy JWT keys, rotate the JWT secret, see below). Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel for that environment, redeploy, check Settings → Staff → Invite works, then delete the old key. |
| Anon / publishable key | Vercel (public), the public site | New publishable key in API Keys; update `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel **and** the public site's env; redeploy both (the value is inlined at build time); then delete the old key. |
| JWT secret (legacy keys) | signs every session and the legacy anon/service keys | Rotating it invalidates the legacy anon and service-role keys and signs every user out. Prefer moving to asymmetric JWT signing keys and publishable/secret keys, which rotate one at a time. If you must, do it in a quiet hour and update both keys everywhere straight after. |
| Database password | `supabase link` / `db push` on admins' machines | Project Settings → Database → Reset database password. Store the new one; re-run `supabase link`. The app does not use it. |
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
   | `SUPABASE_SERVICE_ROLE_KEY` | prod service/secret key | staging key | Sensitive; server only |
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
