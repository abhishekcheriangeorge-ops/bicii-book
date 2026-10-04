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
