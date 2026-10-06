# Current state

Updated: 2026-10-06, Phase 10 (Shopify) complete: step 4 of 4 (the
screens, Today's exception row, E2E journey 5, the closing docs) on
`feat/p10-shopify` (stacked on `feat/p8-labels` at 3f09d22). Evidence checked: `git status`, `git log`, `git worktree list`
and `git for-each-ref refs/heads refs/remotes` at the start and end of the
step; local gates on the final tree (below). Earlier rows: their own gates
as recorded.

## Return in two minutes

- Purpose: the staff Admin for BICII's workshop, over one Supabase backend
  shared with the public site ([PRODUCT.md](docs/PRODUCT.md)).
- Current objective: Phase 10 (Shopify) is complete and awaits its PR;
  it was built in four steps
  ([PLAN Phase 10](docs/PLAN.md#phase-10--shopify), decisions D80–D89 in
  [ADR-020](docs/decisions/ADR-020-shopify.md)). Step 1 is done: ef1a613
  (the decision ranges per track, D80–D89, R-028 resolved), 8ea4dbd
  (`20261004003900_shopify_integration.sql`,
  `20261004004000_shopify_order_processing.sql`, the Phase 10 seed, types,
  fixtures, `tests/db/shopify-webhooks.test.ts`, docs) and 792ce96. Step 2
  is done: 4196a90 (`20261004004100_shopify_product_sync.sql`, the seed's
  trigger flush, types, db-errors, api-surface,
  `tests/db/shopify-sync.test.ts`, docs, R-045, R-046) and 8ec0fba. Step 3
  is done: 92b3335 (adapters, HMAC, gids, env), c56143b (desired state,
  sync and queue runners), 37f4c37 (webhook and cron routes, `vercel.json`,
  proxy matcher, E2E env, the live-stack test, docs, R-047–R-049), 27a7be8
  (log fix) and 3f5970b. Committed locally, not pushed.
- Step 4 is done: 132a1ae (the product page's Online card, Publish online
  and Sync now), 3892eeb (the admin `/shopify` screens, the queue, the
  event inspector, the links, Today's `integration_failed` row, Shopify in
  More, the linked customer on an online sale's page, unit tests, DESIGN,
  USER-GUIDE), 3407fec (`tests/e2e/shopify.spec.ts`, TESTING) and the
  closing docs commit with this update. Committed locally, not pushed.
- Next action: the orchestrator pushes `feat/p10-shopify` and opens its PR
  against `main`, answering the documentation-impact question of
  [.github/pull_request_template.md](.github/pull_request_template.md)
  (docs changed: PLAN, PRODUCT, USER-GUIDE, DESIGN, ARCHITECTURE,
  DATA-MODEL, TESTING, ENGINEERING, OPERATIONS, RUNBOOK, RISKS, ADR-020,
  NOW). The orchestrator reports PRs #1–#8 and #11 merged into `main` on
  2026-10-06 (its statement; locally `origin/main` is 6042e6e "Merge pull
  request #11 from …/feat/p6-consignment" as of the last fetch). The owner
  answers D89's OPEN points and confirms D80–D88 (rows 17–19 of the
  [owner questions](docs/PRODUCT.md#open-assumptions-and-owner-questions)).
- Phase 10 step 4 in one line: every staff member sees a product's
  Shopify status on its page; manage_inventory switches **Publish online**
  and runs **Sync now** (the action runs only the job id the RPC returned);
  admins get **More → Shopify** (connection, settings, tiles), the queue
  (Retry, Link to a BICII product then retry, Dismiss with a reason), the
  products and events lists and the event inspector (outcome in words,
  delivery evidence, the customer link, never by email; JsonView), all real
  403s for anyone else; Today's Needs attention shows "Shopify needs
  attention" rows that open the queue on that job.
- Phase 10 step 3 in one line: every Shopify call is in
  `src/lib/integrations/shopify/` behind the `ShopifyAdmin` interface (the
  GraphQL adapter pinned to 2026-10, or the in-memory fake with
  `SHOPIFY_ADAPTER=fake`, never in production); `POST
  /api/shopify/webhooks` checks the HMAC on the raw bytes, stores every
  delivery (rejected ones as body-less evidence; 413/503/401/400/500/200),
  then runs the event's job and up to 5 due jobs in `after()`; `GET
  /api/cron/integrations` (Vercel cron every 5 minutes, bearer
  `CRON_SECRET`) runs up to 25; `runProductSync` pushes only when the
  desired-state hash changed, at `product_sync_state.sale_price` exactly,
  defers while an order is in flight and once when Shopify's count moved,
  then overwrites (D83). Nothing verified against a real store
  ([R-047](docs/RISKS.md#r-047--the-live-shopify-adapter-is-unverified-against-a-real-store);
  RUNBOOK "Shopify: verify before go-live"). No screens yet.
- Phase 10 step 2 in one line: the online price is
  `private.shopify_online_price` (through `private.selling_price`, so a
  consigned item sells online at its asking price; 0 is a price); staff
  with manage_inventory publish a public, priced, unarchived, shop-saleable
  product online and get back the one sync job to run; every stock,
  product, unit, asking-price or public-photo change queues one sync per
  product (deferred triggers, run at commit); the worker's state and
  result RPCs are service-role only; `reporting.shopify_sync_status` shows
  every staff member the status (the open job to admins only); and
  `reporting.public_items.buy_online_url` is the storefront's
  `/products/<handle>` only for an available, published, synced,
  BICII-created listing (D84; the rule Phase 11 reads).
- Phase 10 step 1 in one line: every webhook is stored before processing
  (deduplicated on its webhook id; rejected deliveries kept as body-less
  evidence, D88); a paid order becomes one online sale through Phase 6's
  `private.sell_line` at Shopify's discounted prices split exactly (D80),
  or nothing, waiting for an admin with a human message (D82); a refund is
  one `sale_refunds` row and never moves stock (D85); test and POS orders
  are skipped and tax-exclusive orders refused (D89); retries back off and
  admins dismiss with a reason (D87); only admins see payloads, the queue
  and the `integration_failed` exceptions, and link variants and customers
  (never by email, D86). No screen, route or Shopify API call yet.
- Phase 8 in one line: labels encode only
  `{shop_settings.public_site_url}/q/{short_id}` (no fallback: nothing
  prints until an admin sets the address; the environment's address is
  only an extra scan base), print 1–500 per job for a product and 1–10
  for a unit or bike, label unique items per unit, price through
  `private.selling_price` (NULL no price line, 0 → $0.00), never carry
  cost, consignor, ownership or notes, render from the job's snapshot only
  while the job is open, and are confirmed printed or failed by staff. The
  anonymous half of SPEC §31 is proven at the database (`labels.test.ts`:
  anon and staff read identical `reporting.public_items` rows) and shown
  to staff in "What the public sees" until Phase 11. Deferred: the
  purchase receive screen's "Print N labels" shortcut, until Phase 7 is
  integrated
  ([R-029](docs/RISKS.md#r-029--the-purchase-receive-screen-has-no-print-n-labels-shortcut-yet));
  untested on a real printer and iOS
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
| Purchasing (Phase 7) | On `feat/p7-purchasing` 7fed53f (local and origin equal: pushed; at the end of Phase 8 step 4) | Not verified here | Not deployed |
| Staff email OTP | On `feat/auth-email-otp`, checked out in the worktree `bicii-book-wt` (local 35d7a63, origin 4b3eadd at the end of Phase 8 step 4) | Not verified here | Not deployed |
| Consignment core and consigned job parts (Phase 6 step 1: D44, D45, D48, D50–D52) | Database only, `feat/p6-consignment` 13fe3f3, fe6ac53, 365bdd7; no screens yet | Locally on 365bdd7: `npm run db:reset` pass (34 migrations, `34\|20261004003400`), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 86 files / 1225 tests passed; `test:e2e` not run (no screen changed); docs link check 34 files / 506 links / 0 problems | Not deployed |
| Sales, restocks, refunds, settlements, consignor ledgers, sale reporting, read RPCs, search, Phase 6 seed (Phase 6 step 2: D44, D46–D49) | Database only, `feat/p6-consignment` 2d2ba0c, 2c402b2; no screens yet | Locally at 2c402b2 + docs: `npm run db:reset` pass (37 migrations, latest `20261004003700`, seed applied), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 89 files / 1298 tests passed, `npm run build` pass, `npm run test:e2e` 106 passed (phone and tablet, 9.7 min), docs link check 34 files / 509 links / 0 problems | Not deployed |
| Consignment screens and consigned job parts (Phase 6 step 3: D4, D27 changed, D44–D48, D50–D52) | Yes, `feat/p6-consignment` 2137316, 5627bb0, ecc90f1 and the step 3 docs commit: `/consignment` (consignors, items), `/consignment/consignors/[id]`, `/consignment/items/[id]`, intake, terms, charges, returns, settlements and reversals; consigned stock in Add part; consigned stock marked on the product, unit and job pages; `C-` scan and search | Locally at ecc90f1 + docs: `npm run check` pass, `npm run check:types` pass, `npm test` 91 files / 1341 tests passed, `npm run test:e2e` 110 passed on phone and tablet (12.4 min; its web server ran `npm run build`, pass), docs link check 34 files / 520 links / 0 problems | Not deployed |
| Sales screens, refunds, restocks, Today and nav wiring, journey 4 (Phase 6 step 4: D7, D46, D48, D49, D51, D53) | Yes, `feat/p6-consignment` 67b1607, b65484a, 543760f, eccd687 and the closing docs commit: `/sales`, `/sales/[id]`, `RecordSaleSheet` / `SaleablePicker`, `RefundSheet`, `RestockControl`; Sell on the consignment item, unit and product pages; "Sold on S-…" with Restock on the unit page; `S-` in `/q` and the `sale` search kind; Sales in More; Today's consignment tiles linked | Locally: `npm run check` pass, `npm run check:types` pass (no diff), `npm test` 92 files / 1364 tests passed, `npm run build` pass (inside `test:e2e`), `npm run test:e2e` 118 passed on phone and tablet (13.3 min; an earlier run had 2 failures, the Today past-day note's old wording in `today.spec.ts`, fixed in eccd687), docs link check 34 files / 528 links / 0 problems | Not deployed |
| Phase 6 review fixes (D54, D55; D47 after archiving; the Shopify-key refusal; one-transaction intake; D48 list count; UI fixes; refund and restock races) | Yes, `feat/p6-consignment` 32f19e6 (the follow-up commit corrects DATA-MODEL's authority and applied state, PLAN's Phase 6 test list and this file's owner-question list) | Locally: `npm run db:reset` pass (37 migrations, seed applied), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 93 files / 1384 tests passed, `npm run test:e2e` 118 passed on phone and tablet (11.8 min; its web server ran `npm run build`, pass), docs link check 34 files / 543 links / 0 problems; rerun at the documentation follow-up: `npm run db:reset` pass (`37\|20261004003700`), `npm run db:types` no diff, `npm run check` pass, `npm run check:types` pass, `npm test` 93 files / 1384 tests passed, `npm run test:e2e` 118 passed on phone and tablet (11.6 min, build inside, no failures, flaky or skipped), docs link check 34 files / 545 links / 0 problems | Not deployed |
| Labels database (Phase 8 step 1: D9 base, D56–D59) | Database only, `feat/p8-labels` 1294e36 (decisions), 2c4f6a3 (migration `20261004003800_labels`, seed, types, tests, docs); no screens yet | Locally at 2c4f6a3: `npm run db:reset` pass (`38\|20261004003800`, seed applied; devstack restarted), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 95 files / 1414 tests passed (incl. `labels.test.ts` 25 tests, `labels-concurrency.test.ts` 5 tests, `meta.test.ts`); `test:e2e` not run (no screen changed); docs link check 35 files / 581 links / 0 problems (after this update) | Not deployed |
| Printing library, QR base in the app, print view, PDF route, print history (Phase 8 step 2: D9, D56, D58, D59) | Yes, `feat/p8-labels` 967b99b (QR addresses from shop settings), cd4bbb6 (printing, domain, actions, views, route, history, docs) and the commit with this update | Locally at cd4bbb6: `npm run check` pass, `npm test` 106 files / 1559 tests passed (incl. `tests/unit/printing/` with ZXing decoding the rasterised QR, `qr-base`, `qr-base-sources`, `print-job-controls`, `tests/db/labels-domain.stack.test.ts`), `npm run build` pass, `npm run test:e2e` 130 passed on phone and tablet (14.4 min; build inside; `print-view.spec.ts` 6 × 2), docs link check 35 files / 589 links / 0 problems (after this update); `check:types` not run (no migration) | Not deployed |
| Print flow on the record pages, Labels and printers settings, labels E2E (Phase 8 step 3: D9, D56–D59) | Yes, `feat/p8-labels` 41c1a5c (code and unit tests) and the commit with this update (E2E, docs): `PrintLabelButton` / `PrintLabelSheet`, the Labels card on product, unit and bike pages, `?print=1&qty=N&reprint=…`, `/settings/labels` (QR address, printers, templates), the decimal `NumberInput` stepper | Locally on the final tree: `npm run check` pass, `npm test` 108 files / 1587 tests passed (after `npm run db:reset` and a devstack restart; `print-label.test.tsx`, `printing/print-sheet.test.ts`, the decimal stepper, `publicSiteUrlInputSchema`, `resolvePrintPreset`), `npm run test:e2e` 146 passed on phone and tablet (14.5 min; build inside, pass; `labels.spec.ts` 8 × 2; a first run had 4 failures, a "Units" list-name clash in `inventory.spec.ts` and `sales.spec.ts`, fixed by naming the Labels card's list "Unit labels"), docs link check 35 files / 597 links / 0 problems; `check:types` not run (no migration) | Not deployed |
| Journey label steps and Phase 8 closing docs (Phase 8 step 4: D9, D56–D59) | Yes, `feat/p8-labels` afaf288 (journey 3: ten identical labels through the PDF adapter; journey 4: one U- label for the consigned bike at the price "What the public sees" shows; shared `tests/e2e/label-helpers.ts`) and the closing docs commit with this update | Locally on the final tree: `npm run check` pass, `npm run check:types` pass (no diff), `npm test` 108 files / 1587 tests passed (after `npm run db:reset` and a devstack restart), `npm run test:e2e` 146 passed, 73 on phone and 73 on tablet, 0 failed (14.2 min; `npm run build` inside, pass), docs link check 35 files / 624 links / 0 problems (on the final docs) | Not deployed |
| Phase 8 review fixes | Yes, `feat/p8-labels`, the commit with this update: the bike page asks for labels only after `notFound()` (an unknown bike is a 404 again) and `label_preview`'s P0002 is "unavailable" (`not_found`); the print view keeps only Back, status and Print / Open PDF sticky, the confirmation in the flow; printing from a `?print=1` deep link replaces its history entry, and `createPrintJobAction` refreshes; printers are a radio list in the sheet; "Did the label print correctly?" for one; the job page's printer name and type on separate rows; the template sheet's field errors on their fields after a change or Save; tests: a signed-in customer gets 403 from the PDF route and the print view, the default-printer and default-template races, the stack test independent of E2E residue, the unit label E2E on a unit it creates | Locally on the final tree: `npm run check` pass, `npm run check:types` pass (no diff), `npm test` 109 files / 1597 tests passed (before and right after an E2E run, on a `bicii_dev` holding its jobs), `npm run test:e2e` 150 passed, 75 on phone and 75 on tablet (13.3 min; `npm run build` inside, pass; a first run had 2 failures, the new unit label test asserting a condition the label truncates, fixed), the two new races fail with `create_print_job`'s retry cut to one attempt (migration restored), docs link check 35 files / 625 links / 0 problems | Not deployed |
| Shopify inbound database (Phase 10 step 1: D80–D89) | Database only, `feat/p10-shopify` ef1a613 (decisions), 8ea4dbd (migrations `20261004003900`, `20261004004000`, seed, types, fixtures, tests, docs); no route, service layer or screens | Locally on the final tree: `npm run db:reset` pass (`40\|20261004004000`, seed applied; devstack restarted), `npm run db:types` committed, `npm run check:types` pass (no diff), `npm run check` pass, `npm test` 111 files / 1666 tests passed (incl. `shopify-webhooks.test.ts` 61 tests, `meta.test.ts`, `shopify-fixtures.test.ts`), `npm run test:e2e` 152 passed on phone and tablet (16.4 min; build inside, pass; run beside the parallel track's E2E), docs link check 36 files / 666 links / 0 problems | Not deployed |
| Shopify outbound database (Phase 10 step 2: D81, D83, D84, D86, D87) | Database only, `feat/p10-shopify` 4196a90 (migration `20261004004100_shopify_product_sync`, seed, types, fixtures, tests, docs); no service layer, route or screens | Locally on the final tree: `npm run db:reset` pass (`41\|20261004004100`, seed applied; devstack restarted), `npm run db:types` committed, `npm run check:types` pass (no diff, after staging), `npm run check` pass, `npm test` 112 files / 1694 tests passed (incl. `shopify-sync.test.ts` 28 tests, `shopify-webhooks.test.ts`, `inventory-publication.test.ts` with the new column, `labels.test.ts`, `meta.test.ts`), docs link check 37 files / 670 links / 0 problems (with this update); `npm run test:e2e` not run (no screen changed) | Not deployed |
| Shopify service layer (Phase 10 step 3: D81, D83, D84, D87, D88) | Yes, `feat/p10-shopify` 92b3335, c56143b, 37f4c37, 27a7be8: `src/lib/integrations/shopify/` (config, ids, hmac, admin, graphql-admin, fake-admin, fake-ids, client, desired-state, deps, sync, queue, webhooks, cron), `src/app/api/shopify/webhooks/route.ts`, `src/app/api/cron/integrations/route.ts`, `vercel.json`, the proxy matcher, `SHOPIFY_ADAPTER` / `CRON_SECRET` in env.ts; no migration, no screen | Locally on the final tree: `npm run check` pass; `npm test` 123 files / 1849 tests passed (unit 71 / 878, db 52 / 971; with `BICII_REQUIRE_STACK=1`, so `shopify.stack.test.ts` ran, both on the persisted `bicii_dev` and again right after E2E reset it); `npm run build` pass; `npm run test:e2e` 150 passed on phone and tablet, 0 failed (15.0 min; build inside; same 150 tests as the Phase 8 review, no spec changed); a manual smoke of the built app on a scratch port: cron 401 without the bearer and 200 with the summary, a signed webhook 200 then `duplicate: true`, a bad HMAC 401, GET 405; docs link check 36 files / 711 links / 0 problems; `db:reset`, `db:types`, `check:types` not run (no migration) | Not deployed |
| Shopify screens, Today's integration row, journey 5 (Phase 10 step 4: D80–D89) | Yes, `feat/p10-shopify` 132a1ae, 3892eeb, 3407fec and the closing docs commit: the product page's Online (Shopify) card; `/shopify`, `/shopify/queue`, `/shopify/products`, `/shopify/events`, `/shopify/events/[id]` (admins); `src/lib/domain/shopify.ts`, `src/lib/shopify.ts`, `src/lib/shopify-forms.ts`, `src/components/domain/shopify/`; `integration_failed` in `src/lib/reports.ts`; no migration | Locally on the final tree: `npm run check` pass; `npm test` 124 files / 1873 tests passed (unit 72 / 902; `BICII_REQUIRE_STACK=1`; before and after E2E reset `bicii_dev`); `npm run test:e2e` 160 passed, 80 per project, 0 failed (15.0 min; `npm run build` inside, pass; `shopify.spec.ts` 5 × 2; earlier runs of that spec alone failed on test timing — a streamed product page read too early, a click not yet navigated — and on a retry path that assumed the in-memory Shopify survived a server restart; all fixed in the spec); docs link check 36 files / 724 links / 0 problems; `db:reset`, `db:types`, `check:types` not run (no migration) | Not deployed |
| Phase 9 reporting, public-site integration, hardware adapter | No | Not built | Not deployed |

Command-level evidence: [ENGINEERING.md](docs/ENGINEERING.md#commands).

## Work location and continuation

- PR stack: `main` (1594c78) ← `docs/build-plan` (#1) ← `feat/m1.1-foundation`
  (#2) ← … ← `feat/p2-appointments` (#7) ← `feat/docs-stack`. #1–#7 are open
  drafts, pushed and equal to origin.
- `feat/docs-stack` (6507449): pushed, equal to `origin/feat/docs-stack`.
- `feat/p10-shopify` (head: the commit with this update): stacked on
  `feat/p8-labels` (3f09d22); Phase 10 complete, committed locally, not
  pushed (`git for-each-ref` shows no `origin/feat/p10-shopify`): ef1a613,
  8ea4dbd, 792ce96 (step 1), 4196a90, 8ec0fba (step 2), 92b3335, c56143b,
  37f4c37, 27a7be8, 3f5970b (step 3), 132a1ae, 3892eeb, 3407fec and the
  commit with this update (step 4).
- `feat/p8-labels` (3f09d22, equal to `origin/feat/p8-labels` on
  2026-10-06; the rest of this entry is as of Phase 8): stacked on
  `feat/p6-consignment` (c791d4b, equal to `origin/feat/p6-consignment`
  on 2026-10-06); Phase 8 complete and pushed by the orchestrator. Step 1:
  1294e36, 2c4f6a3, c5de022; step 2: 967b99b, cd4bbb6, 9608931; step 3:
  41c1a5c, abe7e6c; step 4: afaf288 and 0dc6a41; review fixes: the
  commit with this update. Origin
  holds an older orchestrator auto-save, `wip/feat/p8-labels` (889294d,
  not reviewed).
- `feat/p6-consignment` (pushed by the orchestrator; as of Phase 8 the
  entry read: committed locally, not pushed): stacked on `feat/docs-stack` (34783d6 decisions D44–D53, step 1's commits, step 2's
  2d2ba0c and 2c402b2, step 3's 2137316, 5627bb0, ecc90f1 and d8ba313,
  step 4's 67b1607, b65484a, 543760f, eccd687 and a8967c7, the review
  fixes 32f19e6, and the documentation follow-up commit with this
  update). There is no origin branch of that name;
  origin holds an orchestrator auto-save, `wip/feat/p6-consignment`
  (ed7d27e, a snapshot of uncommitted work, not reviewed). The
  orchestrator pushes it and opens its PR on top of `feat/docs-stack`.
- Parallel track: a second worktree of this clone (`bicii-book-wt`, see
  `git worktree list`; on `feat/staff-roles` at 2026-10-06) with its own
  database builds purchasing, email OTP and staff roles. `feat/p7-purchasing` (7fed53f, equal to origin) and
  `feat/auth-email-otp` (local 35d7a63, origin 4b3eadd: the local branch
  is ahead or differs; owned by that track) at the end of Phase 8 step 4; purchasing forks from PR #6 (no
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
  [R-021](docs/RISKS.md#r-021--reports-overstate-net-sales-after-a-refund-or-restock)),
  13 (D55: should backdating an in-store sale more than a few days need
  a permission?,
  [R-027](docs/RISKS.md#r-027--a-sale-can-be-backdated-without-limit-by-any-staff-member));
  Phase 8 adds rows 15 (confirm D56–D59 and the D9 base: no fallback, and
  changing the address orphans printed labels,
  [R-013](docs/RISKS.md#r-013--changing-the-qr-base-leaves-printed-labels-on-the-old-address))
  and 16 (the next main-line decision range,
  [R-028](docs/RISKS.md#r-028--the-main-line-decision-range-d43d59-is-exhausted)).
- Phase 10 risks: R-040–R-044 (step 1) and, from step 2,
  [R-045](docs/RISKS.md#r-045--the-buy-online-link-follows-overall-availability-not-online-stock)
  (Buy online follows overall availability, not online stock) and
  [R-046](docs/RISKS.md#r-046--the-product-sync-queue-is-coarse) (a
  shop-wide in-flight check; no-op syncs of unpublished products; one
  2-minute deferral per online order); from step 3,
  [R-047](docs/RISKS.md#r-047--the-live-shopify-adapter-is-unverified-against-a-real-store)
  (the GraphQL documents and error codes are unverified),
  [R-048](docs/RISKS.md#r-048--the-rejected-delivery-limit-is-per-server-instance)
  (the rejected limit is per instance) and
  [R-049](docs/RISKS.md#r-049--queued-integration-jobs-wait-for-a-trigger)
  (jobs wait for the cron, a webhook or staff; Hobby crons are daily);
  step 4 updated
  [R-042](docs/RISKS.md#r-042--earlier-online-sales-keep-no-customer-after-a-shopify-customer-is-linked)
  (the sale page shows a later-linked customer; the Sales list and the
  customer page do not yet) and
  [R-011](docs/RISKS.md#r-011--shopify-is-not-built-and-will-be-fixture-tested-only)
  (built; still fixture-tested only).
- Running costs, backups, recovery: none yet ([OPERATIONS.md](docs/OPERATIONS.md)).
