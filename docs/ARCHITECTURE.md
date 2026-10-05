# Architecture and rationale

Owner: the build agent, reviewed by the product owner (Abhishek Cherian
George). Implementation inspected: `c6bf6d0` on 2026-10-05 (application code
identical to `b34bbcd`, the head of PR #7).

This page describes the system as it is built. The decision of record is
[ADR-001](ADR-001-architecture.md), whose body stays as written in PR #1;
where they differ on a fact (versions, for example), this page and the code
are current.

## Current system

```mermaid
flowchart LR
  staff["Staff phone / iPad<br/>(installable PWA)"] --> app["BICII Admin: Next.js app<br/>(this repo; Vercel planned, not set up)"]
  app --> auth
  app --> rest
  app --> storage
  subgraph supabase["Supabase (one backend)"]
    auth["Auth"]
    rest["PostgREST"]
    storage["Storage"]
    db[("Postgres<br/>RLS + RPCs")]
    rest --> db
    auth --> db
    storage --> db
  end
  public["Public site, repo bicii<br/>(not integrated yet, Phase 11)"] -.-> rest
  shopify["Shopify<br/>(planned, Phase 10)"] -.-> app
  printer["Label printer<br/>(browser print / PDF since Phase 8;<br/>hardware adapter Phase 12)"] --- app
```

Dashed lines are planned, not built. Nothing is deployed: there is no
hosted Supabase project and no Vercel project
([R-001](RISKS.md#r-001--nothing-is-deployed)). Locally and in CI the
Supabase services run without Docker on the devstack
([ADR-002](decisions/ADR-002-devstack.md)): Auth on :9999, PostgREST on
:3001, Storage on :5000 behind a gateway on :54321, and Postgres 16.

Installed versions (from `package.json` and `node_modules`, 2026-10-05):
`next` 16.3.8, `react` / `react-dom` 19.2.8, `@supabase/ssr` 0.12.7,
`@supabase/supabase-js` 2.117.2, `zod` 4.6.5, `decimal.js` 10.6.0, `pino`
10.4.0, `@zxing/browser` 0.2.1 (the Scan screen imports it dynamically, only
when the browser has no `BarcodeDetector` for QR codes), and for labels
(Phase 8 step 2) `qrcode` 1.5.4 (the QR matrix), `pdf-lib` 1.17.1 (the
PDF adapter, server only) and `@pdf-lib/standard-fonts` 1.0.0 (text
metrics shared by the SVG and the PDF), all MIT, bundled by Turbopack with
no webpack configuration; no printer SDK
([R-019](RISKS.md#r-019--adr-001-names-versions-the-code-does-not-use)).

## Main workflow: add a part to a job

1. On the job page (`src/app/(staff)/jobs/[id]/page.tsx`) staff open the
   part sheet (`src/components/domain/add-part-sheet.tsx`). The form carries
   a client-made line id, which is the idempotency key.
2. The form posts to the Server Action `addPartToJob` in
   `src/app/(staff)/jobs/actions.ts`, built with `staffAction`
   ([src/lib/actions.ts](../src/lib/actions.ts)): it creates the
   RLS-scoped server client, calls `authorizeStaff` (signed-out → `/login`,
   inactive or missing permission → forbidden), takes the correlation id,
   validates the form with zod (`addPartSchema`), and runs the handler.
3. The handler calls `addPartToJob` in
   [src/lib/domain/inventory.ts](../src/lib/domain/inventory.ts), which calls
   the RPC `add_inventory_line` through PostgREST as the signed-in user.
4. `public.add_inventory_line`
   ([20261004001900_inventory_jobs.sql](../supabase/migrations/20261004001900_inventory_jobs.sql),
   replaced with the same signature by
   [20261004003400_consignment_job_parts.sql](../supabase/migrations/20261004003400_consignment_job_parts.sql)
   for consigned parts, D44; security definer) runs in one transaction: `private.require_staff()`;
   `private.lock_work_order` (the job FOR UPDATE), `private.lock_stock` (a
   per-product advisory lock) and the unit FOR UPDATE, in the global lock
   order ([DATA-MODEL §7](DATA-MODEL.md#7-inventory-movement-ledger)); a
   replay of the same line id returns the existing line
   (`private.inventory_line_replay`); `private.require_open_work_order`;
   validation (quantity, product, currency, `ownership_not_saleable` for
   customer-owned stock only, location or unit); the price is the override
   or `private.selling_price`, the cost the unit's or product's, and only
   NULL is missing (`part_price_missing`, `part_cost_missing`; D24); the
   line is inserted with the price, cost and
   `private.cult_commons_rate_at(...)` snapshotted;
   `private.record_linked_movement` writes one `job_consumption` ledger row
   (for shop stock exactly what `private.record_movement` wrote before); a
   unique unit becomes `held_for_customer` (`private.set_unit_status`) and
   its product's publication is refreshed; a `stock_consumed` event is
   written to the job's timeline.
   Consigned stock (D44, the owner's D27 change): after the unit, the
   consignment item is locked (lock order step 6; for a quantity product,
   all its active items in id order, then the oldest item whose stock at
   the part's location covers the part (D54), else
   `consignment_quantity_unavailable`); the
   item must be active; the cost is the agreed amount (+ a unique item's
   shop charges), the line also stores the item and
   `consignor_payout_snapshot` (the agreed amount), consigned stock never
   goes below zero (`insufficient_stock`), the movement names the item, and
   `private.refresh_consignment_item_status` runs last. Completing the job
   later marks the unit and the item sold (`work_orders_sell_held_units`);
   the consignor liability is derived from the live line on the completed
   job ([DATA-MODEL §9](DATA-MODEL.md#9-consignment)), never stored.
5. Success: the action calls `refresh()`, the sheet shows the on-hand after
   the move, and `after()` logs `{ correlationId, actor, action, outcome }`.

Failure path: a business refusal is `P0001` with a stable snake_case code
(for example `ownership_not_saleable`). The domain module maps field-level
codes to field errors; otherwise `staffAction` maps the error with
`mapDbError` ([src/lib/db-errors.ts](../src/lib/db-errors.ts)) to a safe
message, returns `{ ok: false, error, code, values }`, and the form renders
the typed values again from `ActionResult.values`. The transaction rolls
back, so nothing partial is stored. A retry with the same line id is a
replay, never a second movement.

## Printing workflow: labels from a record

1. A record page (`src/app/(staff)/{products,units,bikes}/[id]/page.tsx`)
   calls `getLabelContext` in
   [src/lib/domain/labels.ts](../src/lib/domain/labels.ts), which reads the
   RPC `label_preview` (no write): the label text from
   `private.label_content` (price through `private.selling_price`, D58) and
   the payload from `private.qr_payload` (D9), plus the active templates
   and printers. "Printing unavailable" (archived, unique product, QR
   address not set, no template) comes back as a reason, never a throw.
2. Print label opens the print sheet
   ([print-label.tsx](../src/components/domain/print-label.tsx)): quantity
   (1–500 for a product, 1–10 for a unit or bike, D56), printer, size.
   "Print N labels" posts `createPrintJobAction`
   (`src/app/(staff)/labels/actions.ts`, `staffAction` + zod) with an id
   minted when the sheet opened.
3. `public.create_print_job`
   ([20261004003800_labels.sql](../supabase/migrations/20261004003800_labels.sql),
   security definer) guards staff, refuses archived records and P- labels
   for unique products, recomputes the content and payload in the database,
   snapshots the template and printer, and inserts a `queued` job; a replay
   of the same id returns the same job. The sheet navigates to the print
   view `/print/labels/[jobId]`.
4. The print view (`src/app/(print)/print/labels/[jobId]/page.tsx`,
   `requireStaff`) renders an open job only (`isPrintable`, D59) from its
   snapshots. Browser printer: Print calls `window.print()` first, then
   `set_print_job_status(rendered)`. PDF printer: Open PDF opens
   `GET /api/labels/[jobId]/pdf` (`authorizeStaff`; 404 unknown, 409
   finished; pdf-lib from the same snapshots, no side effects) in a new
   tab and marks the job rendered.
5. Staff confirm: "Yes, all printed" or "Something went wrong…" with a
   reason (`set_print_job_status` printed or failed). An unconfirmed job
   stays `rendered` under "To confirm" in `/labels`. A finished job is
   history; "Print again" (`reprintPath`) returns to the record with
   `?print=1&qty=N&reprint={job}` and makes a new job linked by
   `reprint_of_id`.

Failure path: business refusals are `P0001` codes mapped in
[src/lib/db-errors.ts](../src/lib/db-errors.ts) (for example
`public_site_url_invalid`, `label_unique_product_needs_unit`,
`label_quantity_out_of_range`); nothing is stored when the RPC refuses.
Journey 3 (`tests/e2e/inventory.spec.ts`) drives steps 1–5 through the PDF
printer and journey 4 (`tests/e2e/consignment-journey.spec.ts`) through
the browser printer.

## Shopify inbound flow

Built in Phase 10 step 1 as database functions; the webhook route, the cron
and the Shopify client are step 3 (`src/lib/integrations/shopify/`), the
screens step 4 ([ADR-020](decisions/ADR-020-shopify.md), D80–D89).

1. **Store first.** The webhook route will verify the HMAC and call
   `record_shopify_webhook` with the service-role key. Every delivery is
   stored before anything else happens: a verified one in
   `integration_events` (deduplicated on X-Shopify-Webhook-Id; a repeat only
   counts the delivery), a rejected one as evidence without its body (D88).
   A new order or refund gets a queued job in `integration_retry_queue`;
   test, POS and unhandled deliveries are stored as skipped (D89).
2. **Queue.** `claim_integration_jobs` hands due jobs to a worker (the
   cron, or the route after it responds) with `FOR UPDATE SKIP LOCKED`, so
   two workers never run one job; a run stalled for 10 minutes is
   reclaimed (D87).
3. **Process in one subtransaction.** `process_shopify_event` locks the
   event row (a processed event is a replay with no effect), then runs
   every business write inside one plpgsql `begin … exception … end`
   block: validate the payload, take the order's advisory lock, find an
   existing sale (`duplicate_order`), map every line by variant, insert the
   sale header, lock stock, units and consignment items in the global lock
   order, write each line through Phase 6's `private.sell_line` with
   `online_sale` (the one sale-line writer, so online and in-store
   economics are identical), refresh publication last. Any refusal rolls
   the whole block back: the event becomes `failed` with a human message
   and its job `needs_attention` (or queued with backoff when transient).
   A refund is one `sale_refunds` row and nothing else (D85).
4. **People act.** Admins see each `needs_attention` job as an
   `integration_failed` operational exception (Today's Needs attention,
   D86), then link the variant (`link_shopify_variant`) and retry, or
   refund in Shopify and dismiss with a reason. Dismissing an order closes
   the refunds waiting for it.

Failure path: business failures never raise out of the processors; they
are stored on the event and job. Unexpected errors are retried
automatically and keep their SQLSTATE in `last_error_detail` (admin only).
`tests/db/shopify-webhooks.test.ts` proves each step, including concurrent
deliveries.

## Component map

| Responsibility | Location | Dependency | Failure consequence |
|---|---|---|---|
| Staff screens and Server Actions | `src/app/(staff)/` (`page.tsx`, `actions.ts` per area) | domain modules, `requireStaff` | the screen or action errors; data stays consistent because the database enforces the rules |
| Sign-in | `src/app/(auth)/login/` | Supabase Auth (email + password on this branch) | staff cannot sign in |
| Session refresh and redirect | [src/proxy.ts](../src/proxy.ts) | `@supabase/ssr` | stale sessions, missing `x-request-id`; it is not the guard |
| Staff guard | [src/lib/auth/session.ts](../src/lib/auth/session.ts) (`requireStaff`, `requireAdmin`, `authorizeStaff`) | `my_staff_profile` | pages and actions refuse to run |
| Action wrapper | [src/lib/actions.ts](../src/lib/actions.ts) (`staffAction`, `ActionResult`) | zod, `db-errors`, logger | inconsistent errors or lost form values |
| Domain modules (server-only) | [src/lib/domain/](../src/lib/domain/) | RLS-scoped client, RPCs | the feature fails; rules still hold in SQL |
| Consignment (Phase 6) | [src/lib/domain/consignment.ts](../src/lib/domain/consignment.ts) (consignors, items, intake, terms, charges, returns, settlements over `list_consignors`, `consignor_statement`, `consignor_payout_details` and the step 1–2 RPCs); screens `src/app/(staff)/consignment/` (`page.tsx` with `?view=consignors\|items`, `consignors/[id]`, `items/[id]`, `actions.ts`); sheets in `src/components/domain/` (consignor, intake, charge, settlement, item controls); pure rules in [src/lib/consignment.ts](../src/lib/consignment.ts) (labels, `autoAllocate`, `allocationProblems`, `paidAtFromDate`) and [consignment-forms.ts](../src/lib/consignment-forms.ts); access mirrors `canViewConsignmentMoney` / `canViewSaleCosts` / `canRecordRefund` in [permissions.ts](../src/lib/auth/permissions.ts) (D48, D49) | RLS-scoped client; the consignment RPCs and the ledger views behind them | consignors cannot be paid or items received; owed, paid and outstanding stay correct because they are derived in SQL (D46). A consignor's totals are summed in the domain module from the item rows, which is how `reporting.consignor_ledger` defines them |
| Sales (Phase 6) | [src/lib/domain/sales.ts](../src/lib/domain/sales.ts) (`listSales`, `getSale`, `saleForUnit`, `searchSaleable`, `recordRetailSale`, `restockUnit`, `recordSaleRefund` over `list_sales`, `sale_lines_detail`, `saleable_stock`, `record_retail_sale`, `restock_unit`, `record_sale_refund`); screens `src/app/(staff)/sales/` (`page.tsx`, `[id]/page.tsx`, `actions.ts`); `RecordSaleSheet` / `SaleablePicker` and `RefundSheet` / `RestockControl` in `src/components/domain/`; pure rules in [src/lib/sales.ts](../src/lib/sales.ts) (`previewSale` over `lineEconomics`, `priceWarnings`, `saleRange`, `refundableAmount`, status words) and [sales-forms.ts](../src/lib/sales-forms.ts); Sell on the consignment item, unit and product pages | RLS-scoped client; the sale RPCs; `private.sell_line` in the database is the single sale-line writer that Phase 10 reuses with `online_sale` | no sale can be recorded; stock, units, consignment and the reports stay consistent because every effect is inside `record_retail_sale` |
| Consigned job parts (D44) | `searchParts` in [inventory.ts](../src/lib/domain/inventory.ts) (consigned units and the FIFO-head consignment of quantity stock, D45), `loadParts` in [lines.ts](../src/lib/domain/lines.ts) (a line's consignment) | `consignor_statement` for the FIFO head and the cost preview | the part sheet does not offer consigned stock; `add_inventory_line` still applies D44 |
| Labels and the QR base (Phase 8; D9, D56–D59, [ADR-017](decisions/ADR-017-labels-and-qr-base.md)) | Database (step 1): `20261004003800_labels.sql` — `private.qr_payload` (the only payload source, from `shop_settings.public_site_url`, no fallback), `private.label_content` (the only label text, price through `private.selling_price`), `label_templates`, `printer_profiles`, `print_jobs` and the five label RPCs. App (step 2): [src/lib/qr.ts](../src/lib/qr.ts) (`getQrBase`, `qrUrl`, `scanBases`: every DISPLAYED QR URL from the same column, "QR address not set" when unusable); [src/lib/printing/](../src/lib/printing/) (pure: zod schemas with the database's layout rule, `composeLabel` — the one layout engine — `LabelSvg`, the status machine, links; `adapters/`: `browser` → `LabelSheet`, `pdf` → pdf-lib, server only); [src/lib/domain/labels.ts](../src/lib/domain/labels.ts) (print job DTO from the snapshots, history, `getLabelContext`, reprint preset, admin template, printer and address writes); actions in `src/app/(staff)/labels/actions.ts` and `settings/labels/actions.ts`; the print view `src/app/(print)/print/labels/[jobId]` (outside the shell), the PDF Route Handler `src/app/api/labels/[jobId]/pdf/route.ts`, and the print history `/labels`, `/labels/[jobId]`. Screens (step 3): the record pages' Labels card and print sheet ([labels-card.tsx](../src/components/domain/labels-card.tsx), [print-label.tsx](../src/components/domain/print-label.tsx), over `getLabelContext` and `resolvePrintPreset`, which read the deep link `?print=1&qty=N&reprint={job}` from each page's awaited `searchParams`) and Settings → Labels and printers (`/settings/labels`, admins only, no `loading.tsx`, [label-settings.tsx](../src/components/domain/label-settings.tsx)). Journeys (step 4): the label steps of journeys 3 and 4. The staff view of what an anonymous scan returns is the existing `PublicPreviewPanel` over `reporting.public_items`; Phase 8 adds no anonymous RPC, client or route (Phase 11 creates `public.public_item`) | Postgres; `shop_settings.public_site_url` | nothing prints while the address is unset (`public_site_url_invalid`), and record pages say "QR address not set"; printed labels keep their address ([R-013](RISKS.md#r-013--changing-the-qr-base-leaves-printed-labels-on-the-old-address)) |
| Supabase clients | [server.ts](../src/lib/supabase/server.ts), [browser.ts](../src/lib/supabase/browser.ts), [service.ts](../src/lib/supabase/service.ts) | anon key + session; service-role key (server only) | no data access |
| Service-role use | [src/lib/admin/](../src/lib/admin/) (staff logins via the Auth admin API) | `SUPABASE_SERVICE_ROLE_KEY` | staff cannot be invited; bypasses RLS, so imports are restricted by ESLint |
| Error mapping | [src/lib/db-errors.ts](../src/lib/db-errors.ts) | P0001 codes, constraint names | users see the generic error |
| Logging and server errors | [src/instrumentation.ts](../src/instrumentation.ts), [src/lib/logger.ts](../src/lib/logger.ts) | pino to stdout | no trace of failures (no retention or alerting, [R-002](RISKS.md#r-002--no-backups-monitoring-alerting-or-exercised-recovery)) |
| PWA shell | [public/sw.js](../public/sw.js), [src/app/manifest.ts](../src/app/manifest.ts) | browser | no install or offline page |
| Schema, rules, RLS, RPCs | [supabase/migrations/](../supabase/migrations/) | Postgres | the authority for every invariant ([DATA-MODEL](DATA-MODEL.md#authority-applied-state-and-implementation-status)) |
| Synthetic demo data | [supabase/seed.sql](../supabase/seed.sql) | migrations | tests and demos lose their fixtures |
| Docker-free Supabase | [scripts/devstack/](../scripts/devstack/), [supabase/devstack/roles.sql](../supabase/devstack/roles.sql) | pinned Auth, PostgREST, Storage binaries | no local or CI backend ([R-003](RISKS.md#r-003--the-devstack-differs-from-hosted-supabase)) |
| CI | [ci.yml](../.github/workflows/ci.yml) (check, test, build), [e2e.yml](../.github/workflows/e2e.yml) (Playwright, label `e2e`, nightly, manual) | GitHub Actions | regressions merge unseen ([R-010](RISKS.md#r-010--e2e-is-not-a-required-check-and-branch-protection-is-unverified)) |

## Why this design

The shop needs one operational truth that a second frontend (the public
site) can share, on phones, with a small team and no dedicated operations
staff. So the rules live in Postgres, where both frontends and every retry
meet them, and the Next.js app stays a thin, server-rendered client. That
reasoning is ADR-001's; the "small team" point is inferred.

| Decision | Record |
|---|---|
| Next.js App Router + Supabase, server-first, PWA | [ADR-001 A1](ADR-001-architecture.md#a1-stack), [A7](ADR-001-architecture.md#a7-mobile-first-pwa) |
| Three layers (screens → domain modules → database), one direction | [ADR-001 A2](ADR-001-architecture.md#a2-three-layers-one-direction) |
| Authorization in the database; the app checks again | [ADR-001 A3](ADR-001-architecture.md#a3-authentication-and-authorization), [A5](ADR-001-architecture.md#a5-clientserver-boundary-with-supabase) |
| Plain SQL migrations, RLS in the same file | [ADR-001 A4](ADR-001-architecture.md#a4-migrations) |
| Correlation ids and structured logs | [ADR-001 A8](ADR-001-architecture.md#a8-observability) |
| Docker-free devstack | [ADR-002](decisions/ADR-002-devstack.md) |
| Customers through `my_*` RPCs, anonymous through explicit projections | [ADR-003](decisions/ADR-003-customer-access.md) |
| Cult Commons per line with a rate snapshot | [ADR-004](decisions/ADR-004-cult-commons.md) |
| One shop time zone and currency in SQL | [ADR-012](decisions/ADR-012-shop-time-zone-and-currency.md) |

All records: [decisions/README.md](decisions/README.md).

## Boundaries and cross-cutting behaviour

- Browser and server: pages are Server Components; Server Actions are
  public POST endpoints, so each one authorizes itself through
  `staffAction` / `requireStaff`. The browser Supabase client is used only
  for photo uploads to Storage (`src/components/domain/photo-uploads.tsx`),
  under the same Storage policies.
- Authorization happens in three places: RLS on every table, guards in the
  RPCs (`private.require_staff`, `private.require_permission`,
  `private.require_admin`) and `requireStaff` in the app. The first two are
  the ones that matter; the app check gives friendly redirects.
- Who reaches which data: staff-only base tables; customers only through
  security definer `my_*` RPCs; anonymous visitors only through
  `reporting.public_items`, `public_appointment_types`, `public_shop_hours`
  and `available_slots`; the service role only in `src/lib/admin/`
  ([ADR-003](decisions/ADR-003-customer-access.md),
  [DATA-MODEL §15](DATA-MODEL.md#15-row-level-security-matrix)).
- Storage: bucket `media-internal` is private (staff policies);
  `media-public` is public by URL with no listing policy for anonymous
  users ([20261004000800_media_storage.sql](../supabase/migrations/20261004000800_media_storage.sql)).
- Money: `numeric` domains in Postgres do the authoritative arithmetic;
  `decimal.js` in [src/lib/money.ts](../src/lib/money.ts) only formats and
  previews.
- Time: every shop-day computation goes through `private.shop_day()` /
  `private.shop_today()` (Asia/Singapore, D35); the TypeScript mirror is
  [src/lib/dates.ts](../src/lib/dates.ts).
- Correlation: `src/proxy.ts` sets `x-request-id`; the server client sends
  it as `x-correlation-id`; RPCs store it on event rows
  (`private.current_correlation_id()`); logs carry it
  ([ADR-001 A8](ADR-001-architecture.md#a8-observability)).
- Idempotency and concurrency: mutations take client-made ids (line, request,
  appointment ids) and replay instead of duplicating; rows are locked FOR
  UPDATE and stock, appointment days and the last-admin check use
  transaction advisory locks.
- Sales and reporting (Phase 6; the screens since step 4): every sale line,
  in-store now and Shopify in Phase 10, is written by one function,
  `private.sell_line` (the line with its snapshots, its linked
  `retail_sale` / `online_sale` movement, the unit and the consignment
  item), called by `record_retail_sale` after the request's own header
  insert and the stock, unit and item locks. Revenue reaches the reports
  through one view: `reporting.financial_lines` unions the sale lines
  with the workshop lines, and `reporting.daily_summary` sums it (plus the
  consigned entries for its consignment columns); the Phase 5 RPCs gate
  it unchanged. The consignor ledgers are views over the item position
  and the settlements, so owed, paid and outstanding are never stored
  ([DATA-MODEL §8, §9, §14](DATA-MODEL.md#8-sales-non-workshop-revenue)).
- Where each consignor's stock is (D54, from the Phase 6 review): every
  movement of a consigned product names its consignment item, so
  `private.consignment_item_on_hand(item, location)` is derived from the
  ledger like product on-hand, never stored; sales, job parts, returns,
  transfers and `saleable_stock` read it under the product's stock lock,
  so a consignor is charged only for stock that was where it was sold
  ([ADR-016](decisions/ADR-016-consignment-and-sales.md)).
- Labels (Phase 8, [ADR-017](decisions/ADR-017-labels-and-qr-base.md)):
  the QR base is `shop_settings.public_site_url` only. The database
  computes every printed payload (`private.qr_payload` into
  `print_jobs.qr_payload`); the app never builds one for printing, and
  every QR URL it displays comes from the same column through
  `src/lib/qr.ts`. `NEXT_PUBLIC_PUBLIC_SITE_URL` is read only in
  `src/lib/env.ts` and `src/lib/qr.ts`, as an extra accepted SCAN base
  (`tests/unit/qr-base-sources.test.ts` enforces it). Label text comes only
  from `print_jobs.content` or `label_preview`, parsed by a strict schema;
  rendering a job (sheet, PDF, history preview) uses only its content,
  template and printer snapshots (`buildLabelDocument`), and only an open
  job (queued, rendered) is rendered for printing (D59): the PDF route
  answers 409 for a finished job, whose print view shows the outcome and
  "Print again" instead. The print view lives in the `(print)` route group,
  outside the staff shell, so `window.print()` prints labels only (the
  toast region is `print:hidden`); its layout calls `requireStaff()` and so
  does the page. The PDF Route Handler calls `authorizeStaff`, whose
  `redirect()` / `forbidden()` become a 307 to /login and an empty 403 in a
  Route Handler (verified in `next/dist/server/route-modules/app-route`
  and the `forbidden` API reference).
  The record pages (product, unit, bike) load the record and call
  `notFound()` first, then `getLabelContext`, which never throws for
  "printing unavailable" (archived, unique product, QR address not set, no
  template, or the record gone: `label_preview`'s P0002 maps to
  `not_found`): a misconfiguration disables Print label with the reason
  and cannot take the page down, and an unknown id is a 404 (the bike page
  asked before `notFound()` until the Phase 8 review). The print sheet is a
  client component given only the label preview, templates and printers;
  it starts a job with `createPrintJobAction` keyed by an id minted when the
  sheet opens and remembers the printer per device in `localStorage`
  (a convenience, never data). "Print again" is a link to the record with
  `?print=1&qty=N&reprint={job}`, so a reprint is always a new job created
  from the current label. The deep link is spent once: closing the sheet
  `router.replace`s the address without it, and printing from it replaces
  its history entry with the print view (a push would leave it, and Back
  would rebuild the page and reopen the sheet with a fresh job id).
  `createPrintJobAction` calls `refresh()` (ADR-001 A6), so the record's
  Recent prints are current when staff come back.
- Errors: `P0001` with a stable code, `42501` for authorization, `P0002` for
  missing rows; mapped in [src/lib/db-errors.ts](../src/lib/db-errors.ts)
  ([DATA-MODEL §16](DATA-MODEL.md#16-rpc-catalogue-security-definer-in-public)).

## Evidence and limits

| Concern | Measured fact | Assumption or unknown | Revisit trigger |
|---|---|---|---|
| Concurrency | Races are tested on separate connections: `tests/db/workshop-concurrency.test.ts`, `reporting-concurrency`, `staff-concurrency`, `appointment-concurrency`, `consignment-concurrency` (Phase 6 steps 1 and 2 and the review fixes: intake, returns, parts, completions, sales, settlements, refunds and restocks; each case proves the second call waits on a lock) and the "under concurrency" block of `inventory-ledger.test.ts` (skipped in existing-database mode); all passed in `npm test` on 2026-10-05 on `feat/p6-consignment` (89 files, 1298 tests) | Behaviour under real shop load | First hosted use |
| Load and latency | Not measured | Single shop, a few staff | Slow screens reported, or Phase 9 reports |
| Upload size | 20 MiB per object on both buckets (`file_size_limit` 20971520); photos are scaled to at most 2048 px and re-encoded as JPEG in the browser first (`prepare-photo.ts`) | Hosted Storage limits per plan | Hosted project created |
| Hosted behaviour | None: everything runs on the devstack | Platform roles, Auth settings and versions may differ | [R-001](RISKS.md#r-001--nothing-is-deployed), [R-003](RISKS.md#r-003--the-devstack-differs-from-hosted-supabase) |
| Labels | Payloads are exactly `{public_site_url}/q/{short_id}` on the print view and in the PDF (`tests/e2e/print-view.spec.ts`, journey 3: ten identical link URIs); the QR decodes to the payload (`tests/unit/printing/label-svg.test.tsx`, ZXing); `reporting.public_items` returns identical rows to anon and to staff (`tests/db/labels.test.ts`) | Output on a real label printer and on iOS AirPrint is untested ([R-030](RISKS.md#r-030--label-output-is-unverified-on-a-real-label-printer-and-on-ios)); print success is confirmed by hand ([R-031](RISKS.md#r-031--print-success-is-confirmed-by-hand)) | First printer purchased, or Phase 12 |
| Recovery | No backup or restore exercised | Unknown plan tier | [R-002](RISKS.md#r-002--no-backups-monitoring-alerting-or-exercised-recovery) |

## Where an incoming engineer should look

- [R-001](RISKS.md#r-001--nothing-is-deployed),
  [R-002](RISKS.md#r-002--no-backups-monitoring-alerting-or-exercised-recovery)
  and [R-003](RISKS.md#r-003--the-devstack-differs-from-hosted-supabase):
  nothing hosted, nothing recoverable yet, and the local platform is a
  re-creation.
- [R-009](RISKS.md#r-009--the-seven-pr-stack-is-unmerged-and-the-purchasing-track-forks-from-pr-6):
  the open PR stack and the parallel purchasing branch.
- [R-004](RISKS.md#r-004--staff-sign-in-change-pending-email-otp): an owner
  change not yet on this line (email OTP is on the parallel track); the D27
  change ([R-007](RISKS.md#r-007--consigned-stock-cannot-be-a-job-part-yet))
  was built in Phase 6 step 1.
- [R-018](RISKS.md#r-018--four-sections-are-placeholder-pages):
  purchasing and reports are placeholders by design, not defects
  (consignment and sales were built in Phase 6, labels in Phase 8).
- The lock order and the single helpers in
  [DATA-MODEL §7](DATA-MODEL.md#7-inventory-movement-ledger) before touching
  any stock path: work order → line → stock → bikes → units → consignment
  items (step 6, Phase 6) → products, after a request's own idempotency
  lock and a consignor FOR SHARE.
