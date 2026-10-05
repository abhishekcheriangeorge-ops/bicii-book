# ADR-008: Work-order status machine, cancellation, ownership, overdue and assignments

Date: 2026-10-04 (commit cc0b5b0, PR #4). Status: D15 owner-confirmed
2026-10-05, including its reopen deviation; D16, D18, D20, D22 accepted
(build defaults, not individually confirmed by the owner). Decision owner:
Abhishek Cherian George (owner) for business meaning; defaults proposed by
the build agent.

## Context

SPEC §7 describes intake, the board and the timeline, and SPEC §23 requires
that collected jobs do not silently change and that timestamps are kept.
The brief does not give the exact transitions, how a completed job is
corrected, when a job can be cancelled, how a job's customer relates to the
bike's owner, what "overdue" means, or who may assign mechanics.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D15 | Transitions per DATA-MODEL §4; completed only from in_progress or paused; collected only from completed or ready_for_collection; collected and cancelled final; nothing returns to received; reopen (completed or ready_for_collection → in_progress) needs a reason and clears `completed_at` and `ready_for_collection_at`; lines are added or voided only while the job is open | Owner-confirmed 2026-10-05, including the deviation: reopen clears completion stamps (DATA-MODEL §4 originally said stamps are never cleared), which moves recognition to the final completion (D32) | `set_work_order_status`, `private.work_orders_enforce_rules` (`20261004001300_work_orders.sql`, `20261004001500_workshop_rpcs.sql`); unit sold/held follow-up in `20261004001900_inventory_jobs.sql`; `tests/db/work-orders.test.ts`, `tests/unit/workshop.test.ts` |
| D16 | Cancel only from an open status, with a reason; refused with `work_order_has_lines` while a non-voided line exists (void first, which writes stock reversals) | Accepted | `set_work_order_status` (`20261004001500_workshop_rpcs.sql`, extended in `20261004001900_inventory_jobs.sql`); `tests/db/work-orders.test.ts`, `tests/db/inventory-ledger.test.ts` |
| D18 | A job's customer must be the bike's current owner, or the bike has no owner; otherwise `bike_owner_mismatch`; checked under FOR SHARE locks | Accepted | `20261004001300_work_orders.sql`; `tests/db/work-orders.test.ts`, `tests/db/workshop-concurrency.test.ts` |
| D20 | Overdue: open and `now() − checked_in_at` > 7 × 24 h; `OVERDUE_AFTER_DAYS`/`isOverdue` in `src/lib/workshop.ts`, reused by Today and reports | Accepted | `src/lib/workshop.ts`, `reporting.operational_exceptions` (`20261004002500_daily_summary.sql`); `tests/unit/workshop.test.ts`, `tests/db/reporting.test.ts` |
| D22 | Any active staff may assign or unassign anyone on a job not collected or cancelled; a new lead replaces the previous lead; only active staff can be assigned | Accepted | `assign_staff`, `unassign_staff` (`20261004001500_workshop_rpcs.sql`); `tests/db/work-orders.test.ts`, `tests/db/workshop-concurrency.test.ts` |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner) and the
transition table in [DATA-MODEL §4](../DATA-MODEL.md#4-workshop). Rationale
for D15's reopen (inferred from D15/D25 text): snapshots stay immutable, so
the only correction for a completed job is to reopen it, void and re-add
lines, and complete it again; the timeline keeps the earlier `completed`
event.

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| Stamps set exactly once and never cleared (DATA-MODEL §4's original rule, named in D15) | Replaced by the reopen rule; the owner confirmed the deviation on 2026-10-05 |

## Consequences

- Past days' workshop figures can change after a reopen; there are no
  reversal entries for workshop lines (D32,
  [ADR-011](ADR-011-recognition-and-financial-reporting.md)).
- Units on a reopened job go back to `held_for_customer` with no stock
  movement (D6/D25, [ADR-010](ADR-010-stock-and-units-on-jobs.md)); a job
  whose sold bike already reached a customer cannot be reopened (D29).
- Staff must transfer a bike before opening a job for a different customer.

## Revisit trigger

Phase 9 restates earlier periods, or the owner wants corrections without a
reopen (for example reversal entries).

## Evidence and links

- `npm test` on 2026-10-05: 1186 tests passed, including the files above.
