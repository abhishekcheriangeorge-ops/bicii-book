# Current state

Updated: 2026-10-06, Phase 9 (reporting and reconciliation) step 3 of 4,
the database for stock reconciliation and the extended operational
exceptions, on `feat/p9-reporting`
(created from `feat/staff-roles` at 5c9fbc7, which is equal to
`origin/feat/staff-roles`), in the second worktree
`/home/user/bicii-book-wt`. Before that, steps 1 (the database) and 2
(the report screens and CSV export) and the staff roles on
`feat/staff-roles`. Evidence checked: `git status` (clean
after the commits), `git worktree list` (`/home/user/bicii-book` on
`feat/p10-shopify`, this worktree on `feat/p9-reporting`), no
`origin/feat/p9-reporting` (nothing pushed), and the local gates below.
Earlier rows keep the evidence of their own phase.

## Return in two minutes

- Purpose: the staff Admin for BICII's workshop, over one Supabase backend
  shared with the public site ([PRODUCT.md](docs/PRODUCT.md)).
- Current objective: staff sign in with emailed one-time codes on the
  whole main line. `origin/feat/p7-purchasing` (current `main` 6042e6e plus
  purchasing) is merged into `feat/auth-email-otp` (a merge commit, no
  rebase), so this branch is main + purchasing + email codes and PR #10
  merges after PR #9. No password sign-in path remains: main's API test
  helper and the seeded customer login were moved to codes. Decisions D10
  (rewritten), D70–D72, record
  [ADR-019](docs/decisions/ADR-019-staff-email-sign-in.md), risks R-035 to
  R-039. Committed locally, not pushed.
