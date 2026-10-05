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
  temporary password). The OTP work is on `feat/auth-email-otp` (4b3eadd,
  local and on origin, equal; checked out in the second worktree
  `bicii-book-wt`), not on this branch; it was not inspected or verified
  here. Whether OTP removes the residual risk is unverified.
- Why accepted: MVP default ([ADR-005](decisions/ADR-005-staff-sign-in-and-delegation.md)).
- Workaround or containment: only admins and trusted `manage_staff` holders
  invite; the D11 ceiling limits what an inviter can grant.
- Next action: owner confirms that the note "D11 changed (staff email OTP)"
  meant the sign-in method (D10 on this branch) and that the D11 ceiling
  stays; integrate the OTP work, revise RUNBOOK's hosted Auth steps, and
  configure SMTP for staging.
- Revisit trigger: the OTP branch is integrated into this line.
- Last checked: 2026-10-05 (Phase 6 review fixes), `git for-each-ref
  refs/heads refs/remotes`, `git worktree list`, the invite form.

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
- Next action: none. Phase 6 step 2 added the same 0 test for sale lines:
  `tests/db/sales.test.ts` "D24 (amended): a price of 0 and a cost of 0
  are known values, snapshotted as 0" (passed in `npm test` on
  2026-10-05).
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
- Workaround or containment: none needed. Since Phase 6 step 3 the Add
  part sheet offers consigned stock ("Consigned · <consignor>",
  `searchParts` in `src/lib/domain/inventory.ts`), proven end to end by
  `tests/e2e/consignment.spec.ts` (a consigned bike added to a job and
  sold at completion).
- Next action: none.
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
- Status and owner: partly resolved; owner (merges), build agent
  (integration). The heading is kept so links stay valid.
