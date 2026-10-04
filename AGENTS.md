# Agent instructions for bicii-book

## This is NOT the Next.js you know

This project uses Next.js 16, which has breaking changes versus training
data: `proxy.ts` replaces `middleware.ts`; `cookies()`, `headers()`,
`params` and `searchParams` are async; Turbopack is the default and a
webpack config fails the build; `next build` does not lint; `revalidateTag`
takes a second argument. After the scaffold exists, read the relevant guide
in `node_modules/next/dist/docs/` before writing any code and heed
deprecation notices.

## Before writing code

Read, in order: `docs/SPEC.md`, `docs/PLAN.md`, `docs/ADR-001-architecture.md`,
`docs/DATA-MODEL.md`, `docs/TESTING.md`.

## Rules that are not negotiable

- The brief in `docs/SPEC.md` is the requirement. Do not change business
  semantics (Cult Commons math, inventory ownership, consignment liability,
  financial snapshots, public/private boundaries, one backend / two
  frontends). If a change would, stop and surface it in the PR.
- Stock, money, settlements, unit status, publication and appointment
  capacity change only through the Postgres RPCs in DATA-MODEL.md §16.
- Every table ships with its RLS policies in the same migration.
- Money is `numeric`; authoritative arithmetic is in Postgres.
- Every ledger-affecting feature has a database test for its invariant
  before it has a screen.
- Never commit secrets. `.env.local` is ignored; `.env.example` documents
  every variable.
- Each phase ends runnable and green (`npm run check`, `npm test`).
