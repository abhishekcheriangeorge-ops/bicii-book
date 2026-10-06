# Current state

Updated: 2026-10-06, `feat/p8-labels` (01cb3da: `origin/main` a1aebf6
merged into labels, then labels' "Print N labels" on purchase receipts)
merged into `feat/p10-shopify` (a merge commit, no rebase; Shopify had
already merged `origin/main` at 3109818), gate on the integrated tree
below. Evidence checked: `git fetch`, `git status`, `git log`,
`git worktree list` and `git merge-base --all` (a1aebf6 and 3f09d22
before the merge) at the start; local gates on the merged tree (below).
Earlier rows: their own gates as recorded.

## Return in two minutes

- Purpose: the staff Admin for BICII's workshop, over one Supabase backend
  shared with the public site ([PRODUCT.md](docs/PRODUCT.md)).
- Current objective: Phase 8 (labels) and Phase 10 (Shopify) are
  complete with their review fixes, and `feat/p10-shopify` holds them
  with everything on `origin/main` (a1aebf6): purchasing, staff email
  sign-in and the three staff roles. Main was merged into each branch on
  its own, then `feat/p8-labels` into `feat/p10-shopify` (the merge
  commit with this update). Every conflict kept both sides: the seed runs
  Phase 7's part after Phase 6's and before Phase 8's print jobs and Phase
  10's Shopify part (Phase 7 creates no products, so Phase 10's P-000027 …
  P-000033 and S-000005 are unchanged); the labels risks numbered
  R-030–R-032 before the ranges existed collided with purchasing's and
  are R-075–R-077 (AGENTS.md's RISKS ranges name them); the labels and
  Shopify owner questions are rows 21–25 after main's 15–20;
  `tests/fixtures/api-surface.ts` holds the label, Shopify and purchasing
  grants; the service role's allow-list (`SERVICE_ROLE_FUNCTIONS`) gained
  `note_sign_in_attempt`; and the labels E2E's signed-in customer gets its
  session from the API (`sessionCookiesFor`), because the login form now
  signs non-staff out (D70). No database object is defined both by a
  labels or Shopify migration (`20261004003800` to `20261004004100`) and
  by a later `20261005…`/`20261006…` migration
  ([DATA-MODEL "Authority"](docs/DATA-MODEL.md#authority-applied-state-and-implementation-status)),
  so the label and Shopify guards follow the roles unchanged: every role
  prints labels; a manager holds `manage_inventory` (Publish online, Sync
  now, product-sync retries) but is not an admin, so Labels and printers
  and the Shopify settings stay admin-only (D86, D91). Labels' follow-up
  is here too: the purchase order's receipts offer "Print N labels" per
  received line
  ([R-029](docs/RISKS.md#r-029--the-purchase-receive-screen-has-no-print-n-labels-shortcut-yet),
  resolved). Committed locally, not pushed.
- Next action: the orchestrator pushes `feat/p8-labels` and
  `feat/p10-shopify` (no upstream yet; it contains `feat/p8-labels` and
  `origin/main`) and opens the PRs against `main` (labels first, then
  Shopify, or the Shopify PR alone), answering the documentation-impact
  question of
  [.github/pull_request_template.md](.github/pull_request_template.md),
  and runs CI with the `e2e` label. The owner answers D89's OPEN points
  and confirms D80–D88 (rows 23–25 of the
  [owner questions](docs/PRODUCT.md#open-assumptions-and-owner-questions))
  and the label defaults (row 21).
- Before any hosted deploy of this release: configure SMTP and run the
  REQUIRED password reset in
  [RUNBOOK](docs/RUNBOOK.md#hosted-supabase-projects-staging-and-production)
  ([R-035](docs/RISKS.md#r-035--logins-created-before-email-codes-keep-a-known-password-until-the-pre-deploy-reset),
  [R-039](docs/RISKS.md#r-039--hosted-email-delivery-and-auth-settings-are-unverified)),
  and choose the Vercel plan for the 5-minute cron
  ([R-049](docs/RISKS.md#r-049--queued-integration-jobs-wait-for-a-trigger)).
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
  to staff in "What the public sees" until Phase 11. New stock from a
  purchase order is labelled from the order's receipts ("Print N labels",
  [R-029](docs/RISKS.md#r-029--the-purchase-receive-screen-has-no-print-n-labels-shortcut-yet),
  resolved at the merge); untested on a real printer and iOS
  ([R-075](docs/RISKS.md#r-075--label-output-is-unverified-on-a-real-label-printer-and-on-ios));
  print success is confirmed by hand
  ([R-076](docs/RISKS.md#r-076--print-success-is-confirmed-by-hand)).
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
| Labels database (Phase 8 step 1: D9 base, D56–D59) | Database only, `feat/p8-labels` 1294e36 (decisions), 2c4f6a3 (migration `20261004003800_labels`, seed, types, tests, docs); no screens yet | Locally at 2c4f6a3: `npm run db:reset` pass (`38\|20261004003800`, seed applied; devstack restarted), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass, `npm test` 95 files / 1414 tests passed (incl. `labels.test.ts` 25 tests, `labels-concurrency.test.ts` 5 tests, `meta.test.ts`); `test:e2e` not run (no screen changed); docs link check 35 files / 581 links / 0 problems (after this update) | Not deployed |
| Printing library, QR base in the app, print view, PDF route, print history (Phase 8 step 2: D9, D56, D58, D59) | Yes, `feat/p8-labels` 967b99b (QR addresses from shop settings), cd4bbb6 (printing, domain, actions, views, route, history, docs) and the commit with this update | Locally at cd4bbb6: `npm run check` pass, `npm test` 106 files / 1559 tests passed (incl. `tests/unit/printing/` with ZXing decoding the rasterised QR, `qr-base`, `qr-base-sources`, `print-job-controls`, `tests/db/labels-domain.stack.test.ts`), `npm run build` pass, `npm run test:e2e` 130 passed on phone and tablet (14.4 min; build inside; `print-view.spec.ts` 6 × 2), docs link check 35 files / 589 links / 0 problems (after this update); `check:types` not run (no migration) | Not deployed |
| Print flow on the record pages, Labels and printers settings, labels E2E (Phase 8 step 3: D9, D56–D59) | Yes, `feat/p8-labels` 41c1a5c (code and unit tests) and the commit with this update (E2E, docs): `PrintLabelButton` / `PrintLabelSheet`, the Labels card on product, unit and bike pages, `?print=1&qty=N&reprint=…`, `/settings/labels` (QR address, printers, templates), the decimal `NumberInput` stepper | Locally on the final tree: `npm run check` pass, `npm test` 108 files / 1587 tests passed (after `npm run db:reset` and a devstack restart; `print-label.test.tsx`, `printing/print-sheet.test.ts`, the decimal stepper, `publicSiteUrlInputSchema`, `resolvePrintPreset`), `npm run test:e2e` 146 passed on phone and tablet (14.5 min; build inside, pass; `labels.spec.ts` 8 × 2; a first run had 4 failures, a "Units" list-name clash in `inventory.spec.ts` and `sales.spec.ts`, fixed by naming the Labels card's list "Unit labels"), docs link check 35 files / 597 links / 0 problems; `check:types` not run (no migration) | Not deployed |
| Journey label steps and Phase 8 closing docs (Phase 8 step 4: D9, D56–D59) | Yes, `feat/p8-labels` afaf288 (journey 3: ten identical labels through the PDF adapter; journey 4: one U- label for the consigned bike at the price "What the public sees" shows; shared `tests/e2e/label-helpers.ts`) and the closing docs commit with this update | Locally on the final tree: `npm run check` pass, `npm run check:types` pass (no diff), `npm test` 108 files / 1587 tests passed (after `npm run db:reset` and a devstack restart), `npm run test:e2e` 146 passed, 73 on phone and 73 on tablet, 0 failed (14.2 min; `npm run build` inside, pass), docs link check 35 files / 624 links / 0 problems (on the final docs) | Not deployed |
| Phase 8 review fixes | Yes, `feat/p8-labels`, the commit with this update: the bike page asks for labels only after `notFound()` (an unknown bike is a 404 again) and `label_preview`'s P0002 is "unavailable" (`not_found`); the print view keeps only Back, status and Print / Open PDF sticky, the confirmation in the flow; printing from a `?print=1` deep link replaces its history entry, and `createPrintJobAction` refreshes; printers are a radio list in the sheet; "Did the label print correctly?" for one; the job page's printer name and type on separate rows; the template sheet's field errors on their fields after a change or Save; tests: a signed-in customer gets 403 from the PDF route and the print view, the default-printer and default-template races, the stack test independent of E2E residue, the unit label E2E on a unit it creates | Locally on the final tree: `npm run check` pass, `npm run check:types` pass (no diff), `npm test` 109 files / 1597 tests passed (before and right after an E2E run, on a `bicii_dev` holding its jobs), `npm run test:e2e` 150 passed, 75 on phone and 75 on tablet (13.3 min; `npm run build` inside, pass; a first run had 2 failures, the new unit label test asserting a condition the label truncates, fixed), the two new races fail with `create_print_job`'s retry cut to one attempt (migration restored), docs link check 35 files / 625 links / 0 problems | Not deployed |
| Shopify inbound database (Phase 10 step 1: D80–D89) | Database only, `feat/p10-shopify` ef1a613 (decisions), 8ea4dbd (migrations `20261004003900`, `20261004004000`, seed, types, fixtures, tests, docs); no route, service layer or screens | Locally on the final tree: `npm run db:reset` pass (`40\|20261004004000`, seed applied; devstack restarted), `npm run db:types` committed, `npm run check:types` pass (no diff), `npm run check` pass, `npm test` 111 files / 1666 tests passed (incl. `shopify-webhooks.test.ts` 61 tests, `meta.test.ts`, `shopify-fixtures.test.ts`), `npm run test:e2e` 152 passed on phone and tablet (16.4 min; build inside, pass; run beside the parallel track's E2E), docs link check 36 files / 666 links / 0 problems | Not deployed |
| Shopify outbound database (Phase 10 step 2: D81, D83, D84, D86, D87) | Database only, `feat/p10-shopify` 4196a90 (migration `20261004004100_shopify_product_sync`, seed, types, fixtures, tests, docs); no service layer, route or screens | Locally on the final tree: `npm run db:reset` pass (`41\|20261004004100`, seed applied; devstack restarted), `npm run db:types` committed, `npm run check:types` pass (no diff, after staging), `npm run check` pass, `npm test` 112 files / 1694 tests passed (incl. `shopify-sync.test.ts` 28 tests, `shopify-webhooks.test.ts`, `inventory-publication.test.ts` with the new column, `labels.test.ts`, `meta.test.ts`), docs link check 37 files / 670 links / 0 problems (with this update); `npm run test:e2e` not run (no screen changed) | Not deployed |
| Shopify service layer (Phase 10 step 3: D81, D83, D84, D87, D88) | Yes, `feat/p10-shopify` 92b3335, c56143b, 37f4c37, 27a7be8: `src/lib/integrations/shopify/` (config, ids, hmac, admin, graphql-admin, fake-admin, fake-ids, client, desired-state, deps, sync, queue, webhooks, cron), `src/app/api/shopify/webhooks/route.ts`, `src/app/api/cron/integrations/route.ts`, `vercel.json`, the proxy matcher, `SHOPIFY_ADAPTER` / `CRON_SECRET` in env.ts; no migration, no screen | Locally on the final tree: `npm run check` pass; `npm test` 123 files / 1849 tests passed (unit 71 / 878, db 52 / 971; with `BICII_REQUIRE_STACK=1`, so `shopify.stack.test.ts` ran, both on the persisted `bicii_dev` and again right after E2E reset it); `npm run build` pass; `npm run test:e2e` 150 passed on phone and tablet, 0 failed (15.0 min; build inside; same 150 tests as the Phase 8 review, no spec changed); a manual smoke of the built app on a scratch port: cron 401 without the bearer and 200 with the summary, a signed webhook 200 then `duplicate: true`, a bad HMAC 401, GET 405; docs link check 36 files / 711 links / 0 problems; `db:reset`, `db:types`, `check:types` not run (no migration) | Not deployed |
| Shopify screens, Today's integration row, journey 5 (Phase 10 step 4: D80–D89) | Yes, `feat/p10-shopify` 132a1ae, 3892eeb, 3407fec and the closing docs commit: the product page's Online (Shopify) card; `/shopify`, `/shopify/queue`, `/shopify/products`, `/shopify/events`, `/shopify/events/[id]` (admins); `src/lib/domain/shopify.ts`, `src/lib/shopify.ts`, `src/lib/shopify-forms.ts`, `src/components/domain/shopify/`; `integration_failed` in `src/lib/reports.ts`; no migration | Locally on the final tree: `npm run check` pass; `npm test` 124 files / 1873 tests passed (unit 72 / 902; `BICII_REQUIRE_STACK=1`; before and after E2E reset `bicii_dev`); `npm run test:e2e` 160 passed, 80 per project, 0 failed (15.0 min; `npm run build` inside, pass; `shopify.spec.ts` 5 × 2; earlier runs of that spec alone failed on test timing — a streamed product page read too early, a click not yet navigated — and on a retry path that assumed the in-memory Shopify survived a server restart; all fixed in the spec); docs link check 36 files / 724 links / 0 problems; `db:reset`, `db:types`, `check:types` not run (no migration). **Correction (review):** that `test:e2e` count is not reproducible on this step's tree: the overview test failed every time on tablet (a strict-mode locator matched the rail's and the More list's Shopify links), so the real result was 159 passed, 1 failed; fixed in 4f8efa8 | Not deployed |
| Phase 10 review fixes (D81, D84, D86, D87) | Yes, `feat/p10-shopify` da13884 (database: one effect across webhook ids, a dismissal is final, `earlier_delivery_skipped`, Buy online only on what Shopify sells, refunds named after their order), 4b60fb9 (runner claim window inside `maxDuration`, the live adapter off in Preview without `SHOPIFY_ALLOW_PREVIEW`, best-effort runs after committed writes), 2723548 (Shopify admin-only in More and the rail, the queue sheet on the live row, the offline reason, footer buttons and focus in the link sheets), 4f8efa8 (E2E), and the docs commit with this update (RUNBOOK Preview, Hobby and rotation; PLAN §4 and D84/D87; ADR-020; R-040, R-045, R-047, R-049) | Locally on the final tree: `npm run db:reset` pass (41 migrations to `20261004004100`, seed applied; devstack restarted), `npm run check` pass, `npm run check:types` pass (no diff), `npm test` 126 files / 1898 tests passed, `npm run build` pass, `npm run test:e2e` 160 passed, 80 per project, 0 failed, 0 flaky (15.3 min; build inside, pass), docs link check 36 files / 728 links / 0 problems | Not deployed |
| Staff roles (D90–D94: admin, manager and mechanic; `private.role_implies`; "Extra access" exceptions; role administration; refunds for managers; seed `manager@bicii.test`; staff screens with the role picker and invites by role) | Yes, `feat/staff-roles`: 0657397, 28de036 (database), bfc5ea2, dd94665 (app model, guards, refunds, profile), ae9763b, 080a796 (staff screens, E2E), a5441dd and the evidence commit (integration review, documentation), then the review-fixes commit after b83ce42; local only, not pushed | Locally after the review fixes (one-time clean-up of implied exceptions in `20261006000200` via `private.drop_implied_exceptions()`; two-connection D92 race tests; `update_staff` `expected_role` with `staff_role_changed`; shared `REASON_MAX_LENGTH`; manager wording; `ExtraAccessBadge`; focus on Cancel; PLAN D11, R-052, R-054): `npm run db:reset` pass (`47\|20261006000300`), `npm run db:types` committed (the `expected_role` argument), `npm run check` pass, `npm run check:types` pass, `BICII_REQUIRE_STACK=1 npm test` 113 files / 1686 tests passed (unit 57 / 738, database 56 / 948; both new concurrency tests failed once by hand with the refusal trigger's lock weakened to `FOR KEY SHARE`, then the lock was restored), `npm run build` pass, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:e2e` 158 passed on phone and tablet (15.1 min, no failures, flaky or skipped), docs link check 37 files / 691 links / 0 problems. Before that, locally (database `bicii_dev_wt`) after the step 4 review fixes (a5441dd): `npm run check` pass, `npm run check:types` pass (no diff), `BICII_REQUIRE_STACK=1 npm test` 113 files / 1680 tests passed (unit 57 / 737, database 56 / 943), `npm run build` pass, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:e2e` 158 passed on phone and tablet (16.8 min, no failures, flaky or skipped; it reset the database: 47 migrations, `47\|20261006000300`, seed applied), docs link check 37 files / 690 links / 0 problems. Earlier steps: step 1 112 / 1632 and 152 E2E; step 2 112 / 1669 and 152 E2E; step 3 113 / 1680 and 158 E2E, all passing | Not deployed |
| Merge of `origin/main` (a1aebf6: purchasing, email sign-in, staff roles) into labels and Shopify; labels risks R-075–R-077 | Yes, `feat/p10-shopify`, the merge commit with this update (with the conflict resolutions, `sessionCookiesFor`, the service-role allow-list and every document) | Locally on the merged tree (database `bicii_dev`): `npm run db:reset` pass (`51\|20261006000300`, seed applied; devstack restarted with its mail catcher), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass (no diff), `BICII_REQUIRE_STACK=1 npm test` 146 files / 2200 tests passed (106 s, no skips), `npm run build` pass, `npm run test:e2e` 200 passed, 100 per project, 0 failed, flaky or skipped (20.3 min; build inside, pass; a first run had 1 failure, tablet `today.spec.ts` "Today shows low stock": the labels spec's and the purchasing spec's leftover low-stock products together pushed the seeded sealant off Today's five rows; `createProduct` now sets a reorder point only when asked and the labels spec sets none, TESTING), docs link check 39 files / 868 links / 0 problems | Not deployed |
| Merge of `origin/main` (a1aebf6: purchasing, email sign-in, staff roles) into labels; labels risks R-075–R-077; receipts' Print N labels (R-029); the manager labels test | Yes, `feat/p8-labels`: the merge commit (conflict resolutions, `sessionCookiesFor`, `createProduct`'s optional reorder point, the manager labels test, every document) and the follow-up commit with this update (`printLabelsPath` and the receipt link, the journey 3 step, docs) | Locally on the merged tree with the follow-up (database `bicii_dev`): `npm run db:reset` pass (`48|20261006000300`, seed applied; devstack restarted), `npm run db:types` committed, `npm run check` pass, `npm run check:types` pass (no diff), `BICII_REQUIRE_STACK=1 npm test` 129 files / 1900 tests passed (unit 70 / 904, database 59 / 996; 116 s, no skips), `npm run build` pass, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:e2e` 190 passed, 95 per project, 0 failed, flaky or skipped (20.2 min; build inside, pass), docs link check 38 files / 0 problems | Not deployed |
| Merge of `feat/p8-labels` (main merged into labels, and its receipts' Print N labels, R-029) into Shopify; Shopify refund jobs follow the roles (D94) | Yes, `feat/p10-shopify`: the merge commit and the follow-up commit with this update | GATE_PLACEHOLDER | Not deployed |
| Phase 9 reporting, public-site integration, hardware adapter | No (reporting is being built on `feat/p9-reporting`) | Not built here | Not deployed |

Command-level evidence: [ENGINEERING.md](docs/ENGINEERING.md#commands).

## Work location and continuation

- `main` on origin (a1aebf6) holds PRs #1–#11 and #13: the stack through
  appointments, the docs stack, Phase 6, purchasing, staff email sign-in
  and the staff roles. The local `main` ref is stale; use `origin/main`.
- `feat/p10-shopify` (head: the follow-up commit with this update, on the
  merge of `feat/p8-labels` 01cb3da into 3109818, 2026-10-06): stacked on
  `feat/p8-labels`, so it holds `origin/main` (a1aebf6, merged into both
  branches), labels with their Print N labels follow-up, and Phase 10.
  Committed locally, not pushed (`git for-each-ref` shows no
  `origin/feat/p10-shopify`; origin holds only the auto-save
  `wip/feat/p10-shopify`). Phase 10: ef1a613, 8ea4dbd, 792ce96 (step 1),
  4196a90, 8ec0fba (step 2), 92b3335, c56143b, 37f4c37, 27a7be8, 3f5970b
  (step 3), 132a1ae, 3892eeb, 3407fec, 92e4aa6 (step 4), da13884, 4b60fb9,
  2723548, 4f8efa8, 7fb9c1a (review fixes), 3109818 (merge of `main`).
- `feat/p8-labels` (01cb3da: the merge of `origin/main` a1aebf6 into
  3f09d22 and the Print N labels follow-up, 2026-10-06): committed
  locally, not pushed (`origin/feat/p8-labels` is 3f09d22, the end of
  Phase 8 with its review fixes). Stacked on `feat/p6-consignment`
  (c791d4b, now in `main`). Step 1:
  1294e36, 2c4f6a3, c5de022; step 2: 967b99b, cd4bbb6, 9608931; step 3:
  41c1a5c, abe7e6c; step 4: afaf288 and 0dc6a41; review fixes: 3f09d22.
  Origin
  holds an older orchestrator auto-save, `wip/feat/p8-labels` (889294d,
  not reviewed).
- `feat/p6-consignment` (c791d4b): merged into `main` (PR #11).
- Parallel track: a second worktree of this clone (`/home/user/bicii-book-wt`,
  see `git worktree list`) builds Phase 9 reporting on
  `feat/p9-reporting` with its own database `bicii_dev_wt` and ports; this
  checkout never touches it.
- Local-only artifacts (git-ignored): `.env.local`, `.devstack/` (with
  `.devstack/mail/`, the mail catcher's codes), `test-results/`.

## Attention and links

- Top risks, most consequential first ([RISKS.md](docs/RISKS.md) order):
  [R-001](docs/RISKS.md#r-001--nothing-is-deployed),
  [R-002](docs/RISKS.md#r-002--no-backups-monitoring-alerting-or-exercised-recovery),
  [R-003](docs/RISKS.md#r-003--the-devstack-differs-from-hosted-supabase).
  Next in play: the labels and Shopify PR
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
  and 14 (consignor data retention,
  [R-026](docs/RISKS.md#r-026--consignor-personal-and-payout-details-are-kept-indefinitely-with-no-change-history));
  Phase 7 adds rows 15–17, email sign-in 18–19 and the staff roles 20
  (main's numbering, unchanged by the merge); Phase 8 adds rows 21
  (confirm D56–D59 and the D9 base: no fallback, and changing the address
  orphans printed labels,
  [R-013](docs/RISKS.md#r-013--changing-the-qr-base-leaves-printed-labels-on-the-old-address))
  and 22 (the decision ranges, answered,
  [R-028](docs/RISKS.md#r-028--the-main-line-decision-range-d43d59-is-exhausted));
  Phase 10 adds rows 23 and 24 (D89: tax basis, Shopify POS) and 25
  (confirm D80–D88).
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
  (jobs wait for the cron, a webhook or staff; Vercel Hobby refuses to
  deploy the 5-minute cron, so the plan is chosen before the first
  deployment);
  step 4 updated
  [R-042](docs/RISKS.md#r-042--earlier-online-sales-keep-no-customer-after-a-shopify-customer-is-linked)
  (the sale page shows a later-linked customer; the Sales list and the
  customer page do not yet) and
  [R-011](docs/RISKS.md#r-011--shopify-is-not-built-and-will-be-fixture-tested-only)
  (built; still fixture-tested only).
- Running costs, backups, recovery: none yet ([OPERATIONS.md](docs/OPERATIONS.md)).
