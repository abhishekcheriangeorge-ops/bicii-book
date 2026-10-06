import { PERMISSION_LABELS, roleLabel, type PermissionKey } from "@/lib/auth/permissions";
import type { Database } from "@/lib/database.types";

/**
 * One line of a staff member's history in words (staff_events; PLAN
 * D90-D93). Pure: safe in unit tests. Payloads written before D90 renamed
 * the enum value say "staff"; roleLabel reads that as Mechanic.
 */
export type StaffEventLike = {
  type: Database["public"]["Enums"]["staff_event_type"];
  permission: PermissionKey | null;
  payload: Record<string, unknown>;
};

const roleIn = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? roleLabel(value) : null;

export function describeStaffEvent(event: StaffEventLike): string {
  const permission = event.permission ? PERMISSION_LABELS[event.permission].label : "a permission";
  switch (event.type) {
    case "created": {
      const role = roleIn(event.payload.role);
      return role ? `Added as ${role}` : "Added";
    }
    case "permission_granted":
      return `Extra access: ${permission} granted`;
    case "permission_revoked":
      return `Extra access: ${permission} removed`;
    case "deactivated":
      return "Deactivated";
    case "reactivated":
      return "Reactivated";
    case "role_changed": {
      const change = event.payload.role as { from?: unknown; to?: unknown } | undefined;
      const from = roleIn(change?.from);
      const to = roleIn(change?.to);
      if (!to) return "Role changed";
      return from ? `Role changed from ${from} to ${to}` : `Role changed to ${to}`;
    }
    case "details_changed":
      return "Details changed";
  }
}
