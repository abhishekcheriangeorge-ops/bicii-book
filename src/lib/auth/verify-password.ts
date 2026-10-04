import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { getPublicEnv } from "@/lib/env";

import { classifySignInError, type SignInFailure } from "./sign-in-errors";

/**
 * Checks `password` against the login `email` without touching the
 * caller's own session: a throwaway, non-persisting anon client signs in,
 * then signs that one session out again (scope "local", so the caller's
 * other sessions are untouched). Used to require the current password
 * before a password change, so a signed-in device left unattended cannot be
 * used to take the account over for good.
 */
export async function verifyPassword(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; failure: SignInFailure }> {
  const env = getPublicEnv();
  const client = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return { ok: false, failure: error ? classifySignInError(error) : "unavailable" };
  }
  // Best effort: an unrevoked throwaway session only expires on its own.
  await client.auth.signOut({ scope: "local" }).catch(() => {});
  return { ok: true };
}
