# ADR-022: Period reporting on four date bases, refunds beside gross, stock at last cost

Date: 2026-10-06 (built on `feat/p9-reporting`, branched from
`feat/staff-roles` at 5c9fbc7). Status: D100–D105 accepted, build defaults
for the owner to confirm ([PRODUCT owner question 21](../PRODUCT.md#open-assumptions-and-owner-questions));
D102 is the build default for the unanswered owner question 12.
D106–D108 (stock reconciliation and the extended operational exceptions)
accepted the same way, owner question 22. Steps 1 (the database), 2 (the
`/reports` and `/reports/lines` screens and the CSV export) and 3
(reconciliation and exceptions in the database, [below](#2026-10-06-stock-reconciliation-and-operational-exceptions-d106d108))
of 4 are built; the screens for step 3 and the closure (step 4) follow. Decision owner: Abhishek Cherian George (owner) for
business meaning; defaults proposed by the build agent and the
orchestrator's Phase 9 brief.

## Context

SPEC §19.2 asks for period reports that "distinguish operational dates
(check-in, completion, collection, sale)" and forbids "manually maintained
report totals as a second truth"; SPEC §23 keeps historical snapshots
immutable and SPEC §10 fixes Cult Commons per line. Phase 5 built the
vocabulary these reports use: `reporting.financial_lines` (recognition at
the job's current completion, D32), `reporting.daily_summary`, the FIN-ACCESS
gate (D30) and the shop calendar (D35). Phase 6 added sales, consignment and
refunds (D44–D49) and left refund netting to Phase 9 (D49). Phase 7 added
purchase receipts (D60–D66), and the staff roles (D90–D94) made managers
cost viewers by role.

The brief does not say which date a period report counts a line on when
the four dates differ, whether a past period can change, how refunds
affect gross, yield and Cult Commons, who is credited for a job, what
happens to lines in another currency, or how stock is valued.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D100 REPORT-BASES | Four bases: `sale` (default) = `financial_lines` (workshop at the job's current `completed_at`, sales at `recognized_at`); `check_in`, `completion`, `collection` = workshop lines by the job's stamp, `check_in` including work in progress; cancelled jobs carry no money; activity counts by each job's own stamps (D31), appointments by scheduled day and current status (D41); ISO weeks, calendar months, at most 731 days | Accepted: build default, owner to confirm | `20261006001000_report_periods.sql` (`report_date_basis`, `reporting.report_lines`, `private.report_rows`, the six RPCs); `tests/db/period-reports.test.ts` |
| D101 REPORT-RESTATEMENT | Reports reflect current source records: a reopen, a back-dated sale or a back-dated receipt restates past days; no period close, no stored totals; an export is a snapshot | Accepted: build default, owner to confirm | every report RPC reads source records; `tests/db/period-reports.test.ts` ("Voids restate the period"); [R-055](../RISKS.md#r-055--past-report-periods-change-after-a-reopen-a-back-dated-sale-or-a-back-dated-receipt) |
| D102 REPORT-REFUNDS | `refunds_total` = Σ `sale_refunds.amount` by `created_at`, shop currency, sale basis only, shown beside gross; gross, cost, yield and Cult Commons never netted; restocked lines stay; no Cult Commons claw-back | Accepted: build default for owner question 12, owner to confirm | `report_period_summary`, `report_period_series`; `tests/db/period-reports.test.ts` ("Refunds are reported separately"); [R-021](../RISKS.md#r-021--reports-overstate-net-sales-after-a-refund-or-restock) |
| D103 REPORT-MECHANIC | Credit the job's CURRENT lead mechanic; 'Unassigned' without a lead; 'Not workshop' for retail and online; additional staff not credited; inactive staff by name | Accepted: build default, owner to confirm | `private.report_key`, `report_breakdown` (mechanic), `report_activity_by_mechanic`; `tests/db/period-reports.test.ts` ("Mechanic attribution") |
| D104 REPORT-CURRENCY | Totals in `private.shop_currency()` only; other-currency lines excluded, counted (`excluded_foreign_line_count`) and raised as `currency_mismatch` (sale lines from step 3) | Accepted: build default, owner to confirm | `private.report_rows` (`p_foreign`), `private.report_foreign_rows`; `tests/db/period-reports.test.ts` ("Totals are in the shop currency") |
| D105 REPORT-PURCHASES-STOCK-VALUE | Receipts by `received_at`: counts for any staff, `purchases_received_total` needs `view_financial_reports` and `view_costs` (never `manage_purchasing` alone, D60); stock value NOW: shop-owned only, quantity stock at last cost (D5/D63) on positive locations, available or reserved units at their own cost else the product's; NULL cost not valued (counted), 0 valued; consigned and customer-owned counted, never valued | Accepted: build default, owner to confirm | `report_period_summary`, `report_activity`, `20261006001100_report_stock_value.sql`; `tests/db/period-reports.test.ts` ("Purchases and stock value"); [R-056](../RISKS.md#r-056--stock-value-uses-each-products-last-cost-not-the-cost-of-the-units-on-hand) |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner), rows
D100–D105, with the status note on D49.

Why the sale basis is `financial_lines` itself: Phase 5 already defines
recognition (D32) and every Today figure; a period report that recomputed
it would be a second vocabulary that could drift. `reporting.report_lines`
is `financial_lines` plus the work in progress, so the sale basis is the
same rows by construction and a test proves `daily_summary` equals the new
RPCs day by day.

Why `financial_lines` gained only an exclusion: every column the reports
need (`channel`, `document_id`, `lead_mechanic_id`, `ownership_type`,
`consignment_item_id`) already exists. The sale branch's channel CASE had
no arm for the reserved `sale_source` value `work_order`; no RPC writes one
(checked across every migration and `feat/p10-shopify`), and if one
existed its lines would double-count the job's own lines, so the branch now
excludes it explicitly. A future `sale_source` value would reach the CASE
with a NULL channel; the channel-partition test derives the expected keys
from `pg_enum` and fails until the CASE and the test learn the new value.

Why refunds are reported beside gross (D102, inferred rationale): the
refund is a separate event with its own date and currency (`sale_refunds`);
netting it into the original sale's day would restate a closed period on
every refund, and netting yield or Cult Commons needs the owner's answer on
claw-back (owner question 12). Showing "refunds recorded" beside gross keeps
both figures true and leaves the policy question open without hiding money.

Why inline bucketing instead of `private.shop_day` per row: the helper
re-reads `shop_settings` through `private.shop_timezone()` on every call.
On the bench, bucketing 58,759 lines with it took 1,235 ms, and with
`(ts at time zone v_tz)::date` (the helper's own definition, the zone read
once) 76 ms. A test proves the two agree at the day-boundary instants.

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| One basis (completion, D3) for every report | Rejected: SPEC §19.2 asks reports to distinguish check-in, completion, collection and sale; a single basis cannot show work in progress or collections |
| Four bases over one line view (`report_lines` = `financial_lines` + work in progress) | Chosen: the sale basis stays Phase 5's recognition by construction |
| Net refunds out of gross, yield and Cult Commons on the sale's day | Rejected for now: restates closed days on every refund and decides a claw-back the owner has not answered (question 12) |
| Report refunds separately by the day they were recorded (D102) | Chosen as the build default; netting or claw-back would be a new decision |
| A materialised summary or stored period totals refreshed after mutations | Rejected: SPEC §19.2 forbids a second truth, and the bench shows live views meet the targets (a year under 0.5 s); revisit on a measured slowdown |
| Period close (lock past periods) | Rejected for the MVP (SPEC §30: no general ledger); past periods restate instead (D101, R-055) |
| Credit every assigned mechanic, or split the job | Rejected: assignments other than the lead carry no share rule in the brief; the current lead (D103) matches the job card |
| Average or FIFO cost for stock value | Rejected: the ledger has no cost layers (D5, D63 keep one last cost per product); last cost is what the shop sees on the product (R-056) |
| Value consigned stock at the agreed amount | Rejected: it is not the shop's asset, and consignment money is gated separately (D48) |
| Page line items by OFFSET | Rejected: deep pages would read the whole range; the keyset `(basis_at, source_line_id)` and a document bound keep a page under 100 ms at any depth on the bench |

## Consequences

- A past period's figures can change after a reopen, a back-dated sale or
  a back-dated receipt (R-055); an exported CSV (step 2) is a snapshot
  taken at export time, at most 50,000 rows, refused (409) when the line
  counts move between its pages (R-057).
- Refunds never reduce gross, yield or Cult Commons in any report; a
  heavily refunded week shows full gross with a refunds figure beside it
  (R-021, owner question 12).
- Stock value uses the product's last cost for every unit on hand (R-056);
  a product without a cost (NULL) is counted, not valued.
- A mechanic with only `view_financial_reports` as an exception sees gross
  and counts with every cost column NULL; managers and admins see
  everything through their role (D91); `manage_purchasing` alone never
  shows purchase totals in reports (D60).
- New error codes `report_range_too_long` and `report_key_invalid`;
  `report_range_invalid` is reused from Phase 5.
- Timings (DATA-MODEL §14) are recorded from the bench; the bench is
  re-run when a report query changes.

## Revisit trigger

The owner answers question 12 (refund netting, claw-back) or 21 (the
reporting build defaults); a measured report slowdown in use; Phase 10's
online refunds (D85) are integrated (they must report through D102); a
second currency or shop.

## 2026-10-06: stock reconciliation and operational exceptions (D106–D108)

Built in Phase 9 step 3 (`20261006001200_stock_reconciliation.sql`,
`20261006001300_operational_exceptions.sql`). Status: accepted, build
defaults for the owner to confirm (owner question 22).

### Context

SPEC §12 asks that current stock be "derivable/reconcilable from
movements" and SPEC §26 lists "stock reconciliation tools" and an
operational exceptions panel (negative stock, units in impossible states,
unsettled consignments older than N days, failed integrations). Phase 4
already refuses most unit drift at commit (`private.assert_unit_consistent`
nets each unit's ledger to 1 at its own location while available or
reserved, 0 elsewhere); Phase 5 built one exceptions surface
(`reporting.operational_exceptions`, `public.operational_exceptions`,
Today's `exceptions_now`) with five kinds visible to every staff member
(D34). Phase 10, on `feat/p10-shopify`, adds `integration_failed` rows for
admins only (D86) through `private.integration_exceptions()` with Phase 5's
nine columns. The brief does not say whether stock needs a balance cache,
when unpaid consignment money becomes an exception, or who sees which
exception.

### Decision

| D | Rule (short) | Implemented in |
|---|---|---|
| D106 STOCK-RECONCILIATION | No `inventory_balances` cache: the ledger sum is the stock. Reconciliation compares each unit's status, location and consignment item status with its ledger (per-location nets and the disposition of its latest non-transfer movement) and each (product, location) ledger with its units; read-only; fixes are links to guarded flows; a persistent issue is an RPC defect | `reporting.unit_ledger_disposition`, `reporting.unit_reconciliation`, `reporting.stock_reconciliation`, `report_stock_reconciliation`, `report_unit_reconciliation`; `tests/db/stock-reconciliation.test.ts` |
| D107 UNSETTLED-CONSIGNMENT-ALERT | An item with outstanding > 0 whose latest sale is more than N shop days ago; N = `shop_settings.consignment_settlement_alert_days` (default 30, 1–365), set only by an admin through `set_consignment_settlement_alert_days` (replay-safe, recorded in `schedule_events`); computed live, never stored or dismissed | the `unsettled_consignment` branch of `reporting.operational_exceptions`; `tests/db/operational-exceptions.test.ts` |
| D108 EXCEPTION-VISIBILITY | One rule, `private.exception_visible(kind)`, for the list, the counts and `exceptions_now`: Phase 5's kinds and unit_state_mismatch for every active staff member; unsettled_consignment for consignment money viewers (D48); integration_failed for admins (D86) | `public.operational_exceptions`, `report_exception_counts`, `today_dashboard`; `tests/db/operational-exceptions.test.ts` |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner), rows
D106–D108, and the status note on D34.

Rationale. The ledger is the single source of truth (SPEC §12); a cache
would be a second truth that needs its own reconciliation, and the bench
shows the live views fast enough for the reconciliation page (under
100 ms at 3,006 units and about 110,000 movements). Reconciliation never
writes because every stock, status and money change already has a guarded
RPC with its own idempotency, reason and history; an automatic fix would
bypass them (inferred). The alert counts from the latest sale because that
is when money became owed (D46), and 30 days matches a monthly settlement
habit (inferred; the owner confirms N). Visibility follows the money:
consignor balances are consignment money (D48), integration failures carry
order details that Phase 10 keeps to admins (D86), and everything else is
operational and already visible to all staff (D30).

The disposition of a unit comes from its latest non-transfer movement
because a transfer only moves the location; a refund writes no movement
(D7), so a refunded unit stays sold until `restock_unit`'s +1. Checks run
in a fixed order and the first failure is the issue, so each corruption
has one code. On products the root cause comes first:
`unique_movement_without_unit` before `unit_count_mismatch`, because a
unitless movement always shifts the count too. A held unit that Phase 5's
`unit_hold_stale` already lists, and a negative location that Phase 5's
`negative_stock` already lists, are not repeated as `unit_state_mismatch`:
one row per problem.

The Phase 10 extension point keeps Phase 10's nine-column signature: this
branch creates `private.integration_exceptions()` only when it is absent,
as a placeholder with no rows, and the extended view maps the six appended
columns itself. Both merge orders apply cleanly (R-058).

### Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| An `inventory_balances` cache maintained by triggers | Rejected for the MVP: a second truth to reconcile; the measured live views meet the reconciliation targets. A future cache must be a trigger-maintained projection that these views also check (D106) |
| Live ledger views and read-only RPCs | Chosen |
| Auto-fix (write the missing movement or status) | Rejected: bypasses the guarded RPCs, their reasons and their histories; a wrong guess would corrupt the ledger it is meant to prove |
| Show the issue and link to the guarded flow (adjust stock, restock, settle, void, return) | Chosen |
| Every exception visible to every staff member (Phase 5's rule) | Rejected: unsettled consignments show consignor balances (D48) and integration failures are admin-only in Phase 10 (D86) |
| Per-kind visibility through one function | Chosen (D108); the counts and Today cannot disagree with the list |
| Widen `private.integration_exceptions()` to fifteen columns | Rejected: Phase 10 on `feat/p10-shopify` already defines the nine-column function; a different signature would break whichever branch merges second |
| Keep Phase 10's nine-column signature; the view maps the appended columns | Chosen; created here only if absent (R-058) |
| Store raised exceptions with a dismiss flag | Rejected: SPEC §19.2 forbids a second truth; an exception clears when its cause is fixed |
| A separate `report_exceptions` RPC and a second Today tile | Rejected: one exceptions surface, extended in place |

### Consequences

- `public.operational_exceptions(max_rows)` keeps its name, argument,
  default, ordering and 1..200 clamp and gains six columns after Phase 5's
  nine (`issue`, `short_id`, `title`, `detail`, `amount`, `currency`); the
  Phase 5 column contract in `tests/db/reporting-fixtures.ts` was extended
  by appending them.
- `today_dashboard.exceptions_now` now differs per caller: mechanic2 does
  not count an unsettled consignment that an admin counts.
- Until the step 4 screens, Today lists the new kinds with its generic
  "Needs attention" copy, and a sale or consignment row has no link.
- At the bench volume the exceptions counts take about 260 ms (target
  150 ms) and Today about 8.8 s, almost all of it Phase 5's
  `daily_summary` for one day (R-059).
- The RPCs that read the wide reconciliation and exception views run with
  `jit = off` (as Phase 2's slot functions do): compiling cost 100–250 ms
  per call on the bench and saved nothing.
- New error code `alert_days_out_of_range`; CHECK
  `shop_settings_consignment_settlement_alert_days_check`.

### Revisit trigger

The owner answers question 22; Phase 10 merges (re-verify R-058); Today
is reported slow (R-059); a unit issue persists after its guarded fix (an
RPC defect to report with the unit's movement history).

## Evidence and links

- Branch `feat/p9-reporting` (local, not pushed), migrations
  `20261006001000_report_periods.sql`,
  `20261006001100_report_stock_value.sql`,
  `20261006001200_stock_reconciliation.sql` and
  `20261006001300_operational_exceptions.sql`.
- Tests: `tests/db/period-reports.test.ts` with the scenario in
  `tests/db/period-report-fixtures.ts`; `tests/db/stock-reconciliation.test.ts`
  and `tests/db/operational-exceptions.test.ts` (D106–D108); Phase 5's and
  Phase 6's reporting tests pass unchanged apart from the six appended
  exception columns.
- Bench: `scripts/bench/report-volume.sql`; timings in
  [DATA-MODEL §14](../DATA-MODEL.md#14-reporting-views-schema-reporting).
- [DATA-MODEL §14, §15, §16](../DATA-MODEL.md#14-reporting-views-schema-reporting),
  [TESTING "What is tested where"](../TESTING.md#what-is-tested-where).
- [ADR-011](ADR-011-recognition-and-financial-reporting.md) (D3, D30–D34),
  [ADR-012](ADR-012-shop-time-zone-and-currency.md) (D35),
  [ADR-016](ADR-016-consignment-and-sales.md) (D49),
  [ADR-018](ADR-018-purchasing.md) (D60, D63, D64),
  [ADR-021](ADR-021-staff-roles.md) (D91, D94).
