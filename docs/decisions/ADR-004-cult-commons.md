# ADR-004: Cult Commons is 30% of positive yield, per line, at a snapshotted rate

Date: 2026-10-03 (SPEC §10); D1 2026-10-04 (PR #1); D21 2026-10-04
(commit cc0b5b0, PR #4). Status: SPEC §10 is a fixed requirement; D1 and D21
accepted (build defaults, not individually confirmed by the owner).
Decision owner: Abhishek Cherian George (owner) for business meaning;
defaults proposed by the build agent.

## Context

[SPEC §10](../SPEC.md#10-cult-commons-rule---critical) fixes the rule:
Cult Commons receives 30% of yield after all direct costs (a consignor
payout is a direct cost), never 30% of gross sales; negative yield is a
loss and creates no negative Cult Commons payment; the rate is configurable
and effective-dated while historical calculations stay snapshots. The brief
does not say whether a loss-making line offsets other lines in the same job,
nor who may change the rate and when.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| — | SPEC §10: share = max(yield, 0) × rate; yield = sale − direct cost | Fixed by the brief | Generated columns of `work_order_line_items` (`20261004001400_work_order_lines.sql`); display copy in `src/lib/cult-commons.ts` |
| D1 | Per line: each line's share uses max(line yield, 0); a loss-making line contributes 0 and does not offset other lines; job Cult Commons = Σ line shares | Accepted | Same columns and `work_order_totals_staff`; `tests/unit/cult-commons.test.ts`, `tests/db/work-order-lines.test.ts`, fixture `tests/fixtures/cult-commons.ts` |
| D21 | Rate changes: admin only, effective now or later, never backdated; rate rows append-only except cancelling a future rate (`cancel_cult_commons_rate`); each line snapshots the rate in force when added; base 0.30 row ships in the migration | Accepted | `cult_commons_rates`, `private.cult_commons_rate_at` (`20261004001200_workshop_catalog.sql`); `tests/db/workshop-catalog.test.ts` |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner), rows D1
and D21. Rationale for D1 (inferred): the brief's "negative yield ... does
not create a negative Cult Commons payment" is applied at the level where
amounts are snapshotted, the line, so a day's or a job's Cult Commons is
always ≥ 0 (D32 relies on this, [ADR-011](ADR-011-recognition-and-financial-reporting.md)).

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| Net the job's lines, so a loss offsets other lines (named in D1's text) | Not chosen; D1's default is per line. The owner has not ruled on it individually |

## Consequences

- A job containing a loss-making line pays more Cult Commons than a netted
  calculation would; the loss shows separately (`loss_total`, D32).
- Rate history never changes past lines; correcting a wrong rate needs a new
  rate row going forward.
- Consignor payout as a direct cost is not built yet (Phase 6, consignment).
- A manual line with a pending cost overstates the share until corrected:
  [ADR-009](ADR-009-line-pricing-and-cost-pending.md),
  [RISKS R-005](../RISKS.md#r-005--cost-pending-lines-overstate-yield-and-cult-commons).

## Revisit trigger

The owner states a different rule for loss-making lines, or a later explicit
rule for negative yield (SPEC §10 allows one).

## Evidence and links

- [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner) D1, D21.
- `npm test` on 2026-10-05 passed all 1186 tests including the files above.
