import "server-only";

import { isPermissionKey, type PermissionKey, type StaffRole } from "@/lib/auth/permissions";
import { unwrap } from "@/lib/db-errors";
import type { ServerSupabase } from "@/lib/supabase/server";

/** One row of Staff settings. Only what the screen needs. */
export type StaffMember = {
  staffId: string;
  displayName: string;
  email: string;
  role: StaffRole;
  active: boolean;
  /** Granted rows only; admins hold every permission by role. */
  grantedPermissions: PermissionKey[];
};

/** Every staff member, for admins and manage_staff holders (RPC staff_roster checks). */
export async function listStaff(supabase: ServerSupabase): Promise<StaffMember[]> {
  const rows = unwrap(await supabase.rpc("staff_roster"));
  return (rows ?? []).map((r) => ({
    staffId: r.id,
    displayName: r.display_name,
    email: r.email,
    role: r.role,
    active: r.active,
    grantedPermissions: (r.granted_permissions ?? []).filter(isPermissionKey),
  }));
}

export async function getStaffMember(
  supabase: ServerSupabase,
  staffId: string,
): Promise<StaffMember | null> {
  const all = await listStaff(supabase);
  return all.find((s) => s.staffId === staffId) ?? null;
}

export async function linkStaff(
  supabase: ServerSupabase,
  input: { authUserId: string; displayName: string; email: string; role: StaffRole },
): Promise<{ staffId: string }> {
  const row = unwrap(
    await supabase.rpc("create_staff", {
      auth_user_id: input.authUserId,
      display_name: input.displayName,
      email: input.email,
      role: input.role,
    }),
  );
  if (!row) throw new Error("create_staff returned no row");
  return { staffId: row.id };
}

export async function setPermission(
  supabase: ServerSupabase,
  input: { staffId: string; permission: PermissionKey; granted: boolean },
): Promise<void> {
  const args = { target_staff_id: input.staffId, permission: input.permission };
  unwrap(
    input.granted
      ? await supabase.rpc("grant_permission", args)
      : await supabase.rpc("revoke_permission", args),
  );
}

export async function setActive(
  supabase: ServerSupabase,
  input: { staffId: string; active: boolean },
): Promise<void> {
  unwrap(
    await supabase.rpc("set_staff_active", {
      target_staff_id: input.staffId,
      active: input.active,
    }),
  );
}
