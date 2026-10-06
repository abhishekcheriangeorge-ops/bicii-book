# Administration and service operations

Owner: Abhishek Cherian George ("George", GitHub `abhishekcheriangeorge-ops`).
Last reviewed against live configuration: not possible; no hosted
environment exists (2026-10-05). The GitHub repository and its Actions runs
were checked through the REST API on 2026-10-05.

Nothing is deployed ([RISKS R-001](RISKS.md#r-001--nothing-is-deployed)).
This page therefore says what exists (a local devstack and CI), what does
not (staging and production), and which procedures wait for them.
Step-by-step procedures live in [RUNBOOK.md](RUNBOOK.md); setup and
commands in [ENGINEERING.md](ENGINEERING.md).

## Start here

- Service or dashboard: none hosted. Code and CI:
  https://github.com/abhishekcheriangeorge-ops/bicii-book (Actions tab).
- Routine administration in the app: [Product administration](#product-administration).
- Something is broken: on a developer machine, `npm run devstack:status`
  and the logs under `.devstack/logs/` ([Diagnosis](#diagnosis-and-alerts));
  in CI, the failed job's log and, for `e2e`, its uploaded report.
- Escalation: the owner for business and account questions; the build agent
  (engineering) for code. Give the commit, the command or screen, and the
  exact message; never paste keys, passwords or customer data.
- Support expectation: none agreed. Best effort.

## Ownership, access, and obligations

| Service or account | Purpose | Owner and access | Billing | If it fails |
|---|---|---|---|---|
| GitHub repository `abhishekcheriangeorge-ops/bicii-book` (public; 0 issues) | Code, pull requests, CI on GitHub Actions | George (owner account) | Not checked | No CI and no review history |
| GitHub Actions (`ci.yml`, `e2e.yml`) | `check`, `test (unit + db)`, `build`; Playwright | Same repository; no secrets configured or needed | Not checked | Changes merge unverified |
| Supabase hosted projects `bicii-staging`, `bicii-prod` | Database, Auth, Storage for previews and production | **Not set up** | n/a | n/a until created |
| Vercel project | Hosting the Admin | **Not set up** | n/a | n/a |
| Domain, DNS | Admin and public site addresses | None known for the Admin | Unknown | n/a |
| Email delivery (SMTP) | Auth email, needed by the planned email OTP sign-in | None | n/a | OTP cannot work ([R-004](RISKS.md#r-004--staff-sign-in-change-pending-email-otp)) |
| Shopify store and its custom app | Phase 10 integration: online orders and refunds in, product price and stock out | None connected; the custom app's token and webhook secret go into Vercel Production only (`SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`, `SHOPIFY_SHOP_DOMAIN`; [RUNBOOK](RUNBOOK.md#shopify)). Preview gets no live-store values: Shopify off, or a separate development store with `SHOPIFY_ALLOW_PREVIEW=true` | Unknown | Online orders wait in the queue (Shopify retries refused webhooks); syncs retry ([R-011](RISKS.md#r-011--shopify-is-not-built-and-will-be-fixture-tested-only), [R-047](RISKS.md#r-047--the-live-shopify-adapter-is-unverified-against-a-real-store)) |
| Vercel cron (`vercel.json`) | Runs due integration jobs every 5 minutes behind `CRON_SECRET` (D87) | Not set up (no Vercel project) | The 5-minute schedule needs a Pro plan: on Hobby a sub-daily cron **fails the deployment**, so Hobby needs a daily schedule in `vercel.json` plus an external 5-minute scheduler ([RUNBOOK](RUNBOOK.md#shopify-the-cron-and-the-queue)); choose the plan before the first deployment | Retries and deferred syncs wait for the next webhook or staff action ([R-049](RISKS.md#r-049--queued-integration-jobs-wait-for-a-trigger)) |
| Label printer | Phase 8 and 12 | Models unknown; Phase 8 prints through the browser or a PDF (untested on a real printer, [R-030](RISKS.md#r-030--label-output-is-unverified-on-a-real-label-printer-and-on-ios)). Printing needs `shop_settings.public_site_url` set ([RUNBOOK](RUNBOOK.md#labels-the-qr-address-before-the-first-print)) | Unknown | Nothing prints while the address is unset ([R-012](RISKS.md#r-012--label-printer-hardware-is-unknown), [R-013](RISKS.md#r-013--changing-the-qr-base-leaves-printed-labels-on-the-old-address)) |

Not established: account custody (organisation or personal ownership), a
second owner or emergency access route, MFA recovery custody, billing
owner, cost limits, and an access review. Who becomes the product
administrator and the technical operator is an owner question
([PRODUCT.md](PRODUCT.md#open-assumptions-and-owner-questions), question 5).
Branch protection on `main` could not be read (HTTP 403;
[R-010](RISKS.md#r-010--e2e-is-not-a-required-check-and-branch-protection-is-unverified)).

This repository is public: never record credentials, recovery codes, hosted
URLs or keys here. When hosted projects exist, their secrets go into the
Vercel environment and a password manager as
[RUNBOOK "Vercel environment setup"](RUNBOOK.md#vercel-environment-setup)
and ["Rotating keys and passwords"](RUNBOOK.md#rotating-keys-and-passwords)
describe (planned; never exercised).

## Environment map

| Environment | App | Database | Auth, Storage, integrations | Configuration source |
|---|---|---|---|---|
| Local devstack | http://localhost:3000 (`npm run dev`); E2E serves a production build on :3100 | `bicii_dev` on Postgres 16 at 127.0.0.1:5432 | Supabase Auth :9999, PostgREST :3001, Storage :5000 behind the gateway :54321; public local demo keys; no email; Shopify off, or the in-memory fake with `SHOPIFY_ADAPTER=fake` (E2E sets it) | `npm run devstack:env` writes `.env.local`; shell variables for the scripts ([ENGINEERING.md](ENGINEERING.md#prerequisites-and-access)) |
| CI (GitHub Actions) | `next build`; `next start` on :3100 for E2E | A `postgres:16` service container per job | The devstack with the local demo keys; no secrets | [`ci.yml`](../.github/workflows/ci.yml): `check`, `test (unit + db)`, `build` on pull requests (opened, synchronize, reopened), pushes to `main` and manual dispatch. [`e2e.yml`](../.github/workflows/e2e.yml): pull requests labelled `e2e`, nightly at 02:23 Singapore time, manual dispatch |
| Preview / staging | **Not set up** | `bicii-staging` planned | Planned | [RUNBOOK](RUNBOOK.md#hosted-supabase-projects-staging-and-production) |
| Production | **Not set up** | `bicii-prod` planned | Planned | [RUNBOOK](RUNBOOK.md#vercel-environment-setup) |

Scheduled workflows and push triggers run from the default branch, and
`main` is still the initial commit (1594c78, no workflows): on 2026-10-05
GitHub reported 0 scheduled and 0 push runs. Until the PR stack merges, CI
runs only on pull requests.

Configuration reference: every variable name, with its exposure and
purpose, is in [`.env.example`](../.env.example);
[PLAN §4](PLAN.md#4-environment-and-secrets) says where each belongs.
Hosted Auth settings, redirect URLs and exposed API schemas are listed in
[RUNBOOK "Hosted Supabase projects"](RUNBOOK.md#hosted-supabase-projects-staging-and-production).

## Product administration

Done in the app by an admin, or by a staff member holding the named
permission. These tasks were exercised only on developer machines and in
CI, by the E2E spec named in each task; where a step has no E2E spec, the
task says so. Labels are as on screen.

**First run** (the first admin, once per hosted project, before staff use
the app; never exercised on a hosted project). After
[creating the first admin](RUNBOOK.md#creating-the-first-admin-in-a-hosted-project):
1. Settings → Labels and printers → set the shop's public website address
   before printing any label; nothing prints until it is set, and changing
   it later orphans printed labels
   ([RUNBOOK](RUNBOOK.md#labels-the-qr-address-before-the-first-print)).
2. Set up the appointment schedule
   ([RUNBOOK](RUNBOOK.md#appointments-schedule-before-go-live)).
3. Make a test print on the shop's label printer
   ([RUNBOOK "Label printers"](RUNBOOK.md#label-printers)).
4. Invite staff (below).

**Shopify data retention** (owner, by hand; D88): webhook bodies keep
customer details until purged with `private.purge_integration_events`
([RUNBOOK](RUNBOOK.md#shopify-purging-old-webhook-data)); no retention
period is set yet ([R-040](RISKS.md#r-040--shopify-webhook-payloads-hold-customer-personal-data-until-purged-by-hand)).
**Who administers the Shopify integration** (D86): admins only for the
event inspector, the queue (retry, dismiss with a reason), variant and
customer links (with a reason) and the settings (online location,
storefront URL, `accept_test_orders` with a reason), because payloads hold
customer data; staff with `manage_inventory` publish products online, run
Sync now and retry product-sync jobs; every staff member sees each
product's sync status. Screens: **More → Shopify** (admins: settings,
queue, products, events) and the product page's **Online (Shopify)** card
([USER-GUIDE](USER-GUIDE.md#publish-a-product-online)). Connecting
the store, secrets, the cron and the go-live checks:
[RUNBOOK "Shopify"](RUNBOOK.md#shopify).

**Invite staff** (admin, or `manage_staff` within the D11 ceiling:
non-admins invite role Staff only;
[ADR-005](decisions/ADR-005-staff-sign-in-and-delegation.md)).
Settings → Staff → Invite staff; fill Name and Email, choose the Role
(admins only), press Invite. Expected: "<email> can now sign in." and a
"Temporary password: shown once" with Copy password; give it to the person
through a private channel. Verify: they sign in and change it under
Settings → Your profile (Current password, New password, Repeat new
password, Change password). Refused with "An account with that email
already exists." when the email is taken. (`tests/e2e/staff.spec.ts`.)
This changes to email sign-in when the OTP work merges
([R-004](RISKS.md#r-004--staff-sign-in-change-pending-email-otp)).

**Grant or remove a permission** (same roles). Settings → Staff → the
person → the switch for the permission. Expected: toast "… granted" or
"… removed"; the change appears in their Staff history with who made it.
Verify: the person's Settings → Your profile lists it under their
permissions. A non-admin can grant only permissions they hold, never
Manage staff. (`tests/e2e/staff.spec.ts`.)

**Deactivate or reactivate** (same roles; never an admin by a non-admin).
Settings → Staff → the person → Deactivate…, give the reason, confirm
"Deactivate <name>". Expected: "<name> deactivated"; their open session
loses access at once; the reason is in Staff history. The database refuses
to leave the shop without an active admin. (`tests/e2e/staff.spec.ts`.)

**Services and prices** (`manage_inventory`). Settings → Services → New
service, or a service to edit or archive. **Cult Commons rate** (admin;
visible with View costs; D21,
[ADR-004](decisions/ADR-004-cult-commons.md)): Settings → Services →
Cult Commons → Schedule a new rate; enter the Rate and when it Starts
(now, or a Singapore time in the future: "Start this rate now" or "Schedule
this rate"). Rates are never edited or backdated; a scheduled rate can be
cancelled before it starts. Each line keeps the rate in force when it was
added. Coverage: New service is driven by
`tests/e2e/workshop-board.spec.ts`; editing or archiving a service and the
Cult Commons rate screens are not covered by any E2E spec (that spec only
checks that a mechanic without View costs sees no "Schedule a new rate").
`schedule_cult_commons_rate` and `cancel_cult_commons_rate` are covered by
the database tests `tests/db/workshop-catalog.test.ts` and
`tests/db/work-order-lines.test.ts`.

**Shop hours, closures and booking capacity** (admin; every staff member
can read them). Settings → Shop hours and closures: Weekly hours, Booking
capacity → Edit, Add closure. **Appointment types** (admin): Settings →
Appointment types → New type. Before real bookings follow
[RUNBOOK "Appointments: schedule before go-live"](RUNBOOK.md#appointments-schedule-before-go-live).
Existing bookings never move; affected ones are flagged and staff call the
customers. (`tests/e2e/appointment-settings.spec.ts`.)

**Stock locations** (`manage_inventory`). Settings → Locations → Add
location (Name, Sort order). Switch a location off when it holds nothing;
it is then no longer offered for stock. (`tests/e2e/inventory-publish.spec.ts`.)

**Consignment access** (grant as for any permission above; D48,
[ADR-016](decisions/ADR-016-consignment-and-sales.md)). Settings → Staff →
the person → the Manage consignments switch. It lets them add and edit
consignors, receive and return items, add and void charges, record and
reverse payments, archive consignors and read consignors' payout details
(Show payout details); with View costs instead they see consignment money
but cannot change it or read payout details. Restocking a consigned unit
needs Manage consignments as well as Adjust stock (D46). Verify: the
consignor page shows Record payment and Show payout details. Without
either permission a member sees counts only, never who is owed money.
(Mechanic views: `tests/e2e/consignment.spec.ts`,
`tests/e2e/consignment-journey.spec.ts`; the grants:
`tests/db/consignment-access.test.ts`.)

**Record a refund** (admin only; D49). Sales → the sale → Record refund;
the Amount starts at what is left to refund; press "Record refund of
$x…", give the reason, confirm "Refund $x". Expected: "Refund of $x
recorded" and the sale reads Partly refunded or Refunded. A refund is money
only: nothing goes back into stock; if the item came back, restock it from
its unit page (Restock, with a reason). Refused with "That's more than is
left to refund on this sale." above the remaining amount.
(`tests/e2e/sales.spec.ts`.)

**Reverse a consignor payment** (`manage_consignments`; D47). Consignment
→ the consignor → Payments → Reverse… on the payment, give the reason,
confirm "Reverse payment". Expected: "Payment reversed"; the payment stays
listed as reversed and the balance goes back up. A payment is never edited
or deleted: reverse it and record the right one. Not covered by an E2E
spec; `reverse_settlement` is covered by `tests/db/settlements.test.ts`.

**Archive a consignor** (`manage_consignments`; D47). Consignment → the
consignor → Archive → "Archive consignor…" → "Archive consignor". Only a
consignor with no item still with the shop and a balance of exactly 0 can
be archived; otherwise the refusal says what is left (sell or return the
items; pay what is owed; an overpayment clears with a later sale, by
voiding a consignor-paid charge or by reversing a payment). An archived
consignor takes in no new items, and their sold items are not restocked
and their jobs not reopened until they are unarchived. Not covered by an
E2E spec; the rules are covered by `tests/db/settlements.test.ts`,
`tests/db/consignment.test.ts`, `tests/db/sales.test.ts` and
`tests/db/consignment-job-parts.test.ts`.

**The QR address, printers and label templates** (admin only; D9,
D56–D59, [ADR-017](decisions/ADR-017-labels-and-qr-base.md)). Settings →
Labels and printers. **QR codes point to** shows the shop's public website
address (`shop_settings.public_site_url`) that every label encodes as
`{address}/q/{short id}`; while it is unset or malformed it says "Not set —
labels cannot be printed" and every Print label is disabled. Change
address → type it → Review the change → Change the address. Expected: "QR
address saved". Changing it orphans labels already printed: they keep
opening the old address, so keep a redirect there
([R-013](RISKS.md#r-013--changing-the-qr-base-leaves-printed-labels-on-the-old-address));
scans of the environment's address (`NEXT_PUBLIC_PUBLIC_SITE_URL`) stay
accepted by the app's scanner. Printers: rename, calibration offsets (0.5
mm steps, −5 to 5), switch off, Make default, Add printer (browser print or
PDF; the type is fixed once created). Label templates per kind: size, QR,
fields and text with a preview; Make default; a default cannot be switched
off. (`tests/e2e/labels.spec.ts` covers adding a template, printing with it
and switching it off, the address shown, and the 403 for a mechanic; the
address change itself is not driven by E2E because every spec shares one
database: `tests/unit/printing/schemas.test.ts` and `tests/db/labels.test.ts`
cover its rule.)

Escalation for any of these: the owner (George). A refusal message comes
from the database's rules; quote it exactly.

Missing administration capabilities (none exists in the code on
2026-10-05): no data export screen, no customer messaging, no appointment
reschedule (cancel and rebook;
[R-017](RISKS.md#r-017--appointments-mvp-has-no-reschedule-and-no-customer-messages)),
no customer data deletion
([R-016](RISKS.md#r-016--no-retention-or-deletion-policy-for-customer-personal-data)),
no deletion of consignor data and no history of changes to a consignor's
payout details
([R-026](RISKS.md#r-026--consignor-personal-and-payout-details-are-kept-indefinitely-with-no-change-history)),
and Purchasing and Reports are placeholders
([R-018](RISKS.md#r-018--four-sections-are-placeholder-pages)).

## Technical operation

Each procedure is in RUNBOOK. Last exercised: **never** for every hosted
procedure (no hosted project exists, 2026-10-05).

- [Hosted Supabase projects: staging and production](RUNBOOK.md#hosted-supabase-projects-staging-and-production)
- [Applying migrations to a hosted project](RUNBOOK.md#applying-migrations-to-a-hosted-project)
- [Creating the first admin in a hosted project](RUNBOOK.md#creating-the-first-admin-in-a-hosted-project)
- [Rotating keys and passwords](RUNBOOK.md#rotating-keys-and-passwords)
- [Vercel environment setup](RUNBOOK.md#vercel-environment-setup)
- [Shopify](RUNBOOK.md#shopify): the custom app, webhooks, environment,
  the cron and queue, API version upgrade, secret rotation, verify before
  go-live, purging old webhook data
- [CI](RUNBOOK.md#ci): the `e2e` label exists and has run on PRs #2 to #7;
  required checks on `main` are unverified (R-010).

## Releases

None yet. The intended order, from
[RUNBOOK "Vercel environment setup"](RUNBOOK.md#vercel-environment-setup)
step 5, is: `supabase db push` to staging, check a preview, `db push` to
production, then promote or merge to `main`; migrations stay backward
compatible with the running app. This order has never been exercised.
Required checks before a release: `check`, `test (unit + db)` and `build`
green, and `e2e` (label) green. Identifying the deployed commit: not
applicable until a Vercel project exists.

## Diagnosis and alerts

No monitoring, uptime check, error tracker or alert recipient exists. An
outage would be noticed by a user. There is no incident record location
([R-002](RISKS.md#r-002--no-backups-monitoring-alerting-or-exercised-recovery)).

- **Application logs:** pino JSON lines to stdout (`src/lib/logger.ts`),
  level from `LOG_LEVEL` (default `info`); `src/instrumentation.ts`
  forwards request errors. No retention is configured anywhere.
- **Correlation:** `proxy.ts` sets `x-request-id` on each request, the
  server Supabase client passes it to PostgREST as `x-correlation-id`, and
  event rows store it
  ([ADR-001 A8](ADR-001-architecture.md#a8-observability)). To trace one
  request, match the log line's id with the event rows' correlation id.
- **Local devstack:** `npm run devstack:status`; logs in
  `.devstack/logs/{auth,rest,storage,gateway}.log`. Common local failures:
  [ENGINEERING.md](ENGINEERING.md#debugging-and-common-setup-failures).
- **CI:** a failed `test` job prints the last devstack log lines; a failed
  `e2e` uploads the Playwright report, traces and devstack logs for 14 days.

| Symptom | User impact | Where to look | First safe diagnostic | Escalation |
|---|---|---|---|---|
| "Sign-in is unavailable right now. Try again in a minute." | Nobody can sign in | Auth log (`.devstack/logs/auth.log` locally) | `npm run devstack:status` | Engineering |
| "You don't have permission to do that." or a 403 page | One task blocked | The person's permissions in Settings → Staff | Compare with [USER-GUIDE "Roles and limits"](USER-GUIDE.md#roles-and-limits) | Admin |
| CI `check:types` fails | PR cannot merge cleanly | Job log | `npm run db:types` locally | Engineering |
| An online order is missing from Sales, or a product's Shopify stock is stale | Online sale not recorded or Shopify oversells | Admins: Today's exceptions ("Shopify needs attention") and `/shopify/queue`; logs `shopify webhook` / `shopify product sync` lines by correlation id | Is the cron running (`/api/cron/integrations` answers 401 without the bearer, 503 without `CRON_SECRET`)? Are webhooks answering 200? | Admin, then engineering ([RUNBOOK](RUNBOOK.md#shopify-resolving-problems)) |

## Recovery

All of the following is **untested**. No recovery has ever been exercised.

- **Application rollback:** once a Vercel project exists, redeploy or roll
  back to an earlier deployment in Vercel. `NEXT_PUBLIC_*` values are built
  into the bundle, so a changed value needs a new build, not a rollback.
  A rollback does not undo a migration; check compatibility first.
- **Database recovery:** no backups exist. Hosted backup coverage depends on
  a Supabase plan that has not been chosen. Never exercised.
- **Storage objects (photos):** stored separately from the database tables;
  a database restore would not restore them (inferred). No backup. Never
  exercised.
- **Configuration and external state:** none hosted. Hosted Auth settings
  and environment variables would have to be re-entered from RUNBOOK and the
  password manager.
- **Acceptable data loss and recovery time:** not agreed (owner question 6
  in [PRODUCT.md](PRODUCT.md#open-assumptions-and-owner-questions)).
- **Last isolated recovery exercise:** never.

Before any recovery exercise, identify the exact backup and a separate
disposable destination project with appropriate access controls. Check
which target the restore writes to: an in-place restore can overwrite it.
Never use production as the exercise destination. Disable or route to test
modes anything with outside effects (email, Shopify webhooks, scheduled
jobs) before running the restored system, and record verification and
cleanup.

## Routine maintenance and leaving the project paused

- **Pinned versions:** the devstack components in
  [`scripts/devstack/config.mjs`](../scripts/devstack/config.mjs) (CI
  rebuilds its cache when one changes) and the Supabase CLI `supabase@2.119.0`
  (type generation and the RUNBOOK commands). Application dependencies are
  pinned by `package-lock.json`; updates are made by the build agent on a
  branch and must pass CI. No update schedule is set.
- **Demo data:** `npm run db:reset` moves the demo's "today" on a developer
  machine; it has no effect anywhere else.
- **Paused state:** nothing hosted runs, so nothing costs money for the
  Admin itself; GitHub plan and Actions billing were not checked (unknown).
  Open pull requests #1 to #7 are drafts awaiting the owner
  ([R-009](RISKS.md#r-009--the-seven-pr-stack-is-unmerged-and-the-purchasing-track-forks-from-pr-6)).

## Responsibility boundaries

- Owner (George): business decisions, account creation and custody,
  hosted projects, billing, first admin, branch protection.
- Engineering (the build agent, or a successor): code, migrations, tests,
  CI, and these documents.
- Product administration in the app: admins, and staff with Manage staff
  within its ceiling.
- Who operates hosted systems (deploys, restores, rotates keys): **not
  assigned**.
