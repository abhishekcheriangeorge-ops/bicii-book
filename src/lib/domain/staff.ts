import "server-only";

import { LoginExistsError, createStaffLogin, deleteStaffLogin } from "@/lib/admin/staff-logins";
import {
  isPermissionKey,
  permissionChangeBlocker,
  type PermissionKey,
  type StaffDTO,
  type StaffRole,
} from "@/lib/auth/permissions";
import type { Database } from "@/lib/database.types";
import { unwrap } from "@/lib/db-errors";
import type { ServerSupabase } from "@/lib/supabase/server";

import { DomainError } from "./errors";

/**
 * Staff settings (SPEC §4.2; DATA-MODEL §1, §16). Every write goes through
 * an RPC as the signed-in actor, so the database checks authorization and
 * records history (staff_events) itself. The screens disable what the
 * viewer may not change (permissionChangeBlocker, accessChangeBlocker); the
 * checks here only turn the cheap cases into precise messages.
 */

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

export type StaffEventType = Database["public"]["Enums"]["staff_event_type"];

/** One line of a staff member's history. */
export type StaffEvent = {
  id: string;
  type: StaffEventType;
  permission: PermissionKey | null;
  /** Null when the change was made outside the app (seed, SQL editor). */
  actorName: string | null;
  payload: Record<string, unknown>;
  reason: string | null;
  at: string;
};

/** Newest first (RPC staff_history: admin or manage_staff). */
export async function listStaffHistory(
  supabase: ServerSupabase,
  staffId: string,
): Promise<StaffEvent[]> {
  const rows = unwrap(
    await supabase.rpc("staff_history", { target_staff_id: staffId, max_rows: 50 }),
  );
  return (rows ?? []).map((r) => ({
    id: r.id,
    type: r.event_type,
    permission: isPermissionKey(r.permission) ? r.permission : null,
    actorName: r.actor_display_name,
    payload:
      r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
        ? (r.payload as Record<string, unknown>)
        : {},
    reason: r.reason,
    at: r.created_at,
  }));
}

export type InviteInput = { displayName: string; email: string; role: StaffRole };
export type InviteResult = { staffId: string; email: string };

/**
 * Invite a colleague: create their Supabase Auth login (service-role admin
 * API, src/lib/admin) with no credential, then link the staff row through
 * create_staff AS THE INVITING USER, so the database checks manage_staff
 * (and admin-only for admins) itself and records the `created` event with
 * the inviter as actor. If linking fails the login is deleted again. The
 * invitee signs in with a code emailed to them (PLAN D10); the inviter
 * never holds a credential for the new login (D11).
 */
export async function inviteStaff(
  supabase: ServerSupabase,
  actor: StaffDTO,
  input: InviteInput,
  onCleanupError: (err: unknown, userId: string) => void,
): Promise<InviteResult> {
  if (input.role === "admin" && actor.role !== "admin") {
    throw new DomainError("Only an admin can invite another admin.", {
      role: ["Only an admin can invite another admin."],
    });
  }
  let login: { userId: string };
  try {
    login = await createStaffLogin({ email: input.email, displayName: input.displayName });
  } catch (err) {
    if (err instanceof LoginExistsError) {
      throw new DomainError("An account with that email already exists.", {
        email: ["An account with that email already exists."],
      });
    }
    throw err;
  }
  try {
    const row = unwrap(
      await supabase.rpc("create_staff", {
        auth_user_id: login.userId,
        display_name: input.displayName,
        email: input.email,
        role: input.role,
      }),
    );
    if (!row) throw new Error("create_staff returned no row");
    return { staffId: row.id, email: input.email };
  } catch (err) {
    await deleteStaffLogin(login.userId).catch((cleanupError) =>
      onCleanupError(cleanupError, login.userId),
    );
    throw err;
  }
}

/** Grant or revoke one permission (RPC grant_permission / revoke_permission). */
export async function setPermission(
  supabase: ServerSupabase,
  actor: StaffDTO,
  input: { staffId: string; permission: PermissionKey; granted: boolean },
): Promise<void> {
  if (input.staffId === actor.staffId) {
    const blocker = permissionChangeBlocker(
      actor,
      { staffId: actor.staffId, role: actor.role },
      input.permission,
    );
    if (blocker) throw new DomainError(blocker);
  }
  const args = { target_staff_id: input.staffId, permission: input.permission };
  unwrap(
    input.granted
      ? await supabase.rpc("grant_permission", args)
      : await supabase.rpc("revoke_permission", args),
  );
}

export const REASON_MAX = 500;

/**
 * Deactivate (reason required: SPEC §22) or reactivate (reason optional)
 * someone's access (RPC set_staff_active).
 */
export async function setActive(
  supabase: ServerSupabase,
  actor: StaffDTO,
  input: { staffId: string; active: boolean; reason?: string },
): Promise<void> {
  const reason = input.reason?.trim() || undefined;
  if (!input.active && !reason) {
    throw new DomainError("Say why you are deactivating them.", {
      reason: ["Say why you are deactivating them."],
    });
  }
  if (!input.active && input.staffId === actor.staffId) {
    throw new DomainError("You can't deactivate yourself.");
  }
  unwrap(
    await supabase.rpc("set_staff_active", {
      target_staff_id: input.staffId,
      active: input.active,
      reason,
    }),
  );
}
