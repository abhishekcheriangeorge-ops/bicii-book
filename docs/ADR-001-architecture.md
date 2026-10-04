# ADR-001 — BICII Admin architecture

Status: proposed (accepted on merge of the plan PR)
Date: 2026-10-04

## Context

The build brief ([SPEC.md](./SPEC.md) §3.2) asks for a short architecture
decision record covering validation, data access, migrations, testing and the
Supabase client/server boundary before code is written. The existing public
site (`abhishekcheriangeorge-ops/bicii`) is Next.js 16.2 / React 19.2 /
Tailwind 4 / TypeScript, deployed on Vercel, static, with no backend. This repo
(`bicii-book`) becomes the staff-facing Admin PWA. Both become clients of one
Supabase project.

Facts that shaped the decisions below, taken from the Next.js 16 docs bundled
in the public site's `node_modules/next/dist/docs/` (this version differs from
older Next.js; the implementing agent must read those docs, not rely on
memory):

- `middleware.ts` is deprecated; the file is `proxy.ts` exporting `proxy()`,
  Node runtime only, and the docs say it is for optimistic checks, not
  authorization.
- `cookies()`, `headers()`, `params` and `searchParams` are all async.
- Turbopack is the default for dev and build; a webpack config fails the build.
- `next build` no longer lints; ESLint runs from its own CLI.
- Without `cacheComponents`, fetches and DB reads are uncached and any route
  that reads cookies is dynamic. That is the right default for an authenticated
  operations app.
- Server Actions are public POST endpoints; every action must authenticate and
  authorize itself. `revalidateTag` now takes a second argument; `updateTag`
  and `refresh` exist for read-your-writes in actions.
- Async Server Components cannot be unit-tested with Vitest; cover them with
  Playwright.

## Decisions

### A1. Stack

- Next.js 16.2 (App Router, Turbopack, `src/` directory, `@/*` alias),
  React 19.2, TypeScript 5 strict, Tailwind 4 CSS-first config. Same versions
  as the public site so the two repos can share conventions and, later, a
  package.
- Supabase: Postgres, Auth (email/password for staff and customers), Storage,
  RLS. Migrations via the Supabase CLI (`supabase/migrations/*.sql`), typed
  client via `supabase gen types typescript` committed to
  `src/lib/database.types.ts`.
- `@supabase/ssr` for cookie-based sessions in Server Components, Server
  Actions, Route Handlers and `proxy.ts`. `@supabase/supabase-js` with the
  service-role key only inside `src/lib/integrations/` and never in anything a
  browser can import.
- Validation: `zod` at every trust boundary (Server Action inputs, webhook
  payloads, env vars via a `src/lib/env.ts` parsed once at startup).
- Money in TypeScript: `decimal.js` (or `big.js`) for display math only.
  Authoritative totals are computed in Postgres generated columns and views.
- QR: `qrcode` for rendering; `@zxing/browser` (or the BarcodeDetector API
  where available, with that fallback) for camera scanning.
- Testing: Vitest for pure TypeScript and for database tests over `pg`;
  Playwright for end-to-end; `eslint` + `prettier` from the CLI.
- Hosting: Vercel for the Next app. No Vercel-specific APIs in application
  code; the only Vercel coupling is the deploy config.

### A2. Three layers, one direction

```
UI (Server Components, Client Components)
  │  calls
  ▼
Server Actions (src/app/**/actions.ts) and Route Handlers (src/app/api/**)
  │  authenticate + validate, then call
  ▼
Domain services (src/lib/domain/**), server-only
  │  use
  ▼
Supabase client (RLS) and Postgres RPCs (security definer, transactional)
```

- Components never import `@supabase/supabase-js` directly and never contain
  business rules. They render DTOs and call actions.
- Every Server Action starts with `const ctx = await requireStaff()` (or
  `requireCustomer()`), parses input with zod, and delegates to one domain
  function. Actions are thin.
- Domain services are `import 'server-only'` modules. They compose reads
  (through the RLS-scoped client) and writes (through RPCs). They return plain
  DTOs with only the fields the caller needs; cost and yield fields are only
  included when the caller has `view_costs`.
- Anything that mutates stock, money, settlements, unit status, publication
  state, appointments or Shopify state goes through a Postgres RPC listed in
  DATA-MODEL.md §16. Those RPCs are the invariant enforcers. Direct inserts to
  ledger tables are not granted to `authenticated`.

### A3. Authentication and authorization

- `proxy.ts` refreshes the Supabase session cookie and redirects anonymous
  requests under `/(staff)` to `/login`. That is all it does. It is an
  optimisation, not a guard.
- The guard is the data access layer: `src/lib/auth/session.ts` exports
  `getSession()` (React `cache`d per request), `requireStaff(permission?)`,
  `requireCustomer()`. They read the session from cookies and the `staff` row
  through RLS, and throw `redirect('/login')` or `forbidden()` as appropriate.
  `experimental.authInterrupts` is on so `forbidden.tsx` / `unauthorized.tsx`
  render 403/401.
- Authorization is enforced three times and must agree: RLS policies on
  tables, `private.require_permission()` at the top of each RPC, and
  `requireStaff(permission)` in the action. The first two are what matter;
  the third gives a clean error before the round trip.
- Customers and anonymous users use the same backend through the public site
  later. Nothing in this repo's policies assumes "all authenticated users are
  staff".

### A4. Migrations

- `supabase/migrations/` is the only way schema changes happen. Numbered by
  timestamp, one concern per file, forward-only. No `supabase db reset` in
  shared environments.
- Each migration that touches a table also carries its RLS policies and
  grants, so a table never exists without its policies in the same commit.
