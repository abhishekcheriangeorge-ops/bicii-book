# BICII Admin (bicii-book)

Staff-facing operations app for BICII, a custom bicycle workshop: intake and
work orders, appointments, inventory and consignment, purchasing, QR labels,
reporting and the Shopify boundary. It shares one Supabase backend with the
public site (`abhishekcheriangeorge-ops/bicii`), which stays the
customer-facing client.

Status: planning. The application scaffold lands in the next PR.

## Documents

| File | What it is |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | The authoritative build brief (v1.0, 3 Oct 2026), converted verbatim from the Word document. |
| [docs/PLAN.md](docs/PLAN.md) | Phases, the first vertical-slice milestone, environment, risks, and the open decisions for the owner. |
| [docs/ADR-001-architecture.md](docs/ADR-001-architecture.md) | Stack, layering, auth, migrations, Supabase client/server boundary, caching, PWA, observability, repo layout. |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Every table, constraint, ledger, view, RLS rule and RPC. |
| [docs/TESTING.md](docs/TESTING.md) | Unit, database and end-to-end harnesses and the invariant-by-invariant test list. |

Read them in that order.

## Stack (decided)

Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind 4,
Supabase (Postgres, Auth, Storage, RLS), Vitest, Playwright, Vercel.

This Next.js version differs from older ones; see `AGENTS.md`.
