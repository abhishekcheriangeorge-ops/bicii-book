# BICII Admin (bicii-book)

The staff-facing operations app for BICII, a custom bicycle workshop in
Singapore: intake and work orders, appointments, inventory and consignment,
purchasing, QR labels, reporting and the Shopify boundary. It is a
phone-first PWA (iPhone in the workshop, iPad at the counter).

It shares **one Supabase backend** with the public site
(`abhishekcheriangeorge-ops/bicii`), which stays the customer-facing client.
Business rules live in Postgres (RLS, constraints, RPCs); this app and the
public site are two frontends over the same database.

**Status:** milestone M1 is built through M1.5 ([PLAN §3](docs/PLAN.md)). Phase 0 /
M1.1 is in place: the Next.js 16 scaffold, design tokens and UI primitives,
the Docker-free Supabase devstack, the foundation, staff and
staff-management migrations, the DB test harness, staff sign-in (email
one-time codes since 2026-10-05, PLAN D10), the staff shell (phone tab bar / iPad rail), Staff settings
(invite, permissions, deactivate), the PWA manifest and service worker,
Playwright E2E, and CI. M1.2 ([PLAN §3](docs/PLAN.md)) adds customers,
bikes with ownership history, photo attachments in Storage, customer
self-service RPCs and staff search (database, seed and tests), the domain
services and Server Actions over them, and the screens: Customers and
Bikes (search-first lists, detail pages, new/edit sheets, archive),
ownership transfer with a reason, the camera upload (downscaled on the
phone, uploaded straight to Storage) with a photo viewer (caption,
internal / customer / public, delete with a reason), and global search
from the header. M1.3 (workshop) is built: its database layer (catalog,
Cult Commons rates, jobs, lines, the customer job projection, job search)
and seeded jobs, the intake wizard (`/jobs/new`), the workshop board and My
Jobs (`/jobs`), the job page (status, lines and totals, photos, people,
approval, notes, details, timeline), services settings with the Cult
Commons rate (`/settings/services`), service history on bikes and
customers, and jobs in global search. M1.4 (inventory) is built: products
and units, the stock ledger with linked reversals, parts on jobs with live
stock, stock adjustments and transfers, publication, the Scan screen and
`/q` short-ID links. M1.5 (Today) is built: the financial reporting views
and read RPCs (recognised lines, daily summaries, job activity, stock
adjustments, operational exceptions; money only with View financial
reports, costs only with View costs), a seed spanning a week of shop days,
the Today dashboard (`/`: today's or an earlier day's jobs, money, stock,
low stock, what needs attention and the last 7 days) and the job yield
panel on the job page.

## Quickstart

