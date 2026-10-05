# Engineering guide

Owner: Abhishek Cherian George (owner); maintained by the build agent.
Last setup exercise: 2026-10-05, this machine (Linux, Node 22.22.0, npm
10.9.4, Postgres 16.14, no Docker), commit f32dc45 (application code
identical to b34bbcd, the head of PR #7); results in the tables below.

This is the one home for setup, commands and conventions. What the product
is: [PRODUCT.md](PRODUCT.md). How it is built: [ARCHITECTURE.md](ARCHITECTURE.md).
Test strategy: [TESTING.md](TESTING.md). Rules that are not negotiable and
the Next.js 16 differences (`proxy.ts`, async request APIs, Turbopack):
[AGENTS.md](../AGENTS.md).

## Prerequisites and access

- Node 22 ([`.nvmrc`](../.nvmrc); `package.json` `engines` says `>=22`) with
  npm 10.
- A Postgres 16 you can reach as a superuser (default `postgres`/`postgres`
  on 127.0.0.1:5432). The scripts create databases and the Supabase platform
  roles, so a non-superuser does not work.
- curl, tar and git. No Docker.
- The devstack binaries (PostgREST 12.2.3, Supabase Auth 2.178.0, Node 24
  for Storage, Supabase Storage 1.79.31; pinned in
  [`scripts/devstack/config.mjs`](../scripts/devstack/config.mjs)) are
  linux-x64. On macOS or Windows use the Supabase CLI with Docker instead:
  [RUNBOOK "Local Supabase with Docker (Supabase CLI)"](RUNBOOK.md#local-supabase-with-docker-supabase-cli).
- For the E2E suite, a Chromium that Playwright can launch. On your own
  machine run `npx playwright install --with-deps chromium` once (CI does
  the same in [`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml);
  exercised only there, and `--with-deps` may ask for sudo on Linux).
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` points it at another Chromium instead.
  Exception: in the build agent's container Chromium is preinstalled at
  `/opt/pw-browsers` and used automatically; do not download browsers
  there.
- About 1 GB of disk for the devstack cache (`~/.cache/bicii-devstack`,
  985 MB measured on 2026-10-05).
- Variables: the app reads `.env.local`, which `npm run devstack:env`
  writes. The devstack scripts, the DB tests and Playwright read
  `DATABASE_URL` / `PG*` / `BICII_*` / `E2E_*` from the **shell only**, never
  from `.env.local`. Every name is listed in [`.env.example`](../.env.example).
  Postgres somewhere else? Set `DATABASE_URL`, or `PGHOST` / `PGPORT` /
  `PGUSER` / `PGPASSWORD` (and `PGDATABASE`, default `bicii_dev`), in the
  shell before any command.
- No hosted service, account or credential is needed for development: all
  work runs against the local devstack with its public local demo keys.
  Never commit `.env.local`.

## Clean checkout to running application

Run in this order. The local results are from 2026-10-05 on this machine,
with the components already cached and `bicii_dev` already present.

| Step | Command | Expected result | Evidence |
|---|---|---|---|
| Install | `npm ci` | `node_modules` from `package-lock.json` | Not run locally in the retrofit; CI runs it in every job through [`.github/actions/prepare`](../.github/actions/prepare/action.yml), e.g. [PR #7 `check`](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37276827625/job/111655574607) |
| Devstack components (once per machine) | `npm run devstack:setup` | Each component "cached" (first run downloads and builds, a few minutes); ends "devstack components ready" | Local: all four "cached", 0.5 s |
| Database | `npm run db:reset` | Drops and rebuilds `bicii_dev`: roles, Auth, Storage, 32 migrations, seed; "database ready in …s" and the seeded logins line | Local: "database ready in 2.8s" |
| Services | `npm run devstack:start` | Auth :9999, PostgREST :3001, Storage :5000 and the gateway "ready: http://127.0.0.1:54321". Builds `bicii_dev` itself if it does not exist yet | Local: four services started, 3.3 s |
| Health | `npm run devstack:status` | A table with each service "running" and "ok (200)" | Local: all four ok (200) |
| Configure | `npm run devstack:env` | Writes the gateway URL, the local anon and service-role keys and a placeholder public site URL into `.env.local`, keeping other lines | Local: exit 0 (contents not printed) |
| Run | `npm run dev` | Next dev server (Turbopack) on :3000; open **http://localhost:3000** and sign in | Local: `GET /login` 200, `/` redirects (307) to `/login` |

`npm run devstack:stop` stops the services. The primitives gallery is at
`/dev/ui` in the dev server.

Seeded logins (synthetic, local and CI only; never seed a hosted project,
see [RISKS R-015](RISKS.md#r-015--the-seed-has-published-logins)). The
password for all of them is `bicii-dev-password`:

| Email | Role | Permissions |
|---|---|---|
| `admin@bicii.test` | admin | all |
| `mechanic1@bicii.test` | staff | `view_costs` |
| `mechanic2@bicii.test` | staff | none |

The seed also has one customer login, `chloe.lim@example.com` (Chloe Lim,
same password), for the public site's customer pages; the Admin does not
let customers in. A first useful result: sign in as `admin@bicii.test` and
Today opens ([USER-GUIDE.md](USER-GUIDE.md)).

## Commands

| Script | What it does | Evidence (2026-10-05 unless a URL) |
|---|---|---|
| `npm run dev` | Next dev server (Turbopack) on :3000. | Local: `/login` 200 |
| `npm run build` / `npm start` | Production build / serve it. | Local: both ran inside `npm run test:e2e` (its web server is `npm run build && next start -p 3100`); CI [PR #7 `build`](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37276827625/job/111655574766) |
| `npm run check` | `next typegen` + `tsc --noEmit`, ESLint, `prettier --check`. | Local: pass (30 s); `feat/p6-consignment` Phase 6 steps 1 and 2: pass; the Phase 6 review fixes: pass |
| `npm run check:types` | Regenerate the database types from a throwaway database built from the migrations and fail if `src/lib/database.types.ts` differs. | Local: pass (5 s); `feat/p6-consignment` Phase 6 step 1 (at 365bdd7) and step 2 (at 2c402b2): pass; the Phase 6 review fixes: pass |
| `npm test` | Every Vitest project (unit + db). | Local: 82 files, 1186 tests passed (58 s); `feat/p6-consignment` Phase 6 step 1: 86 files, 1225 tests passed (78 s); step 2: 89 files, 1298 tests passed (65 s); step 4: 92 files, 1364 tests passed (81 s); the Phase 6 review fixes: 93 files, 1384 tests passed (70 s) |
| `npm run test:unit` | Unit project (jsdom): pure TypeScript and synchronous components. | Local: 45 files, 512 tests passed (37 s); `feat/p6-consignment` Phase 6 step 4 (`npx vitest run --project unit`): 48 files, 579 tests passed (22 s) |
| `npm run test:db` | DB project: invariants, RLS and RPCs on per-file clones of a template database. Includes a live-stack smoke test when the devstack is running. | Local: 37 files, 674 tests passed (48 s) |
| `npm run test:e2e` | Playwright, Chromium, phone + iPad. Builds the app, serves it on :3100, resets `bicii_dev`, starts the devstack if needed. | Local: 106 passed (11.1 min); `feat/p6-consignment` Phase 6 step 2: 106 passed (9.7 min); step 3: 110 passed (12.4 min); step 4: 118 passed (13.3 min); the Phase 6 review fixes: 118 passed (11.8 min) |
| `npm run format` / `npm run lint` | Prettier write / ESLint. | `lint` runs inside `check`; `format` not exercised |
| `npm run tokens:contrast` | Recompute WCAG ratios for the colour tokens; fails on a miss. | Local: 29 pairs ok |
| `npm run icons` | Regenerate the PWA icons from `brand/logo-source.png`. | Not exercised |
| `npm run devstack:setup` | Download and build the devstack components into `~/.cache/bicii-devstack` (`BICII_DEVSTACK_CACHE` moves it; idempotent; `-- --force` rebuilds). | Local: cached; `--force` not exercised |
| `npm run devstack:start` / `stop` / `status` | Run, stop, or show health of Auth :9999, PostgREST :3001, Storage :5000 and the gateway :54321; pids and logs in `.devstack/`. `start` builds the database first if it does not exist yet (as `db:reset` would), never touches an existing one, and restarts services that were started against a different database. | Local: all three |
| `npm run devstack:env` | Write the devstack values into `.env.local`, keeping other lines. Only the app reads `.env.local`; the scripts and tests take `DATABASE_URL` / `PG*` from the shell. | Local: exit 0 |
| `npm run db:reset` | Drop and rebuild the dev database, then seed it. The demo history is relative to the shop day of the reset: reset to move "today". | Local: 2.8 s |
| `npm run db:migrate` | Apply pending migrations without a reset. | Local: "already up to date" |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` (`-- --fresh` builds a throwaway database from the migrations first; CI diffs that). | Local: wrote the file; `git diff --exit-code` clean |

## Validation

| Check | Command | What it establishes | Limits | Evidence |
|---|---|---|---|---|
| Static | `npm run check` | Types (with Next's generated route types), lint rules (including the service-role import boundary), formatting | `next build` does not lint; Markdown is not formatted (prettier ignores `*.md`) | Local pass, 2026-10-05 |
| Generated types | `npm run check:types` | `database.types.ts` matches the migrations | Needs Postgres and the devstack cache | Local pass, 2026-10-05 |
| Unit | `npm run test:unit` | Pure rules: money, permissions, status transitions, labels, form parsing, components | No database | Local: 45 files, 512 tests |
| Database | `npm run test:db` (or `npm test` for both) | Invariants, RLS, RPC guards, concurrency and the API surface against real Supabase Auth and Storage schemas. Global setup builds one template from roles, Auth, Storage, the migrations and the seed; each file runs on its own clone | The live-stack smoke test skips when the gateway is down unless `BICII_REQUIRE_STACK=1` (CI sets it); concurrency blocks skip in existing-database mode | Local `npm test`: 82 files, 1186 tests (on b34bbcd); `npm run test:db`: 37 files, 674 tests; `feat/p6-consignment` Phase 6 step 4 `npm test`: 92 files, 1364 tests (unit 48 / 579, so database 44 / 785); the review fixes: 93 files, 1384 tests (unit 48 / 581, database 45 / 803) |
| End to end | `npm run test:e2e` | The staff journeys on an iPhone 13 and an iPad viewport against a production build and the devstack | Chromium only (installed once, see [Prerequisites](#prerequisites-and-access)); resets `bicii_dev`; not a required check in CI ([R-010](RISKS.md#r-010--e2e-is-not-a-required-check-and-branch-protection-is-unverified)) | Local: 106 passed in 11.1 min (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, no dev server running); CI [PR #7 e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37276834195/job/111655595521) |
| Contrast | `npm run tokens:contrast` | WCAG ratios of the colour token pairs | Tokens only, not rendered pages | Local: 29 pairs ok |
| Build | `npm run build` | The app compiles for production with placeholder public env | Does not contact Supabase; writes under `.next`, as `npm run dev` does; it was exercised only with no dev server running in the checkout | Local inside `test:e2e`; CI [PR #7 `build`](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37276827625/job/111655574766) |
| Docs links | the Vibe Code Docs Stack link checker (below) | Every relative link and heading anchor in the repository's Markdown resolves; fences are closed | Does not check external URLs or the truth of the text | Local: 0 problems at this commit |

Strategy, the invariant list and what CI runs: [TESTING.md](TESTING.md),
in particular [Database test harness](TESTING.md#database-test-harness)
and [CI](TESTING.md#ci).

The docs link check uses the toolkit's checker without its `--root`
mode: `check_docs.py --root <app>` also runs the toolkit's own
skill-package check, which always fails on an application repository.

```sh
git clone https://github.com/abhishekcheriangeorge-ops/vibe-code-docs-stack
python3 -m venv .venv && .venv/bin/pip install -r vibe-code-docs-stack/scripts/requirements-checks.txt
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -B -c "import sys; sys.path.insert(0, 'vibe-code-docs-stack/scripts'); import check_docs; e, n, l = check_docs.check_markdown('/path/to/bicii-book'); print(*e, sep='\n'); print(f'{n} files, {l} links, {len(e)} problems'); sys.exit(1 if e else 0)"
```

Clone the toolkit and create the venv outside this repository, or the
checker would scan the toolkit's own Markdown too.

## Changing the system

Read [AGENTS.md](../AGENTS.md) first. Conventions that are not obvious
from the code:

- **Migrations.** One concern per file in
  [`supabase/migrations`](../supabase/migrations), named
  `20261004NNNN00_<concern>.sql` continuing after the latest `20261004`
  file (`20261004003200_appointment_reporting.sql` today). The parallel
  purchasing track uses `20261005…`; never use that prefix on the main
  line. Never edit an applied migration; add a new one.
- **Access.** Every object gets an explicit `revoke` and `grant`; every table
  ships with RLS and its policies in the same migration. Base tables are
  staff-only; customers reach data only through security definer `my_*`
  RPCs; anonymous users only through explicit public projections
  (`reporting.public_items` and the public schedule RPCs).
- **Functions.** Security definer functions use `set search_path = ''` and
  schema-qualified bodies, put their guards first
  (`private.require_staff`, `require_permission`, `require_admin`) and have
  `EXECUTE` revoked from `PUBLIC`.
- **Business errors.** RPCs raise `P0001` with a code as the message; add
  the code and its message to [`src/lib/db-errors.ts`](../src/lib/db-errors.ts)
  in the same change.
- **History.** A change that needs a reason passes it with
  `private.set_change_reason()`; event and history tables are append-only,
  enforced by triggers. Short IDs (`B-`, `J-`, `P-`, `U-`, …) come from
  `private.next_short_id`. Seed rows use fixed, RFC-valid version 4 UUIDs
  ([`tests/fixtures/ids.ts`](../tests/fixtures/ids.ts)).
- **After a migration:** `npm run db:reset`, `npm run db:types` and commit
  `src/lib/database.types.ts`; add every new table, view or RPC that
  `anon` or `authenticated` can reach to
  [`tests/fixtures/api-surface.ts`](../tests/fixtures/api-surface.ts) (the
  meta DB test fails otherwise). A ledger-affecting change gets its DB
  invariant test before its screen.
- **Application layers** (ADR-001 A2): RPC wrappers live in
  [`src/lib/domain`](../src/lib/domain) and import `server-only`
  (`errors.ts` and `list.ts` are shared types). Server Actions use
  `staffAction` ([`src/lib/actions.ts`](../src/lib/actions.ts)), and a
  failed form returns its typed values in `ActionResult.values` so the form
  renders them again. Money is `numeric` in Postgres and `decimal.js` in
  TypeScript; the database does the authoritative arithmetic.
- **Tests.** DB tests run on per-file clones; E2E specs run on both the
  phone and iPad projects and give every record a unique tag
  (`tagFor(testInfo)`), never counting rows in the shared database.
- **Decisions and docs.** A new business decision takes the next free
  number in D43–D59 (D60 and up belong to the purchasing track), with a
  row in [PLAN §6](PLAN.md#6-open-decisions-for-the-owner) and a record in
  [decisions/](decisions/README.md). Update the canonical doc that owns
  each changed fact ([README.md](../README.md#where-each-fact-lives) lists
  them), record new shortcuts in [RISKS.md](RISKS.md), and answer the
  documentation question in the
  [pull request template](../.github/pull_request_template.md).

Pull requests: CI runs `check`, `test (unit + db)` and `build` on every
pull request; add the `e2e` label to run Playwright
([RUNBOOK "CI"](RUNBOOK.md#ci)). Nothing is deployed; there is no release
process yet ([OPERATIONS.md](OPERATIONS.md#releases)).

## Debugging and common setup failures

| Symptom | Diagnostic | Fix |
|---|---|---|
| DB tests stop with "could not build the template database on … Is Postgres running (pg_ctlcluster 16 main start) and has `npm run devstack:setup` been run?" | `pg_isready -h 127.0.0.1`; `ls ~/.cache/bicii-devstack` | Start Postgres (`pg_ctlcluster 16 main start` on this machine) or set `PG*` in the shell; run `npm run devstack:setup` |
| Sign-in fails right after `npm run db:reset` while the services were running ("Sign-in is unavailable right now. Try again in a minute.") | `npm run devstack:status` shows everything healthy; Auth answered 500 "Database error querying schema" | Observed workaround: `npm run devstack:stop` then `npm run devstack:start`. On 2026-10-05 the first password sign-in after a reset failed and the next ones succeeded; the reset drops the database with `force`, closing Auth's open connections, and the scripts reload only PostgREST (inferred cause) |
| The app shows another environment's data or rejects the keys after switching stacks | Compare `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` with `npm run devstack:status` (do not print the keys) | `npm run devstack:env`, then restart `npm run dev` |
| Signed out or dev tooling misbehaving when the app is opened on `http://127.0.0.1:3000` | Check the address bar | Use `http://localhost:3000`. Auth's site URL is localhost (`scripts/devstack/services.mjs`) and the session cookie belongs to the host you signed in on. `next.config.ts` already allows `127.0.0.1` as a dev origin, and `/login` answered 200 there on 2026-10-05 |
| Today, the board and the demo appointments look a day or more old | The demo history is anchored to the shop day of the last reset | `npm run db:reset` (then restart the services, as above) |
| The Scan screen says "The camera only works over a secure connection. Open the app over HTTPS (or on localhost)." | Opened from a phone over `http://<LAN IP>:3000` | Expected; type the code instead, or follow [RUNBOOK "The camera scanner on phones and iPads"](RUNBOOK.md#the-camera-scanner-on-phones-and-ipads) |
| Playwright cannot find a browser ("Executable doesn't exist …") | Is `PLAYWRIGHT_CHROMIUM_EXECUTABLE` set? Does `/opt/pw-browsers/chromium` exist? | On your own machine: `npx playwright install --with-deps chromium` (as CI does), or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. In the build agent's container Chromium is preinstalled at `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH`); do not download browsers there |
| `check:types` fails in CI | The job prints "Out of date. Run 'npm run db:types' …" | `npm run db:reset && npm run db:types`, commit `src/lib/database.types.ts` |
| A service will not start | `npm run devstack:status`; logs in `.devstack/logs/{auth,rest,storage,gateway}.log` | Free the port or set `BICII_*_PORT` in the shell ([`.env.example`](../.env.example)) |

Known gaps (no hosted environment, devstack differences from hosted
Supabase, unmerged PR stack): [RISKS.md](RISKS.md).

## Knowledge map

| Where | What |
|---|---|
| [`src/app`](../src/app) | App Router: `(auth)/login`, the `(staff)/…` screens, manifest, error pages; `src/proxy.ts` (session refresh and sign-in redirect, Next 16's middleware) and `src/instrumentation.ts` |
| [`src/lib/domain`](../src/lib/domain) | Typed, server-only wrappers over the RPCs |
| [`src/lib/auth`](../src/lib/auth) | Session, `requireStaff`, permissions, redirects, sign-in messages |
| [`src/lib`](../src/lib) | Money, IDs, dates, env, logger, actions, DB error messages; `supabase/` (server, browser and restricted service-role clients); `admin/` (Auth admin API, service role) |
| [`src/components`](../src/components) | `ui/` design-system primitives ([DESIGN.md](DESIGN.md)); `shell/` tab bar, rail, header with global search; `domain/` record components and sheets |
| [`supabase/migrations`](../supabase/migrations) | Schema, RLS and RPCs (Supabase CLI timestamp names) |
| [`supabase/seed.sql`](../supabase/seed.sql) | Demo data and test fixtures (synthetic) |
| [`supabase/devstack`](../supabase/devstack) | `roles.sql`: platform roles for plain Postgres (never a migration) |
| [`scripts/devstack`](../scripts/devstack) | Docker-free Supabase: setup, start/stop, database reset/migrate/types, gateway |
| [`scripts`](../scripts) | Contrast and icon generators |
| [`tests/unit`](../tests/unit), [`tests/db`](../tests/db), [`tests/e2e`](../tests/e2e), [`tests/fixtures`](../tests/fixtures) | The three harnesses and shared IDs, the API-surface allow-list and the public-site fixture |
| [`.github`](../.github) | CI workflows and the shared `prepare` action |
| [`public`](../public), [`brand`](../brand) | Logo, icons, service worker (`sw.js`); the logo source for the icons |
| [`docs`](.) | This documentation set; [README.md](../README.md) lists each document |
