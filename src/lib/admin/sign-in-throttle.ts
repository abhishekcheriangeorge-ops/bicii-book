import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";

import {
  SIGN_IN_WINDOW_SECONDS,
  clientAddress,
  overSignInLimit,
  signInBuckets,
  type SignInAttempt,
} from "@/lib/auth/sign-in-limits";
import type { Database } from "@/lib/database.types";
import { getServerEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The Admin's own sign-in limits (PLAN D72; src/lib/auth/sign-in-limits.ts
 * says why). Every code request and every code verification on /login is
 * counted here BEFORE Supabase Auth is asked, per client address and per
 * email, in Postgres (public.note_sign_in_attempt, service role only), so
 * the count holds across every server instance.
 *
 *   "ok"          go ahead and ask Auth;
 *   "limited"     over a limit: say "Too many attempts" (the same for every
 *                 email, with or without a login);
 *   "unavailable" the count could not be taken: say sign-in is unavailable
 *                 (without the database nobody can sign in anyway).
 */
export type SignInThrottle = "ok" | "limited" | "unavailable";

/** Counts one attempt with an explicit client address (the stack test calls this). */
export async function countSignInAttempt(
  service: SupabaseClient<Database>,
  attempt: SignInAttempt,
  client: string | null,
  email: string,
  multiplier = 1,
): Promise<SignInThrottle> {
  const buckets = signInBuckets(attempt, client, email, multiplier);
  const { data, error } = await service.rpc("note_sign_in_attempt", {
    buckets: buckets.map((b) => b.key),
    window_seconds: SIGN_IN_WINDOW_SECONDS,
  });
  if (error || !data) return "unavailable";
  const hits = new Map(data.map((row) => [row.bucket_key, row.hit_count]));
  return overSignInLimit(buckets, hits) ? "limited" : "ok";
}

/** Counts one attempt by the client of the current request (a login Server Action). */
export async function noteSignInAttempt(
  attempt: SignInAttempt,
  email: string,
): Promise<SignInThrottle> {
  try {
    const client = clientAddress(await headers());
    const { SIGN_IN_LIMIT_MULTIPLIER } = getServerEnv();
    return await countSignInAttempt(
      createServiceClient(),
      attempt,
      client,
      email,
      SIGN_IN_LIMIT_MULTIPLIER,
    );
  } catch {
    // No service-role key, or the request failed before an answer.
    return "unavailable";
  }
}
