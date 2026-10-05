# ADR-012: One shop time zone and currency, decided in the database

Date: 2026-10-05 (commit 0047ab6, PR #6). Status: accepted (build default,
not individually confirmed by the owner). Decision owner: Abhishek Cherian
George (owner) for business meaning; defaults proposed by the build agent.

## Context

SPEC §24 requires consistent money, dates and identifiers, and SPEC §11
starts the MVP with one shop. Daily figures depend on which shop day a
timestamp falls on. Phase 5 needed a shop day before Phase 2 (which adds
`shop_settings`) was built.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D35 | `private.shop_timezone()` ('Asia/Singapore') and `private.shop_currency()` ('SGD'); Phase 2 replaces both bodies, same signatures, to read `shop_settings` with those fallbacks; every SQL shop-day computation goes through `private.shop_day()` / `private.shop_today()` / `private.shop_day_start()` (never `current_date` or a bare `::date`); the app lets the database decide which day is today; totals sum the shop currency only | Accepted | `20261004002300_reporting_calendar.sql`, replaced in `20261004002800_schedule.sql`; `tests/db/reporting.test.ts`, `tests/db/display-parity.test.ts`, `tests/unit/dates.test.ts` |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner), row D35.
Rationale (inferred): one function per concept means a single place decides
the shop day, so the database and the app cannot disagree about "today".

## Alternatives actually considered

None recorded.

## Consequences

- Phases 7 and 9 must call these functions and create no alternatives.
- A second shop, time zone or currency is not supported without revisiting
  this rule; other-currency lines are excluded from totals
  ([ADR-011](ADR-011-recognition-and-financial-reporting.md) D34).

## Revisit trigger

A second shop location in another time zone, or sales in a second currency.

## Evidence and links

- `npm test` on 2026-10-05: 1186 tests passed, including the files above.