- `supabase/seed.sql` seeds local and preview databases. It is deterministic
  (fixed UUIDs) so tests reference seeded rows by ID.
- After every migration: `supabase gen types typescript --local >
  src/lib/database.types.ts` is committed. A CI check regenerates and diffs.
- Environments: local (`supabase start` on a dev machine, or a plain
  Postgres 16 with the `supabase/tests/auth-shim.sql` applied where Docker is
  unavailable), a hosted `bicii-staging` Supabase project for previews, and
  `bicii-prod`. Branch previews on Vercel point at staging.

### A5. Client/server boundary with Supabase

| Context | Client | Key | Notes |
|---|---|---|---|
| Server Components, Actions, Route Handlers | `createServerClient` from `@supabase/ssr` with the `cookies()` store | anon key | RLS applies. The only way the UI reads data. |
| `proxy.ts` | `createServerClient` with request/response cookies | anon key | Refresh only. |
| Client Components | `createBrowserClient` | anon key | Only for realtime subscriptions (board updates) and Storage uploads from the camera. No business reads. |
| Integration workers, webhook handlers | `createClient` with service role | service role | Lives in `src/lib/integrations/**`, `import 'server-only'`, never reachable from a component import graph. |
| Tests | `pg` directly | DB superuser / set role | See TESTING.md. |

Image delivery: `next/image` with `images.remotePatterns` for the Supabase
Storage host. Local development adds `images.dangerouslyAllowLocalIP` only in
`.env.development`-gated config, never in production.

### A6. Caching

`cacheComponents` stays off. The app is authenticated and operational; every
page is dynamic because the DAL reads cookies. Reads are per-request and
deduplicated with React `cache`. After a mutation, actions call `refresh()`
(or `updateTag` for the few tagged reads such as the services catalog and shop
hours) so the user sees their write. Public product pages live in the other
repo and may cache; this app does not.

### A7. Mobile-first PWA

- `src/app/manifest.ts` exports the web manifest (name "BICII Admin",
  standalone, theme `#fbfaf7`, icons from the brand mark).
- A hand-written `public/sw.js` registered from the root layout; MVP scope is
  install + app-shell caching of static assets only. No offline mutations:
  stock and money commits require a live connection by design.
- Camera capture via `<input type="file" accept="image/*" capture="environment">`
  uploading straight to Storage from the client with a signed upload URL
  minted by an action; the action then records the `attachments` row.
- Layout: the public site's tokens (`src/app/globals.css` in `bicii`) are
  copied into this repo's `globals.css` verbatim as the starting point, with an
  additional `@theme` block for operational UI (status colours mapped onto the
  five brand accents, 44px minimum tap targets, dense table typography).
  Shared primitives (`Button`, `Section`, `Reveal` motion) are re-implemented
  here with the same names and props so a future shared package is a move,
  not a rewrite.

### A8. Observability

- `instrumentation.ts` with `onRequestError` forwarding to the log sink.
- `proxy.ts` sets `x-request-id` on the upstream request; the DAL reads it
  through `headers()` and attaches it to every RPC call as
  `correlation_id` (a `set_config('app.correlation_id', …, true)` at the start
  of each RPC, stored on events and integration rows).
- Structured JSON logs (`pino`) from actions and integration code, emitted in
  `after()` so they never delay the response. Critical mutations log
  `{correlationId, actor, rpc, entityId, outcome}`.

### A9. Repository layout

```
bicii-book/
  docs/                      this plan, ADRs, data model, testing
  supabase/
    config.toml
    migrations/
    seed.sql
    tests/                   SQL fixtures, auth shim for plain Postgres
  src/
    app/
      (auth)/login
      (staff)/               everything behind requireStaff
        layout.tsx           app shell: bottom nav on phone, rail on iPad
        page.tsx             Today dashboard
        jobs/ , intake/ , customers/ , bikes/ , appointments/ ,
        products/ , units/ , inventory/ , consignment/ , purchasing/ ,
        labels/ , reports/ , settings/ , scan/
      api/
        shopify/webhooks/route.ts
        health/route.ts
      manifest.ts
      forbidden.tsx, unauthorized.tsx, not-found.tsx, error.tsx
    components/
      ui/                    button, input, picker, sheet, toast, qr, …
      shell/                 nav, header, scan button
      domain/                job card, line table, stock badge, …
    lib/
      auth/                  session.ts, permissions.ts
      supabase/              server.ts, browser.ts, service.ts
      domain/                customers.ts, bikes.ts, workshop.ts, lines.ts,
                             inventory.ts, consignment.ts, purchasing.ts,
                             appointments.ts, reports.ts
      integrations/shopify/  client.ts, webhooks.ts, sync.ts
      printing/              templates.ts, adapters/{browser,pdf}.ts
      money.ts, ids.ts, env.ts, logger.ts, database.types.ts
  tests/
    unit/                    vitest
    db/                      vitest over pg
    e2e/                     playwright
  proxy.ts
  instrumentation.ts
```

## Consequences

- The database is the invariant layer; the TypeScript domain layer is a
  convenience over it. This makes the public site cheap to build later: it
  gets the same RPCs and RLS for free.
- Every ledger-affecting feature costs a migration, an RPC, a policy, a DB
  test and a UI. That is the spec's definition of done, so the cost is
  deliberate.
- Running the test suite needs a Postgres. Developer machines use
  `supabase start`; the cloud agent container uses the local Postgres 16 with
  the auth shim; CI uses a Postgres service container plus the shim. The shim
  is small (auth schema, `auth.uid()`, `auth.jwt()`, the three roles) and is
  the only place where "not real Supabase" leaks in.
- Shopify is behind an interface from the first commit, so the first eleven
  phases do not need Shopify credentials.
