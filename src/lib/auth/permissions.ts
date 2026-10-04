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

/** What the DAL hands to pages and actions: no tokens, no Auth internals. */
export type StaffDTO = {
  staffId: string;
  userId: string;
  displayName: string;
  email: string;
  role: StaffRole;
  /** Effective permissions: every permission for an active admin, none when inactive. */
  permissions: PermissionKey[];
  active: boolean;
};

/**
 * Effective permissions, the same rule as private.has_permission: inactive
 * staff have none; an active admin has every permission; active staff have
 * what was granted.
 */
export function effectivePermissions(
  role: StaffRole,
  active: boolean,
  granted: readonly PermissionKey[],
): PermissionKey[] {
  if (!active) return [];
  if (role === "admin") return [...PERMISSIONS];
  return PERMISSIONS.filter((p) => granted.includes(p));
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
