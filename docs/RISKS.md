# Known problems, compromises, and unknowns

Maintainer: the build agent, with the owner (Abhishek Cherian George).
Review trigger: the end of each phase, and before any hosted deployment.

The most consequential unresolved items come first. There is no issue
tracker in use (0 GitHub issues on 2026-10-05): the backlog is the phases in
[PLAN §2](PLAN.md#2-phases) plus the next actions below, and [NOW.md](../NOW.md) names
the next action. Decisions referred to as Dn are in
[PLAN §6](PLAN.md#6-open-decisions-for-the-owner), with their records in
[decisions/](decisions/README.md).

This repository is public. Security weaknesses are recorded here only as a
non-exploitable summary with owner, status and next action; reproduction
steps, affected identifiers and incident evidence belong in an
access-controlled location outside the repository. No such location has
been set up yet, so any finding that needs one is recorded as "private
handoff pending" without details. Never put secret values, hosted keys or
URLs, or customer data in this file.

## R-001 — Nothing is deployed

- Category: operational gap.
- Status and owner: open; owner (creates the hosted projects), build agent
  (procedures).
- Trigger: any use by real staff or customers.
- Impact: the app runs only on a developer machine or in CI. The hosted
  Supabase projects `bicii-staging` and `bicii-prod` named in
  [PLAN §4](PLAN.md#4-environment-and-secrets) and
  [RUNBOOK "Hosted Supabase projects"](RUNBOOK.md#hosted-supabase-projects-staging-and-production)
  have not been created, and there is no Vercel project. Every hosted
  procedure in RUNBOOK (project setup, applying migrations, first admin, key
  rotation, Vercel environment) has never been exercised.
- Evidence and confidence: high. No hosted Supabase URL, key or project
  reference exists in the repository or `.env.example`; PLAN §4 says the
  owner creates the projects. Not checked against the owner's
  Supabase or Vercel accounts, which this environment cannot access.
- Workaround or containment: none needed until go-live; all testing runs
  locally and in CI against the devstack.
- Next action: owner creates `bicii-staging`; the build agent then follows
  RUNBOOK step by step against staging and records what differs.
- Revisit trigger: the first hosted project exists.
- Last checked: 2026-10-05, repository search and PLAN §4 / RUNBOOK review.

## R-002 — No backups, monitoring, alerting or exercised recovery

- Category: operational gap.
- Status and owner: open; owner with the build agent.
- Trigger: data loss, a bad migration, or a production error.
- Impact: there is no backup plan or restore exercise, no uptime or error
  monitoring and no alert recipient. Server errors are logged as pino JSON
  lines to stdout (`src/lib/logger.ts`, `src/instrumentation.ts`) with no
  log retention configured anywhere and no error tracker. A database restore
  would not cover Storage objects (photos), which live outside the
  database tables (inferred from Supabase's architecture; not exercised).
  A photo deleted by staff (`delete_attachment`) is therefore gone for
  good; only its metadata stays in `attachment_events`.
- Evidence and confidence: high for absence (no backup, monitoring or
  error-tracker configuration or dependency in the repository); the hosted
  plan's backup features are unknown because no hosted project exists.
- Workaround or containment: none; nothing is deployed (R-001).
- Next action: before go-live, decide the backup and restore method for the
  database and for Storage, exercise a restore into a separate project, and
  name an alert recipient.
- Revisit trigger: the first hosted production project is planned.
- Last checked: 2026-10-05, `package.json`, `src/lib/logger.ts`,
  `src/instrumentation.ts`.

## R-003 — The devstack differs from hosted Supabase

- Category: unverified assumption.
- Status and owner: accepted for development ([ADR-002](decisions/ADR-002-devstack.md));
  build agent.
- Trigger: behaviour that depends on platform roles, Auth settings, the
  Postgres major version or service versions.
- Impact: tests pass against a platform layer that is recreated locally,
  so a difference could surface only on a hosted project:
  - `supabase/devstack/roles.sql` recreates the platform roles and default
    grants that hosted Supabase provides;
  - Auth settings in `scripts/devstack/services.mjs` (sign-up enabled,
    mailer autoconfirm, no SMTP, password minimum 6) differ from the hosted
    settings RUNBOOK prescribes (sign-ups off, minimum 12);
  - the devstack and CI run Postgres 16, `supabase/config.toml` sets
    `major_version = 17` for the Docker CLI, and the hosted version is
    unknown;
  - Auth 2.178.0, PostgREST 12.2.3 and Storage 1.79.31 are pinned, while
    hosted versions are managed by the provider;
  - Realtime and Edge Functions are not used, so their differences do not
    matter today.
- Evidence and confidence: the settings above read from the files on
  2026-10-05; the size of any real difference is unknown until a hosted
  project exists.
- Why accepted: real Auth, PostgREST and Storage without Docker or staging
  credentials (ADR-002).
- Workaround or containment: the meta tests compare the reachable API
  surface with `tests/fixtures/api-surface.ts`; the Docker CLI path
  (Postgres 17) remains available.
- Next action: after the first staging push, run the DB tests in
  existing-database mode against staging only
  ([RUNBOOK](RUNBOOK.md#local-supabase-with-docker-supabase-cli) describes
  the mode) and compare.
- Revisit trigger: first staging project; a pinned version bump.
- Last checked: 2026-10-05, `scripts/devstack/config.mjs`,
  `scripts/devstack/services.mjs`, `supabase/config.toml`, RUNBOOK.

## R-004 — Staff sign-in change pending (email OTP)

- Category: deliberate shortcut / unverified assumption.
- Status and owner: open; owner (decision), build agent (integration).
- Trigger: any staff invitation on this branch.
- Impact: the owner changed staff sign-in to Supabase email OTP on
  2026-10-05 (recorded as D10 here). This branch still uses email +
  password, and the inviter sees the new login's temporary password, so a
  manager could keep a second login at their own permission level (D11's
  residual risk). OTP is being built on the parallel track and is not on
  this branch. RUNBOOK's hosted Auth steps describe the password settings
  and will need revising when OTP merges. Hosted email delivery (SMTP),
  which OTP needs, is not configured anywhere.
- Evidence and confidence: high for the current behaviour
  (`src/app/(staff)/settings/staff/new/invite-form.tsx` shows the
  temporary password); no `feat/auth-email-otp` ref exists locally or on
  origin on 2026-10-05, so the OTP work was not inspected. Whether OTP
  removes the residual risk is unverified.
- Why accepted: MVP default ([ADR-005](decisions/ADR-005-staff-sign-in-and-delegation.md)).
- Workaround or containment: only admins and trusted `manage_staff` holders
  invite; the D11 ceiling limits what an inviter can grant.
- Next action: owner confirms that the note "D11 changed (staff email OTP)"
  meant the sign-in method (D10 on this branch) and that the D11 ceiling
  stays; integrate the OTP work, revise RUNBOOK's hosted Auth steps, and
  configure SMTP for staging.
- Revisit trigger: the OTP branch is integrated into this line.
- Last checked: 2026-10-05, `git for-each-ref`, `git ls-remote --heads
  origin`, the invite form.

## R-005 — Cost-pending lines overstate yield and Cult Commons

- Category: deliberate shortcut.
- Status and owner: accepted (owner-confirmed D14); owner.
- Trigger: a manual line added without a cost (always, for staff without
  `view_costs`).
- Impact: the line is stored with cost 0, so its yield is its whole sale and
  its Cult Commons share is 30% of the sale until a `view_costs` holder
  voids it and adds it again with the cost. Job, day and period figures are
  overstated meanwhile; they are flagged as provisional, not blocked.
- Evidence and confidence: high; `tests/db/work-order-lines.test.ts` asserts
  the stored 0.00 cost, `cost_pending` and `cost_pending_count`; reporting
  flags them (D32: `financial_lines.cost_pending`,
  `today_dashboard.cost_pending_lines`).
- Why accepted: a mechanic must be able to record work without seeing costs
  ([ADR-009](decisions/ADR-009-line-pricing-and-cost-pending.md)).
- Workaround or containment: "Cost pending" shows on the line for everyone;
  totals are labelled provisional for `view_costs` holders.
- Next action: owner chooses whether to keep the default or adopt one of the
  options in ADR-009 (block completion, enter a pending cost once, or
  exclude from reports).
- Revisit trigger: pending lines staying uncorrected in real use.
- Last checked: 2026-10-05, PLAN D14/D32 and the test above (passed in
  `npm test`).

## R-006 — No test proves a zero-price or zero-cost part is accepted

- Category: validation gap.
- Status and owner: resolved 2026-10-05 by Phase 6 step 1 (`feat/p6-consignment`,
  commit fe6ac53, local only); build agent. The heading is kept so links
  stay valid.
- Trigger: adding a part whose price or cost is 0 (a free part).
- Impact (before): the owner amended D24 on 2026-10-05: 0 is a known price
  or cost and only NULL counts as missing. `add_inventory_line` already did
  this, but no test covered the 0 cases.
- Evidence and confidence: high. `tests/db/consignment-job-parts.test.ts`
  "D24: a part priced 0 and a part costing 0 are accepted with 0 snapshots
  and are not cost_pending; so is a consigned part agreed at 0" (a
  shop-owned part priced 0, one costing 0, a 0 price override and a
  consigned part agreed at 0), and `tests/db/consignment.test.ts` "D24: an
  agreed amount of 0 and an asking price of 0 are known values, stored as
  0"; both pass in `npm test` (86 files, 1225 tests) on 2026-10-05.
- Workaround or containment: none needed.
- Next action: none; Phase 6 step 2 adds the same 0 tests for sale lines
  (D24).
- Revisit trigger: next change to `add_inventory_line` or a new part or
  sale path.
- Last checked: 2026-10-05, the tests above.

## R-007 — Consigned stock cannot be a job part yet

- Category: known defect (owner change not yet implemented).
- Status and owner: resolved 2026-10-05 by Phase 6 step 1 (`feat/p6-consignment`,
  commits 13fe3f3 and fe6ac53, local only; D44); build agent. The heading is
  kept so links stay valid.
- Trigger: staff use a consigned item as a part on a job.
- Impact (before): the owner changed D27 on 2026-10-05 so that consigned
  stock may be a job part, while `add_inventory_line` still refused it.
  Now `add_inventory_line` (replaced in
  `supabase/migrations/20261004003400_consignment_job_parts.sql`, same
  signature) accepts consigned stock under D44 and refuses only
  customer-owned stock (`ownership_not_saleable`), with the backstop
  trigger `work_order_line_items_consignment_rules` for every writer; the
  old comment saying Phase 6 keeps the refusal is gone with the replaced
  function, and PLAN's D27 row was rewritten in 34783d6.
- Evidence and confidence: high. `tests/db/consignment-job-parts.test.ts`
  (held on add, sold at completion with liability = the agreed amount,
  reopen and re-completion, void on the open job, FIFO quantity parts, no
  negative consigned stock, customer-owned refusals),
  `tests/db/consignment-concurrency.test.ts` (two completions create one
  liability; a unit on two jobs or on a job while it is returned has one
  winner); all pass in `npm test` on 2026-10-05.
- Workaround or containment: none needed. The Admin has no screen for
  consignment yet (Phase 6 step 3), so staff cannot reach the path from the
  UI until then.
- Next action: none for the database; step 3 builds the screens.
- Revisit trigger: a change to `add_inventory_line` or
  `work_orders_sell_held_units`.
- Last checked: 2026-10-05, the migrations and tests above
  ([ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md),
  [ADR-016](decisions/ADR-016-consignment-and-sales.md)).

## R-008 — Correcting a job whose sold bike reached its buyer is multi-step

- Category: deliberate shortcut.
- Status and owner: accepted (owner-confirmed D29, "revisit later"); owner.
- Trigger: a mistake on a completed job whose sold shop bike was already
  transferred to the customer.
- Impact: reopen and void are refused with `bike_with_customer`; staff must
  transfer the bike back to the shop (with a reason), reopen, correct,
  complete and transfer again.
- Evidence and confidence: high; `tests/db/inventory-ledger.test.ts` and
  `tests/db/inventory-publication.test.ts` cover the refusals.
- Why accepted: a correction must never make a customer's bike available or
  public again ([ADR-010](decisions/ADR-010-stock-and-units-on-jobs.md)).
- Workaround or containment: the five-step sequence above.
- Next action: none until the revisit trigger.
- Revisit trigger: proposed (the owner set none): the first time staff need
  the transfer-back workaround.
- Last checked: 2026-10-05, PLAN D29 and the tests above.

## R-009 — The seven-PR stack is unmerged and the purchasing track forks from PR #6

- Category: operational gap.
- Status and owner: open; owner (merges), build agent (integration).
- Trigger: merging the stack and integrating the parallel tracks.
- Impact: PRs #1–#7 are open drafts stacked on each other; `main` holds only
  the initial commit 1594c78. `feat/p7-purchasing` (local only, not on
  origin) forks from PR #6's head d3e2101, so it has no appointments
  (Phase 2). Expected conflict points: PLAN §6 (it adds D60–D66 after
  D35), migration order (its `20261005…` files after this line's
  `20261004…` files), `tests/fixtures/api-surface.ts`,
  `src/lib/database.types.ts` and `src/lib/db-errors.ts`. The email OTP
  work is also not yet visible.
- Evidence and confidence: high; GitHub REST pull list, `git branch -vv`,
  `git merge-base feat/p7-purchasing feat/p2-appointments` = d3e2101 and
  `git show feat/p7-purchasing:docs/PLAN.md` on 2026-10-05.
- Workaround or containment: each PR head is green in CI (R-010).
- Next action: owner reviews and merges the stack bottom-up; the build agent
  integrates purchasing and OTP afterwards, regenerating types and the
  API-surface fixture and re-running all gates.
- Revisit trigger: PR #1 merges.
- Last checked: 2026-10-05.

## R-010 — E2E is not a required check, and branch protection is unverified

- Category: validation gap / unverified assumption.
- Status and owner: open; owner (repository settings).
- Trigger: a pull request merged without the `e2e` label.
- Impact: `.github/workflows/e2e.yml` runs Playwright only on pull requests
  labelled `e2e`, nightly and on manual dispatch, so a PR can pass `check`,
  `test (unit + db)` and `build` with a broken journey. RUNBOOK "CI" asks
  for branch protection on `main` requiring those three checks, but the
  protection settings could not be read (REST `branches/main/protection`
  returned 403), so whether it is configured is unknown. The nightly e2e
  schedule and the push-to-`main` CI trigger run from the default branch,
  which is still the initial commit without workflows, so neither has
  ever run.
- Evidence and confidence: CI check runs on 2026-10-05: PR #1 (7f04f99) has
  none (it predates CI); PRs #2–#7 heads (9106a01, 74fff3e, 8763e6b,
  9922441, d3e2101, b34bbcd) all show `check`, `test (unit + db)`, `build`
  and `e2e (Playwright)` = success (PR #7:
  https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37276834195/job/111655595521).
  GitHub REST on 2026-10-05: 0 workflow runs with event `schedule` and 0
  with event `push`; `main` is 1594c78 (four files, no `.github/`).
- Workaround or containment: the `e2e` label was applied on PRs #2–#7 (their
  successful e2e runs were `pull_request` events).
- Next action: owner confirms or sets branch protection on `main` (see
  [RUNBOOK "CI"](RUNBOOK.md#ci)) and decides whether `e2e` should gate
  merges.
- Revisit trigger: before merging PR #1.
- Last checked: 2026-10-05, GitHub REST API.

## R-011 — Shopify is not built and will be fixture-tested only

- Category: validation gap.
- Status and owner: open; build agent, Phase 10.
- Trigger: Phase 10.
- Impact: no Shopify integration exists on this branch (only the reserved
  id columns `customers.shopify_customer_id`, `products.shopify_product_id`
  and `products.shopify_variant_id`). When built, its webhook
  and sync code will be tested against signed fixture payloads only until a
  real or development store is connected, so API and payload drift would not
  be caught.
- Evidence and confidence: high; no `src/lib/integrations/` directory and no
  Shopify tables on this branch; PLAN Phase 10 plans fixture payloads.
- Workaround or containment: none needed yet.
- Next action: at Phase 10, the owner provides a development store, and a
  test against it is added before go-live.
- Revisit trigger: Phase 10 starts.
- Last checked: 2026-10-05, repository tree.

## R-012 — Label printer hardware is unknown

- Category: unverified assumption.
- Status and owner: open; owner (printer models).
- Trigger: Phase 8 (labels) and Phase 12 (hardware adapter).
- Impact: [SPEC §16](SPEC.md#16-label-printing) forbids hard-coding a
  printer protocol before inspecting BICII's printers. Phase 8 is not
  built; Phase 12 waits for the printer models. Until then printing will be
  browser print / PDF only.
- Evidence and confidence: high; `/labels` is a placeholder page reading
  "Arrives in Phase 8 (QR and labels)" (R-018).
- Workaround or containment: browser print/PDF fallback, planned for Phase 8.
- Next action: owner names the label printer models and label sizes.
- Revisit trigger: Phase 8 starts.
- Last checked: 2026-10-05.

## R-013 — QR base undecided until Phase 8

- Category: unverified assumption.
- Status and owner: open; build agent, Phase 8.
- Trigger: printing or scanning labels across environments.
- Impact: the QR base is `NEXT_PUBLIC_PUBLIC_SITE_URL` until Phase 8 decides
  between it and `shop_settings.public_site_url` (D9). A label encoding
  another environment's public site URL is shown as "Not a BICII label" by
  this environment's scanner. The Admin shows the QR URL as text today; no
  QR image is rendered and no label printed yet.
- Evidence and confidence: high; `src/lib/qr.ts` (`getQrBase`,
  `scanBases`), `src/lib/scan.ts`.
- Workaround or containment: type the short ID into Scan or Search.
- Next action: Phase 8 decides the base and keeps the environment's base in
  `scanBases()` ([ADR-007](decisions/ADR-007-short-ids-and-qr-base.md)).
- Revisit trigger: Phase 8 starts.
- Last checked: 2026-10-05.

## R-014 — Camera scanning needs HTTPS or localhost

- Category: operational gap.
- Status and owner: accepted (browser rule); build agent.
- Trigger: opening Scan on a phone or iPad over plain HTTP on the LAN.
- Impact: the camera is unavailable and only manual entry works; testing on
  devices needs a TLS setup or a hosted preview (none exists, R-001).
- Evidence and confidence: high;
  [RUNBOOK "The camera scanner on phones and iPads"](RUNBOOK.md#the-camera-scanner-on-phones-and-ipads).
- Workaround or containment: manual entry; the RUNBOOK's LAN options.
- Next action: none beyond a hosted preview (R-001).
- Revisit trigger: a staging preview exists.
- Last checked: 2026-10-05, RUNBOOK.

## R-015 — The seed has published logins

- Category: security concern (non-exploitable summary).
- Status and owner: mitigated by procedure; operator.
- Trigger: running `supabase/seed.sql` on a hosted project.
- Impact: the seed creates staff logins and one customer login whose
  shared password is published: in the docs only in
  [ENGINEERING.md](ENGINEERING.md#clean-checkout-to-running-application)
  (other docs link there), and in the public code (`supabase/seed.sql`,
  `scripts/devstack/db.mjs`, `tests/fixtures/ids.ts`). Seeding a hosted
  project would therefore open it to anyone.
- Evidence and confidence: high; RUNBOOK "Hosted Supabase projects" step 5
  says never to run it on a hosted project.
- Workaround or containment: create the first hosted admin as RUNBOOK
  describes.
- Next action: follow RUNBOOK when the first hosted project is created.
- Revisit trigger: R-001.
- Last checked: 2026-10-05, RUNBOOK.

## R-016 — No retention or deletion policy for customer personal data

- Category: unverified assumption.
- Status and owner: open; owner.
- Trigger: a customer asks for their data to be deleted, or a legal or
  business retention limit applies.
- Impact: customers, bikes and job history are archived or kept, never
  deleted (no DELETE through the API), and are kept indefinitely. Staff can
  delete individual photos, including customer and bike photos, with a
  reason: any active staff member may, the Storage object is removed and
  only the metadata stays in `attachment_events`
  ([DATA-MODEL "Lifecycle"](DATA-MODEL.md#authority-applied-state-and-implementation-status)).
  Neither the brief nor
  the docs set a retention or deletion policy, and whether any legal
  obligation applies has not been checked.
- Evidence and confidence: high for the behaviour
  (`20261004000600_customers.sql`: soft delete only;
  `20261004000900_attachments.sql` `delete_attachment` and
  `src/lib/domain/attachments.ts` `deletePhoto`: photo deletion); the policy
  question is open.
- Workaround or containment: none.
- Next action: owner decides a retention and deletion policy; the build
  agent then designs a deletion or anonymisation path that keeps financial
  snapshots intact.
- Revisit trigger: before customers sign in (Phase 11).
- Last checked: 2026-10-05.

## R-017 — Appointments MVP has no reschedule and no customer messages

- Category: deliberate shortcut.
- Status and owner: accepted (D38 and the Phase 2 scope); owner.
- Trigger: a settings change leaves booked appointments outside the hours,
  or a customer needs another time.
- Impact: existing bookings never move; there is no reschedule (cancel and
  rebook) and no automatic customer message, so staff must call the
  customers whose bookings no longer fit.
- Evidence and confidence: high; PLAN Phase 2 and
  [RUNBOOK "Appointments: schedule before go-live"](RUNBOOK.md#appointments-schedule-before-go-live).
- Why accepted: MVP scope ([ADR-013](decisions/ADR-013-appointments.md)).
- Workaround or containment: the screens flag affected appointments.
- Next action: none until requested.
- Revisit trigger: customer self-booking goes live (Phase 11).
- Last checked: 2026-10-05.

## R-018 — Four sections are placeholder pages

- Category: known limitation.
- Status and owner: open; build agent (Phases 6–9).
- Trigger: staff open Consignment, Purchasing, Labels or Reports.
- Impact: those pages render the `ComingSoon` component
  (`src/components/shell/coming-soon.tsx`), which reads "Arrives in Phase
  N (…)"; none of their features exist on
  this branch.
- Evidence and confidence: high; `src/app/(staff)/{consignment,purchasing,labels,reports}/page.tsx`.
- Workaround or containment: none.
- Next action: Phases 6, 7 (parallel track), 8 and 9.
- Revisit trigger: each phase ends.
- Last checked: 2026-10-05.

## R-019 — ADR-001 names versions the code does not use

- Category: known defect (documentation).
- Status and owner: accepted; build agent.
- Trigger: reading ADR-001 A1 as the current stack.
- Impact: ADR-001 names Next.js 16.2 and the `qrcode` package; `package.json`
  has `next` 16.3.8, `react` 19.2.8 and no `qrcode` dependency (labels are
  not built). ADR-001 is kept as the historical record.
- Evidence and confidence: high; `package.json` on 2026-10-05.
- Workaround or containment: `package.json` is authoritative for versions;
  [ARCHITECTURE.md](ARCHITECTURE.md#current-system) states the installed
  versions, and ADR-001's status lines point to it and to the later
  decision records.
- Next action: none; a later decision record supersedes ADR-001 A1 only if
  the stack choice itself changes.
- Revisit trigger: a QR rendering library is chosen (Phase 8).
- Last checked: 2026-10-05.

## R-020 — A bike record consigned once cannot be consigned again

- Category: deliberate shortcut.
- Status and owner: accepted (D51, build default, owner to confirm); owner.
- Trigger: a consignor takes a consigned bike back (or buys it back) and
  later brings the same bike to be consigned again.
- Impact: a unit keeps its link to its bike for life, both ways
  (`inventory_units.bike_id`, `bikes.inventory_unit_id`), so the returned
  unit still holds the bike record and a new intake of that bike record is
  refused with `bike_already_linked` (D51). The same is true of a sold shop
  bike that comes back.
- Evidence and confidence: high; `create_consignment_item` applies Phase 4's
  bike rules (`supabase/migrations/20261004003300_consignment.sql`) and
  `tests/db/consignment.test.ts` "a consigned bike links a shop bike record
  both ways; a customer's, archived or already linked bike is refused"
  (D51) proves the link stays after a return and that the same bike record
  is then refused with `bike_already_linked`; it passes in `npm test` on
  2026-10-05 (commit 13fe3f3).
- Workaround or containment: register a new bike record for the second
  consignment (the old record keeps its history and photos).
- Next action: none until the revisit trigger; then decide whether a unit
  that left stock may release its bike link.
- Revisit trigger: the first bike consigned a second time.
- Last checked: 2026-10-05, the migration and test above.
