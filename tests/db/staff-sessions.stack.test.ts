/**
 * Live devstack: deactivation ends a person's Supabase Auth sessions at once
 * (PLAN D71). A throwaway staff login is invited the way Staff settings
 * does it (service-role auth.admin.createUser without a password, then
 * create_staff as the admin), signs in with a code, and is deactivated by
 * the admin with a reason. Then:
 *
 *   * its refresh token no longer works and Auth answers its access token
 *     with session_not_found (the devstack signs HS256, so getClaims() in
 *     the Admin asks Auth: the session ends at once);
 *   * PostgREST still accepts the unexpired access token on its own (the
 *     hosted window, until jwt_expiry), but the database treats the person
 *     as inactive: my_staff_profile says active = false;
 *   * a fresh code still verifies at Auth (shouldCreateUser false knows
 *     nothing about staff), yet my_staff_profile says active = false, so
 *     the Admin's verifyCode and requireStaff refuse it (D70).
 *
 * Needs `npm run db:reset && npm run devstack:start`; skips like the other
 * stack tests unless BICII_REQUIRE_STACK=1. Creates a uniquely named staff
 * member and leaves it deactivated: staff rows are history and are never
 * deleted (DATA-MODEL §15), so its Auth user stays too (staff.auth_user_id
 * is on delete restrict). `npm run db:reset` clears them.
 */
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ANON_KEY } from "../../scripts/devstack/config.mjs";
import { STAFF } from "../fixtures/ids";

import {
  STACK_URL,
  anonClient,
  otpClient,
  serviceClient,
  stackReachable,
  staffClient,
} from "./stack";

const reachable = await stackReachable("staff sessions");

function throwawayEmail() {
  return `stack-deactivated-${Date.now()}-${randomUUID().slice(0, 8)}@bicii.test`;
}

/** Auth's own answer to an access token (GET /auth/v1/user): status and error_code. */
async function askAuth(accessToken: string): Promise<{ status: number; code: string | undefined }> {
  const res = await fetch(`${STACK_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json()) as { error_code?: string };
  return { status: res.status, code: body.error_code };
}

describe.skipIf(!reachable)("deactivation revokes Auth sessions on the live stack (D71)", () => {
  it("ends the sessions at once, and a fresh code is refused by the staff check", async () => {
    const email = throwawayEmail();

    // Invite: an Auth user without a password, linked as staff by the admin.
    const created = await serviceClient().auth.admin.createUser({ email, email_confirm: true });
    if (created.error) throw created.error;
    const authUserId = created.data.user.id;
    const admin = await staffClient("admin");
    const staff = await admin.rpc("create_staff", {
      auth_user_id: authUserId,
      display_name: "Deactivated Stack Test",
      email,
      role: "staff",
    });
    if (staff.error) throw staff.error;
    const staffId = staff.data.id;

    // The colleague signs in with a code and is active staff.
    const colleague = await otpClient(email);
    const before = await colleague.rpc("my_staff_profile");
    expect(before.error).toBeNull();
    expect(before.data?.[0]).toMatchObject({ id: staffId, active: true });
    const { data: sessionData } = await colleague.auth.getSession();
    const accessToken = sessionData.session!.access_token;
    const refreshToken = sessionData.session?.refresh_token;
    expect(refreshToken).toBeTruthy();
    expect(await askAuth(accessToken)).toEqual({ status: 200, code: undefined });

    // The admin deactivates them, with a reason.
    const deactivated = await admin.rpc("set_staff_active", {
      target_staff_id: staffId,
      active: false,
      reason: "Stack test: left the shop",
    });
    expect(deactivated.error).toBeNull();
    expect(deactivated.data?.active).toBe(false);

    // PostgREST verifies the unexpired access token on its own (the hosted
    // window, D71), but the database already treats the person as inactive.
    const inWindow = await colleague.rpc("my_staff_profile");
    expect(inWindow.error).toBeNull();
    expect(inWindow.data?.[0]).toMatchObject({ id: staffId, active: false, permissions: [] });

    // Auth no longer knows the session: the access token is refused and the
    // refresh token cannot be exchanged.
    const authAnswer = await askAuth(accessToken);
    expect(authAnswer.status).toBe(403);
    expect(authAnswer.code).toBe("session_not_found");
    // supabase-js reports session_not_found as a missing session, which is
    // what getClaims() in the Admin sees: no session, so /login.
    const user = await anonClient().auth.getUser(accessToken);
    expect(user.data.user).toBeNull();
    expect(user.error?.name).toBe("AuthSessionMissingError");
    const refreshed = await anonClient().auth.refreshSession({ refresh_token: refreshToken! });
    expect(refreshed.error?.code).toBe("refresh_token_not_found");
    expect(refreshed.data.session).toBeNull();
    const ownRefresh = await colleague.auth.refreshSession();
    expect(ownRefresh.error).not.toBeNull();

    // A fresh code still verifies at Auth, but the person is inactive, so
    // the Admin signs them out (verifyCode) and requireStaff refuses them.
    const again = await otpClient(email);
    const after = await again.rpc("my_staff_profile");
    expect(after.error).toBeNull();
    expect(after.data?.[0]).toMatchObject({ id: staffId, active: false, permissions: [] });

    // The deactivation is in the history, with the admin as actor.
    const history = await admin.rpc("staff_history", { target_staff_id: staffId });
    expect(history.error).toBeNull();
    expect(history.data?.[0]).toMatchObject({
      event_type: "deactivated",
      actor_staff_id: STAFF.admin,
      reason: "Stack test: left the shop",
    });
  });
});
