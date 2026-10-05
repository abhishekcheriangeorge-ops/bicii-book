# ADR-002: Run the real Supabase services locally without Docker

Date: 2026-10-04 (commits c02e0e4, df9fb27, PR #2). Status: accepted
(implemented, used by CI). Decision owner: Abhishek Cherian George (owner)
for business meaning; defaults proposed by the build agent.

## Context

Staff sign in through Supabase Auth and every API read is subject to RLS, so
local development and the database tests need Auth, PostgREST and Storage.
The build environment has Postgres 16 but no Docker, so `supabase start`
cannot run there ([PLAN §0](../PLAN.md#0-ground-truth-established-before-planning)).
The original plan (PR #1, `git show 7f04f99:docs/PLAN.md`, Phase 0
deliverables and §5) planned an auth shim, `supabase/tests/auth-shim.sql`,
for the database tests and login E2E against staging credentials, skipped
when those were absent.

## Decision and rationale

The devstack in `scripts/devstack/` runs the real Supabase Auth, PostgREST
and Storage on a plain Postgres 16 behind a dependency-free Node gateway on
`:54321` with Supabase's URL layout (`/auth/v1`, `/rest/v1`, `/storage/v1`).
Versions are pinned in `scripts/devstack/config.mjs`: PostgREST 12.2.3,
Supabase Auth 2.178.0, Supabase Storage 1.79.31 (run on Node 24.21.0). The
only devstack-specific SQL is `supabase/devstack/roles.sql` (the platform
roles, schemas and default grants hosted Supabase already has); it is never
a migration. Database builds apply Auth's and Storage's own migrations, then
`supabase/migrations/*.sql`, recorded the way the Supabase CLI records them.

Rationale, from the commit messages and [PLAN §5](../PLAN.md#5-risks-and-mitigations):
the DB tests and login E2E then run against real Supabase services with no
Docker and no staging credentials, so the same harness runs in the agent
container, on a laptop and in CI. The Supabase CLI with Docker remains
supported ([RUNBOOK "Local Supabase with Docker"](../RUNBOOK.md#local-supabase-with-docker-supabase-cli)).

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| Auth shim `supabase/tests/auth-shim.sql` plus E2E against staging credentials (PR #1 plan) | Replaced: the tests need the real services, "not a shim" (c02e0e4); without staging credentials the planned login E2E would have been skipped (PR #1 §5), and no staging project exists |
| Supabase CLI with Docker (`supabase start`) | Kept as a supported alternative where Docker exists; not possible in the build environment |

## Consequences

- A one-time `npm run devstack:setup` downloads and builds the components
  into `~/.cache/bicii-devstack`: 985 MB measured on 2026-10-05, mostly
  Storage's `node_modules`; CI caches it under a key of the pinned versions.
- The binaries are linux-x64 builds; macOS and Windows use the Docker CLI
  path instead (README "Quickstart").
- The local platform layer differs from hosted Supabase (recreated roles and
  grants, Auth settings, Postgres major version, pinned service versions):
  [RISKS R-003](../RISKS.md#r-003--the-devstack-differs-from-hosted-supabase).
- Bumping a pinned version is a deliberate change in `config.mjs` and
  rebuilds the cache.

## Revisit trigger

The first hosted staging project exists (compare the devstack with it), or a
pinned service version has to change.

## Evidence and links

- `scripts/devstack/` (`config.mjs`, `services.mjs`, `database.mjs`),
  `supabase/devstack/roles.sql`, `.github/workflows/ci.yml` (Postgres 16
  service container plus the devstack).
- [TESTING.md "Database test harness"](../TESTING.md#database-test-harness)
  and ["Devstack commands"](../TESTING.md#devstack-commands).
- CI on the PR #7 head b34bbcd: `test (unit + db)` success,
  https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37276827625/job/111655574785.
- Local 2026-10-05: `npm run devstack:status` all four services healthy;
  `npm test` 82 files, 1186 tests passed.