- Next action: the orchestrator runs CI with the `e2e` label on PRs #9
  and #10 and merges #9 then #10 (`feat/p7-purchasing` 7fed53f and
  `feat/auth-email-otp` 85077c9 are pushed); after #10 merges it pushes
  `feat/staff-roles`, opens its pull request against `main` (body: the
  step 4 report's documentation-impact answer) and runs CI with the `e2e`
  label; then integrates labels (Phase 8) the same way. The owner answers
  questions 18 (confirm D70–D72), 19 (the SMTP provider) and 20 (confirm
  the staff-roles build defaults D92 and D93) in
  [PRODUCT.md](docs/PRODUCT.md#open-assumptions-and-owner-questions).
- Before any hosted deploy of this release: configure SMTP and run the
  REQUIRED password reset in
  [RUNBOOK](docs/RUNBOOK.md#hosted-supabase-projects-staging-and-production)
  ([R-035](docs/RISKS.md#r-035--logins-created-before-email-codes-keep-a-known-password-until-the-pre-deploy-reset),
  [R-039](docs/RISKS.md#r-039--hosted-email-delivery-and-auth-settings-are-unverified)).
- Staff roles (admin, manager, mechanic; owner decision 2026-10-06): built
  and committed locally on `feat/staff-roles`, not pushed (D90–D94,
  [ADR-021](docs/decisions/ADR-021-staff-roles.md)): the database
  (`private.role_implies`, exceptions, role administration, refunds for
  managers), the app's permission model and guards, the profile page, and
  the staff screens (role picker, Extra access, invites by role). D60 now
  covers only a mechanic holding `manage_purchasing` as an exception
  ([R-034](docs/RISKS.md#r-034--a-manage_purchasing-exception-shows-unit-costs-on-purchasing-screens));
  what stays open is R-050 to R-054.
- Phase 9 reporting, step 1 of 4 (database), committed locally on
  `feat/p9-reporting`, not pushed: `20261006001000_report_periods` and
  `20261006001100_report_stock_value` (D100–D105,
  [ADR-022](docs/decisions/ADR-022-reporting.md)): four date bases over
  `reporting.report_lines`, the summary, series, breakdown, line-item,
  activity and by-mechanic RPCs, stock value at last cost; refunds beside
  gross (D102, the build default for owner question 12); risks R-055 and
  R-056; owner question 21.
- Phase 9 reporting, step 2 of 4 (app), committed locally on
  `feat/p9-reporting`, not pushed: `/reports` (period and date-basis
  controls in the URL, figures with cost tiles hidden without View costs,
  refunds beside gross, buckets, the breakdown by seven dimensions, stock
  at last cost now, activity and jobs by mechanic), `/reports/lines` (one
  group's lines; View financial reports, a real 403) and the app's first
  Route Handler, the CSV export `/reports/export` (R-057: 50,000 rows at
  most, 409 when the counts move); `ComingSoon` placeholders at
  `/reports/exceptions` and `/reports/reconciliation`.
- Phase 9 reporting, step 3 of 4 (database), committed locally on
  `feat/p9-reporting`, not pushed: `20261006001200_stock_reconciliation`
  (no balance cache, D106: `reporting.unit_ledger_disposition`,
  `unit_reconciliation`, `stock_reconciliation`, the RPCs
  `report_stock_reconciliation` and `report_unit_reconciliation`) and
  `20261006001300_operational_exceptions` (the threshold
  `shop_settings.consignment_settlement_alert_days` and its admin RPC,
  D107; `private.exception_visible`, D108; the exceptions view and
  `public.operational_exceptions` with six appended columns and the kinds
  unit_state_mismatch, unsettled_consignment and integration_failed;
  `report_exception_counts`; Today's `exceptions_now` per caller; the
  Phase 10 placeholder `private.integration_exceptions()`, R-058). The seed
  reconciles unchanged; no RPC defect was found. Risks R-058 (re-verify at
  the Phase 10 merge) and R-059 (Today slow at a busy year's volume, mostly
  Phase 5's `daily_summary`); owner question 22. Next action: step 4, the
  `/reports/exceptions` and `/reports/reconciliation` screens over these
  RPCs (links to the guarded fixes, the threshold setting for admins,
  labels for the new kinds on Today), the `exceptions`, `stock` and
  `units` export kinds, and the phase closure.
- Main uncertainty: nothing hosted exists
  ([R-001](docs/RISKS.md#r-001--nothing-is-deployed)).

## What is actually working

CI runs `check`, `test (unit + db)` and `build` in one run per head; e2e is
a separate, label-triggered run. All listed results are success.

| Capability | Implemented | Verified and how | Deployed |
|---|---|---|---|
| Foundation and staff sign-in (password until the email sign-in integration) | Yes, PR #2 9106a01 | [CI](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37207471211), [e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37207644142/job/111452093165) | Not deployed |
| Customers, bikes, photos | Yes, PR #3 74fff3e | [CI](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37216112124), [e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37216116874/job/111476852853) | Not deployed |
| Workshop jobs | Yes, PR #4 8763e6b | [CI](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37231006487), [e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37231011044/job/111520439511) | Not deployed |
| Inventory | Yes, PR #5 9922441 | [CI](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37262357001), [e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37262379042/job/111612114525) | Not deployed |
| Today and financial engine | Yes, PR #6 d3e2101 | [CI](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37262369366), [e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37262380782/job/111612119938) | Not deployed |
| Appointments | Yes, PR #7 b34bbcd | [CI](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37276827625), [e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37276834195/job/111655595521); locally `npm test` 82 files / 1186 tests, `npm run check`, `check:types`, `test:e2e` 106 passed | Not deployed |
| Docs stack | Yes, merged in PR #8 (fbf8240; on `origin/main` 6042e6e) | Locally: docs link check, 33 files / 476 links, 0 problems; `npm run check` pass (after the review fixes) | Not deployed |
| Purchasing (Phase 7: suppliers, purchase orders, receiving, reorder; D60–D66) | Yes, `feat/p7-purchasing`: built through a0fc1d2 (pushed), integrated with `main` in the merge 06979ec, the documentation commit 6f71dd4 and the integration review fixes after it (local only) | Locally on the integrated branch (database `bicii_dev_wt`): `npm run db:reset` pass (42 migrations, `42\|20261005000500`, seed applied), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass (no diff), `npm test` 102 files / 1517 tests passed (unit 52 / 643, database 50 / 874), `npm run build` pass, `npm run test:e2e` 138 passed on phone and tablet (16.8 min, no failures, flaky or skipped), docs link check 35 files / 595 links / 0 problems. After the integration review fixes (reorder suggestions shop-owned only; product-page supplier costs need view_costs; docs): `npm run db:reset` pass (`42\|20261005000500`), `npm run db:types` no diff, `npm run check` pass, `npm run check:types` pass (no diff), `npm test` 102 files / 1518 tests passed (the strengthened consigned-reorder test failed against the unfixed migration), `npm run build` pass, `npm run test:e2e` 138 passed on phone and tablet (15.0 min, no failures, flaky or skipped), docs link check 35 files / 596 links / 0 problems | Not deployed |
| Staff email sign-in (one-time codes, D10, D70–D72: sessions end on deactivation, the Admin's own sign-in limits, a generic devstack mail catcher) | Yes, `feat/auth-email-otp`: built through 4b3eadd (pushed), integrated with main and purchasing in the merge 38db51b, the documentation commit 35d7a63 and the integration review fixes after it (local only) | Locally on the integrated branch (database `bicii_dev_wt`): `npm run db:reset` pass (44 migrations, `44\|20261005006000`, seed applied), `npm run db:types` no diff, `npm run check` pass, `npm run check:types` pass, `BICII_REQUIRE_STACK=1 npm test` 111 files / 1585 tests passed (unit 56 / 686, database 55 / 899), `npm run build` pass, `npm run test:e2e` 152 passed on phone and tablet (18.2 min, no failures, flaky or skipped; run before the new `seed-logins.test.ts` and the docs), docs link check 36 files / 641 links / 0 problems. After the integration review fixes (PLAN D11 and ADR-005 status wording, Chloe's seeded login in DATA-MODEL, the service-role key named as required for every sign-in in .env.example, env.ts, ARCHITECTURE, RUNBOOK, OPERATIONS and R-039, the sign-in throttle's logged `cause`, ENGINEERING's Validation evidence, the seed comment): `npm run check` pass, `npm run check:types` pass (no diff), `BICII_REQUIRE_STACK=1 npm test` 111 files / 1585 tests passed, `npm run build` pass, `npm run test:e2e` 152 passed on phone and tablet (15.7 min; a first run while the other worktree's E2E shared the CPUs had 1 failure, the phone consignment journey's "Void…" click lost right after "Charge added", which passed on the rerun), docs link check 36 files / 644 links / 0 problems | Not deployed |
| Consignment core and consigned job parts (Phase 6 step 1: D44, D45, D48, D50–D52) | Database only, `feat/p6-consignment` 13fe3f3, fe6ac53, 365bdd7; no screens yet | Locally on 365bdd7: `npm run db:reset` pass (34 migrations, `34\|20261004003400`), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 86 files / 1225 tests passed; `test:e2e` not run (no screen changed); docs link check 34 files / 506 links / 0 problems | Not deployed |
| Sales, restocks, refunds, settlements, consignor ledgers, sale reporting, read RPCs, search, Phase 6 seed (Phase 6 step 2: D44, D46–D49) | Database only, `feat/p6-consignment` 2d2ba0c, 2c402b2; no screens yet | Locally at 2c402b2 + docs: `npm run db:reset` pass (37 migrations, latest `20261004003700`, seed applied), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 89 files / 1298 tests passed, `npm run build` pass, `npm run test:e2e` 106 passed (phone and tablet, 9.7 min), docs link check 34 files / 509 links / 0 problems | Not deployed |
| Consignment screens and consigned job parts (Phase 6 step 3: D4, D27 changed, D44–D48, D50–D52) | Yes, `feat/p6-consignment` 2137316, 5627bb0, ecc90f1 and the step 3 docs commit: `/consignment` (consignors, items), `/consignment/consignors/[id]`, `/consignment/items/[id]`, intake, terms, charges, returns, settlements and reversals; consigned stock in Add part; consigned stock marked on the product, unit and job pages; `C-` scan and search | Locally at ecc90f1 + docs: `npm run check` pass, `npm run check:types` pass, `npm test` 91 files / 1341 tests passed, `npm run test:e2e` 110 passed on phone and tablet (12.4 min; its web server ran `npm run build`, pass), docs link check 34 files / 520 links / 0 problems | Not deployed |
| Sales screens, refunds, restocks, Today and nav wiring, journey 4 (Phase 6 step 4: D7, D46, D48, D49, D51, D53) | Yes, `feat/p6-consignment` 67b1607, b65484a, 543760f, eccd687 and the closing docs commit: `/sales`, `/sales/[id]`, `RecordSaleSheet` / `SaleablePicker`, `RefundSheet`, `RestockControl`; Sell on the consignment item, unit and product pages; "Sold on S-…" with Restock on the unit page; `S-` in `/q` and the `sale` search kind; Sales in More; Today's consignment tiles linked | Locally: `npm run check` pass, `npm run check:types` pass (no diff), `npm test` 92 files / 1364 tests passed, `npm run build` pass (inside `test:e2e`), `npm run test:e2e` 118 passed on phone and tablet (13.3 min; an earlier run had 2 failures, the Today past-day note's old wording in `today.spec.ts`, fixed in eccd687), docs link check 34 files / 528 links / 0 problems | Not deployed |
| Phase 6 review fixes (D54, D55; D47 after archiving; the Shopify-key refusal; one-transaction intake; D48 list count; UI fixes; refund and restock races) | Yes, `feat/p6-consignment` 32f19e6 (the follow-up commit corrects DATA-MODEL's authority and applied state, PLAN's Phase 6 test list and this file's owner-question list) | Locally: `npm run db:reset` pass (37 migrations, seed applied), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 93 files / 1384 tests passed, `npm run test:e2e` 118 passed on phone and tablet (11.8 min; its web server ran `npm run build`, pass), docs link check 34 files / 543 links / 0 problems; rerun at the documentation follow-up: `npm run db:reset` pass (`37\|20261004003700`), `npm run db:types` no diff, `npm run check` pass, `npm run check:types` pass, `npm test` 93 files / 1384 tests passed, `npm run test:e2e` 118 passed on phone and tablet (11.6 min, build inside, no failures, flaky or skipped), docs link check 34 files / 545 links / 0 problems | Not deployed |
| Labels (Phase 8) | On `feat/p8-labels` in the other worktree; not on this branch | Not verified here | Not deployed |
| Staff roles (D90–D94: admin, manager and mechanic; `private.role_implies`; "Extra access" exceptions; role administration; refunds for managers; seed `manager@bicii.test`; staff screens with the role picker and invites by role) | Yes, `feat/staff-roles`: 0657397, 28de036 (database), bfc5ea2, dd94665 (app model, guards, refunds, profile), ae9763b, 080a796 (staff screens, E2E), a5441dd and the evidence commit (integration review, documentation), then the review-fixes commit after b83ce42; local only, not pushed | Locally after the review fixes (one-time clean-up of implied exceptions in `20261006000200` via `private.drop_implied_exceptions()`; two-connection D92 race tests; `update_staff` `expected_role` with `staff_role_changed`; shared `REASON_MAX_LENGTH`; manager wording; `ExtraAccessBadge`; focus on Cancel; PLAN D11, R-052, R-054): `npm run db:reset` pass (`47\|20261006000300`), `npm run db:types` committed (the `expected_role` argument), `npm run check` pass, `npm run check:types` pass, `BICII_REQUIRE_STACK=1 npm test` 113 files / 1686 tests passed (unit 57 / 738, database 56 / 948; both new concurrency tests failed once by hand with the refusal trigger's lock weakened to `FOR KEY SHARE`, then the lock was restored), `npm run build` pass, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:e2e` 158 passed on phone and tablet (15.1 min, no failures, flaky or skipped), docs link check 37 files / 691 links / 0 problems. Before that, locally (database `bicii_dev_wt`) after the step 4 review fixes (a5441dd): `npm run check` pass, `npm run check:types` pass (no diff), `BICII_REQUIRE_STACK=1 npm test` 113 files / 1680 tests passed (unit 57 / 737, database 56 / 943), `npm run build` pass, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:e2e` 158 passed on phone and tablet (16.8 min, no failures, flaky or skipped; it reset the database: 47 migrations, `47\|20261006000300`, seed applied), docs link check 37 files / 690 links / 0 problems. Earlier steps: step 1 112 / 1632 and 152 E2E; step 2 112 / 1669 and 152 E2E; step 3 113 / 1680 and 158 E2E, all passing | Not deployed |
| Period reporting database (Phase 9 step 1: D100–D105; date bases, report lines, summary / series / breakdown / line items / activity / by-mechanic RPCs with cost gating, purchases, stock value at last cost, six indexes, volume bench) | Database only, `feat/p9-reporting`, the step 1 commits after 5c9fbc7; local only, not pushed; no screens yet | Locally (database `bicii_dev_wt`): `npm run db:reset` pass (`49\|20261006001100`, seed applied), `npm run db:types` committed, `npm run check` pass (47 s), `npm run check:types` pass (no diff), `BICII_REQUIRE_STACK=1 npm test` 114 files / 1720 tests passed (unit 57 / 739, database 57 / 981; `period-reports.test.ts` 33 tests; Phase 5's and Phase 6's reporting tests unchanged and passing; 107 s), `npm run build` pass (30 s), `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:e2e` 158 passed on phone and tablet (15.4 min, no failures, flaky or skipped; it reset the database), docs link check 38 files / 724 links / 0 problems; bench `scripts/bench/report-volume.sql` on a throwaway clone (every target met, timings in DATA-MODEL §14) | Not deployed |
| Period report screens and CSV export (Phase 9 step 2: `/reports`, `/reports/lines`, `/reports/export` with kinds series, breakdown, lines, stock_value and mechanics; D30, D100–D105) | Yes, `feat/p9-reporting`, the three step 2 commits after c5c1fd7 and the evidence commit; local only, not pushed | Locally (database `bicii_dev_wt`): `npm run check` pass (58 s), `npm run check:types` pass (no diff), `BICII_REQUIRE_STACK=1 npm test` 118 files / 1761 tests passed (unit 60 / 776 with the new `period-reports`, `csv` and `report-exports` tests; database 58 / 985 with `period-report-exports.stack.test.ts`; 108 s), `npm run build` pass, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:e2e` 168 passed on phone and tablet (17.4 min, no failures, flaky or skipped; `reports.spec.ts` 5 tests on each project; it reset the database), docs link check 38 files / 737 links / 0 problems | Not deployed |
| Stock reconciliation and extended operational exceptions (Phase 9 step 3: D106–D108; reconciliation views and RPCs, the unsettled-consignment threshold, per-kind visibility, sale-line currency_mismatch, the Phase 10 placeholder, bench section 3) | Database only, `feat/p9-reporting`, the step 3 commits after 05c9414; local only, not pushed; screens are step 4 | Locally (database `bicii_dev_wt`): `npm run db:reset` pass (`51\|20261006001300`, seed applied; the seed reconciles unchanged), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass (no diff), `BICII_REQUIRE_STACK=1 npm test` 120 files / 1788 tests passed (unit 60 / 776 unchanged; database 60 / 1012 with `stock-reconciliation.test.ts` 21 and `operational-exceptions.test.ts` 6; Phase 5's exception tests pass with the six appended column names; 106 s), `npm run build` pass (32 s), `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:e2e` 168 passed on phone and tablet (17.8 min, no failures, flaky or skipped; it reset the database), docs link check 38 files / 750 links / 0 problems; bench section 3 on a throwaway clone (reconciliation 50–88 ms, exceptions list 390 ms, counts 257 ms and Today 8.8 s missed their 150 ms targets: R-059); the Phase 10 merge order simulated in a scratch database (R-058) | Not deployed |
| Phase 9 reconciliation and exception screens (step 4), Shopify, public-site integration, hardware adapter | No (Shopify on `feat/p10-shopify` in the other worktree) | Not built here | Not deployed |

Command-level evidence: [ENGINEERING.md](docs/ENGINEERING.md#commands).

## Work location and continuation

- `main` on origin (6042e6e) holds PRs #1–#8 and #11: the stack through
  appointments, the docs stack and Phase 6. The local `main` ref is stale;
  use `origin/main`.
- `feat/p9-reporting` (this worktree, `/home/user/bicii-book-wt`): created
  from `feat/staff-roles` at 5c9fbc7; Phase 9 steps 1, 2 and 3 committed
  locally, not pushed (no `origin/feat/p9-reporting`). Labels (Phase 8) and Shopify
  (Phase 10) are not on it; Phase 10 is read through
  `git show feat/p10-shopify:<path>` only.
- `feat/staff-roles` (pushed: local and `origin/feat/staff-roles` equal at 5c9fbc7): created
  from `feat/auth-email-otp` at 85077c9; the roles commits 0657397,
  28de036 (step 1), bfc5ea2, dd94665 (step 2), ae9763b, 080a796 (step 3)
  the step 4 review and documentation commits and the review-fixes
  commit, all committed locally and not pushed (no `origin/feat/staff-roles`). Its pull request goes
  against `main` after PR #10 merges.
- `feat/auth-email-otp` (85077c9, local and origin equal): the merge
  38db51b with `origin/feat/p7-purchasing`, the documentation commit
  35d7a63 and the integration review fixes. PR #10 is its pull request; it
  merges after PR #9.
- `feat/p7-purchasing` (7fed53f, local and origin equal) is PR #9.
- Other branches: `feat/p8-labels` and then `feat/p10-shopify` are built in
  `/home/user/bicii-book`, the other worktree, with its own database
  `bicii_dev`; they are not on `main`.
- This worktree runs its own devstack and database: source `.wt-env`
  (`PGDATABASE=bicii_dev_wt`, the `BICII_*_PORT` variables including the
  mail catcher's `BICII_SMTP_PORT` and `BICII_MAIL_HTTP_PORT`, and
  `E2E_PORT=3200`) before every command
  ([ENGINEERING.md](docs/ENGINEERING.md#prerequisites-and-access)).
- Local-only artifacts (git-ignored): `.env.local`, `.devstack/` (with
  `.devstack/mail/`), `test-results/`.

## Attention and links

- Top risks, most consequential first ([RISKS.md](docs/RISKS.md) order):
  [R-001](docs/RISKS.md#r-001--nothing-is-deployed),
  [R-002](docs/RISKS.md#r-002--no-backups-monitoring-alerting-or-exercised-recovery),
  [R-003](docs/RISKS.md#r-003--the-devstack-differs-from-hosted-supabase).
  Next in play: merging the integrated purchasing branch, then email
  sign-in (PR #10), then labels
  ([R-009](docs/RISKS.md#r-009--the-seven-pr-stack-is-unmerged-and-the-purchasing-track-forks-from-pr-6)).
- Decisions needed: [owner questions](docs/PRODUCT.md#open-assumptions-and-owner-questions);
  Phase 6 adds rows 9 (confirm D44–D55; D54 and D55 came from the review),
  10 (D53: should a price below the agreed amount plus shop charges need
  manage_consignments?,
  [R-024](docs/RISKS.md#r-024--a-consigned-item-can-be-sold-below-what-the-consignor-is-owed)),
  11 (agreement photos, R-022), 12 (refund netting and Cult Commons
  claw-back, decided by Phase 9's refund-reporting row, D49,
  [R-021](docs/RISKS.md#r-021--reports-overstate-net-sales-after-a-refund-or-restock)),
  13 (D55: should backdating an in-store sale more than a few days need
  a permission?,
  [R-027](docs/RISKS.md#r-027--a-sale-can-be-backdated-without-limit-by-any-staff-member))
  and 14 (how long consignors' personal and payout details are kept, and
  whether payout-detail changes are recorded,
  [R-026](docs/RISKS.md#r-026--consignor-personal-and-payout-details-are-kept-indefinitely-with-no-change-history));
  Phase 7 adds rows 15 (confirm D61–D66), 16 (a reverse-receipt for a
  wrong delivery,
  [R-030](docs/RISKS.md#r-030--a-wrong-delivery-cannot-be-reversed-only-adjusted))
  and 17 (unique items on purchase orders,
  [R-033](docs/RISKS.md#r-033--unique-items-bought-from-a-supplier-have-no-purchase-order));
  email sign-in adds rows 18 (confirm D70–D72) and 19 (which SMTP provider
  sends the codes,
  [R-039](docs/RISKS.md#r-039--hosted-email-delivery-and-auth-settings-are-unverified)),
  and treats row 1 as answered (the owner's "D11" is the sign-in method;
  the delegation ceiling itself stays a build default, not individually
  confirmed, and is restated for roles by D93); staff roles add row 20
  (confirm D92 and D93's build defaults,
  [R-053](docs/RISKS.md#r-053--the-staff-roles-build-defaults-d92-and-d93-are-unconfirmed));
  Phase 9 notes the build default D102 on row 12 and adds row 21 (confirm
  the reporting build defaults D100–D105,
  [R-055](docs/RISKS.md#r-055--past-report-periods-change-after-a-reopen-a-back-dated-sale-or-a-back-dated-receipt),
  [R-056](docs/RISKS.md#r-056--stock-value-uses-each-products-last-cost-not-the-cost-of-the-units-on-hand));
  step 2 adds [R-057](docs/RISKS.md#r-057--csv-exports-stop-at-50000-rows-and-refuse-when-figures-change-mid-export)
  (export limits) and no owner question; step 3 adds row 22 (confirm
  D106–D108), [R-058](docs/RISKS.md#r-058--phase-9s-exceptions-migration-must-be-re-verified-when-phase-10-merges)
  (re-verify at the Phase 10 merge) and
  [R-059](docs/RISKS.md#r-059--today-and-the-exception-counts-are-slow-at-a-busy-years-volume)
  (Today's latency at volume).
- Running costs, backups, recovery: none yet ([OPERATIONS.md](docs/OPERATIONS.md)).
