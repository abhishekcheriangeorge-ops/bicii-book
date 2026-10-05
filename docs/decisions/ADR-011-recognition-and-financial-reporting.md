# ADR-011: Revenue recognition, financial access, Today tiles and exceptions

Date: D3 2026-10-04 (PR #1); D30–D34 2026-10-05 (commit 0047ab6, PR #6).
Status: D32 owner-confirmed 2026-10-05 (with D15); D3 (as refined by D32),
D30, D31, D33, D34 accepted (build defaults, not individually confirmed by
the owner). Decision owner: Abhishek Cherian George (owner) for business
meaning; defaults proposed by the build agent.

## Context

SPEC §19 asks for a daily dashboard and period views, and SPEC §4.2 makes
costs and financial reports permissions. Financial snapshots are immutable
(SPEC §2, §23). The brief does not say on which day workshop revenue counts,
who sees which figures, how Today counts jobs, what makes an adjustment
significant, or which operational exceptions to raise.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D3 | Workshop revenue is recognised at `work_orders.completed_at`, not collection or check-in; reports also offer those bases | Accepted; refined by D32 (current completion after a reopen, D15) | `reporting.financial_lines` (`20261004002400_financial_lines.sql`); `tests/db/reporting.test.ts` |
| D30 | FIN-ACCESS: money rows need `view_financial_reports`; every cost-derived figure also needs `view_costs` (NULL otherwise, the UI says hidden); the job yield panel needs `view_costs` only; operational counts visible to all active staff | Accepted | `20261004002400_financial_lines.sql`, `20261004002600_dashboard_rpcs.sql` (`work_order_yield`, `today_dashboard`); `tests/db/reporting-access.test.ts`, `tests/db/reporting.test.ts` |
| D31 | TODAY-TILES: checked in, started, completed, ready, collected, cancelled are flows by the current stamp's shop day; received, waiting, ready to start, in progress, awaiting collection and overdue are today's snapshot from status | Accepted | `reporting.daily_summary` (`20261004002500_daily_summary.sql`), `today_dashboard`; `tests/db/reporting.test.ts`, `tests/e2e/today.spec.ts` |
| D32 | RECOGNITION: a non-voided workshop line is recognised on the shop day of its job's current `completed_at`; a reopen removes the job from its earlier day until completed again (past days can change; no reversal entries); each line's Cult Commons ≥ 0; `cost_pending` lines recognised as stored and flagged, never excluded | Owner-confirmed 2026-10-05, together with D15 | `reporting.financial_lines`; `tests/db/reporting.test.ts`, `tests/db/reporting-concurrency.test.ts` |
| D33 | SIGNIFICANT-ADJ: a `stock_adjustment` or `damaged` movement is significant when \|qty\| ≥ 5, or on a unique unit, or \|qty\| × unit cost ≥ 100.00 SGD; one function holds the rule; the flag is visible to all, the value needs `view_costs` | Accepted | `private.is_significant_adjustment` (`20261004002500_daily_summary.sql`); `tests/db/reporting.test.ts` |
| D34 | EXCEPTIONS: `overdue_job` (exactly D20), `uncollected_job`, `negative_stock`, `unit_hold_stale`, `currency_mismatch`; later phases add kinds | Accepted | `reporting.operational_exceptions` (`20261004002500_daily_summary.sql`); `tests/db/reporting.test.ts`, `tests/db/reporting-seed.test.ts` |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner). D32's
stated reason for flagging rather than excluding pending lines is D14's safe
default ([ADR-009](ADR-009-line-pricing-and-cost-pending.md)).

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| Recognise at collection (`collected_at`) or at check-in (named in D3) | Not the recognition basis; D3 keeps them as alternative report bases (Phase 9 date-basis selector, not built) |
| Exclude or estimate `cost_pending` lines (named in D32) | Rejected by D32: recognised as stored and flagged |

## Consequences

- A day's or a period's workshop totals can change after a reopen; Phase 9
  restates earlier periods the same way.
- Staff without `view_costs` see Today's operational counts but no
  cost-derived figures.
- Totals sum the shop currency only (D35); other-currency lines raise a
  `currency_mismatch` exception.

## Revisit trigger

Phase 9 (reporting and reconciliation) starts, or the owner asks for
reversal entries instead of restating past days.

## Evidence and links

- [DATA-MODEL §14](../DATA-MODEL.md#14-reporting-views-schema-reporting).
- `npm test` on 2026-10-05: 1186 tests passed, including the files above.
