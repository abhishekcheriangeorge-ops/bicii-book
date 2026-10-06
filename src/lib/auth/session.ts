import "server-only";

import { randomUUID } from "node:crypto";

import { forbidden, redirect } from "next/navigation";
import { headers } from "next/headers";
import { cache } from "react";

import { createClient, type ServerSupabase } from "@/lib/supabase/server";

import {
  effectivePermissions,
  hasPermission,
  isPermissionKey,
  type PermissionKey,
  type StaffDTO,
  type StaffRole,
} from "./permissions";

export type { StaffDTO } from "./permissions";

export type Session = {
  userId: string;
  email: string | null;
};

/**
 * The verified user behind `supabase`'s session, or null. Uses
 * `auth.getClaims()`, which the installed supabase-js recommends for server
 * code: it verifies the JWT (against the project's JWKS for asymmetric
 * keys, or by asking Supabase Auth for symmetric ones, as the local devstack
 * uses) instead of trusting the cookie like `getSession()` would.
 */
async function readSession(supabase: ServerSupabase): Promise<Session | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const claims = data.claims;
  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
  };
}

/**
 * The caller's staff record with effective permissions, or null when not
 * staff (a customer). Read through RLS via `my_staff_profile()`; inactive
 * staff come back with active=false and no permissions. Call only after the
 * session was verified with readSession on the same client.
 */
async function readStaff(supabase: ServerSupabase): Promise<StaffDTO | null> {
  const { data, error } = await supabase.rpc("my_staff_profile");
  if (error) throw new Error(`my_staff_profile failed: ${error.code} ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  const granted = (row.permissions ?? []).filter(isPermissionKey);
  return {
    staffId: row.id,
    userId: row.auth_user_id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    active: row.active,
    permissions: effectivePermissions(row.role, row.active, granted),
  };
}

/**
 * The staff record of whoever `supabase` is signed in as (readStaff), for
 * the sign-in action: right after a code is verified, it admits only
 * active staff (PLAN D70). Null when the login is not staff.
 */
export async function readStaffProfile(supabase: ServerSupabase): Promise<StaffDTO | null> {
  return readStaff(supabase);
}

/**
 * The verified signed-in user, or null.
 *
 * Memoised with React cache(), which deduplicates only while a Server
 * Component tree renders. Inside a Server Action there is no render, so
 * cache() runs the function every time: actions use authorizeStaff() with
 * one client instead (src/lib/actions.ts).
 */
export const getSession = cache(async (): Promise<Session | null> => {
  return readSession(await createClient());
});

/**
 * The signed-in user's staff record, or null when signed out or not staff.
 * Memoised per render like getSession().
 */
export const getStaff = cache(async (): Promise<StaffDTO | null> => {
  if (!(await getSession())) return null;
  return readStaff(await createClient());
});

export type StaffRequirement = {
  /** Required permission (from the role or an exception, PLAN D91). */
  permission?: PermissionKey;
  /**
   * Require role admin: the admin-only settings (shop settings, hours,
   * closures, appointment types, Cult Commons rates), mirroring
   * private.require_admin().
   */
  admin?: boolean;
  /**
   * Require one of these roles, for rules decided by role rather than by
   * permission, e.g. refunds for admins and managers (D94,
   * private.can_record_refunds()). No exception satisfies it.
   */
  roles?: readonly StaffRole[];
};

function guard(
  session: Session | null,
  staff: StaffDTO | null,
  { permission, admin, roles }: StaffRequirement,
): StaffDTO {
  if (!session) redirect("/login");
  if (!staff || !staff.active) forbidden();
  if (admin && staff.role !== "admin") forbidden();
  if (roles && !roles.includes(staff.role)) forbidden();
  if (permission && !hasPermission(staff, permission)) forbidden();
  return staff;
}

/**
 * The guard every staff page starts with (ADR-001 A3). Signed out ->
 * redirect to /login. Signed in but not active staff, or lacking
 * `permission` -> forbidden() (403 page). The database enforces the same
 * rules again in RLS and in each RPC.
 */
export async function requireStaff(permission?: PermissionKey): Promise<StaffDTO> {
  return guard(await getSession(), await getStaff(), { permission });
}

/** requireStaff() plus role admin. */
export async function requireAdmin(): Promise<StaffDTO> {
  return guard(await getSession(), await getStaff(), { admin: true });
}

/**
 * The same guard for Server Actions, on the client the action will use:
 * one session check (getClaims) and one my_staff_profile call per action,
 * where requireStaff() would repeat both because cache() does not memoise
 * outside a render.
 */
export async function authorizeStaff(
  supabase: ServerSupabase,
  requirement: StaffRequirement = {},
): Promise<{ session: Session; staff: StaffDTO }> {
  const session = await readSession(supabase);
  const staff = session ? await readStaff(supabase) : null;
  return { session: session as Session, staff: guard(session, staff, requirement) };
}

/**
 * The request's correlation ID: the `x-request-id` proxy.ts set on the
 * upstream request, or a fresh one where proxy did not run.
 */
export const getCorrelationId = cache(async (): Promise<string> => {
  // Without a render (Server Actions) this reads the header each time; it
  // is a header lookup, so that is fine.
  const h = await headers();
  return h.get("x-request-id") ?? randomUUID();
});
