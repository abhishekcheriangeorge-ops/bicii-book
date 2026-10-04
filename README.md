# BICII Admin (bicii-book)

Staff-facing operations app for BICII, a custom bicycle workshop: intake and
work orders, appointments, inventory and consignment, purchasing, QR labels,
reporting and the Shopify boundary. It shares one Supabase backend with the
public site (`abhishekcheriangeorge-ops/bicii`), which stays the
customer-facing client.

Status: Phase 0 (foundation) — scaffold, design tokens, UI primitives, the
Docker-free Supabase devstack, the foundation and staff migrations, the DB
test harness, sign-in, the staff shell (phone tab bar / iPad rail), Staff
settings (invite, permissions, deactivate), the PWA manifest and service
worker, and Playwright E2E are in. CI follows.

## Running it

Node 22 (`.nvmrc`), npm.

```sh
npm install
cp .env.example .env.local   # fill in; never commit it
npm run dev                  # http://localhost:3000, gallery at /dev/ui
npm run check                # typegen + tsc, eslint, prettier --check
npm test                     # all Vitest projects (unit + db)
npm run test:unit            # unit project only (jsdom)
npm run test:db              # db project: Postgres + real Supabase Auth/Storage schemas
npm run build                # production build (Turbopack)
npm run test:e2e             # Playwright (phone + iPad): build, start :3100, reset bicii_dev
npm run tokens:contrast      # recompute WCAG ratios for the colour tokens
npm run icons                # regenerate PWA icons from brand/logo-source.png
```

### Local Supabase without Docker (devstack)

Needs Postgres 16 on 127.0.0.1:5432 (user/password `postgres`; override with
`DATABASE_URL` or `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`), plus curl, tar
and git. Runs the real Supabase Auth, PostgREST and Storage behind a gateway
on http://127.0.0.1:54321, like `supabase start` (which also works, with
Docker).

```sh
npm run devstack:setup       # once: download/build services into ~/.cache/bicii-devstack
npm run db:reset             # rebuild bicii_dev: roles, Auth, Storage, migrations, seed
npm run devstack:start       # Auth :9999, PostgREST :3001, Storage :5000, gateway :54321
npm run devstack:env         # write .env.local for the app (local demo keys)
npm run devstack:status      # health table; devstack:stop stops everything
npm run db:migrate           # apply new migrations without a reset
npm run db:types             # regenerate src/lib/database.types.ts
```

Seeded logins (password `bicii-dev-password`): `admin@bicii.test` (admin),
`mechanic1@bicii.test` (view_costs), `mechanic2@bicii.test` (no
permissions). Open the app at http://localhost:3000 (not 127.0.0.1: Next 16
blocks dev resources on other origins).

## Documents

| File | What it is |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | The authoritative build brief (v1.0, 3 Oct 2026), converted verbatim from the Word document. |
| [docs/PLAN.md](docs/PLAN.md) | Phases, the first vertical-slice milestone, environment, risks, and the open decisions for the owner. |
| [docs/ADR-001-architecture.md](docs/ADR-001-architecture.md) | Stack, layering, auth, migrations, Supabase client/server boundary, caching, PWA, observability, repo layout. |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Every table, constraint, ledger, view, RLS rule and RPC. |
| [docs/TESTING.md](docs/TESTING.md) | Unit, database and end-to-end harnesses and the invariant-by-invariant test list. |
| [docs/DESIGN.md](docs/DESIGN.md) | Design tokens (brand + operational layer) and the UI primitives. |

Read the first five in that order.

## Stack (decided)

Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind 4,
Supabase (Postgres, Auth, Storage, RLS), Vitest, Playwright, Vercel.

This Next.js version differs from older ones; see `AGENTS.md`.
