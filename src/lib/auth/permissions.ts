import { Constants, type Database } from "@/lib/database.types";

/**
 * Permission vocabulary and resolution for the UI and Server Actions. The
 * database is the authority (private.has_permission, RLS, RPC guards); this
 * mirrors it so pages can fail fast with a 403 and hide controls the user
 * cannot use. Pure: safe in Client Components and unit tests.
 */
export type PermissionKey = Database["public"]["Enums"]["permission_key"];
export type StaffRole = Database["public"]["Enums"]["staff_role"];

export const PERMISSIONS: readonly PermissionKey[] = Constants.public.Enums.permission_key;

export const PERMISSION_LABELS: Record<PermissionKey, { label: string; description: string }> = {
  view_costs: {
    label: "View costs",
    description: "See cost, yield and Cult Commons figures on jobs and stock.",
  },
  manage_inventory: {
    label: "Manage inventory",
    description: "Create and edit products, units, transfers and publication.",
  },
  adjust_stock: {
    label: "Adjust stock",
    description: "Record manual stock adjustments and restocks, with a reason.",
  },
  manage_consignments: {
    label: "Manage consignments",
    description: "Consignors, consignment intake, returns and settlements.",
  },
  manage_purchasing: {
    label: "Manage purchasing",
    description: "Suppliers, purchase orders and receiving.",
  },
  manage_staff: {
    label: "Manage staff",
    description: "Invite staff, change permissions, deactivate and reactivate.",
  },
  view_financial_reports: {
    label: "View financial reports",
    description: "Sales, yield and Cult Commons reports.",
  },
};

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

export const STAFF_ROLES: readonly StaffRole[] = Constants.public.Enums.staff_role;

/**
 * What each role implies (PLAN D91 ROLE-PERMISSIONS), mirroring
 * private.role_implies: an admin every permission; a manager every
 * permission except manage_staff; a mechanic none. A database test
 * (tests/db/staff-roles.test.ts) proves the two agree for every role and
 * permission.
 */
export const ROLE_PERMISSIONS: Record<StaffRole, readonly PermissionKey[]> = {
  admin: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => p !== "manage_staff"),
  mechanic: [],
};

/** Whether `role` implies `permission` (D91); mirrors private.role_implies. */
export function roleImplies(role: StaffRole, permission: PermissionKey): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** What the DAL hands to pages and actions: no tokens, no Auth internals. */
export type StaffDTO = {
  staffId: string;
  userId: string;
  displayName: string;
  email: string;
  role: StaffRole;
  /** Effective permissions: what the role implies plus exceptions; none when inactive. */
  permissions: PermissionKey[];
  active: boolean;
};

/**
 * Effective permissions, the same rule as private.has_permission (D91):
 * inactive staff have none; active staff have what their role implies plus
 * their exceptions (`granted`), in enum order.
 */
export function effectivePermissions(
  role: StaffRole,
  active: boolean,
  granted: readonly PermissionKey[],
): PermissionKey[] {
  if (!active) return [];
  return PERMISSIONS.filter((p) => roleImplies(role, p) || granted.includes(p));
}

export function hasPermission(
  staff: Pick<StaffDTO, "role" | "active" | "permissions">,
  permission: PermissionKey,
): boolean {
  return effectivePermissions(staff.role, staff.active, staff.permissions).includes(permission);
}

type Actor = Pick<StaffDTO, "staffId" | "role" | "active" | "permissions">;
type Target = { staffId: string; role: StaffRole };

/**
 * Why `actor` may not grant or revoke `permission` on `target`, or null when
 * they may. Mirrors private.authorize_permission_change, the delegation
 * ceiling of PLAN D11: admins may change anything; a manage_staff holder
 * only other non-admins, never manage_staff, and only permissions they hold
 * themselves, so managing staff never escalates anyone past the manager.
 */
export function permissionChangeBlocker(
  actor: Actor,
  target: Target,
  permission: PermissionKey,
): string | null {
  if (!actor.active) return "Only active staff can change permissions.";
  if (actor.role === "admin") return null;
  if (!hasPermission(actor, "manage_staff")) return "You need the Manage staff permission.";
  if (target.staffId === actor.staffId) return "Only an admin can change your permissions.";
  if (target.role === "admin") return "Admins have every permission.";
  if (permission === "manage_staff") return "Only an admin can grant or remove Manage staff.";
  if (!hasPermission(actor, permission)) return "You can only grant permissions you have yourself.";
  return null;
}

/**
 * Why `actor` may not deactivate or reactivate `target`, or null when they
 * may. Mirrors set_staff_active: nobody deactivates themselves, and only an
 * admin changes an admin's access.
 */
export function accessChangeBlocker(actor: Actor, target: Target): string | null {
  if (!actor.active) return "Only active staff can change access.";
  if (target.staffId === actor.staffId) return "You can't deactivate yourself.";
  if (target.role === "admin" && actor.role !== "admin") {
    return "Only an admin can change an admin's access.";
  }
  if (actor.role !== "admin" && !hasPermission(actor, "manage_staff")) {
    return "You need the Manage staff permission.";
  }
  return null;
}

type AccessSubject = Pick<StaffDTO, "role" | "active" | "permissions">;

/**
 * Consignment money (agreed amounts, charges, item history, liability,
 * the ledger, settlements, a job line's payout snapshot): PLAN D48
 * SALES-ACCESS, mirroring private.can_view_consignment_money(). Active
 * staff with manage_consignments or view_costs; view_financial_reports
 * alone is not enough.
 */
export function canViewConsignmentMoney(staff: AccessSubject): boolean {
  return hasPermission(staff, "manage_consignments") || hasPermission(staff, "view_costs");
}

/**
 * Sale cost, yield, Cult Commons, rate and payout snapshots: D48 (follows
 * D30), mirroring private.can_view_sale_costs(). Active staff with
 * view_costs.
 */
export function canViewSaleCosts(staff: AccessSubject): boolean {
  return hasPermission(staff, "view_costs");
}

/**
 * Recording a retail refund (money going out): D94 REFUND-ROLES (amends
 * D49), mirroring private.can_record_refunds(): an active admin or manager,
 * by role. view_financial_reports is a read permission and never enough,
 * and no exception grants it.
 */
export function canRecordRefund(staff: Pick<StaffDTO, "role" | "active">): boolean {
  return staff.active && (staff.role === "admin" || staff.role === "manager");
}
