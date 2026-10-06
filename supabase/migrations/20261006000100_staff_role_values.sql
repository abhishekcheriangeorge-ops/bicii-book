-- Staff roles: admin, manager, mechanic (PLAN D90 STAFF-ROLES; ADR-021;
-- DATA-MODEL.md §1).
--
-- Why these statements live in a migration of their own: a new enum value
-- cannot be used in the transaction that adds it, and every migration runs
-- in its own transaction. 'manager' is added here and first used by
-- 20261006000200_staff_role_permissions.sql (private.role_implies,
-- private.can_record_refunds) and the migrations after it.
--
-- 'staff' is renamed to 'mechanic' rather than kept and relabelled (ADR-021):
--   * Nothing is hosted (RISKS R-001), so no deployed data or client depends
--     on the old label.
--   * RENAME VALUE keeps the value's OID, so stored staff.role values, the
--     column default (`default 'staff'` becomes `default 'mechanic'`) and
--     create_staff's parameter default follow the rename without a rewrite.
--   * No function body compares a staff_role with the literal 'staff'
--     (plpgsql would fail at run time); every check is `role = 'admin'`.
--   * "Staff" keeps meaning any active person (private.is_staff()).
--   * staff_events payloads are append-only jsonb text: events written
--     before the rename keep "staff", which the app labels Mechanic.

alter type public.staff_role rename value 'staff' to 'mechanic';
alter type public.staff_role add value if not exists 'manager' after 'admin';

comment on type public.staff_role is
  'Staff role (D90): admin implies every permission; manager every permission except manage_staff; mechanic none. Exceptions on top: staff_permissions.';