- Trigger: integrating the parallel tracks into `main`.
- Impact: the stack (PRs #1–#7), the docs stack (#8) and Phase 6 (#11)
  are merged into `main` (6042e6e). `feat/p7-purchasing` forked from PR
  #6's head d3e2101; `main` is now merged into it (a merge commit, no
  rebase) with every conflict resolved keeping both sides, `staff_search`
  carrying both tracks' kinds, and the seed's Phase 7 part after Phase 6's.
  That integration is local only until pushed, and its PR (#9) still has
  to be reviewed and merged. The email OTP work (`feat/auth-email-otp`)
  and labels (`feat/p8-labels`, on the other worktree) are not on `main`
  yet.
- Evidence and confidence: high; `git log --oneline origin/main`,
  `git merge-base` before the merge (d3e2101) and the merge commit's two
  parents (a0fc1d2, 6042e6e); the gates on the merged branch are in
  [NOW.md](../NOW.md).
- Workaround or containment: each integration reruns every gate on the
  merged tree.
- Next action: push `feat/p7-purchasing`, let CI and the `e2e` label run on
  PR #9, merge it; then integrate OTP and labels the same way.
- Revisit trigger: PR #9 merges.
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
  snapshots intact. Consignors' personal and payout details have the same
  gap ([R-026](#r-026--consignor-personal-and-payout-details-are-kept-indefinitely-with-no-change-history)).
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
- Status and owner: open; build agent (Phases 8–9). Consignment stopped
  being a placeholder in Phase 6 step 3 and Purchasing in Phase 7 (on the
  main line since the integration on `feat/p7-purchasing`); the heading is
  kept so links stay valid.
- Trigger: staff open Labels or Reports.
- Impact: those pages render the `ComingSoon` component
  (`src/components/shell/coming-soon.tsx`), which names the phase they
  arrive in; none of their features exist on this branch.
- Evidence and confidence: high; `src/app/(staff)/{labels,reports}/page.tsx`.
- Workaround or containment: none.
- Next action: Phases 8 (other worktree) and 9.
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

## R-021 — Reports overstate net sales after a refund or restock

- Category: deliberate shortcut.
- Status and owner: accepted (D49, build default, owner to confirm);
  owner, with Phase 9's refund-reporting row (working name DR5).
- Trigger: an admin records a refund on a sale (`record_sale_refund`), or
  staff restock a sold unit (`restock_unit`).
- Impact: `reporting.financial_lines` and `reporting.daily_summary` (and so
  Today and the financial reports) keep every sale line at its snapshot:
  a refunded or restocked sale still counts in gross sales, yield and Cult
  Commons on its recognition day. Net sales, yield and the Cult Commons
  share are overstated by the refunded amount until Phase 9 decides
  netting and Cult Commons claw-back. The consignor ledger is not affected
  (a restock removes the liability; a refund alone does not change it,
  D46).
- Evidence and confidence: high; the sale branch of `financial_lines` in
  `supabase/migrations/20261004003700_consignment_reporting.sql` subtracts
  nothing; `tests/db/consignment-reporting.test.ts` asserts that S-000002
  keeps its full 28.00 entry after its 14.00 refund, and `SEED_DAYS` day 4
  includes it (passed in `npm test` on 2026-10-05).
- Workaround or containment: refunds and restocks show on the sale, in
  `list_sales` (`refunded_total`, `restocked_lines`) and on the consignor
  ledger; refunds are admin-only and capped at the sale total (D49). Since
  Phase 6 step 4 the sale page's Yield card says "Refunds and restocks do
  not change these figures yet", the Sales list marks Partly refunded /
  Refunded and Restocked, and `tests/e2e/sales.spec.ts` shows a partial
  refund on the sale and in the list.
- Next action: Phase 9 decides the refund-reporting row (DR5) for retail
  and online refunds together.
- Revisit trigger: the first real refund, or Phase 9's reports.
- Last checked: 2026-10-05, the migration and tests above.

## R-022 — Agreement photos are hidden by the app, not by the database

- Category: uncertainty (access design).
- Status and owner: open; owner to confirm, build agent.
- Trigger: a staff member without Manage consignments or View costs reads
  a consignment item's agreement photos outside the item page (for
  example through the attachments API with their own session).
- Impact: agreement photos (D52) are internal, and `attachments` RLS lets
  every active staff member read internal photos. A signed agreement
  shows the amount owed to the consignor, which D48 otherwise reveals only
  to Manage consignments or View costs. The item page loads and shows
  agreement photos only to those staff (`getConsignmentItem` in
  `src/lib/domain/consignment.ts` with `canSeeMoney`); the database does
  not enforce it.
- Evidence and confidence: high; `src/app/(staff)/consignment/items/[id]/page.tsx`
  ("Agreement photos" card), the attachments policies in
  `supabase/migrations/20261004000900_attachments.sql`;
  `tests/e2e/consignment.spec.ts` covers the admin path only
  (passed on 2026-10-05).
- Workaround or containment: the app never sends the photos to other
  staff; customers and anonymous users never read them (D52's trigger and
  CHECK keep them internal).
- Next action: owner decides whether agreement photos are consignment
  money (then a later migration gates `consignment_item` attachments by
  `private.can_view_consignment_money()`, a new D-row from D54) or ordinary
  internal photos (then the item page shows them to all staff).
- Revisit trigger: the owner's answer, or Phase 11's attachment access
  review.
- Last checked: 2026-10-05.

## R-023 — A consigned unit's cost preview leaves out shop-paid charges

- Category: known defect (display).
- Status and owner: open; build agent.
- Trigger: a View costs holder opens a consigned unit's or product's page
  after a shop-paid charge was added to its consignment.
- Impact: the unit page's "Cost and yield" reads `public.inventory_unit_costs`
  (Phase 4), whose cost is the unit's direct cost, the agreed amount
  only; D44 snapshots agreed amount plus shop-paid charges when it goes on
  a job or a sale. The preview overstates expected yield and Cult Commons
  by the charges; nothing stored is wrong. The consignment item page and
  the Add part sheet use agreed amount plus shop-paid charges.
- Evidence and confidence: high; the seeded C-000001 (agreed 2,400.00 and
  a 120.00 shop charge) shows cost $2,400.00 on its unit page (screenshot
  on 2026-10-05) against the 2,520.00 its line would snapshot; the rule
  that a shop charge raises the part's cost is proven by
  `tests/db/consignment-job-parts.test.ts` "a shop charge raises the
  part's cost (D4) …".
- Workaround or containment: read the consignment item's Money card. The
  sale sheet's "Below cost" warning and preview (Phase 6 step 4) also use
  agreed amount plus shop-paid charges (`searchSaleable` reads
  `consignor_statement`), so only the unit page's Phase 4 card is affected.
- Next action: a later migration adds shop-paid charges to
  `inventory_unit_costs` for consigned units (same columns).
- Revisit trigger: the next migration touching `inventory_unit_costs`, or
  Phase 9's reports.
- Last checked: 2026-10-05.

## R-024 — A consigned item can be sold below what the consignor is owed

- Category: unverified assumption (owner question).
- Status and owner: open; owner (D53's open question), build agent for
  any change.
- Trigger: any staff member lowers a consigned line's price in the sale
  sheet (D53 lets any active staff member override a price, with no
  database floor).
- Impact: a consigned item sold under its agreed amount plus shop-paid
  charges makes a loss for the shop: the consignor is still owed the
  agreed amount (D46), the line's yield is negative and its Cult Commons
  share is 0 (D1). Nothing is wrong in the ledger; the shop simply loses
  money on the sale.
- Evidence and confidence: high; `private.sell_line` in
  `supabase/migrations/20261004003500_sales.sql` takes any price of 0 or
  more; the sheet only warns ("Below the asking price" for everyone,
  "Below cost: this sale loses money" for View costs), proven by
  `tests/unit/sales.test.ts` (`priceWarnings`) and
  `tests/e2e/sales.spec.ts` (both warnings on a unique unit priced under
  its cost; only the first for a member without cost access).
- Workaround or containment: the warnings; the sale page shows the loss to
  View costs holders; a loss line contributes no Cult Commons.
- Next action: the owner answers D53's question (should a price below the
  agreed amount plus shop charges need `manage_consignments`?); if yes, a
  migration adds the check to `private.sell_line` with a new P0001 code.
- Revisit trigger: the owner's answer, or the first consigned sale at a
  loss.
- Last checked: 2026-10-05.

## R-025 — A transfer of consigned stock cannot choose whose stock moves

- Category: known limitation.
- Status and owner: open; owner (whether it matters), build agent.
- Trigger: staff move consigned quantity stock between locations when two
  or more consignors have the same product at the source location.
- Impact: since D54 every consigned movement names its consignment item,
  so each consignor's stock is known per location and a sale or job part
  is charged to the consignor whose stock is there. `transfer_stock` kept
  its signature (no item argument), so a transfer of consigned quantity
  stock moves the oldest active item that has the whole quantity at the
  source location; a quantity no single consignor has there is refused
  (`consignment_quantity_unavailable`: move one consignor's stock at a
  time). If staff physically move another consignor's goods, the books
  attribute the move to the older consignor; sales then follow the books,
  not the shelf, which matters only if the goods can be told apart.
- Evidence and confidence: high;
  `supabase/migrations/20261004003300_consignment.sql`
  (`private.consignment_item_on_hand`, the replaced `transfer_stock`, the
  D50 movement trigger), `tests/db/consignment-locations.test.ts`.
- Workaround or containment: sell or return by naming the item (the sale
  sheet lists each consignor at the location that holds their stock);
  move consignors' stock one at a time in FIFO order.
- Next action: if the owner wants staff to choose, add an optional item
  argument to `transfer_stock` (a new signature, so a migration, types,
  the API-surface fixture and the transfer sheet change).
- Revisit trigger: the first complaint that a transfer moved the wrong
  consignor's stock, or a second shop location.
- Last checked: 2026-10-05.

## R-026 — Consignor personal and payout details are kept indefinitely with no change history

- Category: unverified assumption (owner question) / operational gap.
- Status and owner: open; owner (retention decision), build agent.
- Trigger: a consignor asks for their data to be deleted, a legal or
  business retention limit applies, or someone needs to know who changed
  a consignor's bank or PayNow details.
- Impact: Phase 6 stores consignors' names, email, phone and
  `payout_details` (bank or PayNow details). Consignors are archived,
  never deleted (D47: there is no DELETE grant or policy), so this data is
  kept indefinitely. `payout_details` has no change history: the
  consignors table has triggers for `updated_at`, normalisation and the
  archive rules, and no event table, so a changed bank detail leaves no
  record of who changed it or what it was before. Read access is limited
  (D48: `manage_consignments` only, through a column grant and
  `consignor_payout_details`).
- Evidence and confidence: high for the behaviour;
  `supabase/migrations/20261004003300_consignment.sql` (the consignors
  table and its comment "Archived, never deleted", the column comment on
  `payout_details`, the grants without DELETE and the select/insert/update
  policies, the three consignors triggers); whether any legal obligation
  applies has not been checked.
- Workaround or containment: only `manage_consignments` holders read or
  write payout details; staff can blank them on an archived consignor.
- Next action: the owner decides retention for consignor data together
  with R-016; the build agent then adds an append-only consignor history
  (at least who changed `payout_details` and when, without storing the
  old value in clear) and a deletion or anonymisation path that keeps
  sales and settlements intact.
- Revisit trigger: before any hosted deployment with real consignors.
- Last checked: 2026-10-05.

## R-027 — A sale can be backdated without limit by any staff member

- Category: unverified assumption (owner question, D55).
- Status and owner: open; owner (D55's open question), build agent for
  any change.
- Trigger: a staff member records a sale with "Sold earlier?" dated days,
  weeks or months back.
- Impact: D55 refuses a date before the stock was with the shop
  (`sale_before_stock`: a consigned item's intake, a unit's latest
  restock) and after now + 5 minutes; otherwise any active staff member
  may date an in-store sale in the past. The sale is recognised on that
  shop day, so it changes that day's gross sales, yield and Cult Commons
  in reports and on Today, with the rate in force then. There is no
  period lock (the brief has none), no permission tier and no window, and
  shop-owned stock has no lower bound, because its registration date is
  when it was entered, not when it arrived.
- Evidence and confidence: high; `record_retail_sale` and
  `private.sell_line` in `supabase/migrations/20261004003500_sales.sql`;
  `tests/db/sales.test.ts` ("when a sale may be dated (D55 SALE-DATE)");
  the Phase 6 review reproduced a sale dated 400 days before its consigned
  item was received, now refused.
- Workaround or containment: the sale keeps who recorded it and when
  (`created_by`, `created_at`) next to its `recognized_at`; reports
  separate sale and recognition dates (SPEC §14, §22).
- Next action: the owner answers D55's question (should backdating beyond
  a window need `view_financial_reports` or admin?); if yes, a migration
  adds the check to `record_retail_sale` with a new P0001 code and the
  sheet hides "Sold earlier?" beyond it.
- Revisit trigger: the owner's answer, Phase 9 reporting, or the first
  closed-period request.
- Last checked: 2026-10-05.

## R-030 — A wrong delivery cannot be reversed, only adjusted

- Category: known limitation (D65; owner question 16).
- Status and owner: open; owner (whether a reverse-receipt is wanted),
  build agent for any change.
- Trigger: staff record a delivery with the wrong count, the wrong product
  line or the wrong actual cost.
- Impact: receipts and their lines are immutable
  (`purchase_receipt_immutable`). A wrong count is corrected with a
  reasoned Phase 4 stock adjustment, and the PO line raised or lowered if
  the supplier will send more; the order's received figures keep the wrong
  count. A wrong actual cost has already become the product's cost and the
  supplier's last cost (D5, D63) and stays so until a `view_costs` holder
  edits the product cost or a later delivery sets it; nothing restores the
  earlier cost.
- Evidence and confidence: high; `supabase/migrations/20261005000300_purchase_receiving.sql`
  (header and `private.purchase_receipts_immutable`);
  `tests/db/purchasing.test.ts` (receipts refuse UPDATE and DELETE).
- Workaround or containment: the Receive screen shows what is still to
  come and the "Differs" flag before the commit; every receipt names who
  recorded it and when; the product's `cost_changed` event says which
  delivery set the cost.
- Next action: the owner answers question 16; if yes, a reverse-receipt
  RPC writing linked ledger reversals and restoring the earlier last cost.
- Revisit trigger: the first wrong delivery in use, or the owner's answer.
- Last checked: 2026-10-05.

## R-031 — Two staff can record the same delivery twice

- Category: known limitation (D65).
- Status and owner: open; build agent.
- Trigger: two people receive the same paper delivery note on two
  devices, each with its own submission.
- Impact: the idempotency key makes one submission's retries safe, not two
  submissions of one delivery. The second is refused only when it exceeds
  what is still to come (`purchase_over_receipt`); otherwise it adds stock
  again. The guard is soft: the Receive screen lists recent receipts and
  makes staff tick "This is a different delivery" when the delivery-note
  reference matches one already recorded on that order (any case); there
  is no database uniqueness on the reference, because suppliers reuse it
  for split deliveries.
- Evidence and confidence: high; `src/components/domain/purchasing/receive-form.tsx`
  (`duplicateReference`), `tests/e2e/purchasing.spec.ts` (the duplicate
  warning), PLAN D65.
- Workaround or containment: over-receipt is refused, so a duplicate can
  only use up what was still to come; a stock adjustment with a reason
  corrects it.
- Next action: none planned; revisit if it happens.
- Revisit trigger: the first duplicate delivery in use.
- Last checked: 2026-10-05.

## R-032 — Purchase movements carry the recording time, not the delivery time

- Category: known limitation (D64).
- Status and owner: open; build agent (Phase 9 reporting).
- Trigger: a delivery is back-dated (up to 30 days) when it is received.
- Impact: Phase 4's ledger has no effective-date column and is
  append-only, so a `purchase_received` movement's `created_at` is when it
  was recorded; its reason names the delivery time in shop time ("PO-000002
  received 2 Oct 2026 11:30"), and the receipt holds `received_at`. Stock
  reports by movement date place the stock on the recording day. The seed
  shows it: its receipts are back-dated, their movements carry seed time.
- Evidence and confidence: high; `private.record_receipt_movement` and
  `receive_purchase` in `20261005000300_purchase_receiving.sql`;
  `tests/db/purchasing-seed.test.ts`.
- Workaround or containment: purchasing reports and the last-cost order
  use `purchase_receipts.received_at`; Phase 5's daily summary and Today
  count no `purchase_received` movement.
- Next action: Phase 9 decides whether stock reports need the delivery
  date (join the receipt) or an effective-date column on the ledger.
- Revisit trigger: Phase 9 stock or valuation reports.
- Last checked: 2026-10-05.

## R-033 — Unique items bought from a supplier have no purchase order

- Category: known limitation (D62; owner question 17).
- Status and owner: open; owner (whether it is wanted), build agent.
- Trigger: the shop buys a frame, a bike or another unique item from a
  supplier.
- Impact: a PO holds counted products only
  (`purchase_line_unique_product`). A unique item is registered in Stock
  with `create_unique_unit` and its cost, so no supplier, order, delivery
  note or last cost is recorded for it, and "on order" never counts it.
- Evidence and confidence: high; `set_purchase_order_line` in
  `20261005000300_purchase_receiving.sql`; `tests/db/purchasing.test.ts`
  ("submit needs a line; lines order shop-owned quantity products once
  each").
- Workaround or containment: the unit's internal notes can name the
  supplier and invoice.
- Next action: the owner answers question 17; if yes, a unique-unit
  purchase flow (a PO line that registers units on receipt).
- Revisit trigger: the owner's answer.
- Last checked: 2026-10-05.

## R-034 — A manage_purchasing exception shows unit costs on purchasing screens

- Category: unverified assumption (D60; the owner was informed on
  2026-10-06 and has not objected).
- Status and owner: open; owner.
- Trigger: an admin grants `manage_purchasing` to a mechanic as a
  single-permission exception (managers hold `view_costs` through their
  role once the staff roles are built, so this is the exception case).
- Impact: that mechanic sees purchase costs on purchasing screens: PO line
  costs and totals, actual receipt costs, supplier last costs, the cost
  prefill (the product's cost for products a PO can hold) and PO history.
  Because by D5 a receipt's cost becomes the product's cost, they in
  effect learn the unit cost of every orderable product. They still see no
  yield, margin, Cult Commons or report figure and no Phase 3/4/5 cost
  surface: the product page's "Suppliers & orders" card shows supplier
  last costs to `view_costs` holders only (`canSeeProductPageSupplierCosts`
  in `src/lib/purchasing.ts`, since the integration review; before it the
  card used the purchasing rule and showed them to the exception holder
  too). Until the staff roles are built, this applies to every non-admin
  holding `manage_purchasing`, not only a mechanic.
- Evidence and confidence: high; `private.can_view_purchase_costs()` in
  `20261005000100_suppliers.sql`; `tests/db/purchasing-access.test.ts`
  ("manage_purchasing alone runs purchasing and sees purchase costs, but no
  Phase 3/4/5 cost surface" and the prefill test); `tests/unit/purchasing.test.ts`
  ("shows supplier last costs on the product page to view_costs holders
  and admins only").
- Workaround or containment: grant the exception only to people trusted
  with unit costs; Settings → Staff lists each person's permissions.
- Next action: revisit with the staff roles (D90–D99) if the owner wants
  the exception to hide costs (a buyer would then order blind).
- Revisit trigger: the staff roles land, or the owner objects.
- Last checked: 2026-10-05.
