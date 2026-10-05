import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

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

/**
 * Creates a confirmed, code-only login (PLAN D10): the invitee signs in
 * with a code emailed to this address, and nobody, the inviter included,
 * ever holds a credential for it. (Auth itself stores the hash of a random
 * secret that it never reveals.)
 */
export async function createStaffLogin(input: {
  email: string;
  displayName: string;
}): Promise<{ userId: string }> {
  const admin = createServiceClient().auth.admin;
  const { data, error } = await admin.createUser({
    email: input.email,
    email_confirm: true,
    user_metadata: { display_name: input.displayName },
  });
  if (error || !data.user) {
    // Match on the code: Auth answers 422 for several unrelated problems,
    // so the status alone means nothing.
    if (error?.code === "email_exists" || error?.code === "user_already_exists") {
      throw new LoginExistsError();
    }
    throw new Error(
      `auth.admin.createUser failed: ${error?.code ?? "no user"} ${error?.message ?? ""}`,
    );
  }
  return { userId: data.user.id };
}

/** Compensation when linking the staff row fails: remove the login just created. */
export async function deleteStaffLogin(userId: string): Promise<void> {
  const { error } = await createServiceClient().auth.admin.deleteUser(userId);
  if (error) throw new Error(`auth.admin.deleteUser failed: ${error.code ?? ""} ${error.message}`);
}
