# Current state

Updated: 2026-10-05, Phase 6 step 2 checkpoint on `feat/p6-consignment`.
Evidence checked: local refs and `git worktree list` on 2026-10-05; local
gates on this branch at 2c402b2 plus the step 2 docs commit (below); step
1's gates at 365bdd7. Earlier rows: GitHub REST pull list and check runs for
the seven PR heads, local gates on b34bbcd (the head of PR #7).

## Return in two minutes

- Purpose: the staff Admin for BICII's workshop, over one Supabase backend
  shared with the public site ([PRODUCT.md](docs/PRODUCT.md)).
- Current objective: [PLAN](docs/PLAN.md#2-phases) Phase 6, consignment and
  sales, in four steps on `feat/p6-consignment`. Steps 1 and 2 (the whole
  Phase 6 database: consignment core, consigned job parts, sales,
  restocks, refunds, settlements, the ledgers, reporting, read RPCs,
  search and the seed) are built and committed locally.
- Next action: Phase 6 step 3, the domain layer and the consignment
  screens, over the RPCs in
  [DATA-MODEL §16](docs/DATA-MODEL.md#16-rpc-catalogue-security-definer-in-public)
  (`list_consignors`, `consignor_statement`, `consignor_payout_details`,
  `record_settlement`, `reverse_settlement`, the step 1 intake RPCs), and
  widening the part sheet (`searchParts` in `src/lib/domain/inventory.ts`)
  to consigned stock. Step 4: the sales screens (`saleable_stock`,
  `record_retail_sale`, `list_sales`, `sale_lines_detail`, `restock_unit`,
  `record_sale_refund`), Today and journey 4.
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
| Purchasing (Phase 7) | On `feat/p7-purchasing` 59944d6 only | Not verified here | Not deployed |
| Staff email OTP | Parallel track; no `feat/auth-email-otp` ref visible | Not verified | Not deployed |
| Consignment core and consigned job parts (Phase 6 step 1: D44, D45, D48, D50–D52) | Database only, `feat/p6-consignment` 13fe3f3, fe6ac53, 365bdd7; no screens yet | Locally on 365bdd7: `npm run db:reset` pass (34 migrations, `34\|20261004003400`), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 86 files / 1225 tests passed; `test:e2e` not run (no screen changed); docs link check 34 files / 506 links / 0 problems | Not deployed |
| Sales, restocks, refunds, settlements, consignor ledgers, sale reporting, read RPCs, search, Phase 6 seed (Phase 6 step 2: D44, D46–D49) | Database only, `feat/p6-consignment` 2d2ba0c, 2c402b2; no screens yet | Locally at 2c402b2 + docs: `npm run db:reset` pass (37 migrations, latest `20261004003700`, seed applied), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 89 files / 1298 tests passed, `npm run build` pass, `npm run test:e2e` 106 passed (phone and tablet, 9.7 min), docs link check 34 files / 509 links / 0 problems | Not deployed |
| Phase 6 screens (steps 3–4), labels, Phase 9 reporting, Shopify, public-site integration, hardware adapter | No | Not built | Not deployed |

Command-level evidence: [ENGINEERING.md](docs/ENGINEERING.md#commands).

## Work location and continuation

- PR stack: `main` (1594c78) ← `docs/build-plan` (#1) ← `feat/m1.1-foundation`
  (#2) ← … ← `feat/p2-appointments` (#7) ← `feat/docs-stack`. #1–#7 are open
  drafts, pushed and equal to origin.
- `feat/docs-stack` (6507449): pushed, equal to `origin/feat/docs-stack`.
- `feat/p6-consignment`: stacked on `feat/docs-stack`; local only, not
  pushed (34783d6 decisions D44–D53, step 1's commits, step 2's 2d2ba0c and
  2c402b2, and this checkpoint). The orchestrator pushes.
- Parallel track: a second worktree of this clone (`bicii-book-wt`, see
  `git worktree list`) with its own database builds purchasing and email
  OTP. `feat/p7-purchasing` is local
  only and forks from PR #6 (no appointments); it is merged in a later
  integration step
  ([R-009](docs/RISKS.md#r-009--the-seven-pr-stack-is-unmerged-and-the-purchasing-track-forks-from-pr-6)).
- Local-only artifacts (git-ignored): `.env.local`, `.devstack/`,
  `test-results/`.

## Attention and links

- Top risks, most consequential first ([RISKS.md](docs/RISKS.md) order):
  [R-001](docs/RISKS.md#r-001--nothing-is-deployed),
  [R-002](docs/RISKS.md#r-002--no-backups-monitoring-alerting-or-exercised-recovery),
  [R-003](docs/RISKS.md#r-003--the-devstack-differs-from-hosted-supabase).
  Next in play: the PR stack integration
  ([R-009](docs/RISKS.md#r-009--the-seven-pr-stack-is-unmerged-and-the-purchasing-track-forks-from-pr-6)).
- Decisions needed: [owner questions](docs/PRODUCT.md#open-assumptions-and-owner-questions).
- Running costs, backups, recovery: none yet ([OPERATIONS.md](docs/OPERATIONS.md)).
