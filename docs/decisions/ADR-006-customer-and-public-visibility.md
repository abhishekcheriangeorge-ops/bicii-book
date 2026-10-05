# ADR-006: What customers and the public may see

Date: 2026-10-04 to 2026-10-05 (D8 PR #1; D12, D13 PR #3; D17, D19 PR #4;
D42 PR #7). Status: D12 owner-confirmed 2026-10-05; D8, D13, D17, D19, D42
accepted (build defaults, not individually confirmed by the owner).
Decision owner: Abhishek Cherian George (owner) for business meaning;
defaults proposed by the build agent.

## Context

SPEC §4, §5, §8 and §23 require a public/private boundary: customers never
see internal notes, costs or staff-only data, and photos carry a visibility
(`internal`, `customer`, `public`). The brief does not say exactly which
timeline events, jobs, appointment fields or photos a customer sees, nor
which records may have public photos. The mechanism (customer `my_*` RPCs)
is [ADR-003](ADR-003-customer-access.md); this record holds the rules.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D8 | Customer-visible timeline: status changes, completion, collection, `customer`/`public` photos; never notes, line costs or assignments | Accepted; shown to customers in Phase 11 | `my_work_order_timeline` (`20261004001600_workshop_customer_access.sql`); `tests/db/workshop-customer-access.test.ts` |
| D12 | The current owner sees every customer/public photo of the bike, including earlier ones; a previous owner stops seeing the bike after transfer; staff history keeps every owner | Owner-confirmed 2026-10-05 | `my_bikes`, `my_bike_attachments` (`20261004001000_customer_access.sql`); `tests/db/customer-access.test.ts` |
| D13 | A photo on a customer record is never public (`attachment_customer_never_public`); bike photos may be public, chosen per photo | Accepted | `20261004000900_attachments.sql`; `tests/db/attachments.test.ts`, `tests/unit/attachments.test.ts` |
| D17 | A customer sees the jobs where they are the job's customer, whoever owns the bike now, archived bikes included, cancelled hidden; coarse status; lines show description, quantity, unit price, total only | Accepted; shown in Phase 11 | `my_work_orders`, `my_work_order_lines` (`20261004001600_workshop_customer_access.sql`); `tests/db/workshop-customer-access.test.ts` |
| D19 | A work-order photo is internal or customer, never public (`attachment_work_order_never_public`, CHECK backstop) | Accepted | `20261004001300_work_orders.sql`; `tests/db/work-orders.test.ts`, `tests/db/attachments.test.ts` |
| D42 | Customers see type name, times, status, their bike while still theirs, their own note, `cancelled_at`, `cancelled_via` and `can_cancel`; never internal note, reason, capacity, source or actor; one projection `public.my_appointment` | Accepted | `20261004003000_appointment_customer_access.sql`; `tests/db/appointment-customer-access.test.ts` |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner). Rationale
(inferred where not stated in the rows): show customers their own history
and the bike's current shared photos, and keep anything that reveals staff
judgement, costs or other customers out of every customer projection.

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| Limit each owner to photos taken during their ownership (named in D12) | Not chosen; the owner confirmed D12's default on 2026-10-05 |

## Consequences

- A new owner of a second-hand bike sees its earlier customer-visible
  photos; photos that identify a previous owner belong in `internal`
  (inferred).
- These rules are enforced in the database now but customers cannot sign in
  until Phase 11, so no customer has used them yet.
- Customer and work-order photos are never public; bike, product and unit
  photos may be, and published items need one
  ([ADR-010](ADR-010-stock-and-units-on-jobs.md) D26).

## Revisit trigger

Phase 11 shows these projections to real customers.

## Evidence and links

- [DATA-MODEL §15](../DATA-MODEL.md#15-row-level-security-matrix).
- `npm test` on 2026-10-05: 1186 tests passed, including the files above.
