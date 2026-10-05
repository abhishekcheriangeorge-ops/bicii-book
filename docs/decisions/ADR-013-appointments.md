# ADR-013: Appointment capacity, booking rules, statuses and check-in

Date: D2 2026-10-04 (PR #1); D36–D41 2026-10-05 (commit f29d339, PR #7).
Status: accepted (build defaults, not individually confirmed by the owner).
Decision owner: Abhishek Cherian George (owner) for business meaning;
defaults proposed by the build agent.

## Context

SPEC §6 asks for shop hours, closures, appointment types, intake capacity,
customer self-booking (later on the public site) and check-in into a work
order, with capacity that holds under concurrency (SPEC §25). The brief
does not define the capacity unit, the booking and cancellation limits, the
slot grid, the late-arrival edges or how appointments are counted.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D2 | One `intake_capacity_units` pool per `intake_slot_minutes` window across the shop; a type consumes `capacity_units` for its whole duration | Accepted | `20261004002800_schedule.sql`, `20261004002900_appointments.sql` (`available_slots`, `book_appointment`); `tests/db/appointment-slots.test.ts`, `tests/db/appointment-concurrency.test.ts`, `tests/unit/appointment-slots.test.ts` |
| D36 | APPT-COMPLETION: an appointment completes automatically when its work order first reaches completed, ready or collected; never by hand; a reopen does not reopen it; a cancelled job leaves it `checked_in` | Accepted | Trigger `work_orders_sync_appointment_completion` (`20261004003100_appointment_check_in.sql`); `mark_appointment_status` refuses `completed`; `tests/db/appointment-check-in.test.ts`, `tests/unit/appointment-status.test.ts` |
| D37 | APPT-SELF-BOOKING: customers book active and public types only, with minimum notice (default 120 min), horizon (60 days), at most 3 upcoming customer-made bookings (per-customer advisory lock), and cancel until the cutoff (120 min); staff bookings are exempt from those but never from hours, closures or capacity, and cannot be in the past (`appointment_in_past`); slots readable anonymously | Accepted (final; Phase 11 defines no rules of its own) | `book_my_appointment`, `cancel_my_appointment` (`20261004003000_appointment_customer_access.sql`) over the booking rules and lock in `20261004002900_appointments.sql`; `tests/db/appointment-customer-access.test.ts`, `tests/db/appointment-concurrency.test.ts` |
| D38 | APPT-GRID: windows aligned to shop-local midnight in `intake_slot_minutes` steps; a booking lies inside one continuous open stretch of one date; `custom_hours` replaces the weekly intervals on its dates; `closed` beats custom hours; settings changes never move, shrink or cancel existing appointments | Accepted | `20261004002900_appointments.sql`; `tests/db/appointment-slots.test.ts`, `tests/db/schedule-settings.test.ts`, `tests/unit/schedule.test.ts` |
| D39 | APPT-LATE-ARRIVAL: `no_show → arrived` only on the appointment's own shop date, re-checking capacity; cancelled and completed final; `arrived → cancelled` with a reason; `no_show` only after `starts_at` (`appointment_not_started`) | Accepted | `mark_appointment_status` (`20261004002900_appointments.sql`); `tests/db/appointments.test.ts`, `tests/unit/appointment-status.test.ts` |
| D40 | APPT-CHECK-IN: needs a bike owned by the appointment's customer; creates a work order or links one open work order of the same customer and bike without an appointment; `work_orders.appointment_id` set once | Accepted | `check_in_appointment` (`20261004003100_appointment_check_in.sql`); `tests/db/appointment-check-in.test.ts` |
| D41 | APPT-COUNTS: Today and reports count appointments by scheduled shop date and current status (scheduled, arrived, no-show) | Accepted | `daily_summary` appointment columns (`20261004003200_appointment_reporting.sql`); `tests/db/appointment-reporting.test.ts` |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner). What
customers see of an appointment is D42 in
[ADR-006](ADR-006-customer-and-public-visibility.md); the procedure for
setting the schedule is in
[RUNBOOK "Appointments: schedule before go-live"](../RUNBOOK.md#appointments-schedule-before-go-live).

## Alternatives actually considered

None recorded.

## Consequences

- MVP limits: no reschedule (cancel and rebook) and no automatic customer
  messages; when settings change, staff call the customers whose bookings
  no longer fit ([RISKS R-017](../RISKS.md#r-017--appointments-mvp-has-no-reschedule-and-no-customer-messages)).
- Customer self-booking is built in the database but no customer can sign in
  until Phase 11.

## Revisit trigger

Phase 11 customer booking goes live, or the owner asks for reschedule or
customer notifications.

## Evidence and links

- [DATA-MODEL §3](../DATA-MODEL.md#3-shop-hours-and-appointments).
- `npm test` on 2026-10-05: 1186 tests passed, including the files above.
