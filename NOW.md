# Current state

Updated: 2026-10-05, the Phase 7 (purchasing) integration with the main
line on `feat/p7-purchasing`, in the second worktree `bicii-book-wt`.
Evidence checked: `git fetch origin`, `git for-each-ref refs/heads
refs/remotes` and `git worktree list` before the merge; the local gates
on this branch after the integration (below). Earlier rows keep the
evidence of their own phase.

## Return in two minutes

- Purpose: the staff Admin for BICII's workshop, over one Supabase backend
  shared with the public site ([PRODUCT.md](docs/PRODUCT.md)).
- Current objective: [PLAN](docs/PLAN.md#2-phases) Phase 7, purchasing,
  integrated with `main` (Phases 2 and 6 and the docs stack included) on
  `feat/p7-purchasing`: `origin/main` (6042e6e) merged into the branch
  (a merge commit, no rebase), every conflict resolved keeping both sides,
  `staff_search` carrying Phase 6's and Phase 7's kinds, consigned
  products refused by every purchasing path, and the docs moved into the
  Vibe Code Docs Stack structure (decision record
  [ADR-018](docs/decisions/ADR-018-purchasing.md), RISKS R-030 to R-034).
  Committed locally, not pushed.
- Next action: the orchestrator pushes `feat/p7-purchasing` so PR #9 shows
  the integrated branch, runs CI with the `e2e` label and merges it; then
  integrates email OTP and labels (Phase 8, including the receive screen's
  print shortcut) the same way. The owner confirms D61–D66 and answers
  questions 15–17 in
  [PRODUCT.md](docs/PRODUCT.md#open-assumptions-and-owner-questions).
- Owner decision recorded here: three staff roles (admin, manager,
  mechanic; 2026-10-06) are decided but not built on this branch; D60 now
  covers only a mechanic granted `manage_purchasing` as an exception
  ([ADR-018](docs/decisions/ADR-018-purchasing.md),
  [R-034](docs/RISKS.md#r-034--a-manage_purchasing-exception-shows-unit-costs-on-purchasing-screens)).
- Main uncertainty: nothing hosted exists
  ([R-001](docs/RISKS.md#r-001--nothing-is-deployed)).

## What is actually working

CI runs `check`, `test (unit + db)` and `build` in one run per head; e2e is
a separate, label-triggered run. All listed results are success.

| Capability | Implemented | Verified and how | Deployed |
|---|---|---|---|
| Foundation and staff sign-in (password) | Yes, PR #2 9106a01 | [CI](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37207471211), [e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37207644142/job/111452093165) | Not deployed |
| Customers, bikes, photos | Yes, PR #3 74fff3e | [CI](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37216112124), [e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37216116874/job/111476852853) | Not deployed |
| Workshop jobs | Yes, PR #4 8763e6b | [CI](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37231006487), [e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37231011044/job/111520439511) | Not deployed |
| Inventory | Yes, PR #5 9922441 | [CI](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37262357001), [e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37262379042/job/111612114525) | Not deployed |
| Today and financial engine | Yes, PR #6 d3e2101 | [CI](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37262369366), [e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37262380782/job/111612119938) | Not deployed |
| Appointments | Yes, PR #7 b34bbcd | [CI](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37276827625), [e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37276834195/job/111655595521); locally `npm test` 82 files / 1186 tests, `npm run check`, `check:types`, `test:e2e` 106 passed | Not deployed |
| Docs stack | Yes, `feat/docs-stack` | Locally: docs link check, 33 files / 476 links, 0 problems; `npm run check` pass (after the review fixes) | Not deployed |
| Purchasing (Phase 7: suppliers, purchase orders, receiving, reorder; D60–D66) | Yes, `feat/p7-purchasing`: built through a0fc1d2 (pushed), integrated with `main` in the merge 06979ec and the documentation commit after it (local only) | Locally on the integrated branch (database `bicii_dev_wt`): `npm run db:reset` pass (42 migrations, `42\|20261005000500`, seed applied), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass (no diff), `npm test` 102 files / 1517 tests passed (unit 52 / 643, database 50 / 874), `npm run build` pass, `npm run test:e2e` 138 passed on phone and tablet (16.8 min, no failures, flaky or skipped), docs link check 35 files / 595 links / 0 problems | Not deployed |
| Staff email OTP | On `feat/auth-email-otp` 4b3eadd (local and origin equal: pushed), checked out in the worktree `bicii-book-wt` | Not verified here | Not deployed |
| Consignment core and consigned job parts (Phase 6 step 1: D44, D45, D48, D50–D52) | Database only, `feat/p6-consignment` 13fe3f3, fe6ac53, 365bdd7; no screens yet | Locally on 365bdd7: `npm run db:reset` pass (34 migrations, `34\|20261004003400`), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 86 files / 1225 tests passed; `test:e2e` not run (no screen changed); docs link check 34 files / 506 links / 0 problems | Not deployed |
| Sales, restocks, refunds, settlements, consignor ledgers, sale reporting, read RPCs, search, Phase 6 seed (Phase 6 step 2: D44, D46–D49) | Database only, `feat/p6-consignment` 2d2ba0c, 2c402b2; no screens yet | Locally at 2c402b2 + docs: `npm run db:reset` pass (37 migrations, latest `20261004003700`, seed applied), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 89 files / 1298 tests passed, `npm run build` pass, `npm run test:e2e` 106 passed (phone and tablet, 9.7 min), docs link check 34 files / 509 links / 0 problems | Not deployed |
| Consignment screens and consigned job parts (Phase 6 step 3: D4, D27 changed, D44–D48, D50–D52) | Yes, `feat/p6-consignment` 2137316, 5627bb0, ecc90f1 and the step 3 docs commit: `/consignment` (consignors, items), `/consignment/consignors/[id]`, `/consignment/items/[id]`, intake, terms, charges, returns, settlements and reversals; consigned stock in Add part; consigned stock marked on the product, unit and job pages; `C-` scan and search | Locally at ecc90f1 + docs: `npm run check` pass, `npm run check:types` pass, `npm test` 91 files / 1341 tests passed, `npm run test:e2e` 110 passed on phone and tablet (12.4 min; its web server ran `npm run build`, pass), docs link check 34 files / 520 links / 0 problems | Not deployed |
| Sales screens, refunds, restocks, Today and nav wiring, journey 4 (Phase 6 step 4: D7, D46, D48, D49, D51, D53) | Yes, `feat/p6-consignment` 67b1607, b65484a, 543760f, eccd687 and the closing docs commit: `/sales`, `/sales/[id]`, `RecordSaleSheet` / `SaleablePicker`, `RefundSheet`, `RestockControl`; Sell on the consignment item, unit and product pages; "Sold on S-…" with Restock on the unit page; `S-` in `/q` and the `sale` search kind; Sales in More; Today's consignment tiles linked | Locally: `npm run check` pass, `npm run check:types` pass (no diff), `npm test` 92 files / 1364 tests passed, `npm run build` pass (inside `test:e2e`), `npm run test:e2e` 118 passed on phone and tablet (13.3 min; an earlier run had 2 failures, the Today past-day note's old wording in `today.spec.ts`, fixed in eccd687), docs link check 34 files / 528 links / 0 problems | Not deployed |
| Phase 6 review fixes (D54, D55; D47 after archiving; the Shopify-key refusal; one-transaction intake; D48 list count; UI fixes; refund and restock races) | Yes, `feat/p6-consignment` 32f19e6 (the follow-up commit corrects DATA-MODEL's authority and applied state, PLAN's Phase 6 test list and this file's owner-question list) | Locally: `npm run db:reset` pass (37 migrations, seed applied), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 93 files / 1384 tests passed, `npm run test:e2e` 118 passed on phone and tablet (11.8 min; its web server ran `npm run build`, pass), docs link check 34 files / 543 links / 0 problems; rerun at the documentation follow-up: `npm run db:reset` pass (`37\|20261004003700`), `npm run db:types` no diff, `npm run check` pass, `npm run check:types` pass, `npm test` 93 files / 1384 tests passed, `npm run test:e2e` 118 passed on phone and tablet (11.6 min, build inside, no failures, flaky or skipped), docs link check 34 files / 545 links / 0 problems | Not deployed |
| Labels (Phase 8) | On `feat/p8-labels` in the other worktree; not on this branch | Not verified here | Not deployed |
| Phase 9 reporting, Shopify, public-site integration, staff roles, hardware adapter | No | Not built | Not deployed |

Command-level evidence: [ENGINEERING.md](docs/ENGINEERING.md#commands).

## Work location and continuation

- `main` on origin (6042e6e) holds PRs #1–#8 and #11: the stack through
  appointments, the docs stack and Phase 6. The local `main` ref is stale
  (1594c78); use `origin/main`.
- `feat/p7-purchasing` (this worktree, `/home/user/bicii-book-wt`): the
  merge 06979ec (parents a0fc1d2 and 6042e6e) and one documentation
  commit after it, committed locally and not pushed; `origin/feat/p7-purchasing`
  is still a0fc1d2. PR #9 is its pull request.
- Other branches: `feat/auth-email-otp` (4b3eadd, pushed) and
  `feat/p8-labels` (checked out in `/home/user/bicii-book`, the other
  worktree, with its own database `bicii_dev`) are not on `main`.
- This worktree runs its own devstack and database: source `.wt-env`
  (`PGDATABASE=bicii_dev_wt`, the `BICII_*_PORT` variables and
  `E2E_PORT=3200`) before every command
  ([ENGINEERING.md](docs/ENGINEERING.md#prerequisites-and-access)).
- Local-only artifacts (git-ignored): `.env.local`, `.devstack/`,
  `test-results/`.

## Attention and links

- Top risks, most consequential first ([RISKS.md](docs/RISKS.md) order):
  [R-001](docs/RISKS.md#r-001--nothing-is-deployed),
  [R-002](docs/RISKS.md#r-002--no-backups-monitoring-alerting-or-exercised-recovery),
  [R-003](docs/RISKS.md#r-003--the-devstack-differs-from-hosted-supabase).
  Next in play: merging the integrated purchasing branch, then OTP and
  labels
  ([R-009](docs/RISKS.md#r-009--the-seven-pr-stack-is-unmerged-and-the-purchasing-track-forks-from-pr-6)).
- Decisions needed: [owner questions](docs/PRODUCT.md#open-assumptions-and-owner-questions);
  Phase 6 adds rows 9 (confirm D44–D55; D54 and D55 came from the review),
  10 (D53: should a price below the agreed amount plus shop charges need
  manage_consignments?,
  [R-024](docs/RISKS.md#r-024--a-consigned-item-can-be-sold-below-what-the-consignor-is-owed)),
  11 (agreement photos, R-022), 12 (refund netting and Cult Commons
  claw-back, decided by Phase 9's refund-reporting row, D49,
  [R-021](docs/RISKS.md#r-021--reports-overstate-net-sales-after-a-refund-or-restock))
  and 13 (D55: should backdating an in-store sale more than a few days need
  a permission?,
  [R-027](docs/RISKS.md#r-027--a-sale-can-be-backdated-without-limit-by-any-staff-member));
  Phase 7 adds rows 15 (confirm D61–D66), 16 (a reverse-receipt for a
  wrong delivery,
  [R-030](docs/RISKS.md#r-030--a-wrong-delivery-cannot-be-reversed-only-adjusted))
  and 17 (unique items on purchase orders,
  [R-033](docs/RISKS.md#r-033--unique-items-bought-from-a-supplier-have-no-purchase-order)).
- Running costs, backups, recovery: none yet ([OPERATIONS.md](docs/OPERATIONS.md)).
