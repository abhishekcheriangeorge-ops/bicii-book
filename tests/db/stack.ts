/**
 * Shared by the live devstack tests (*.stack.test.ts, stack.smoke.test.ts):
 * the gateway URL, whether it is reachable, and signed-in clients.
 *
 * Those files skip, saying so, when the gateway is not reachable, unless
 * BICII_REQUIRE_STACK=1 (CI), where an unreachable gateway fails instead.
 */
import { createClient } from "@supabase/supabase-js";

import { ANON_KEY, GATEWAY_URL } from "../../scripts/devstack/config.mjs";
import type { Database } from "@/lib/database.types";

import { SEED_PASSWORD, STAFF_EMAIL, type SeedStaff } from "../fixtures/ids";

export const STACK_URL = process.env.BICII_STACK_URL ?? GATEWAY_URL;

async function gatewayHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${STACK_URL}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** True when the devstack answers; throws under BICII_REQUIRE_STACK=1 when it does not. */
export async function stackReachable(label: string): Promise<boolean> {
  const reachable = await gatewayHealthy();
  // CI starts the devstack before `npm test` and sets BICII_REQUIRE_STACK=1,
  // so an unreachable gateway there is a failure, not a silent skip.
  if (!reachable && process.env.BICII_REQUIRE_STACK === "1") {
    throw new Error(
      `[${label}] BICII_REQUIRE_STACK=1 but the devstack gateway is not reachable at ${STACK_URL}/health.`,
    );
  }
  if (!reachable) {
    console.warn(
      `[${label}] SKIPPED: devstack gateway not reachable at ${STACK_URL}/health. ` +
        "Run `npm run db:reset && npm run devstack:start` to include it.",
    );
  }
  return reachable;
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };

/** An anonymous client, as a visitor's browser. */
export function anonClient() {
  return createClient<Database>(STACK_URL, ANON_KEY, options);
}

/** A client signed in as a seeded staff member. */
export async function staffClient(who: SeedStaff) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: STAFF_EMAIL[who],
    password: SEED_PASSWORD,
  });
  if (error) throw error;
  return client;
}
