import "server-only";

import { randomUUID } from "node:crypto";

import { forbidden, redirect } from "next/navigation";
import { headers } from "next/headers";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

import {
  effectivePermissions,
  hasPermission,
  isPermissionKey,
  type PermissionKey,
  type StaffDTO,
} from "./permissions";

export type { StaffDTO } from "./permissions";

export type Session = {
  userId: string;
  email: string | null;
};

/**
 * The verified signed-in user, or null. Uses `auth.getClaims()`, which the
 * installed supabase-js recommends for server code: it verifies the JWT
 * (against the project's JWKS for asymmetric keys, or by asking Supabase
 * Auth for symmetric ones, as the local devstack uses) instead of trusting
 * the cookie like `getSession()` would. Cached per request.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const claims = data.claims;
  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
  };
});

/**
 * The signed-in user's staff record with effective permissions, or null when
 * signed out or not staff (a customer). Read through RLS via
 * `my_staff_profile()`; inactive staff come back with active=false and no
 * permissions. Cached per request.
 */
export const getStaff = cache(async (): Promise<StaffDTO | null> => {
  const session = await getSession();
  if (!session) return null;
  const supabase = await createClient();
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
});

/**
 * The guard every staff page and Server Action starts with (ADR-001 A3).
 * Signed out -> redirect to /login. Signed in but not active staff, or
 * lacking `permission` -> forbidden() (403 page). The database enforces the
 * same rules again in RLS and in each RPC.
 */
export async function requireStaff(permission?: PermissionKey): Promise<StaffDTO> {
  const session = await getSession();
  if (!session) redirect("/login");
  const staff = await getStaff();
  if (!staff || !staff.active) forbidden();
  if (permission && !hasPermission(staff, permission)) forbidden();
  return staff;
}

/** requireStaff() plus role admin. */
export async function requireAdmin(): Promise<StaffDTO> {
  const staff = await requireStaff();
  if (staff.role !== "admin") forbidden();
  return staff;
}

/**
 * The request's correlation ID: the `x-request-id` proxy.ts set on the
 * upstream request, or a fresh one where proxy did not run.
 */
export const getCorrelationId = cache(async (): Promise<string> => {
  const h = await headers();
  return h.get("x-request-id") ?? randomUUID();
});