Needs Node 22 (`.nvmrc`) with npm, a Postgres 16 you can reach as a superuser
(default `postgres`/`postgres` on 127.0.0.1:5432), and curl, tar and git.
No Docker. The devstack binaries are linux-x64; on macOS or Windows use the
Supabase CLI with Docker instead ([RUNBOOK](docs/RUNBOOK.md#local-supabase-with-docker-supabase-cli)).

```sh
npm ci
npm run devstack:setup   # once per machine: Auth, PostgREST, Storage into ~/.cache/bicii-devstack
npm run devstack:start   # mail catcher, Auth, PostgREST, Storage + gateway on http://127.0.0.1:54321
                         # (builds bicii_dev on first run)
npm run db:reset         # rebuild bicii_dev: roles, Auth, Storage, migrations, seed (~1s)
npm run devstack:env     # write the local URLs and demo keys into .env.local
npm run dev              # http://localhost:3000
```

Open **http://localhost:3000** (not 127.0.0.1: Next 16 blocks dev resources
on other origins) and sign in with a seeded login. There are no passwords
(PLAN D10): enter one of the emails below, press **Email me a code**, then
read the 6-digit code from the devstack's mail catcher and type it in:

```sh
curl "http://127.0.0.1:${BICII_MAIL_HTTP_PORT:-8025}/messages/latest?to=admin@bicii.test"
# the "code" field is the code; or open the newest file in .devstack/mail/
```

A code is valid for 10 minutes and only the newest one works.

| Email | Role | Permissions |
|---|---|---|
| `admin@bicii.test` | admin | all |
| `mechanic1@bicii.test` | staff | `view_costs` |
| `mechanic2@bicii.test` | staff | none |

Postgres somewhere else? Set `DATABASE_URL`, or `PGHOST` / `PGPORT` /
`PGUSER` / `PGPASSWORD` (and `PGDATABASE`, default `bicii_dev`), in the
shell before any of the commands (they do not read `.env.local`). `npm run devstack:stop` stops the services.

### The devstack and its mail catcher

`npm run devstack:start` runs, in order: a local mail catcher (HTTP
:8025, SMTP :2525), Supabase Auth :9999, PostgREST :3001, Storage :5000
and the gateway :54321, all on 127.0.0.1. Supabase Auth emails sign-in
codes (PLAN D10) to the mail catcher, which keeps them in `.devstack/mail/`
and nowhere else. Read the newest one for an address with

```sh
curl "http://127.0.0.1:${BICII_MAIL_HTTP_PORT:-8025}/messages/latest?to=admin@bicii.test"
```

(the `code` field is the code; the API is in
[TESTING.md](docs/TESTING.md#the-devstack-mail-catcher)). Every port can be
moved in the shell, for example to run a second checkout beside the first:
`BICII_MAIL_HTTP_PORT`, `BICII_SMTP_PORT`, `BICII_AUTH_PORT`,
`BICII_REST_PORT`, `BICII_STORAGE_PORT`, `BICII_GATEWAY_PORT` (with its own
`PGDATABASE`). `npm run devstack:status` prints the gateway and mail URLs.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next dev server (Turbopack) on :3000. Primitives gallery at `/dev/ui`. |
| `npm run build` / `npm start` | Production build / serve it. |
| `npm run check` | `next typegen` + `tsc --noEmit`, ESLint, `prettier --check`. |
| `npm run check:types` | Regenerate the database types from a throwaway database and fail if `src/lib/database.types.ts` differs (CI runs it). |
| `npm test` | Every Vitest project (unit + db). |
| `npm run test:unit` | Unit project (jsdom): pure TypeScript and synchronous components. |
| `npm run test:db` | DB project: invariants, RLS and RPCs on clones of a template built with the real Supabase Auth and Storage migrations. Includes a live-stack smoke test when the devstack is running. |
| `npm run test:e2e` | Playwright, Chromium, phone + iPad. Builds the app, serves it on :3100, resets `bicii_dev`, starts the devstack if needed. |
| `npm run format` / `npm run lint` | Prettier write / ESLint. |
| `npm run tokens:contrast` | Recompute WCAG ratios for the colour tokens; fails on a miss. |
| `npm run icons` | Regenerate the PWA icons from `brand/logo-source.png`. |
| `npm run devstack:setup` | Download and build the devstack components (idempotent; `-- --force` rebuilds). |
| `npm run devstack:start` / `stop` / `status` | Run, stop, or show health of the mail catcher :8025 (SMTP :2525), Auth :9999, PostgREST :3001, Storage :5000 and the gateway :54321. |
| `npm run devstack:env` | Write the devstack values into `.env.local`, keeping other lines. |
| `npm run db:reset` | Drop and rebuild the dev database, then seed it (the demo history is relative to the shop day of the reset: reset to move "today"). |
| `npm run db:migrate` | Apply pending migrations without a reset. |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` (`-- --fresh` builds a throwaway database from the migrations first; CI diffs that). |

## Project layout

```
.github/            CI workflow and the shared "prepare" action
brand/              logo source for the icons
docs/               spec, plan, ADR, data model, testing, design, runbook
public/             logo, icons, service worker (sw.js)
scripts/            contrast and icon generators
  devstack/         Docker-free Supabase: setup, start/stop, db reset/migrate/types, gateway, mail catcher
src/
  app/              App Router: (auth)/login, (staff)/... screens, manifest, error pages
  components/ui/    design-system primitives
  components/shell/ tab bar, rail, header (with global search), profile chip
  components/domain/ record components: camera upload, photo grid/viewer, sheets, search field
  lib/              money, ids, dates, env, logger, actions, db errors
    auth/           session, requireStaff, permissions, redirects
    supabase/       server, browser and (restricted) service-role clients
    domain/         typed wrappers over the RPCs
    admin/          Auth admin API (service role)
  proxy.ts          session refresh and sign-in redirect (Next 16's middleware)
  instrumentation.ts
supabase/
  migrations/       the schema, RLS and RPCs (Supabase CLI timestamp names)
  seed.sql          demo data and test fixtures
  devstack/         roles.sql: platform roles for plain Postgres (never a migration)
  templates/        Auth's email templates (sign-in codes, no links)
tests/
  unit/  db/  e2e/  fixtures/
```

## Documents

| File | What it is |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | The authoritative build brief (v1.0, 3 Oct 2026). |
| [docs/PLAN.md](docs/PLAN.md) | Phases, the first milestone, environment, risks, open decisions. |
| [docs/ADR-001-architecture.md](docs/ADR-001-architecture.md) | Stack, layering, auth, migrations, the Supabase client/server boundary, PWA, observability. |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Every table, constraint, ledger, view, RLS rule and RPC. |
| [docs/TESTING.md](docs/TESTING.md) | Unit, database and E2E harnesses, the invariant test list, CI. |
| [docs/DESIGN.md](docs/DESIGN.md) | Design tokens and UI primitives. |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Supabase CLI with Docker, hosted projects, first admin, key rotation, Vercel. |

Read SPEC, PLAN, ADR, DATA-MODEL and TESTING in that order before changing
code, and see [AGENTS.md](AGENTS.md) for the rules that are not negotiable.

## Stack

Next.js 16 (App Router, Turbopack), React 19, TypeScript 5, Tailwind 4,
Supabase (Postgres, Auth, Storage, RLS), zod, decimal.js, pino, Vitest,
Playwright, GitHub Actions, Vercel. This Next.js differs from older ones
(`proxy.ts`, async request APIs); see `AGENTS.md`. `@zxing/browser` (with
its `@zxing/library` peer) decodes QR codes on the Scan screen where the
browser has no `BarcodeDetector`; it is imported dynamically, only then.
The camera needs HTTPS or localhost (RUNBOOK, "The camera scanner on
phones and iPads").
