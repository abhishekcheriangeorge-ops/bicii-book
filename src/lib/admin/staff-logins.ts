import "server-only";

import { randomInt } from "node:crypto";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * Supabase Auth admin operations for Staff settings. Service role: callers
 * must already have passed requireStaff('manage_staff'), and the staff row is
 * created afterwards through the create_staff RPC as the inviting user, which
 * checks authorization again in the database.
 */

// No look-alikes (0/O, 1/l/I) so it can be read out loud or copied by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/** 20 characters from a 54-symbol alphabet: about 115 bits. */
export function temporaryPassword(length = 20): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out.replace(/(.{5})(?!$)/g, "$1-");
}

export class LoginExistsError extends Error {
  constructor() {
    super("An account with that email already exists.");
    this.name = "LoginExistsError";
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
    if (error?.code === "email_exists" || error?.status === 422) throw new LoginExistsError();
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
