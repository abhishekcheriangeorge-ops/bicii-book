# Agent instructions for bicii-book

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Next.js 16 specifics for this project

The managed block above is kept verbatim so `next dev` leaves this file
alone. In this project specifically: `proxy.ts` replaces `middleware.ts`;
`cookies()`, `headers()`, `params` and `searchParams` are async; Turbopack is
the default and a webpack config fails the build; `next build` does not lint;
`revalidateTag` takes a second argument (`updateTag`/`refresh` exist for
Server Actions). The docs for the installed version are in
`node_modules/next/dist/docs/`; read the relevant guide before writing
framework code and heed deprecation notices.

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
