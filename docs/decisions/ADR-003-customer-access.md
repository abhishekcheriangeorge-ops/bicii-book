# ADR-003: Customers reach their data only through `my_*` RPCs

Date: 2026-10-04 (commit a532967, PR #3). Status: accepted (implemented and
tested). Decision owner: Abhishek Cherian George (owner) for business
meaning; defaults proposed by the build agent.

## Context

SPEC §4 and §23 require that customers see only their own records and never
internal notes, costs or other staff-only data, and that the public site and
the Admin share one backend. In Supabase, signed-in staff and signed-in
customers share the `authenticated` database role, so a column grant cannot
show `internal_notes` to staff while hiding it from customers, and RLS can
only hide whole rows. The shared role is a platform constraint, not an
evaluated option.

## Decision and rationale

- Base tables are readable by active staff only: their RLS policies call
  `private.is_staff()`; a customer selecting them gets zero rows.
- Customers read and write only through `security definer` RPCs that
  resolve the caller with `private.current_customer_id()` /
  `private.require_customer()`, never take a customer id from the caller,
  return an explicit list of customer-safe columns, and return nothing (not
  an error) for someone else's record. On this branch:
  `my_customer_profile`, `update_my_profile`, `my_bikes`,
  `my_bike_attachments`, `my_work_orders`, `my_work_order_lines`,
  `my_work_order_timeline`, `my_work_order_attachments`, `my_appointments`,
  `book_my_appointment`, `cancel_my_appointment` (EXECUTE for
  `authenticated` only).
- Anonymous visitors reach only explicit projections:
  `public.available_slots(date, uuid)`, `public.public_appointment_types()`,
  `public.public_shop_hours()` and the view `reporting.public_items`;
  `private.selling_price` is executable by `anon` only because that view
  calls it.
- The service-role client (which bypasses RLS) may be imported only in
  `src/lib/admin/**` and `src/lib/integrations/**`, enforced by the ESLint
  `no-restricted-imports` rule in `eslint.config.mjs`.
- `tests/db/meta.test.ts` compares everything `anon` and `authenticated`
  can execute or touch with the allow-list in
  `tests/fixtures/api-surface.ts`, so a forgotten revoke fails CI.

Rationale (from the header of
`supabase/migrations/20261004001000_customer_access.sql` and
[DATA-MODEL §15](../DATA-MODEL.md#15-row-level-security-matrix)): with one
role, row and column privileges cannot separate staff from customers, so the
separation lives in the RPCs' projections; every later phase follows the
same pattern.

## Alternatives actually considered

None recorded.

## Consequences

- Every customer-facing read needs its own RPC and test (own rows only,
  customer-safe columns, anon denied); Phases 2 and 3 added theirs.
- The public site (Phase 11) can call only these RPCs and projections; it
  carries no business rules.
- Customer sign-up (creating and linking the customers row) is not built;
  it arrives with the public site's sign-in (Phase 11).
- A security-definer function bypasses RLS, so each one's guards and
  projection are the boundary: `set search_path = ''`, guards first,
  EXECUTE revoked from PUBLIC.

## Revisit trigger

Phase 11 public-site integration, or customer sign-up being built.

## Evidence and links

- Migrations `20261004001000_customer_access.sql`,
  `20261004001600_workshop_customer_access.sql`,
  `20261004003000_appointment_customer_access.sql`.
- Tests: `tests/db/customer-access.test.ts`,
  `tests/db/workshop-customer-access.test.ts`,
  `tests/db/appointment-customer-access.test.ts`, `tests/db/meta.test.ts`.
- Visibility rules for what customers see: [ADR-006](ADR-006-customer-and-public-visibility.md).
