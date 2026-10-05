import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

import { temporaryPassword } from "./temporary-password";

/**
 * Supabase Auth admin operations for Staff settings. Service role: callers
 * must already have passed requireStaff('manage_staff'), and the staff row is
 * created afterwards through the create_staff RPC as the inviting user, which
 * checks authorization again in the database.
 */

export class LoginExistsError extends Error {
  constructor() {
    super("An account with that email already exists.");
    this.name = "LoginExistsError";
  }
}

/** Supabase Auth refused the generated password (the project's password rules). */
export class WeakPasswordError extends Error {
  constructor(readonly reasons: string[]) {
    super(
      `Supabase Auth rejected the temporary password: ${reasons.join(", ") || "weak_password"}`,
    );
    this.name = "WeakPasswordError";
  }
}

/**
 * Creates a confirmed email/password login with a one-time temporary
 * password. The password is returned once, to be shown to the admin; it is
 * not stored or logged anywhere by the app.
 */
export async function createStaffLogin(input: {
  email: string;
  displayName: string;
}): Promise<{ userId: string; temporaryPassword: string }> {
  const admin = createServiceClient().auth.admin;
  const password = temporaryPassword();
  const { data, error } = await admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    user_metadata: { display_name: input.displayName },
  });
  if (error || !data.user) {
    // Match on the code: Auth answers 422 for several unrelated problems
    // (weak_password among them), so the status alone means nothing.
    if (error?.code === "email_exists" || error?.code === "user_already_exists") {
      throw new LoginExistsError();
    }
    if (error?.code === "weak_password") {
      const reasons = (error as { reasons?: unknown }).reasons;
      throw new WeakPasswordError(Array.isArray(reasons) ? reasons.map(String) : []);
    }
    throw new Error(
      `auth.admin.createUser failed: ${error?.code ?? "no user"} ${error?.message ?? ""}`,
    );
  }
  return { userId: data.user.id, temporaryPassword: password };
}

/** Compensation when linking the staff row fails: remove the login just created. */
export async function deleteStaffLogin(userId: string): Promise<void> {
  const { error } = await createServiceClient().auth.admin.deleteUser(userId);
  if (error) throw new Error(`auth.admin.deleteUser failed: ${error.code ?? ""} ${error.message}`);
}
