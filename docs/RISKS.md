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
- Status and owner: mostly resolved; owner (merges), build agent
  (integration). The heading is kept so links stay valid.
- Trigger: integrating the parallel tracks into `main`.
- Impact: the stack (PRs #1–#7), the docs stack (#8), Phase 6 (#11),
  purchasing (#9), staff email sign-in (#10) and the staff roles (#13)
  are merged into `main` (`a1aebf6` on 2026-10-06). Labels (Phase 8,
  `feat/p8-labels`) and Shopify (Phase 10, `feat/p10-shopify`, stacked on
  labels) are not. Each merged `origin/main` on its own (merge commits, no
  rebase), and `feat/p8-labels` (with its "Print N labels" follow-up) is
  then merged into `feat/p10-shopify` (2026-10-06; local only until
  pushed), so `feat/p10-shopify` holds main, labels and Shopify. Every
  conflict kept both sides: the seed runs Phase 7's part after Phase 6's
  and before Phase 8's print jobs and Phase 10's Shopify part (Phase 7
  creates no products, so the Phase 10 short IDs P-000027 … P-000033 are
  unchanged); the labels risks that collided with purchasing's
  R-030–R-032 are R-075–R-077; the owner questions of labels and Shopify
  are rows 21–25 after main's 15–20; the API-surface allow-list holds the
  label, Shopify and purchasing grants; the service role's allow-list
  gained `note_sign_in_attempt`; and the labels E2E's signed-in customer
  gets its session through the API, because the login form now signs
  non-staff out (D70). No function, view, policy, grant, trigger or type
  is defined both by a labels or Shopify migration and by a purchasing,
  sign-in or roles migration ([DATA-MODEL](DATA-MODEL.md#authority-applied-state-and-implementation-status)
  "Authority"), so no reconciling migration was needed for the merge.
  Reporting (Phase 9) is on its own branch.
- Evidence and confidence: high; `git merge-base --all` before the merge
  (a1aebf6 and 3f09d22), the merge commit's parents; the gates on the
  merged tree are in [NOW.md](../NOW.md).
- Workaround or containment: each integration reruns every gate on the
  merged tree.
- Next action: push `feat/p8-labels` and `feat/p10-shopify` (the latter
  contains labels and main), open the labels PR against `main` and then
  the Shopify PR (or the Shopify PR alone, which contains labels), let CI
  and the `e2e` label run, and merge.
- Revisit trigger: the labels or Shopify PR merges.
- Last checked: 2026-10-06 (the merge of `feat/p8-labels` into
  `feat/p10-shopify`).

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
- Status and owner: open; build agent (Phase 10), owner (a development
  store).
- Trigger: Phase 10 and go-live of the online channel.
- Impact: Phase 10 step 1 built the inbound database side (webhook
  recording, the queue, order and refund processing, D80–D89) and step 2
  the outbound sync's database side (what to push, the queue, the results);
  step 3 the service layer (the GraphQL and fake adapters, the webhook and
  cron routes, the queue and sync runners); step 4 the screens (Phase 10
  is complete; E2E journey 5 runs against the in-memory fake only).
  Everything is tested against payloads written from Shopify's documented
  REST shapes (`tests/fixtures/shopify.ts`), never against a real store,
  so payload and API drift would not be caught: in particular whether a
  tax-inclusive store's refund line `subtotal` includes tax
  (`private.shopify_refund_line_amount`), whether refund transactions
  carry shop money, and the order-edit case of
  [R-044](#r-044--an-edited-order-with-a-discounted-line-records-a-lower-price).
- Evidence and confidence: high; `tests/db/shopify-webhooks.test.ts` uses
  only fixture payloads; no store credentials exist.
- Workaround or containment: unknown or malformed payloads fail safe:
  nothing is recorded and the event waits for an admin
  (`shopify_payload_invalid`, D82).
- Next action: the owner provides a development store; the build agent
  works through
  [RUNBOOK "Verify before go-live"](RUNBOOK.md#shopify-verify-before-go-live)
  (added in step 3) and records the results there; the outbound calls'
  own unverified assumptions are
  [R-047](#r-047--the-live-shopify-adapter-is-unverified-against-a-real-store).
- Revisit trigger: a development store is connected; Shopify's pinned API
  version changes.
- Last checked: 2026-10-06, Phase 10 step 3.

## R-012 — Label printer hardware is unknown

- Category: unverified assumption.
- Status and owner: open; owner (printer models).
- Trigger: Phase 8 (labels) and Phase 12 (hardware adapter).
- Impact: [SPEC §16](SPEC.md#16-label-printing) forbids hard-coding a
  printer protocol before inspecting BICII's printers. Phase 8 shipped the
  `browser` and `pdf` adapters only (`network_raw` and `bluetooth` exist
  in the enum but `printer_profiles_adapter_available` refuses them) and
  58 × 40 mm built-in templates, a size not checked against BICII's label
  stock; a hardware adapter is Phase 12 and waits for the printer models.
- Evidence and confidence: high; `src/lib/printing/adapters/` (browser,
  pdf), `supabase/migrations/20261004003800_labels.sql`; journey 3 prints
  ten labels through the PDF adapter and journey 4 one through the browser
  adapter (`tests/e2e/inventory.spec.ts`,
  `tests/e2e/consignment-journey.spec.ts`, Phase 8 step 4).
- Workaround or containment: browser print (AirPrint on iPad/iPhone) or
  the PDF profile; admins add templates for other label sizes and offsets
  per printer in Labels and printers ([RUNBOOK "Label printers"](RUNBOOK.md#label-printers)).
- Next action: owner names the label printer models and label sizes;
  Phase 12 then builds the hardware adapter.
- Revisit trigger: the printer models are known, or Phase 12 starts.
- Last checked: 2026-10-05.

## R-013 — Changing the QR base leaves printed labels on the old address

- Category: compromise (D9 decided by Phase 8,
  [ADR-017](decisions/ADR-017-labels-and-qr-base.md)).
- Status and owner: open (residual); owner (the public address), build
  agent (procedures).
- Trigger: an admin changes `shop_settings.public_site_url` after labels
  were printed, or the public site moves.
- Impact: the QR base is now `shop_settings.public_site_url`, computed only
  by `private.qr_payload` with no fallback (decided 2026-10-05, Phase 8
  step 1). Labels already printed keep encoding the address they were
  printed with; after a change they open the old address unless the old
  site redirects `/q/{short_id}`, and the Admin scanner accepts them only
  if that base is still one of `scanBases()` (the database base and the
  environment's `NEXT_PUBLIC_PUBLIC_SITE_URL`). Until an admin sets a valid
  address nothing prints (`public_site_url_invalid`), which is intended.
- Evidence and confidence: high; `private.qr_payload` and
  `shop_settings_public_site_url_check` in
  `supabase/migrations/20261004003800_labels.sql`;
  `tests/db/labels.test.ts` ("QR payload (D9)"). Since Phase 8 step 2 the
  Admin displays QR URLs from the same column (`getQrBase()` / `qrUrl()`
  in `src/lib/qr.ts`, "QR address not set" when unusable) and scans both
  bases (`scanBases()`): `tests/unit/qr-base.test.ts` (parity with
  `tests/fixtures/qr-bases.ts`), `tests/unit/qr-base-sources.test.ts`, and
  `tests/e2e/print-view.spec.ts`, whose environment base
  (`http://localhost:4001`) differs from the seeded database base
  (`http://localhost:4000`): the product page shows the database URL and
  manual entry accepts both. Phase 8 step 4: journeys 3 and 4 assert every
  printed payload (print view and PDF link) equals the database base
  exactly (`tests/e2e/inventory.spec.ts`,
  `tests/e2e/consignment-journey.spec.ts`).
- Workaround or containment: keep the old public address redirecting
  `/q/*`, and keep the old address as the environment's
  `NEXT_PUBLIC_PUBLIC_SITE_URL` so the Admin scanner still accepts its
  labels; reprint labels after a move (Print again keeps the history).
- Next action: none in the app for the residual; the RUNBOOK says to set
  the address before the first print and not to change it casually. Only
  one earlier address can be accepted through the environment; more would
  need a list of retired bases (not planned).
- Revisit trigger: the public site's address changes; Phase 11 builds the
  public `/q` route.
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
- Phase 11 (2026-10-06): still open. Customers will create their own
  records on the public site, so the gap now covers self-registered
  customers too; D122 keeps that to people who book (a sign-in alone
  creates no record), which limits how much is collected.
- Last checked: 2026-10-06.

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
- Phase 11 (2026-10-06): unchanged. The public site offers Cancel (until
  D37's cutoff) and a new booking; it says to cancel and book again to
  change a time, and sends nothing to the customer.
- Last checked: 2026-10-06.

## R-018 — Four sections are placeholder pages

- Category: known limitation.
- Status and owner: open; build agent (Phase 9). Consignment stopped
  being a placeholder in Phase 6 step 3, Purchasing in Phase 7 (on the
  main line since the integration on `feat/p7-purchasing`) and Labels in
  Phase 8 (the print history, printing from the record pages, and Labels
  and printers); Reports remains. The heading is kept so links stay valid.
- Trigger: staff open Reports.
- Impact: the page renders the `ComingSoon` component
  (`src/components/shell/coming-soon.tsx`), which names the phase it
  arrives in; none of its features exist on this branch.
- Evidence and confidence: high; `src/app/(staff)/reports/page.tsx`.
- Workaround or containment: none.
- Next action: Phase 9 (other worktree).
- Revisit trigger: each phase ends.
- Last checked: 2026-10-05.

## R-019 — ADR-001 names versions the code does not use

- Category: known defect (documentation).
- Status and owner: accepted; build agent.
- Trigger: reading ADR-001 A1 as the current stack.
- Impact: ADR-001 names Next.js 16.2 and the `qrcode` package;
  `package.json` has `next` 16.3.8 and `react` 19.2.8. `qrcode` is
  installed since Phase 8 step 2 (1.5.4, with `pdf-lib` 1.17.1 and
  `@pdf-lib/standard-fonts` 1.0.0), so only the version names differ.
  ADR-001 is kept as the historical record.
- Evidence and confidence: high; `package.json` on 2026-10-05 (Phase 8
  step 2; unchanged at the end of Phase 8, step 4).
- Workaround or containment: `package.json` is authoritative for versions;
  [ARCHITECTURE.md](ARCHITECTURE.md#current-system) states the installed
  versions, and ADR-001's status lines point to it and to the later
  decision records.
- Next action: none; a later decision record supersedes ADR-001 A1 only if
  the stack choice itself changes.
- Revisit trigger: the stack choice itself changes.
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
- Status and owner: accepted (D49, build default, owner to confirm; D85
  applies it to online refunds); owner, with Phase 9's refund-reporting
  row (in D100–D119).
- Trigger: an admin or a manager records a refund on a sale
  (`record_sale_refund`, D94), a Shopify refund is recorded
  (`process_shopify_refund`, Phase 10), or staff restock a sold unit
  (`restock_unit`).
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
  ledger; refunds are for admins and managers (D94) and capped at the sale
  total (D49). Since
  Phase 6 step 4 the sale page's Yield card says "Refunds and restocks do
  not change these figures yet", the Sales list marks Partly refunded /
  Refunded and Restocked, and `tests/e2e/sales.spec.ts` shows a partial
  refund on the sale and in the list.
- Next action: Phase 9 decides the refund-reporting row (in D100–D119) for
  retail and online refunds together; Phase 10's online refunds net
  nothing either (`tests/db/shopify-webhooks.test.ts` proves
  `financial_lines` unchanged by an online refund).
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
- Phase 11's attachment access review (2026-10-06): customers never read
  consignment-item attachments. The customer Storage policy (D124) admits
  only bike and job photos marked customer or public, and D52 keeps
  agreement photos internal; the staff-side question above is unchanged.
- Last checked: 2026-10-06.

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

## R-028 — The main-line decision range D43–D59 is exhausted

- Category: process gap.
- Status and owner: resolved 2026-10-06; orchestrator.
- Trigger: the next main-line phase needs a new D-row (for example
  Shopify, Phase 10, or Phase 9 reporting's refund row).
- Impact: [PLAN §6](PLAN.md#6-open-decisions-for-the-owner) reserved
  D43–D59 for this line and D60 and up for the purchasing track (D60–D66
  on `feat/p7-purchasing`). Phase 8 took D56–D59, the last four numbers,
  so there was no free main-line number; a later phase picking one on its
  own risked a collision at the integration step.
- Evidence and confidence: high. Resolved by the orchestrator's allocation
  of 2026-10-06, now stated in PLAN §6's introduction,
  [decisions/README.md](decisions/README.md), AGENTS.md's maintenance
  contract and [ENGINEERING.md](ENGINEERING.md): D60–D69 purchasing,
  D70–D79 staff email sign-in, D80–D89 Shopify (used by Phase 10, ADR-020),
  D90–D99 staff roles, D100–D119 Phase 9 reporting, D120–D139 Phase 11
  public site, D140 and up later; ADR-018 to ADR-023 likewise; and the
  RISKS ranges in AGENTS.md (R-028–R-029 labels, R-030–R-034 purchasing,
  R-035–R-039 email sign-in, R-040–R-049 Shopify, R-050–R-054 roles,
  R-055–R-064 reporting, R-065–R-074 public site). At the merge of `main`
  into `feat/p10-shopify` (2026-10-06) the D-rows and records met without a
  collision (D56–D59, D60–D66, D70–D72, D80–D89, D90–D94); the labels
  risks numbered R-030–R-032 before the ranges existed collided with
  purchasing's and became R-075–R-077, with every link updated.
- Workaround or containment: none needed.
- Next action: none; each phase uses only its own range.
- Revisit trigger: a phase exhausts its range.
- Last checked: 2026-10-06 (the merge of `feat/p8-labels` into
  `feat/p10-shopify`).

## R-029 — The purchase receive screen has no "Print N labels" shortcut yet

- Category: compromise (integration deferred).
- Status and owner: resolved at the merge of `main` into `feat/p8-labels`
  (2026-10-06); build agent. The heading is kept so links stay valid.
- Trigger: staff receive a purchase order and want labels for what came in.
- Impact: Phase 8 built labels where purchasing (Phase 7) did not exist.
  Now that both are on this branch, receiving returns to the order, and
  every line of the order's **Receipts** has "Print N labels" (N = the
  quantity received): the product page with its print sheet open at that
  count (`printLabelsPath`, the `?print=1&qty=N` deep link the record pages
  already read). A purchase line is always a counted product (D62), so the
  label is the product's; above 500 the sheet prints 500 and says how many
  remain (D56). Nothing is printed until staff press Print, so a receipt
  never creates a print job by itself. The lost-response banner of the
  receive screen ("This delivery was recorded …") links to the order, where
  the shortcut is.
- Evidence and confidence: high; `src/app/(staff)/purchasing/(browse)/orders/[id]/page.tsx`,
  `src/lib/printing/links.ts` (`tests/unit/printing/job.test.ts` "links");
  journey 3's receiving step in `tests/e2e/purchasing.spec.ts` clicks
  "Print 18 labels" on the receipt and finds the sheet at "Print 18
  labels".
- Workaround or containment: none needed.
- Next action: none.
- Revisit trigger: receiving gains unique items (a unit per label, D57).
- Last checked: 2026-10-06.

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
- Phase 11 (2026-10-06): the public site asks for codes with
  `shouldCreateUser: true` (D120), so once sign-ups are on, every address
  gets a code and a login and the answer reveals nothing on that path.
  The staff path and a direct API call with `shouldCreateUser: false`
  behave as above. Until the owner turns sign-ups on, the public site
  shows one message for every refused address.
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

## R-040 — Shopify webhook payloads hold customer personal data until purged by hand

- Category: data protection gap.
- Status and owner: open; owner (retention), build agent.
- Trigger: any Shopify order or refund webhook.
- Impact: `integration_events.payload` keeps each order's body as
  received, with the buyer's name, email, addresses and phone, for as long
  as the row exists. Only admins can read it (D86, RLS), but nothing
  removes it automatically: the owner-only
  `private.purge_integration_events(older_than)` (at least 30 days) must be
  run by hand, and failed or pending events are never purged (D88). This
  adds to [R-016](#r-016--no-retention-or-deletion-policy-for-customer-personal-data).
  The payload is also what recognises a dismissed refund delivered again
  under a new webhook id (D87: a dismissal is final, matched on the
  refund id in the stored payload): after its payload is purged, such a
  redelivery of a refund of a recorded sale would be recorded. Orders are
  matched on the stored order gid, which a purge keeps. Shopify retries
  keep their webhook id, so this needs a new id at least 30 days later.
- Evidence and confidence: high;
  `supabase/migrations/20261004003900_shopify_integration.sql` (no cron);
  `tests/db/shopify-webhooks.test.ts` "Webhook evidence is immutable".
- Workaround or containment: admin-only access; the purge function;
  rejected deliveries never store a body.
- Next action: the owner decides a retention period (owner question 4);
  OPERATIONS then schedules the purge.
- Revisit trigger: go-live of the online channel; a deletion request.
- Last checked: 2026-10-06.

## R-041 — An online order for more consigned stock than one consignment holds fails

- Category: deliberate limitation (D45).
- Status and owner: accepted; owner.
- Trigger: an online order line for a consignment-owned quantity product
  whose quantity is more than any single active consignment has at the
  online location, although several consignments together would cover it.
- Impact: a sale line draws from exactly one consignment item (D45/D54),
  so `private.sell_line` refuses the line and the whole order is not
  recorded; it waits as `shopify_insufficient_stock` or
  `shopify_sale_refused` for an admin, who records it by hand as two sales
  lines or refunds it in Shopify (D82).
- Evidence and confidence: high; `tests/db/shopify-webhooks.test.ts`
  "Consignment sale creates correct liability and yield" (the second order
  of two jerseys when one is left).
- Workaround or containment: keep consigned quantity stock online only
  from one consignment at a time, or sell it in store.
- Next action: none unless it happens; revisit with D45.
- Revisit trigger: the first such order.
- Last checked: 2026-10-06.

## R-042 — Earlier online sales keep no customer after a Shopify customer is linked

- Category: deliberate limitation (D86).
- Status and owner: accepted; build agent (Phase 9 reports, the sales
  list).
- Trigger: an admin links a BICII customer to a Shopify customer who
  already has online sales.
- Impact: a recorded sale is immutable except its status (Phase 6,
  `sales_enforce_rules`), so the link applies only to orders recorded after
  it; earlier online sales keep `customer_id` null and carry only
  `sales.shopify_customer_id`. Any list or report keyed on
  `sales.customer_id` misses them until the screens join through
  `customers.shopify_customer_id` (step 4).
- Evidence and confidence: high; `link_shopify_customer` returns
  `earlier_online_sales`; `tests/db/shopify-webhooks.test.ts` "Customer
  linking is explicit".
- Workaround or containment: the link's result says how many earlier sales
  exist.
- Step 4 (built): the sale page shows "<customer> (linked through
  Shopify)" for such a sale, and the event inspector shows the linked
  customer through the same id. Not yet: the Sales list still says
  "Walk-in" for them, and the customer page does not list their online
  sales. The customer link is proven by the database tests and the unit
  tests of its wording, not by an E2E test (linking a seeded customer
  would be permanent across runs).
- Next action: the Sales list and the customer page join through
  `customers.shopify_customer_id`; Phase 9 reports join the same way.
- Revisit trigger: Phase 9 customer reports; staff asking why an online
  sale shows Walk-in.
- Last checked: 2026-10-06 (Phase 10 step 4).

## R-043 — Phase 9 must widen the integration exceptions function

- Category: integration debt.
- Status and owner: open; the build agent of Phase 9.
- Trigger: Phase 9 appends its columns (`issue, short_id, title, detail,
  amount, currency`) to `reporting.operational_exceptions`.
- Impact: Phase 10 built `private.integration_exceptions()` in Phase 5's
  nine-column shape and added it to the view with `union all`; a Phase 9
  replacement of the view that widens only the other branches fails to
  create, or drops the integration rows if the branch is forgotten.
- Evidence and confidence: high;
  `supabase/migrations/20261004004000_shopify_order_processing.sql`,
  DATA-MODEL §14; Phase 9 is not built on this branch.
- Workaround or containment: none needed until Phase 9.
- Next action: Phase 9 replaces `private.integration_exceptions()` with
  the wider columns in the same migration that widens the view, and keeps
  `tests/db/shopify-webhooks.test.ts` "Integration failures are
  operational exceptions" green.
- Revisit trigger: Phase 9 or the integration step.
- Last checked: 2026-10-06.

## R-044 — An edited order with a discounted line records a lower price

- Category: shortcut (D80), unverified against Shopify.
- Status and owner: open; build agent (step 3, with a development store).
- Trigger: an order edited in Shopify after payment so that a discounted
  line's `current_quantity` is below its `quantity`.
- Impact: BICII records `price × current_quantity − Σ the line's discount
  allocations`. If Shopify keeps the allocations of the original quantity,
  the recorded line total is lower than what the remaining items were
  charged, understating sales, yield and Cult Commons for that order (a
  fully removed line is ignored and correct).
- Evidence and confidence: medium; the rule is in
  `process_shopify_order_paid`; no real edited-order payload has been
  inspected (R-011).
- Workaround or containment: order edits after payment are rare; the sale
  shows Shopify's order name, so staff can compare with Shopify.
- Next action: inspect an edited order on a development store; if
  allocations are not adjusted, prorate them by `current_quantity /
  quantity` in the one place the line total is computed.
- Revisit trigger: a development store is connected.
- Last checked: 2026-10-06.

## R-045 — The Buy-online link follows overall availability, not online stock

- Category: deliberate shortcut (D84).
- Status and owner: accepted for now; build agent (Phase 11 decides how it
  shows the link), owner.
- Trigger: a published, synced product whose stock is only at a location
  other than the online location (e.g. all units in the workshop store).
- Impact: `reporting.public_items.availability` counts stock and units at
  every location, and `buy_online_url` follows the row's availability, so
  the public page can show **Buy online** while Shopify, which only sees
  the online location (D83), shows the item sold out. The shopper reaches
  a sold-out Shopify page; no sale is recorded wrongly (an order BICII
  cannot fulfil waits for an admin, D82). Since the Phase 10 review the
  link never sells something other than the page shows: a unit row gets
  it only when it is the unit an online order takes (the oldest
  available, non-customer-owned, non-archived unit at the online
  location, D81), and a unique product's row only when its shown price
  equals the online price. What remains is only this sold-out case, on a
  product (quantity) row.
- Evidence and confidence: high; the view definition in
  `20261004004100_shopify_product_sync.sql` and
  `tests/db/shopify-sync.test.ts` "Buy online link" and "links only what
  Shopify sells".
- Workaround or containment: keep online stock at the online location;
  staff move stock with a transfer.
- Next action: Phase 11 or the owner decides whether the link should
  require stock at the online location (a column change only, in the one
  view).
- Revisit trigger: Phase 11 builds the public `/q` page, or the shop keeps
  sellable stock at a second location.
- Last checked: 2026-10-06, Phase 10 review fixes.

## R-046 — The product-sync queue is coarse

- Category: deliberate shortcut (D83, D84).
- Status and owner: accepted for now; build agent (step 3 measures it).
- Trigger: busy online periods, frequent stock changes, products that were
  pushed and then unpublished.
- Impact: `product_sync_state.orders_in_flight` is shop-wide: any orders/paid
  event of the last 10 minutes that is pending (or failed with its job
  queued or running) reports an order in flight for every product, so the
  worker may defer stock pushes of unrelated products by up to a few
  minutes. A product pushed once keeps being queued on every change after
  it is unpublished (`private.enqueue_product_sync` queues anything pushed
  before), so the worker runs syncs that end `unchanged`. Neither records
  anything wrong; both cost Shopify API calls and delay.
- Evidence and confidence: medium; the rules are in
  `20261004004100_shopify_product_sync.sql`; no volume has been measured
  (no store, R-011).
- Workaround or containment: one queued job per product and the desired
  hash keep repeats cheap; the worker skips the push when the hash is
  unchanged.
  Step 3 measured the cost rather than volume: a sync whose desired hash
  equals the last push makes **no** Shopify call (proven in
  `tests/unit/shopify-sync.test.ts` and `tests/db/shopify.stack.test.ts`),
  so the repeat syncs of an unpublished, drafted product cost one
  `product_sync_state` read and one `record_product_sync_result` each.
  Every online order, though, costs one extra 2-minute deferral of its
  product's next push: the order lowers Shopify's count before BICII
  records it, so the push's compare quantity (the last pushed quantity) is
  stale once, and the worker waits before overwriting (D83, step 3's
  `runProductSync` step 7).
- Next action: kept as built in step 3 (no database change); revisit the
  in-flight scope (only orders naming the product's variant) and the
  per-order deferral (compare with Shopify's count less the order just
  recorded) after measuring on a development store.
- Revisit trigger: Shopify API throttling or visible delay in a development
  store.
- Last checked: 2026-10-06, Phase 10 step 3.

## R-047 — The live Shopify adapter is unverified against a real store

- Category: validation gap (D83, D84).
- Status and owner: open; build agent, owner (a development store).
- Trigger: the first connection to a real store; a Shopify API version
  upgrade.
- Impact: `src/lib/integrations/shopify/graphql-admin.ts` was written from
  Shopify's documentation without a store to run it against. Assumptions
  that could be wrong: the `productSet` input shape (`productOptions`,
  `variants[].optionValues`, the SKU on `inventoryItem.sku`, media through
  `files`); `inventorySetQuantities`' compare field `changeFromQuantity`
  (older versions: `compareQuantity` plus `ignoreCompareQuantity`), its
  stale-compare error codes (`CHANGE_FROM_QUANTITY_STALE`,
  `COMPARE_QUANTITY_STALE`) and the `@idempotent(key:)` directive; whether
  a product created by productSet is stocked at the online location before
  the first inventory write; whether productSet without a variant price
  keeps the price; the `locations` query's `isActive`. A wrong field name
  fails every push as `shopify_bad_response` (retried, then needs
  attention after 8 attempts); a wrong stale code would make a moved count
  a non-retriable `shopify_user_error` instead of the 2-minute deferral.
  No money or stock is recorded wrongly: the ledger never depends on a
  push. A further hazard is configuration: a Preview deployment runs on
  the staging database, whose short IDs and so Shopify handles
  (`bicii-<short id>`) repeat production's, and a product with no sync
  row is upserted by handle; with the live store's token, a preview's
  Publish online or Sync now would overwrite a live product with staging
  data. The RUNBOOK gives Preview no live-store values, and the client
  keeps the live adapter off when `VERCEL_ENV=preview` unless
  `SHOPIFY_ALLOW_PREVIEW=true` (set only for a development store;
  `tests/unit/shopify-fake-admin.test.ts` "which Shopify a deployment
  talks to").
- Evidence and confidence: medium; `tests/unit/shopify-graphql-admin.test.ts`
  proves what BICII sends and how it maps answers, against a mocked fetch
  only. The idempotency key is BICII's own: a UUID-shaped SHA-256 of the
  inventory item, desired hash, job id and phase (deviation from the
  brief's `${productId}:${hash}`, so Sync now and a retry after a moved
  count are not swallowed by Shopify's idempotency replay).
- Workaround or containment: the fake adapter for every test and E2E;
  Shopify is off until the variables are set.
- Next action: work through
  [RUNBOOK "Verify before go-live"](RUNBOOK.md#shopify-verify-before-go-live)
  on a development store and correct the documents and the tests together.
- Revisit trigger: a development store exists; `SHOPIFY_API_VERSION`
  changes; Preview deployments get Shopify variables.
- Last checked: 2026-10-06, Phase 10 review fixes.

## R-048 — The rejected-delivery limit is per server instance

- Category: deliberate shortcut (D88).
- Status and owner: accepted for now; build agent.
- Trigger: a burst of unsigned or wrongly signed POSTs to
  `/api/shopify/webhooks`.
- Impact: the limit of 30 stored rejected deliveries a minute is an
  in-memory sliding window in each server process
  (`SlidingWindowLimiter` in `webhooks.ts`). On Vercel every function
  instance has its own window and a cold start resets it, so a burst
  spread over many instances can store more than 30 a minute (each bad
  body is still one row with a delivery count, D88, and never a payload).
  Above the limit deliveries are only logged
  (`shopify_rejected_rate_limited`), so a real misconfiguration during a
  burst leaves fewer rows to inspect.
- Evidence and confidence: high; `tests/unit/shopify-webhook-handler.test.ts`
  "the 31st rejected delivery".
- Workaround or containment: the platform's own firewall or rate limiting
  in front of the route; the owner purges rejected rows by hand
  (`private.purge_integration_events`).
- Next action: if hosted logs show rejected bursts, move the limit into
  the database (a count of rejected rows in the last minute in
  `record_shopify_webhook`) or the platform firewall.
- Revisit trigger: hosted deployment; any rejected-delivery burst in the
  logs.
- Last checked: 2026-10-06, Phase 10 step 3.

## R-049 — Queued integration jobs wait for a trigger

- Category: operational dependency (D87).
- Status and owner: open; owner (the Vercel plan), build agent.
- Trigger: a Vercel Hobby plan; a quiet shop; a failed result write.
- Impact: nothing runs jobs on its own except the cron
  (`/api/cron/integrations`, every 5 minutes in `vercel.json`) and the
  work after each webhook (its own event, then up to 5 due jobs). Vercel's
  Hobby plan allows only crons that run at most once a day and **fails
  the deployment** of a more frequent one, so with `vercel.json` as
  committed the Admin cannot deploy on Hobby at all; the Hobby fallback is
  a daily schedule in `vercel.json` plus an external scheduler. Without
  that scheduler a retry backing off a minute, a deferred stock push
  (D83) or a refund waiting for its order can wait until the next
  webhook, staff action or the daily run. A runner claims a job only
  while that job's worst case (four Shopify calls at the 10 s timeout plus
  5 s) still ends 5 s before the function's `maxDuration` (60 s), so a
  slow Shopify no longer runs a claimed job past the limit
  (`tests/unit/shopify-cron-route.test.ts` "the runner's time budget").
  If the platform stops the function anyway, or a runner cannot store a
  result (the database unreachable), the job stays `running` and is
  reclaimed only after 10 minutes.
- Evidence and confidence: high for the Hobby limit: Vercel's page
  "Cron jobs: usage and pricing" (last updated 2026-07-15) says
  expressions that run more than once a day fail during deployment on
  Hobby; not checked against the owner's account (no Vercel project,
  R-001).
- Workaround or containment: a Pro plan, or on Hobby a daily schedule plus
  an external scheduler calling the cron route with the bearer every 5
  minutes ([RUNBOOK](RUNBOOK.md#shopify-the-cron-and-the-queue)); staff
  Retry and Sync now run their job immediately.
- Next action: the owner chooses the Vercel plan before the first
  deployment of this branch (RUNBOOK "Verify before go-live" item 9).
- Revisit trigger: the Vercel project is created.
- Last checked: 2026-10-06, Phase 10 review fixes.

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

## R-065 — A mistyped customer email lets someone else claim that record

- Category: security concern (non-exploitable summary; D121).
- Status and owner: accepted for MVP; owner to confirm with question 30.
- Trigger: staff save a customer with an email address that belongs to
  someone else, and that person signs in on the public site.
- Impact: the website links their login to that record (D121), so they see
  its bikes, customer-visible photos, jobs and appointments, and can book
  under it. Costs, notes and other staff-only data stay hidden (ADR-003).
- Evidence and confidence: high; `claim_my_customer` in
  `20261006103000_public_site.sql`; `tests/db/public-site.test.ts` ("links
  the one unlinked record with the same email").
- Why accepted: the code email proves the person controls that address,
  which is the address the shop recorded; two records with one address
  link nothing (`customer_link_ambiguous`).
- Workaround or containment: staff check the email at intake; a wrong link
  is undone by clearing the record's login link in the database (no
  screen yet) and correcting the email.
- Next action: the owner answers question 30; if wanted, an Admin screen
  shows and removes a customer's website login.
- Revisit trigger: the first wrong link reported, or the owner's answer.
- Last checked: 2026-10-06.

## R-066 — Anyone can create a website login

- Category: accepted compromise (D120, D122).
- Status and owner: accepted for MVP; build agent.
- Trigger: the owner turns on "Allow new users to sign up" for the public
  site's accounts.
- Impact: anyone who can read a code sent to an address can create a
  Supabase Auth login. A login with no customer record sees nothing but the
  public pages, and the Admin refuses it (no staff row), but the logins
  accumulate in Auth, and every booking by a new login adds a customer
  record staff will see.
- Evidence and confidence: high for the behaviour; ADR-003's staff-only
  base tables and `requireStaff`; `claim_my_customer` creates records only
  with `create_if_missing` (`tests/db/public-site.test.ts`).
- Why accepted: SPEC §18 asks for customer sign-up; codes keep logins tied
  to real mailboxes, and Auth's rate limits and D37's booking limits bound
  the volume.
- Workaround or containment: archive unwanted customer records in the
  Admin; delete stray logins in the Supabase dashboard.
- Next action: none until abuse is seen; a captcha on the code request is
  the next step if it is.
- Revisit trigger: unexpected customer records or Auth sign-ups.
- Last checked: 2026-10-06.

## R-067 — The public site depends on this repository's RPC shapes

- Category: dependency.
- Status and owner: open; build agent.
- Trigger: a migration changes the columns or arguments of a `my_*` RPC,
  `available_slots`, `bookable_slots`, `public_appointment_types`,
  `public_shop_hours`, `claim_my_customer` or `reporting.public_items`.
- Impact: the public site (repository `bicii`) breaks on the next deploy or
  as soon as the migration is applied, because it is a second client of
  the same database with no copy of the schema.
- Evidence and confidence: high; DATA-MODEL "Integration contracts" and
  §15–§16 list the contract; the public site keeps its own row types for
  these calls.
- Workaround or containment: the contract functions only ever gain columns
  at the end and keep their arguments; journey 6 in the public site's CI
  runs against this repository's `main`.
- Next action: run the public site's CI after any change to these objects.
- Revisit trigger: any migration that touches them.
- Last checked: 2026-10-06.

## R-075 — Label output is unverified on a real label printer and on iOS

- Category: verification gap.
- Status and owner: open; owner (a test print on the shop's printer).
  Phase 8 step 3 added the record pages' print sheet and the printers'
  calibration offsets (editable in Labels and printers); still nothing has
  been printed on a printer.
- Trigger: the first real print on the shop's label printer, from an
  iPhone or iPad (browser print) or through the PDF (Share → Print).
- Impact: the label sheet and the PDF are tested in Chromium and in code
  (`tests/unit/printing/`: every element inside the label, the QR decoded
  back to the exact payload with ZXing from a rasterised SVG; the PDF's
  page size and link; `tests/e2e/print-view.spec.ts`: one label per page
  under print media; `tests/e2e/labels.spec.ts`: 10 labels with the exact
  payload, a 50 × 30 mm template's `@page` size, `window.print` stubbed;
  Phase 8 step 4's journey 3: ten labels through the PDF adapter, the PDF
  fetched as `application/pdf` with ten pages and ten identical link URIs,
  the PDF tab opened in Chromium and closed), never on a printer. Unknowns: whether iOS Safari
  honours `@page { size: 58mm 40mm; margin: 0 }` for a label printer or
  scales the page; whether the device draws "Helvetica, Arial" with the
  Helvetica metrics the layout was measured with (a wider substitute is
  clipped at the label edge, never spilled); how a 500-label job
  (`<use>` copies of one label) behaves on an older iPad.
- Evidence and confidence: medium; `src/lib/printing/compose.ts`,
  `label-svg.tsx`, `adapters/`; no printer in the build environment.
- Workaround or containment: the PDF profile (exact page size, standard
  fonts) when browser print scales; printer offsets (±5 mm, per profile)
  for a shifted print; staff confirm or fail every job (D59), so a bad
  print is recorded and reprinted.
- Next action: a test print of each built-in template on the shop's
  printer from an iPad, both profiles, before go-live; note the result in
  the RUNBOOK's labels section.
- Revisit trigger: the first real print, or Phase 12's hardware adapter.
- Last checked: 2026-10-05.

## R-076 — Print success is confirmed by hand

- Category: operational shortcut (D59, by design).
- Status and owner: open; owner (whether staff keep up with confirming),
  build agent (Phase 12's hardware adapter).
- Trigger: staff press Print (or Open PDF) and walk away without answering
  "Did all N labels print correctly?".
- Impact: a browser cannot report whether the printer succeeded
  (`window.print()` returns nothing; a PDF tab tells the app nothing), so a
  job stays `rendered` until someone marks it printed or failed. Unconfirmed
  jobs accumulate under Labels → To confirm; the record's "price changed
  since the last printed label" warning (D58) counts only confirmed
  (`printed`) jobs, so an unconfirmed reprint does not clear it.
- Evidence and confidence: high; `src/components/domain/print-job-controls.tsx`
  (Print then the confirmation), `listPrintJobs` filter `open`
  (`src/lib/domain/labels.ts`), `lastPrintedPrice` (status `printed`);
  journeys 3 and 4 (Phase 8 step 4) confirm their jobs by hand after Open
  PDF and Print.
- Workaround or containment: the confirmation appears on the print view
  right after Print and again on the job's page; To confirm lists every
  open job with who started it; nothing reprints automatically.
- Next action: owner decides whether To confirm needs a count on Today or
  a periodic clean-up; Phase 12's network adapter can report success
  itself.
- Revisit trigger: To confirm regularly holds more than a day's prints, or
  Phase 12.
- Last checked: 2026-10-05.

## R-077 — One Phase 8 commit is undocumented and fails E2E on its own

- Category: process gap (commit history, not code).
- Status and owner: open; the orchestrator (who opens the pull request).
- Trigger: `git bisect` or a review stepping through `feat/p8-labels`
  commit by commit.
- Impact: commit `41c1a5c` (step 3's screens: the print sheet, the Labels
  card, the record pages' Print label and `/settings/labels`) changes no
  file under `docs/` and not NOW.md, against the AGENTS.md contract (docs
  "in the same commit as the code"); the docs arrive in the next commit,
  `abe7e6c`. At `41c1a5c` `npm run test:e2e` is also red: the Labels card's
  `<ul aria-label="Units to label">` matches `getByRole("list", { name:
  "Units" })` (Playwright matches names as case-insensitive substrings) in
  `tests/e2e/inventory.spec.ts` and `sales.spec.ts`, a strict-mode
  failure; `abe7e6c` renames it "Unit labels". Business semantics are
  untouched and the branch head is complete and green.
- Evidence and confidence: high; `git show --stat 41c1a5c` (21 files, all
  under `src/` and `tests/`), `git show abe7e6c` (the docs and the rename),
  the Phase 8 review.
- Workaround or containment: none needed in the tree.
- Next action: when the pull request is opened, squash `41c1a5c` and
  `abe7e6c`, or say in its documentation-impact answer that `41c1a5c`'s
  documentation and the E2E selector fix are in `abe7e6c`, so bisecting
  does not stop on a red, undocumented commit.
- Revisit trigger: the Phase 8 pull request.
- Last checked: 2026-10-05.
