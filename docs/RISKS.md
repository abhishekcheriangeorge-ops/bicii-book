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
    mailer autoconfirm, mail to the local catcher instead of an SMTP
    provider, a 1-second per-address interval and raised rate limits) differ
    from the hosted settings RUNBOOK prescribes (sign-ups off, custom SMTP,
    60 seconds, sized limits;
    [R-039](#r-039--hosted-email-delivery-and-auth-settings-are-unverified));
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
- Status and owner: closed 2026-10-06 by the integration of
  `feat/auth-email-otp` into this line; what remains is tracked in R-035 to
  R-039.
- Trigger: any staff invitation (before the integration).
- Impact (as recorded on 2026-10-05): the owner changed staff sign-in to
  Supabase email OTP; this line still used email + password and the
  inviter saw the new login's temporary password (D11's residual risk).
- Resolution: staff now sign in with emailed codes (D10 rewritten,
  D70–D72, [ADR-019](decisions/ADR-019-staff-email-sign-in.md)); invites
  create no password and show none; RUNBOOK's hosted Auth step describes
  SMTP, the code templates, the rate limits and the REQUIRED password reset
  for logins created before the switch
  ([R-035](#r-035--logins-created-before-email-codes-keep-a-known-password-until-the-pre-deploy-reset));
  hosted email delivery is still unverified
  ([R-039](#r-039--hosted-email-delivery-and-auth-settings-are-unverified)).
  The owner's note "D11 changed" is read as the sign-in method, as the
  orchestrator's owner-decision list records.
- Evidence: `tests/e2e/auth.spec.ts`, `tests/e2e/staff.spec.ts`,
  `tests/db/stack.smoke.test.ts`, `tests/db/seed-logins.test.ts`; no test
  or helper signs in with a password (`grep` for the password grant and
  `signInWithPassword` finds none, 2026-10-06).
- Last checked: 2026-10-06, merge of `origin/feat/p7-purchasing` into
  `feat/auth-email-otp`.

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
  to be reviewed and merged. The email sign-in work (`feat/auth-email-otp`,
  PR #10, forked from Phase 5's head) now has `origin/feat/p7-purchasing`
  merged into it (2026-10-06, a merge commit, local only), so PR #10 is
  main + purchasing + email codes and merges after #9. Labels
  (`feat/p8-labels`) and Shopify, on the other worktree, are not on `main`
  yet.
- Evidence and confidence: high; `git log --oneline origin/main`,
  `git merge-base` before the merge (d3e2101) and the merge commit's two
  parents (a0fc1d2, 6042e6e); the gates on the merged branch are in
  [NOW.md](../NOW.md).
- Workaround or containment: each integration reruns every gate on the
  merged tree.
- Next action: push `feat/p7-purchasing` and `feat/auth-email-otp`, let CI
  and the `e2e` label run on PRs #9 and #10, merge #9 then #10; then
  integrate labels the same way.
- Revisit trigger: PR #9 or #10 merges.
- Last checked: 2026-10-06.

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
- Impact: the seed creates staff logins (one of them an admin) and one
  customer login at published `.test` and `example.com` addresses, with
  fixed, published UUIDs. Since email codes (D10) none of them has a usable
  password (the hash of a random secret), so on a hosted project they
  would open nothing by themselves, but a seeded admin row would be an
  admin whose mailbox the shop does not control, and the demo data would
  mix with the shop's.
- Evidence and confidence: high; `tests/db/seed-logins.test.ts`; RUNBOOK
  "Hosted Supabase projects" step 5 says never to run the seed on a hosted
  project.
- Workaround or containment: create the first hosted admin as RUNBOOK
  describes.
- Next action: follow RUNBOOK when the first hosted project is created.
- Revisit trigger: R-001.
- Last checked: 2026-10-06, RUNBOOK, `supabase/seed.sql`.

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
- Status and owner: open; build agent (Phase 8 and Phase 9 step 4).
  Consignment stopped being a placeholder in Phase 6 step 3, Purchasing in
  Phase 7 (on the main line since the integration on
  `feat/p7-purchasing`) and Reports in Phase 9 step 2 on
  `feat/p9-reporting`; the heading is kept so links stay valid.
- Trigger: staff open Labels, or the Exceptions and Stock reconciliation
  links at the bottom of Reports.
- Impact: those pages render the `ComingSoon` component
  (`src/components/shell/coming-soon.tsx`), which names the phase or step
  they arrive in; none of their features exist on this branch. Labels is
  built on `feat/p8-labels` in the other worktree and is a placeholder
  here until that branch is integrated.
- Evidence and confidence: high; `src/app/(staff)/labels/page.tsx`,
  `src/app/(staff)/reports/{exceptions,reconciliation}/page.tsx`
  ("Phase 9 step 4"); `/reports` itself is built
  (`tests/e2e/reports.spec.ts`).
- Workaround or containment: none.
- Next action: Phase 9 step 4 (exceptions and reconciliation screens);
  the Phase 8 integration (labels).
- Revisit trigger: each phase or step ends.
- Last checked: 2026-10-06 (Phase 9 step 2).

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
  owner, with Phase 9's refund-reporting row (working name DR5). Since
  2026-10-06 decided as build default D102 REPORT-REFUNDS (Phase 9 step 1,
  [ADR-022](decisions/ADR-022-reporting.md)): refunds are reported as
  their own figure beside gross, never netted, with no Cult Commons
  claw-back; owner question 12 is still open, so the risk stays accepted
  until the owner confirms or changes D102.
- Trigger: an admin or a manager records a refund on a sale
  (`record_sale_refund`, D94), or
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
  includes it (passed in `npm test` on 2026-10-05). Since 2026-10-06 the
  period reports show `refunds_total` and `refund_count` beside gross on
  the sale basis (`report_period_summary`, `report_period_series`);
  `tests/db/period-reports.test.ts` ("Refunds are reported separately
  (D102)") proves a manager's refund counts on the day it is recorded and
  leaves the sale's gross, cost, yield and Cult Commons (restocked line
  included) unchanged.
- Workaround or containment: refunds and restocks show on the sale, in
  `list_sales` (`refunded_total`, `restocked_lines`) and on the consignor
  ledger; refunds are for admins and managers (D94) and capped at the sale
  total (D49). Since
  Phase 6 step 4 the sale page's Yield card says "Refunds and restocks do
  not change these figures yet", the Sales list marks Partly refunded /
  Refunded and Restocked, and `tests/e2e/sales.spec.ts` shows a partial
  refund on the sale and in the list.
- Next action: was "Phase 9 decides the refund-reporting row (DR5) for
  retail and online refunds together" (done as D102, 2026-10-06). Now:
  Phase 9 step 2 shows "refunds recorded" beside gross on the report
  screens; the owner answers question 12 (netting, claw-back); Phase 10's
  online refunds (D85) report through D102 when integrated.
- Revisit trigger: the first real refund, the owner's answer to question
  12, or Phase 10's integration.
- Last checked: 2026-10-06, `20261006001000_report_periods.sql` and
  `tests/db/period-reports.test.ts`.

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
  role since the staff roles, D91, so this is the exception case).
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
  too). Since the staff roles (D90–D94; in the database on
  `feat/staff-roles`, `private.role_implies`), a manager holds
  `view_costs` and `manage_purchasing` through the role and an exception
  the role implies cannot exist (D92), so this applies only to a mechanic
  holding `manage_purchasing` as an exception.
- Evidence and confidence: high; `private.can_view_purchase_costs()` in
  `20261005000100_suppliers.sql`; `tests/db/purchasing-access.test.ts`
  ("manage_purchasing alone runs purchasing and sees purchase costs, but no
  Phase 3/4/5 cost surface" and the prefill test); `tests/unit/purchasing.test.ts`
  ("shows supplier last costs on the product page to view_costs holders
  and admins only", and since the staff roles a manager seeing purchase
  costs through View costs while a mechanic with the exception sees them on
  purchasing screens only); `tests/db/staff-roles.test.ts` (an exception the
  role implies is refused).
- Workaround or containment: grant the exception only to people trusted
  with unit costs, or make a buyer who needs costs a manager; Settings →
  Staff shows each person's role and extra access, and the role-change
  sheet says what a person keeps.
- Next action: none unless the owner objects. The staff roles (D90–D94,
  built on `feat/staff-roles`) resolved the earlier next action: a
  manager now sees costs through the role, and a mechanic's exception is
  the only case left; hiding costs from it would make that buyer order
  blind.
- Revisit trigger: the owner objects to the exception case, or asks for a
  buyer role.
- Last checked: 2026-10-06 (staff roles, integration review).

## R-035 — Logins created before email codes keep a known password until the pre-deploy reset

- Category: security concern (non-exploitable summary; D10, D11).
- Status and owner: mitigated by procedure; operator.
- Trigger: deploying the release that switches sign-in to codes on a
  project whose staff logins were created by the old password flow.
- Impact: the Admin has no password form, but Supabase Auth's password
  grant stays callable with the public anon key while the Email provider
  is on (codes need it). A login invited before the switch has the
  temporary password its inviter saw, so the inviter could still sign in
  as that person, which was D11's residual risk. Nothing is hosted yet
  (R-001), so no such login exists outside developer machines; the local
  seed's logins already have no usable password.
- Evidence and confidence: high for the mechanism (`tests/db/stack.smoke.test.ts`
  shows the seeded logins have no usable password; RUNBOOK "Hosted
  Supabase projects" step 2 holds the reset); the reset SQL itself has not
  run on a hosted project.
- Workaround or containment: RUNBOOK's REQUIRED step replaces every staff
  login's password with the hash of a random secret and ends their
  sessions, after SMTP works and before the code release is deployed.
- Next action: run the step on each hosted project when it exists and
  record the row count.
- Revisit trigger: the first hosted project (R-001).
- Last checked: 2026-10-06, RUNBOOK, `supabase/seed.sql`.

## R-036 — Auth's password grant and password change stay reachable

- Category: security concern (non-exploitable summary; D10).
- Status and owner: accepted for MVP; build agent.
- Trigger: anyone holding a staff session, or Auth's API called directly
  with the public anon key.
- Impact: Supabase Auth serves codes and passwords through one Email
  provider, so its password grant and its password change endpoint stay
  on even though the Admin offers neither. With "Secure password change"
  on (config.toml `secure_password_change`, the devstack's
  `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION`, RUNBOOK's
  hosted step), setting a password needs an emailed nonce once a session is
  more than 24 hours old; a session younger than 24 hours can set one
  without it. Someone who set a password could later sign in without the
  mailbox. Deactivation still blocks them (D71: `requireStaff`, RLS and the
  RPC guards check `staff.active`).
- Evidence and confidence: high; `tests/db/stack.smoke.test.ts` ("setting
  a password needs reauthentication once a session is a day old").
- Why accepted: the Email provider cannot serve codes without also
  serving passwords; staff are trusted with their own login.
- Workaround or containment: keep "Secure password change" on; deactivate
  people who leave.
- Next action: revisit if Supabase allows codes without the password grant,
  or if the owner wants passwords disabled by an Auth hook.
- Revisit trigger: an Auth version bump. (The staff roles, D90–D94, did
  not change this: roles decide what a signed-in person may do, not how
  they sign in; checked 2026-10-06.)
- Last checked: 2026-10-06, `scripts/devstack/services.mjs`,
  `supabase/config.toml`.

## R-037 — Auth's OTP endpoint reveals whether an address has a login

- Category: security concern (non-exploitable summary; D70).
- Status and owner: accepted for MVP; build agent.
- Trigger: a direct call to Supabase Auth's code request with the public
  anon key.
- Impact: Auth answers an unknown email differently from one with a login,
  so a direct API caller can learn whether an address has a login. The
  Admin's screens never show it (an unknown email gets the same "Check your
  email" screen and no account is created), and staff addresses are not
  secret.
- Evidence and confidence: high; `src/lib/auth/sign-in-errors.ts`
  (`otp_disabled` treated as sent), `tests/unit/sign-in-errors.test.ts`,
  `tests/e2e/auth.spec.ts`.
- Why accepted: it is Auth's behaviour, outside the Admin's control.
- Workaround or containment: none needed for staff addresses.
- Next action: revisit before Phase 11 signs customers in, whose addresses
  may be private.
- Revisit trigger: Phase 11; an Auth version that changes the answer.
- Last checked: 2026-10-06.

## R-038 — A visitor who knows a staff email can delay its sign-in

- Category: security concern (non-exploitable summary; D72).
- Status and owner: accepted for MVP; build agent.
- Trigger: repeated code requests or verifications for one staff email, or
  from many client addresses at once.
- Impact: the Admin's own per-email limits (D72) can be used up by someone
  who knows the address, keeping its owner waiting up to 5 minutes at a
  time; many client addresses together can still fill Auth's shared
  per-IP limit, which counts the Admin's server. The per-client limits
  rely on the host setting the client's address in `x-forwarded-for` and
  overwriting what the client sent (Vercel does; another host might not).
- Evidence and confidence: high for the design (`src/lib/auth/sign-in-limits.ts`,
  `tests/unit/sign-in-limits.test.ts`, `tests/db/sign-in-throttle.test.ts`);
  never observed in use.
- Why accepted: MVP; the window is short and staff can ask an admin.
- Workaround or containment: Auth's hosted per-IP limits sized well above
  the Admin's (RUNBOOK); logs show `auth.request_code` warnings.
- Next action: revisit if it is ever observed, or before moving off
  Vercel.
- Revisit trigger: a report of locked-out staff; a hosting change.
- Last checked: 2026-10-06.

## R-039 — Hosted email delivery and Auth settings are unverified

- Category: unverified assumption / operational gap (D10, D70, D71).
- Status and owner: open; owner (SMTP provider and hosted projects), build
  agent (procedure).
- Trigger: the first hosted project; any change of mail provider.
- Impact: without working email nobody can sign in. The hosted SMTP
  provider, the code-only templates, OTP length and expiry, the
  per-address interval, Auth's per-IP limits, sign-ups off and "Secure
  password change" are described in RUNBOOK but never applied. The
  session-revocation migration needs DELETE on Auth's session tables and
  refuses to apply without it, and a project that verifies JWTs locally
  accepts an access token already issued for up to `jwt_expiry` after
  deactivation (the guards refuse it). The Docker CLI path
  (`BICII_MAIL_KIND=mailpit`, Mailpit) was written from Mailpit's API
  documentation and has never run (no Docker here). Every sign-in also
  needs `SUPABASE_SERVICE_ROLE_KEY` (the D72 counters run first), so a
  missing or wrong key in Vercel locks everyone out while Auth's own log
  looks healthy; the login actions log the cause (`limit: "admin"`,
  `cause`), and RUNBOOK's deploy and rotation steps now end with a code
  sign-in from a fresh browser (2026-10-06 review).
- Evidence and confidence: high for absence (R-001); the devstack path is
  covered by `tests/db/stack.smoke.test.ts` and `tests/e2e/auth.spec.ts`
  through the mail catcher.
- Workaround or containment: RUNBOOK says to test SMTP with the owner's own
  address before deploying the code release.
- Next action: owner chooses an SMTP provider; the build agent follows
  RUNBOOK step 2 against staging and records what differs.
- Revisit trigger: R-001.
- Last checked: 2026-10-06, RUNBOOK.

## R-050 — Managers record refunds with no second approval

- Category: accepted compromise (D94, amending D49).
- Status and owner: accepted for MVP; owner.
- Trigger: a manager records a retail refund.
- Impact: money goes out on one person's decision. Before the roles only
  an admin could; now every manager can, up to the sale total minus
  earlier refunds, with a mandatory reason. No second person approves it
  and no daily limit applies. A refund is financial only (D7) and is
  replay-safe by its id.
- Evidence and confidence: high; `private.can_record_refunds()` and
  `public.record_sale_refund` in
  `20261006000200_staff_role_permissions.sql` (the body otherwise
  identical to `20261004003500_sales.sql`); `tests/db/sales.test.ts`
  ("only admins and managers refund (D94 amends D49) …");
  `tests/unit/session-guard.test.ts` (the `roles` requirement);
  `tests/e2e/roles.spec.ts` (a manager records a $6.00 refund).
- Why accepted: the owner decided on 2026-10-06 that managers may refund;
  the cap, the reason and the refund list on the sale page leave a trail.
- Workaround or containment: the sale page lists every refund with who
  recorded it and why; make someone a manager only if they may refund.
- Next action: revisit if the owner wants an approval step or a limit per
  refund or per day; Phase 9's refund reporting (owner question 12) will
  show refunds by person.
- Revisit trigger: a disputed refund; Phase 9 reporting.
- Last checked: 2026-10-06 (staff roles, integration review).

## R-051 — A role change reaches open pages only on their next request

- Category: accepted compromise (D90–D93).
- Status and owner: accepted for MVP; build agent.
- Trigger: an admin demotes someone, or removes their extra access, while
  that person has the Admin open.
- Impact: pages already on their screen keep showing what was rendered
  before the change (for example costs on a job page, or a Record refund
  button) until they navigate or refresh. Nothing they do afterwards goes
  through on the old role: every page request, Server Action, RLS policy
  and RPC reads the person's role and exceptions again
  (`my_staff_profile`, `private.has_permission`, `can_record_refunds`).
- Evidence and confidence: high for the mechanism; `getStaff()` in
  `src/lib/auth/session.ts` is memoised per request only;
  `tests/unit/session-guard.test.ts`; `tests/db/staff-roles.test.ts` (the
  role × permission matrix through `has_permission` and
  `my_staff_profile` takes effect in the same transaction as the change);
  `public/sw.js` caches no pages. Not observed in use.
- Why accepted: the same window as deactivation's open pages (D71); the
  data already on the screen was allowed when it was loaded.
- Workaround or containment: ask the person to close the Admin, or
  deactivate them when access must end at once (D71 ends their sessions).
- Next action: none planned.
- Revisit trigger: the owner wants a demotion to clear open screens at
  once.
- Last checked: 2026-10-06 (staff roles, integration review).

## R-052 — History written before the rename says "staff", not "mechanic"

- Category: compromise (D90).
- Status and owner: accepted; build agent.
- Trigger: anyone reading `staff_events` payloads written before
  `20261006000100_staff_role_values.sql` other than through the Admin, for
  example a SQL export or a future report.
- Impact: `created` and `role_changed` events keep the role text of the
  time, `"staff"`, because `staff_events` is append-only. The Admin labels
  it Mechanic (`roleLabel` in `src/lib/auth/permissions.ts`,
  `describeStaffEvent` in `src/lib/staff-events.ts`); a raw reader sees
  both spellings for the same role. Nothing is hosted (R-001), so only
  developer databases migrated step by step from before
  `20261006000100_staff_role_values.sql` have such rows; `db:reset` and
  the seed write "mechanic" (a fresh `bicii_dev_wt` had 0 such events).
- Evidence and confidence: high; `tests/unit/auth-helpers.test.ts`
  (the test that reads the legacy history value `"staff"` as Mechanic),
  `tests/unit/staff-roles-screens.test.ts`.
- Why accepted: rewriting append-only history would break its own rule;
  the rename itself is recorded in ADR-021.
- Workaround or containment: read history through `staff_history()` and
  the Admin, or map `"staff"` to mechanic in any export.
- Next action: Phase 9 maps the value if it reports on `staff_events`.
- Revisit trigger: a report or export of staff history.
- Last checked: 2026-10-06 (staff roles, integration review).

## R-053 — The staff roles build defaults D92 and D93 are unconfirmed

- Category: unverified assumption (D92, D93).
- Status and owner: open; owner.
- Trigger: the owner reads the roles differently from the build.
- Impact: four behaviours were chosen by the build within the owner's
  decision: (1) an exception the role already includes cannot exist, and
  a role change removes the exceptions the new role includes (D92); (2) a
  later demotion does not bring them back, so demoting a manager who was
  once a mechanic with `manage_purchasing` leaves them with no extra
  access; (3) a `manage_staff` holder who is not an admin acts on
  mechanics only, also for renaming, deactivating and reactivating (D93);
  (4) such a holder can still rename themselves, as before the roles. If
  the owner wanted otherwise, people would have more or less access than
  expected after a role change.
- Evidence and confidence: high for what is built;
  `20261006000200_staff_role_permissions.sql` (triggers
  `staff_permissions_refuse_implied`, `staff_role_drop_implied_exceptions`),
  `20261006000300_staff_role_administration.sql`;
  `tests/db/staff-roles.test.ts` ("promoting a mechanic to manager drops
  the exceptions the role implies, with history; … demoting brings
  nothing back", "a mechanic with manage_staff acts on mechanics within
  the ceiling, …" including the self-rename); the role-change sheet says
  so beforehand (`roleChangeSummary` in `src/lib/auth/role-change.ts`).
- Workaround or containment: the change-role sheet lists what is removed
  and that changing back does not restore it; History records every
  removal with the role change's reason.
- Next action: the owner answers
  [PRODUCT owner question 20](PRODUCT.md#open-assumptions-and-owner-questions).
- Revisit trigger: the owner's answer.
- Last checked: 2026-10-06 (staff roles, integration review).

## R-054 — The change-role sheet checks the role it showed, not the extra access

- Category: accepted compromise (D92, D93).
- Status and owner: accepted for MVP; build agent.
- Trigger: two admins work on the same person at once: one opens the
  change-role sheet, the other changes that person's extra access before
  the first confirms.
- Impact: the sheet's "What changes" lines were worked out from the extra
  access shown when the page loaded. The role itself is checked: the
  Admin sends the role the sheet showed (`update_staff` `expected_role`),
  and a role changed meanwhile is refused with "Someone changed their role
  in the meantime. Reload and try again." (`staff_role_changed`). An
  exception granted meanwhile is not checked, so the sheet may not list
  it among what the new role removes; the role change still removes it
  (D92) and History records that removal with the role change's reason.
- Evidence and confidence: high; `update_staff` in
  `20261006000300_staff_role_administration.sql`;
  `tests/db/staff-roles.test.ts` ("a role change confirmed against a role
  that changed meanwhile is refused …"); `ChangeRoleSheet` in
  `src/app/(staff)/settings/staff/[staffId]/staff-controls.tsx`. Not
  observed in use.
- Why accepted: it needs two admins acting on one person within seconds;
  nothing is lost silently (History has every removal), and removed extra
  access can be granted again.
- Workaround or containment: History on the person's page.
- Next action: none planned.
- Revisit trigger: the shop has several admins who administer staff at
  the same time, or a removal is reported as unexpected.
- Last checked: 2026-10-06 (staff roles, review fixes).

## R-055 — Past report periods change after a reopen, a back-dated sale or a back-dated receipt

- Category: deliberate design (D101 REPORT-RESTATEMENT).
- Status and owner: accepted (build default, owner to confirm, owner
  question 21); owner.
- Trigger: a completed job is reopened (D15) and completed again on a
  later day; a sale is recorded with an earlier `recognized_at` (D55); a
  purchase receipt is back-dated (D64, up to 30 days); a settlement is
  reversed (D47).
- Impact: a period report run twice can give different figures for the
  same past days: the reopened job leaves its old completion day, the
  back-dated sale or receipt joins its past day, a reversed settlement
  leaves `settlements_paid_total`. There is no period close and no stored
  total (SPEC §19.2, §30), so nothing records what a report said before.
- Evidence and confidence: high; the report RPCs read source records only
  (`20261006001000_report_periods.sql`); `tests/db/period-reports.test.ts`
  ("Voids restate the period (D101, D15, D32)") moves job B from Fri 7
  March to 11 March after a reopen and a void.
- Workaround or containment: an exported CSV (built in Phase 9 step 2) is
  a snapshot taken at export time; job and sale histories show every
  reopen, void and date; back-dated receipts are limited to 30 days (D64).
  The export's file name names the period and basis, not the time it was
  taken (`bicii-<kind>-<basis>-<from>_<to>.csv`); the download's own time
  is the only record of when.
- Next action: the owner confirms D101 or asks for a period close (a new
  decision); if exports are kept as records, add the export time to the
  file (a header row or the name).
- Revisit trigger: an accountant or the owner needs closed periods, or a
  report is disputed after a restatement.
- Last checked: 2026-10-06 (Phase 9 step 2).

## R-056 — Stock value uses each product's last cost, not the cost of the units on hand

- Category: deliberate simplification (D105, D5, D63).
- Status and owner: accepted (build default, owner to confirm, owner
  question 21); owner.
- Trigger: a quantity product's cost changes between deliveries (a receipt
  sets `products.default_direct_cost` to the latest cost, D63).
- Impact: `report_stock_value` values every unit of a quantity product on
  hand at its last cost, so after a price change the value differs from
  what was actually paid for the stock still on the shelf (higher after a
  rise, lower after a fall). Products with a NULL cost are counted in
  `uncosted_items` and not valued, so the value is understated until a
  cost is set; consigned and customer-owned stock is never valued.
  Locations below zero count as 0.
- Evidence and confidence: high; `20261006001100_report_stock_value.sql`;
  `tests/db/period-reports.test.ts` ("report_stock_value: last cost x
  positive on-hand ..."). The ledger has no cost layers, so FIFO or average
  cost is not derivable without a new design.
- Workaround or containment: the stock value is labelled "at last cost"
  on `/reports` ("Stock at cost now", step 2); unique units use their own cost; purchase receipts keep the
  actual cost of each delivery (`purchase_receipt_lines.unit_cost_actual`).
- Next action: the owner confirms D105 or asks for average or FIFO cost (a
  new decision and a ledger change).
- Revisit trigger: stock value is used for accounts or insurance, or costs
  move a lot between deliveries.
- Last checked: 2026-10-06 (Phase 9 step 1).

## R-057 — CSV exports stop at 50,000 rows and refuse when figures change mid-export

- Category: known limitation.
- Status and owner: accepted; build agent.
- Trigger: an export of more than 50,000 breakdown groups or lines (a long
  range on the job dimension, or every line of a busy year); or a job,
  sale or refund changes the period's lines while an export is paging.
- Impact: the export answers 413 "Too many rows to export. Choose a
  shorter range." instead of a file; or, when the groups' or lines' count
  disagrees with `report_period_summary` (or the group's `line_count`)
  twice in a row, 409 "Figures changed while exporting. Try again." Each
  page is its own PostgREST request and transaction, so the check is on
  integer line counts only: a change that keeps the count (an edited
  price on a line already counted) is not detected, and the file can mix
  rows read before and after it.
- Evidence and confidence: high for the behaviour
  (`src/lib/domain/period-reports.ts` `getAllBreakdownForExport`,
  `getAllLineItemsForExport`, `EXPORT_MAX_ROWS`; pages of 500 groups and
  1,000 lines, PostgREST's max-rows; `tests/db/period-report-exports.stack.test.ts`
  walks the keyset and checks the counts on the seed); medium for the
  limit being enough (the bench year has 61,029 lines,
  [DATA-MODEL §14](DATA-MODEL.md#14-reporting-views-schema-reporting), so a
  full year of lines exceeds it at that volume; a month does not).
- Workaround or containment: export a shorter range, or the breakdown
  instead of the lines; retry after a 409. The screens are not limited.
- Next action: none until a real export hits the limit; then a streamed
  export from one database snapshot (one RPC returning the CSV, or a
  server-side cursor in a single transaction).
- Revisit trigger: a 413 or a repeated 409 reported by staff, or the shop
  needs year-long line exports.
- Last checked: 2026-10-06 (Phase 9 step 2).

## R-058 — Phase 9's exceptions migration must be re-verified when Phase 10 merges

- Category: integration risk (merge order).
- Status and owner: open; orchestrator (the integration of
  `feat/p9-reporting` and `feat/p10-shopify`).
- Trigger: `feat/p10-shopify` and `feat/p9-reporting` are merged into one
  branch, in either order.
- Impact: Phase 10's `20261004004000_shopify_order_processing.sql` sorts
  BEFORE Phase 9's `20261006001300_operational_exceptions.sql`. It creates
  `private.integration_exceptions()` (nine columns, admins only, D86) and
  replaces `reporting.operational_exceptions` with its nine-column
  `integration_failed` branch. Phase 9 must keep Phase 10's body and
  replace the view with fifteen columns. If the placeholder overwrote
  Phase 10's body, admins would never see a failed Shopify job; if the
  signatures differed, whichever migration ran second would fail.
- Evidence and confidence: high for this branch; medium-high for the
  merged one (simulated, not yet the real merge). On 2026-10-06 a scratch
  database built from this branch's migrations plus Phase 10's four files
  (`20261004003800`–`…4100`, read with `git show feat/p10-shopify:…`, so
  in merged filename order) and this branch's seed applied every
  migration; Phase 10's body of `private.integration_exceptions()` was
  kept (it reads `needs_attention`), the view had 15 columns, and a
  `needs_attention` product_sync job was listed for the admin as
  `integration_failed` (entity `integration_job`, issue
  `integration_failed`, title the P- ID, detail the error) and counted in
  their `exceptions_now` (4), while mechanic2 saw none (3); the scratch
  database was dropped. `20261006001300` creates the placeholder inside a
  `DO` block guarded by `to_regprocedure('private.integration_exceptions()')
  is null`, with exactly Phase 10's signature (read with `git show
  feat/p10-shopify:supabase/migrations/20261004004000_shopify_order_processing.sql`),
  and its view maps the appended columns itself;
  `tests/db/operational-exceptions.test.ts` checks the signature from the
  catalogue. Phase 10's other migrations (`…3900`, `…4100`) do not touch
  the view, `public.operational_exceptions` or `today_dashboard`. On the
  merged branch Phase 10's `src/lib/reports.ts` already labels
  integration_failed "Shopify needs attention"; its `integration_job`
  link must survive step 4's exceptions screen.
- Workaround or containment: none needed until the merge.
- Next action: on the integrated branch run `npm run db:reset`, then
  `tests/db/operational-exceptions.test.ts`, `reporting.test.ts`,
  `reporting-seed.test.ts` and Phase 10's exception tests, and check that
  an admin sees a `needs_attention` job as `integration_failed` with
  `issue` = `integration_failed` while mechanic2 does not.
- Revisit trigger: the merge; any later change to
  `private.integration_exceptions()` on either branch.
- Last checked: 2026-10-06 (Phase 9 step 3).

## R-059 — Today and the exception counts are slow at a busy year's volume

- Category: performance (measured).
- Status and owner: open; build agent (Phase 9 step 4 or a follow-up).
- Trigger: a year of busy-shop data: the bench in
  `scripts/bench/report-volume.sql` (15,021 jobs, 51,025 work-order lines,
  10,004 sale lines, about 110,000 movements, 3,006 unique units, 1,503
  overdue or uncollected jobs).
- Impact: `today_dashboard(null)` took 8,837 ms against a 150 ms target.
  Almost all of it is Phase 5's `public.daily_summary(d, d)` for one day
  (6,400–8,400 ms measured alone, with and without JIT): it joins the day
  to `reporting.daily_summary`, which computes every day since the
  earliest activity before the day is picked. Phase 9 did not change it
  (the brief keeps `today_dashboard`'s body except the exceptions count).
  The exceptions count itself (`report_exception_counts()`, and the same
  query inside Today) took 257 ms against 150 ms; the list
  (`operational_exceptions(200)`) 390 ms, inside its 500 ms target. The
  seeded shop is far below this volume, and Today loads instantly there.
- Evidence and confidence: high for the measurements (DATA-MODEL §14
  "Reconciliation and exception timings", 2026-10-06, a throwaway clone
  of `bicii_dev_wt`, numbers noisy within about ±20% on the shared
  4-CPU machine); medium for how soon a real shop reaches this volume.
  Before two query fixes the counts took 585 ms and the list 973 ms: the
  currency_mismatch branches now read the shop currency once per query,
  and the reconciliation and exception RPCs run with `jit = off` (JIT
  compilation alone cost 100–250 ms per call).
- Workaround or containment: none needed at today's volume. The
  reconciliation RPCs are well inside target (50–88 ms).
- Next action: rewrite `public.daily_summary(d, d)` to compute only the
  requested days from the source tables (the same columns, proved equal
  by `period-reports.test.ts`' daily_summary comparison), and consider
  `jit = off` on `today_dashboard` (an attribute change the brief kept out
  of this step); only if the counts still miss, a trigger-maintained
  projection of the exception counts (the documented D106 follow-up), never
  a hand-maintained total.
- Revisit trigger: Today takes more than a second in use, or the shop's
  data approaches the bench volume.
- Last checked: 2026-10-06 (Phase 9 step 3).
