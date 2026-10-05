# Current state

Updated: 2026-10-05, Phase 8 (QR identity and labels) step 3 of 4, the
print flow on the record pages and the Labels and printers settings, on
`feat/p8-labels` (stacked on
`feat/p6-consignment` at c791d4b). Evidence checked: `git status`, `git
log`, `git worktree list` and `git for-each-ref refs/heads refs/remotes` at
the start of the step; local gates at the step's code commits (below).
Earlier rows: their own gates as recorded.

## Return in two minutes

- Purpose: the staff Admin for BICII's workshop, over one Supabase backend
  shared with the public site ([PRODUCT.md](docs/PRODUCT.md)).
- Current objective: [PLAN](docs/PLAN.md#phase-8--qr-and-labels) Phase 8,
  QR identity and label printing, in four steps on `feat/p8-labels`. Step 1
  (database: `20261004003800_labels.sql`, the seed's five print jobs, D9
  base and D56–D59, [ADR-017](docs/decisions/ADR-017-labels-and-qr-base.md))
  and step 2 (`src/lib/qr.ts` on the database base, `src/lib/printing/`,
  `src/lib/domain/labels.ts`, the label and settings actions, the print view
  `/print/labels/[id]`, the PDF route `/api/labels/[id]/pdf`, the print
  history `/labels`) and step 3 (Print label and the Labels card on the
  product, unit and bike pages with the `?print=1&qty=N&reprint=…` deep
  link; Settings → Labels and printers for admins; `tests/e2e/labels.spec.ts`)
  are committed locally. Step 4 (journeys, the phase's closing docs) is not
  built. Phase 6 (`feat/p6-consignment`, c791d4b) is complete and not
  pushed.
- Next action: Phase 8 step 4: the journeys that cross labels (journey 3's
  "print 10 labels" without the Phase 7 receive shortcut, journey 4's label
  step), closing Phase 8 in PLAN and NOW. The orchestrator pushes
  `feat/p6-consignment` and `feat/p8-labels` and opens their PRs. The
  owner answers D44–D59 (rows 9 and 15) in
  [PRODUCT.md](docs/PRODUCT.md#open-assumptions-and-owner-questions); the
  orchestrator or owner opens a new main-line decision range (D59 was the
  last, [R-028](docs/RISKS.md#r-028--the-main-line-decision-range-d43d59-is-exhausted)).
- Phase 8 in one line: labels encode only
  `{shop_settings.public_site_url}/q/{short_id}` (no fallback: nothing
  prints until the address is set; the Admin shows "QR address not set";
  the environment's address is only an extra scan base), print 1–500 per
  job for a product and 1–10 for a unit or bike, label unique items per
  unit, price through `private.selling_price` (NULL no price, 0 → $0.00),
  never carry cost, consignor, ownership or notes, are rendered from the
  job's snapshot only while the job is open, and are confirmed printed or
  failed by staff. Deferred: the purchase receive screen's "Print N labels"
  shortcut, until Phase 7 is integrated
  ([R-029](docs/RISKS.md#r-029--the-purchase-receive-screen-has-no-print-n-labels-shortcut-yet));
  untested on a real printer
  ([R-030](docs/RISKS.md#r-030--label-output-is-unverified-on-a-real-label-printer-and-on-ios));
  print success is confirmed by hand
  ([R-031](docs/RISKS.md#r-031--print-success-is-confirmed-by-hand)).
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
| Purchasing (Phase 7) | On `feat/p7-purchasing` a0fc1d2 (local and origin equal: pushed) | Not verified here | Not deployed |
| Staff email OTP | On `feat/auth-email-otp` 4b3eadd (local and origin equal: pushed), checked out in the worktree `bicii-book-wt` | Not verified here | Not deployed |
| Consignment core and consigned job parts (Phase 6 step 1: D44, D45, D48, D50–D52) | Database only, `feat/p6-consignment` 13fe3f3, fe6ac53, 365bdd7; no screens yet | Locally on 365bdd7: `npm run db:reset` pass (34 migrations, `34\|20261004003400`), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 86 files / 1225 tests passed; `test:e2e` not run (no screen changed); docs link check 34 files / 506 links / 0 problems | Not deployed |
| Sales, restocks, refunds, settlements, consignor ledgers, sale reporting, read RPCs, search, Phase 6 seed (Phase 6 step 2: D44, D46–D49) | Database only, `feat/p6-consignment` 2d2ba0c, 2c402b2; no screens yet | Locally at 2c402b2 + docs: `npm run db:reset` pass (37 migrations, latest `20261004003700`, seed applied), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 89 files / 1298 tests passed, `npm run build` pass, `npm run test:e2e` 106 passed (phone and tablet, 9.7 min), docs link check 34 files / 509 links / 0 problems | Not deployed |
| Consignment screens and consigned job parts (Phase 6 step 3: D4, D27 changed, D44–D48, D50–D52) | Yes, `feat/p6-consignment` 2137316, 5627bb0, ecc90f1 and the step 3 docs commit: `/consignment` (consignors, items), `/consignment/consignors/[id]`, `/consignment/items/[id]`, intake, terms, charges, returns, settlements and reversals; consigned stock in Add part; consigned stock marked on the product, unit and job pages; `C-` scan and search | Locally at ecc90f1 + docs: `npm run check` pass, `npm run check:types` pass, `npm test` 91 files / 1341 tests passed, `npm run test:e2e` 110 passed on phone and tablet (12.4 min; its web server ran `npm run build`, pass), docs link check 34 files / 520 links / 0 problems | Not deployed |
| Sales screens, refunds, restocks, Today and nav wiring, journey 4 (Phase 6 step 4: D7, D46, D48, D49, D51, D53) | Yes, `feat/p6-consignment` 67b1607, b65484a, 543760f, eccd687 and the closing docs commit: `/sales`, `/sales/[id]`, `RecordSaleSheet` / `SaleablePicker`, `RefundSheet`, `RestockControl`; Sell on the consignment item, unit and product pages; "Sold on S-…" with Restock on the unit page; `S-` in `/q` and the `sale` search kind; Sales in More; Today's consignment tiles linked | Locally: `npm run check` pass, `npm run check:types` pass (no diff), `npm test` 92 files / 1364 tests passed, `npm run build` pass (inside `test:e2e`), `npm run test:e2e` 118 passed on phone and tablet (13.3 min; an earlier run had 2 failures, the Today past-day note's old wording in `today.spec.ts`, fixed in eccd687), docs link check 34 files / 528 links / 0 problems | Not deployed |
| Phase 6 review fixes (D54, D55; D47 after archiving; the Shopify-key refusal; one-transaction intake; D48 list count; UI fixes; refund and restock races) | Yes, `feat/p6-consignment` 32f19e6 (the follow-up commit corrects DATA-MODEL's authority and applied state, PLAN's Phase 6 test list and this file's owner-question list) | Locally: `npm run db:reset` pass (37 migrations, seed applied), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 93 files / 1384 tests passed, `npm run test:e2e` 118 passed on phone and tablet (11.8 min; its web server ran `npm run build`, pass), docs link check 34 files / 543 links / 0 problems; rerun at the documentation follow-up: `npm run db:reset` pass (`37\|20261004003700`), `npm run db:types` no diff, `npm run check` pass, `npm run check:types` pass, `npm test` 93 files / 1384 tests passed, `npm run test:e2e` 118 passed on phone and tablet (11.6 min, build inside, no failures, flaky or skipped), docs link check 34 files / 545 links / 0 problems | Not deployed |
| Labels database (Phase 8 step 1: D9 base, D56–D59) | Database only, `feat/p8-labels` 1294e36 (decisions), 2c4f6a3 (migration `20261004003800_labels`, seed, types, tests, docs); no screens yet | Locally at 2c4f6a3: `npm run db:reset` pass (`38\|20261004003800`, seed applied; devstack restarted), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 95 files / 1414 tests passed (incl. `labels.test.ts` 25 tests, `labels-concurrency.test.ts` 5 tests, `meta.test.ts`); `test:e2e` not run (no screen changed); docs link check 35 files / 581 links / 0 problems (after this update) | Not deployed |
| Printing library, QR base in the app, print view, PDF route, print history (Phase 8 step 2: D9, D56, D58, D59) | Yes, `feat/p8-labels` 967b99b (QR addresses from shop settings), cd4bbb6 (printing, domain, actions, views, route, history, docs) and the commit with this update | Locally at cd4bbb6: `npm run check` pass, `npm test` 106 files / 1559 tests passed (incl. `tests/unit/printing/` with ZXing decoding the rasterised QR, `qr-base`, `qr-base-sources`, `print-job-controls`, `tests/db/labels-domain.stack.test.ts`), `npm run build` pass, `npm run test:e2e` 130 passed on phone and tablet (14.4 min; build inside; `print-view.spec.ts` 6 × 2), docs link check 35 files / 589 links / 0 problems (after this update); `check:types` not run (no migration) | Not deployed |
| Print flow on the record pages, Labels and printers settings, labels E2E (Phase 8 step 3: D9, D56–D59) | Yes, `feat/p8-labels` 41c1a5c (code and unit tests) and the commit with this update (E2E, docs): `PrintLabelButton` / `PrintLabelSheet`, the Labels card on product, unit and bike pages, `?print=1&qty=N&reprint=…`, `/settings/labels` (QR address, printers, templates), the decimal `NumberInput` stepper | Locally on the final tree: `npm run check` pass, `npm test` 108 files / 1587 tests passed (after `npm run db:reset` and a devstack restart; `print-label.test.tsx`, `printing/print-sheet.test.ts`, the decimal stepper, `publicSiteUrlInputSchema`, `resolvePrintPreset`), `npm run test:e2e` 146 passed on phone and tablet (14.5 min; build inside, pass; `labels.spec.ts` 8 × 2; a first run had 4 failures, a "Units" list-name clash in `inventory.spec.ts` and `sales.spec.ts`, fixed by naming the Labels card's list "Unit labels"), docs link check 35 files / 597 links / 0 problems; `check:types` not run (no migration) | Not deployed |
| Phase 8 step 4 (journeys, closing docs), Phase 9 reporting, Shopify, public-site integration, hardware adapter | No | Not built | Not deployed |

Command-level evidence: [ENGINEERING.md](docs/ENGINEERING.md#commands).

## Work location and continuation

- PR stack: `main` (1594c78) ← `docs/build-plan` (#1) ← `feat/m1.1-foundation`
  (#2) ← … ← `feat/p2-appointments` (#7) ← `feat/docs-stack`. #1–#7 are open
  drafts, pushed and equal to origin.
- `feat/docs-stack` (6507449): pushed, equal to `origin/feat/docs-stack`.
- `feat/p8-labels`: stacked on `feat/p6-consignment` (c791d4b); Phase 8
  steps 1 to 3 committed locally, not pushed (step 1: 1294e36 decisions,
  2c4f6a3 the database layer, c5de022; step 2: 967b99b, cd4bbb6, 9608931;
  step 3: 41c1a5c and the commit with this update). No origin branch of that name; origin holds an
  older orchestrator auto-save, `wip/feat/p8-labels` (ce8bab9, not
  reviewed).
- `feat/p6-consignment`: stacked on `feat/docs-stack`; committed locally,
  not pushed (34783d6 decisions D44–D53, step 1's commits, step 2's
  2d2ba0c and 2c402b2, step 3's 2137316, 5627bb0, ecc90f1 and d8ba313,
  step 4's 67b1607, b65484a, 543760f, eccd687 and a8967c7, the review
  fixes 32f19e6, and the documentation follow-up commit with this
  update). There is no origin branch of that name;
  origin holds an orchestrator auto-save, `wip/feat/p6-consignment`
  (ed7d27e, a snapshot of uncommitted work, not reviewed). The
  orchestrator pushes it and opens its PR on top of `feat/docs-stack`.
- Parallel track: a second worktree of this clone (`bicii-book-wt`, see
  `git worktree list`) with its own database builds purchasing and email
  OTP. `feat/p7-purchasing` (a0fc1d2) and `feat/auth-email-otp` (4b3eadd)
  are pushed (equal to origin); purchasing forks from PR #6 (no
  appointments); both are merged in a later integration step
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
  [R-027](docs/RISKS.md#r-027--a-sale-can-be-backdated-without-limit-by-any-staff-member)).
- Running costs, backups, recovery: none yet ([OPERATIONS.md](docs/OPERATIONS.md)).
