# ADR-009: Who may price a line, and manual lines with a pending cost

Date: 2026-10-04 (commit cc0b5b0, PR #4). Status: owner-confirmed
2026-10-05 with a clarification. Decision owner: Abhishek Cherian George
(owner) for business meaning; defaults proposed by the build agent.

## Context

SPEC §9 lets staff add service, part and manual lines, and SPEC §4.2 makes
cost visibility a permission (`view_costs`). SPEC §10 deducts direct cost
before Cult Commons. A mechanic without `view_costs` must still be able to
add a manual line, but cannot see or enter its cost.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D14 | Any active staff may set or override a line's unit sale price (≥ 0) when adding it; entering or overriding a unit direct cost needs `view_costs` (42501 otherwise); no negative-price or discount lines; a manual line added without a cost is stored with unit cost 0 and marked `cost_pending`; the line shows "Cost pending" to everyone, `work_order_totals_staff.cost_pending_count` counts live pending lines and totals are labelled provisional; the correction is void and re-add with the cost (reopen first if completed); nothing blocks completion | Owner-confirmed 2026-10-05 with the clarification: "a line's totals use the line's own cost, including 0; zero-price lines are valid (free parts)" | `add_service_line`, `add_manual_line`, `void_line` (`20261004001500_workshop_rpcs.sql`), `cost_pending` and generated totals (`20261004001400_work_order_lines.sql`); flags carried into reporting by D32; `tests/db/work-order-lines.test.ts`, `tests/db/workshop-catalog.test.ts`, `tests/e2e/workshop-board.spec.ts` |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner), row D14.
The owner's clarification matches the stored arithmetic: totals are computed
from the line's own snapshotted cost, and 0 is a valid cost and a valid
price. A pending line's cost of 0 is a placeholder that the flag marks;
[D24](ADR-010-stock-and-units-on-jobs.md) keeps inventory lines out of this
state.

## Alternatives actually considered

The owner options named in D14 (none chosen; the safe default above stays):

| Option | Why chosen or rejected |
|---|---|
| Block completing a job with a pending cost | Not selected by the owner; the default lets the job complete ("Nothing blocks completion") |
| Let a `view_costs` holder enter a pending cost once | Not selected by the owner; the default keeps snapshots immutable |
| Have Phase 5 reports exclude or flag pending lines | Flagging is built (D32: recognised as stored and flagged, never excluded); exclusion not chosen |

## Consequences

- Until a `view_costs` holder voids and re-adds the line with its cost, the
  line's yield is its whole sale and its Cult Commons share is 30% of the
  sale, so yield and Cult Commons are overstated
  ([RISKS R-005](../RISKS.md#r-005--cost-pending-lines-overstate-yield-and-cult-commons)).
- Labour belongs on a service line (snapshots the service's cost) and parts
  on inventory lines, which never become `cost_pending`.

## Revisit trigger

The owner picks one of the options above, or reports show pending lines
staying uncorrected.

## Evidence and links

- `tests/db/work-order-lines.test.ts` asserts a manual line without cost is
  stored at 0.00 with `cost_pending: true` and counted in
  `cost_pending_count`; passed in `npm test` on 2026-10-05.
