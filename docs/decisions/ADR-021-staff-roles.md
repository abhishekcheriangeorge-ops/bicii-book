# ADR-021: Three staff roles, with per-person exceptions on top

Date: 2026-10-06 (built on `feat/staff-roles`, branched from
`feat/auth-email-otp` at 85077c9). Status: D90, D91 and D94 owner decisions
of 2026-10-06, built in the database, the app's permission model,
guards, refunds and profile page, and the staff screens (role picker,
Extra access, invites by role), integration-reviewed on 2026-10-06; D92
accepted (a build default within the owner's decision, owner to confirm);
D93 owner decision for "only admins manage admins and managers", with the
mechanics-only reach of a non-admin `manage_staff` holder over rename and
deactivation a build default, owner to confirm (D92 and D93's build-default
parts: [PRODUCT owner question 20](../PRODUCT.md#open-assumptions-and-owner-questions),
[R-053](../RISKS.md#r-053--the-staff-roles-build-defaults-d92-and-d93-are-unconfirmed)).
Decision owner: Abhishek
Cherian George (owner) for business meaning; defaults proposed by the build
agent. Amends D49 (refunds, [ADR-016](ADR-016-consignment-and-sales.md)) and
restates D11 (delegation, [ADR-005](ADR-005-staff-sign-in-and-delegation.md))
for roles.

## Context

Until now staff had two roles, `admin` (every permission) and `staff`
(only the permissions granted one by one in `staff_permissions`). A person
who ran the floor needed six separate grants, and nothing in the system
said "manager". On 2026-10-06 the owner proposed: "maybe we create admin,
manager, mechanic, then managers can get to see the extra stuff?", and
answered the follow-up questions: a manager gets every extra except staff
management; per-person exceptions stay; managers may record refunds.

Constraints: SPEC §4.2 keeps the seven granular permissions; the database
is the authority (RLS, RPC guards), and every permission-gated policy, view
and RPC already goes through `private.has_permission` /
`require_permission` / the `can_view_*` helpers, while admin-only settings
go through `private.is_admin()` / `require_admin()`. Nothing is hosted
([R-001](../RISKS.md#r-001--nothing-is-deployed)).

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D90 STAFF-ROLES | `staff_role` is `admin \| manager \| mechanic`; `staff` renamed to `mechanic` (`alter type ... rename value`), `manager` added after `admin` in its own migration; new staff default to mechanic; "staff" still means any active person; legacy `"staff"` in append-only `staff_events` payloads is labelled Mechanic by the app | Owner decision 2026-10-06; built | `20261006000100_staff_role_values.sql`; `supabase/seed.sql` (manager@bicii.test); `src/lib/auth/permissions.ts` (`ROLES`, `ROLE_LABELS`, `roleLabel`), `src/components/domain/role-badge.tsx`, `src/lib/staff-events.ts` (legacy `"staff"` reads Mechanic); `tests/db/staff-roles.test.ts`, `tests/unit/auth-helpers.test.ts`, `tests/unit/staff-roles-screens.test.ts`, `tests/e2e/roles.spec.ts` |
| D91 ROLE-PERMISSIONS | admin implies all seven permissions, manager all but `manage_staff`, mechanic none; effective = role + exceptions, none while inactive; one SQL rule `private.role_implies` used by `has_permission` and `my_staff_profile`, mirrored by `roleImplies()` with a parity test; admin-only settings, roles and admin/manager accounts stay `is_admin` / `require_admin` | Owner decision 2026-10-06; built | `20261006000200_staff_role_permissions.sql`, `src/lib/auth/permissions.ts`, `src/lib/auth/session.ts` (`admin: true` stays for admin-only settings), `src/app/(staff)/settings/profile/page.tsx`; `tests/db/staff-roles.test.ts`, `tests/unit/auth-helpers.test.ts`, `tests/unit/session-guard.test.ts`, `tests/unit/purchasing.test.ts` |
| D92 ROLE-EXCEPTIONS | `staff_permissions` rows are "Extra access" exceptions on top of the role; a row the role implies cannot exist (`grant_permission` and a BEFORE INSERT trigger for every writer, P0001 `permission_implied_by_role`); a role change deletes the rows the new role implies (trigger `staff_role_drop_implied_exceptions`) with `permission_revoked` history; a demotion does not restore them | Accepted: build default, owner to confirm | `20261006000200_staff_role_permissions.sql`, `20261006000300_staff_role_administration.sql`, `src/lib/db-errors.ts`, `src/lib/auth/permissions.ts` (`isExceptionFor`, `exceptionsOf`, `permissionChangeBlocker`), `src/lib/auth/role-change.ts` (`roleChangeSummary`), `src/app/(staff)/settings/staff/[staffId]/` ("Extra access" card, `PermissionSwitches`); `tests/db/staff-roles.test.ts`, `tests/db/staff-history.test.ts`, `tests/unit/auth-helpers.test.ts`, `tests/unit/staff-roles-screens.test.ts`, `tests/e2e/roles.spec.ts` |
| D93 ROLE-ADMINISTRATION | Only an admin invites admins and managers, changes roles and acts on an admin's or a manager's row; a non-admin `manage_staff` holder invites and acts on mechanics only, within D11's ceiling; nobody changes their own role; the last active admin stays; each role change appends `role_changed` with actor and optional reason | Owner decision 2026-10-06 (admins manage admins and managers); mechanics-only reach a build default, owner to confirm | `20261006000300_staff_role_administration.sql`, `src/lib/auth/permissions.ts` (`permissionChangeBlocker`, `accessChangeBlocker`, `roleChangeBlocker`, `invitableRoles`), `src/lib/domain/staff.ts` (`setRole`, `inviteStaff`), `src/app/(staff)/settings/staff/actions.ts` (`setStaffRole`, admin only), `src/app/(staff)/settings/staff/[staffId]/staff-controls.tsx` (`RoleControl`), `src/app/(staff)/settings/staff/new/invite-form.tsx`; `tests/db/staff-roles.test.ts`, `tests/db/staff-management.test.ts`, `tests/unit/auth-helpers.test.ts`, `tests/e2e/roles.spec.ts`, `tests/e2e/staff.spec.ts` |
| D94 REFUND-ROLES | Retail refunds by an active admin or manager (`private.can_record_refunds()`, a role check; no permission or exception grants it); cap, reason, replay and D7 unchanged | Owner decision 2026-10-06; built | `20261006000200_staff_role_permissions.sql` (`record_sale_refund`'s guard only), `src/lib/auth/permissions.ts` (`canRecordRefund`), `src/lib/auth/session.ts` (`roles`), `src/app/(staff)/sales/actions.ts` (`roles: ["admin", "manager"]`); `tests/db/sales.test.ts`, `tests/db/staff-roles.test.ts`, `tests/unit/consignment.test.ts`, `tests/unit/session-guard.test.ts`, `tests/e2e/roles.spec.ts` |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner), rows
D90–D94, with the status notes on D11, D49 and D60.

One rule in one place: `private.role_implies(role, permission)` is the only
statement of what a role grants. Because `has_permission` calls it, every
existing RLS policy, `*_staff` view and RPC guard follows without being
touched; the database tests call one representative gate per permission
family as each kind of person to prove it.

Why the enum value was renamed rather than kept and relabelled: keeping
`staff` in the database and showing "Mechanic" in the app would leave two
names for one thing in every query, test, log and document, and "staff"
already means "any active person" (`private.is_staff()`, "Staff settings").
`ALTER TYPE ... RENAME VALUE` keeps the value's OID, so stored rows, the
column default and `create_staff`'s parameter default follow without a
rewrite; no function body compares a `staff_role` with the literal
`'staff'`; and nothing is hosted, so no deployed client sends the old
value. The cost is append-only history: `staff_events` payloads written
before the rename keep the text `"staff"`, which the app labels Mechanic.

Why a role change deletes implied exceptions (D92) instead of keeping
dormant rows: a row the role already implies would be invisible in effect
and would silently come back on a demotion, granting access nobody chose at
the time; deleting it with a `permission_revoked` event keeps the history
and makes a demotion grant nothing by itself.

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| (1) Permissions only, the status quo: every non-admin configured switch by switch | Rejected by the owner's proposal: a manager needs six grants and nothing says "manager" |
| (2) Roles only, no per-person exceptions | Rejected: the owner keeps exceptions (a mechanic who orders parts gets `manage_purchasing` alone; a manager who invites gets `manage_staff`), and D60 depends on that case |
| (3) Roles plus exceptions | Chosen: roles carry the common case; `staff_permissions` stays as the exception list, with its history and D11 ceiling |
| Keep the enum value `staff` and relabel it Mechanic in the app | Rejected: two names for one thing everywhere, and "staff" already means any active person (above) |
| Keep implied exception rows dormant across role changes | Rejected (D92): a demotion would silently restore access |
| Refunds as an eighth permission | Rejected (D94): the owner tied refunds to the manager role; a permission could be granted to a mechanic as an exception |

## Consequences

- A manager sees every cost and financial surface and does every inventory,
  stock, consignment and purchasing action through the role; D60's
  purchasing-screens-only cost visibility now applies only to a mechanic
  granted `manage_purchasing` as an exception
  ([R-034](../RISKS.md#r-034--a-manage_purchasing-exception-shows-unit-costs-on-purchasing-screens)).
- A manager can carry only `manage_staff` as an exception, and even then
  acts on mechanics only; admins remain the only people who manage admins,
  managers and roles.
- The app must mirror the rule (`roleImplies()`); the parity test fails if
  the two disagree. Every staff-screen control the database would refuse
  is shown disabled with the reason (the blockers in
  `src/lib/auth/permissions.ts`), never offered.
- Managers record refunds on their own decision, within the cap
  ([R-050](../RISKS.md#r-050--managers-record-refunds-with-no-second-approval)).
- A role change reaches pages already open only on their next request
  ([R-051](../RISKS.md#r-051--a-role-change-reaches-open-pages-only-on-their-next-request)).
- History written before the rename keeps `"staff"`
  ([R-052](../RISKS.md#r-052--history-written-before-the-rename-says-staff-not-mechanic)).
- Seed and tests have a fourth login, `manager@bicii.test` (Kavya Menon).

## Revisit trigger

The owner confirms or changes D92 or D93's build-default parts; a fourth
role is asked for; a permission is added to `permission_key` (decide what
the manager role implies); a hosted project exists before this lands (the
rename would then need a data migration plan).

## Evidence and links

- Branch `feat/staff-roles` (local, not pushed; steps 1–4 and the
  integration review of 2026-10-06), migrations
  `20261006000100_staff_role_values.sql`,
  `20261006000200_staff_role_permissions.sql`,
  `20261006000300_staff_role_administration.sql`.
- Tests: `tests/db/staff-roles.test.ts` (44), `tests/db/sales.test.ts`,
  `tests/db/staff-history.test.ts`, `tests/db/staff-management.test.ts`,
  `tests/unit/auth-helpers.test.ts`, `tests/unit/session-guard.test.ts`,
  `tests/unit/staff-roles-screens.test.ts`, `tests/unit/purchasing.test.ts`,
  `tests/e2e/roles.spec.ts`.
- [DATA-MODEL §1, §15, §16, §18](../DATA-MODEL.md#1-identity-and-authorization),
  [TESTING "What is tested where"](../TESTING.md#what-is-tested-where).
- [ADR-005](ADR-005-staff-sign-in-and-delegation.md) (D11),
  [ADR-016](ADR-016-consignment-and-sales.md) (D49),
  [ADR-018](ADR-018-purchasing.md) (D60).
