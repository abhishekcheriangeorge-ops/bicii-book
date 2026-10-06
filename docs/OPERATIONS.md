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
| Email delivery (SMTP) | Auth email: staff sign-in codes (D10), later customer codes (Phase 11) | **Not set up**; a custom SMTP provider is required on every hosted project ([RUNBOOK](RUNBOOK.md#hosted-supabase-projects-staging-and-production)) | Unknown | Nobody can sign in ([R-039](RISKS.md#r-039--hosted-email-delivery-and-auth-settings-are-unverified)) |
| Shopify store | Phase 10 integration | None connected | Unknown | n/a ([R-011](RISKS.md#r-011--shopify-is-not-built-and-will-be-fixture-tested-only)) |
| Label printer | Phase 8 and 12 | Models unknown | Unknown | n/a ([R-012](RISKS.md#r-012--label-printer-hardware-is-unknown)) |

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
| Local devstack | http://localhost:3000 (`npm run dev`); E2E serves a production build on :3100 | `bicii_dev` on Postgres 16 at 127.0.0.1:5432 | Supabase Auth :9999, PostgREST :3001, Storage :5000 behind the gateway :54321; public local demo keys; no email, no Shopify | `npm run devstack:env` writes `.env.local`; shell variables for the scripts ([ENGINEERING.md](ENGINEERING.md#prerequisites-and-access)) |
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

**Roles** (D90-D94, [ADR-021](decisions/ADR-021-staff-roles.md)). Every
person is an Admin, a Manager or a Mechanic. Admins have every permission
and the admin-only settings; managers every permission except Manage
staff, and record refunds; mechanics the workshop only. Anything more for
one person is **Extra access**, an exception on top of their role.

**Invite staff** (admin, or `manage_staff` within the D11 ceiling, D93:
non-admins invite Mechanics only;
[ADR-005](decisions/ADR-005-staff-sign-in-and-delegation.md)).
Settings → Staff → Invite staff; fill Name and Email (their real mailbox:
they sign in with it). An admin picks the Role (Admin, Manager or
Mechanic; Mechanic is chosen first); anyone else sees "They join as a
Mechanic." and no picker. Press Invite.
Expected: "<email> can now sign in.", "They join as a <Role>." and "They
open BICII Admin, enter this email and type the 6-digit code we email
them. No password needed." No
password is created or shown (D10,
[ADR-019](decisions/ADR-019-staff-email-sign-in.md)); tell the person to
open the Admin and ask for a code. Verify: they sign in with the emailed
code and Today opens; then **Set extra access** (**Open their page** for an
admin). Refused with "An account
with that email already exists." when the email is taken (a deactivated
colleague is reactivated instead). Whoever controls the invited mailbox
controls that login. (`tests/e2e/staff.spec.ts`, `tests/e2e/roles.spec.ts`,
`tests/e2e/auth.spec.ts`.)

**Change a role** (admin only, never their own, D93). Settings → Staff →
the person → Role: pick Admin, Manager or Mechanic → Change role…; the
sheet "Change <name> to <Role>?" says what the new role has, which extra
access it already includes (removed with the change, D92) and what they
lose; optionally answer Why? (up to 500 characters) → Change role.
Expected: "<name> is now a <Role>"; the badge shows the new role; History
reads "Role changed from <From> to <To>" with the actor and reason, and
"Extra access: <Permission> removed" for each exception the new role
includes. Changing back does not restore removed extra access. Refused on
their own row ("You can't change your own role.", the picker is off) and
when no active admin would remain ("The shop must keep at least one active
admin."). Non-admins see the role read-only. (`tests/e2e/roles.spec.ts`;
the rules: `tests/db/staff-roles.test.ts`.)

**Extra access** (grant or remove a permission as an exception; admin, or
`manage_staff` on mechanics only). Settings → Staff → the person → Extra
access → the switch for the permission. The card first says what the role
includes ("Included in the Manager role: …"); those are never switches.
An admin's card has none ("Admins have every permission; there is nothing
extra to grant."); a manager's offers only Manage staff; a mechanic's all
seven. Expected: toast "… granted" or "… removed"; History reads "Extra
access: … granted" (or removed) with who made it.
Verify: the person's Settings → Your profile lists it, marked Extra access.
A non-admin can grant only permissions they hold, never Manage staff, and
only to mechanics. (`tests/e2e/staff.spec.ts`, `tests/e2e/roles.spec.ts`.)

**Deactivate or reactivate** (same reach as Extra access: a non-admin acts
on mechanics only, D93).
Settings → Staff → the person → Deactivate…, give the reason, confirm
"Deactivate <name>". Expected: "<name> deactivated"; their Auth sessions
are ended in the same step and any page they still have open loses access
at once (D71); the reason is in Staff history. The database refuses
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

**Consignment access** (a manager's role includes it; for a mechanic, extra access as above; D48,
[ADR-016](decisions/ADR-016-consignment-and-sales.md)). Settings → Staff →
the person → Extra access → the Manage consignments switch. It lets them add and edit
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

**Record a refund** (an admin or a manager; D94, amending D49). Sales → the sale → Record refund;
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

**Purchasing access** (extra access as above; D60,
[ADR-018](decisions/ADR-018-purchasing.md)). Settings → Staff → the person
→ Extra access → the Manage purchasing switch. It lets them add, edit and archive
suppliers and their product links, create, submit and cancel purchase
orders, receive deliveries and create reorder drafts, and it shows them
purchase costs on purchasing screens (line, receipt and last costs, order
totals and history) but no job, sale, product-page or report cost.
Managers hold it through their role, with View costs (D91); granting it as
extra access to a mechanic is the exception D60 describes
([R-034](RISKS.md#r-034--a-manage_purchasing-exception-shows-unit-costs-on-purchasing-screens)).
Verify: Purchasing shows New order, Receive and Reorder. (Mechanic view and
the 403s: `tests/e2e/purchasing.spec.ts`; the grants:
`tests/db/purchasing-access.test.ts`.)

**Correct a delivery** (`manage_purchasing`, plus `adjust_stock`; D65). A
recorded delivery is never edited. A wrong count: Inventory → the product
→ Adjust stock with a reason naming the PO; if the supplier will still
send the rest, change the line's ordered quantity on the order. A wrong
actual cost has become the product's cost: someone with View costs and
Manage inventory edits the product's cost
([R-030](RISKS.md#r-030--a-wrong-delivery-cannot-be-reversed-only-adjusted)).
Not covered by an E2E spec; the immutability and adjustments are covered
by `tests/db/purchasing.test.ts` and `tests/db/inventory-ledger.test.ts`.

**Archive a supplier** (`manage_purchasing`). Purchasing → Suppliers →
the supplier → Archive. Refused while the supplier has a draft, submitted
or partially received order ("This supplier still has open orders. Receive
or cancel them first."). Archived suppliers are hidden from pickers and
searched only in the archived list. Not covered by an E2E spec;
`tests/db/purchasing-access.test.ts` covers the rule.

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

**Reports and exports** (D30, D100–D105,
[ADR-022](decisions/ADR-022-reporting.md)). Reports (More on a phone)
shows Activity and jobs by mechanic to everyone; sales, yield and Cult
Commons figures need View financial reports, costs inside them View
costs (managers hold both by role). Every table has Export CSV: a
snapshot of the moment, at most 50,000 rows for period exports, 200 for
exceptions and 1,000 for reconciliation, refused rather than cut short
([R-057](RISKS.md#r-057--csv-exports-stop-at-50000-rows-and-refuse-when-figures-change-mid-export)).
(`tests/e2e/reports.spec.ts`, `tests/e2e/exceptions.spec.ts`.)

**Who sees which exception** (D108). Reports → Exceptions (and Today's
Needs attention) list, for every active staff member, overdue and
uncollected jobs, stock below zero, stale holds, lines in another
currency and items in an impossible state; unsettled consignments only
with Manage consignments or View costs (admins and managers by role, or
extra access); Shopify failures (Phase 10) only admins. One database
function decides it for the list, the counts and Today. Verify: mechanic2
(no extra access) sees no Unsettled consignments section
(`tests/e2e/exceptions.spec.ts`; the rule: `tests/db/operational-exceptions.test.ts`).

**Unsettled-consignment threshold** (admin; D107). Reports → Exceptions →
Change beside "Alert unsettled consignments after N days" → 1 to 365 →
Save. A sold consignment item with money still owed becomes an exception
when its latest sale is more than N shop days old (30 by default). The
change is recorded in the schedule history like other shop settings; the
same value again changes nothing. Verify: the toast and the new sentence
(`tests/e2e/exceptions.spec.ts`).

**Stock reconciliation** (any staff; D106). Inventory → Reconcile stock.
Read only: it compares each unique item's status and location, and the
unit counts per product and location, with the movement ledger. Fix a
problem through its record (Adjust stock with a reason, restock, settle,
void, return); what to do per issue is in
[RUNBOOK](RUNBOOK.md#when-reconciliation-or-exceptions-show-a-problem).

Escalation for any of these: the owner (George). A refusal message comes
from the database's rules; quote it exactly.

Missing administration capabilities (none exists in the code on
2026-10-06): no customer messaging, no appointment
reschedule (cancel and rebook;
[R-017](RISKS.md#r-017--appointments-mvp-has-no-reschedule-and-no-customer-messages)),
no customer data deletion
([R-016](RISKS.md#r-016--no-retention-or-deletion-policy-for-customer-personal-data)),
no deletion of consignor data and no history of changes to a consignor's
payout details
([R-026](RISKS.md#r-026--consignor-personal-and-payout-details-are-kept-indefinitely-with-no-change-history)),
no reverse-receipt for a wrong delivery
([R-030](RISKS.md#r-030--a-wrong-delivery-cannot-be-reversed-only-adjusted)),
and Labels is a placeholder
([R-018](RISKS.md#r-018--four-sections-are-placeholder-pages)). The only
data exports are the report CSVs.

## Technical operation

Each procedure is in RUNBOOK. Last exercised: **never** for every hosted
procedure (no hosted project exists, 2026-10-05).

- [Hosted Supabase projects: staging and production](RUNBOOK.md#hosted-supabase-projects-staging-and-production):
  for staff sign-in by emailed code (D10, D70–D72) it covers the custom
  SMTP provider (required; the built-in sender mails only the project's
  team), the code-only email templates in `supabase/templates`, OTP length
  6 and expiry 600 s, sign-ups off, Auth's rate limits (60 s between
  emails to one address; per-IP sign-in and verification limits of at
  least 150 per 5 minutes, above the Admin's own D72 limits), "Secure
  password change" on, and the **required pre-deploy password reset**:
  before the release that switches sign-in to codes, replace every staff
  login's password with a random secret's hash and end their sessions,
  after SMTP has delivered a code to the owner
  ([R-035](RISKS.md#r-035--logins-created-before-email-codes-keep-a-known-password-until-the-pre-deploy-reset)).
- [Applying migrations to a hosted project](RUNBOOK.md#applying-migrations-to-a-hosted-project),
  including what to do if `20261005005000_staff_session_revocation`
  refuses to apply (its role must be able to delete Auth sessions, D71).
- [Creating the first admin in a hosted project](RUNBOOK.md#creating-the-first-admin-in-a-hosted-project)
- [Rotating keys and passwords](RUNBOOK.md#rotating-keys-and-passwords)
- [Vercel environment setup](RUNBOOK.md#vercel-environment-setup)
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
  `.devstack/logs/{mail,auth,rest,storage,gateway}.log`; sign-in codes
  sent locally are in `.devstack/mail/`. Common local failures:
  [ENGINEERING.md](ENGINEERING.md#debugging-and-common-setup-failures).
- **CI:** a failed `test` job prints the last devstack log lines; a failed
  `e2e` uploads the Playwright report, traces and devstack logs for 14 days.

| Symptom | User impact | Where to look | First safe diagnostic | Escalation |
|---|---|---|---|---|
| "Sign-in is unavailable right now. Try again in a minute." | Nobody can sign in | The Admin's errors `auth.request_code` / `auth.verify_code` with `limit: "admin"`: their `cause` is `no_service_role_key` (`SUPABASE_SERVICE_ROLE_KEY` unset), `rpc_error` with a code (a wrong key gives `42501` or an API-key error; otherwise the `note_sign_in_attempt` RPC or the database failed) or `request_failed`; without `limit: "admin"`, the Auth log (`.devstack/logs/auth.log` locally) | Hosted: check `SUPABASE_SERVICE_ROLE_KEY` in Vercel matches the project's current secret key, then the Supabase status; locally: `npm run devstack:status` | Engineering |
| Staff report that no sign-in code arrives | That person cannot sign in | Auth logs for `over_email_send_rate_limit`; the Admin's warnings `auth.request_code`; the SMTP provider's sending log (hosted) | Send a code to the owner's address (hosted: Users → Send magic link; locally: the mail catcher) | Engineering, then the owner (SMTP provider) |
| "You don't have permission to do that." or a 403 page | One task blocked | The person's permissions in Settings → Staff | Compare with [USER-GUIDE "Roles and limits"](USER-GUIDE.md#roles-and-limits) | Admin |
| CI `check:types` fails | PR cannot merge cleanly | Job log | `npm run db:types` locally | Engineering |

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
  (SMTP, email templates, rate limits) and environment variables would have
  to be re-entered from RUNBOOK and the password manager; until SMTP works
  again nobody can sign in.
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
  The stack and Phase 6 are merged into `main`; purchasing (PR #9) and
  email sign-in (PR #10, which contains purchasing) are integrated but
  unmerged, and labels and Shopify are on their own branches
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
