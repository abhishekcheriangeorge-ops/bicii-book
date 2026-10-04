/**
 * E2E global setup: make sure the devstack serves a freshly seeded
 * bicii_dev before any test runs.
 *
 *   1. Reset bicii_dev (roles -> Auth -> Storage -> migrations -> seed)
 *      unless E2E_RESET=0.
 *   2. Start the devstack services if they are not running (idempotent).
 *   3. Wait until a seeded login works end to end through the gateway
 *      (Auth issues a JWT, PostgREST answers my_staff_profile with it).
 *
 * Needs Postgres 16 and the devstack cache (`npm run devstack:setup`, once).
 * E2E_EXTERNAL_STACK=1 skips steps 1 and 2 for a stack this script does not
 * manage (`supabase start`, already reset and seeded); step 3 still runs.
 */
import { execFileSync } from "node:child_process";

import {
  ANON_KEY,
  DEFAULT_DB_NAME,
  GATEWAY_URL,
  ROOT,
  databaseUrl,
  withDatabase,
} from "../../scripts/devstack/config.mjs";
import { SEED_PASSWORD, STAFF_EMAIL } from "../fixtures/ids";

function run(script: string, args: string[], env: Record<string, string>) {
  execFileSync(process.execPath, [`scripts/devstack/${script}`, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

async function stackWorks(): Promise<boolean> {
  try {
    const token = await fetch(`${GATEWAY_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email: STAFF_EMAIL.admin, password: SEED_PASSWORD }),
    });
    if (!token.ok) return false;
    const { access_token } = (await token.json()) as { access_token: string };
    const profile = await fetch(`${GATEWAY_URL}/rest/v1/rpc/my_staff_profile`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        authorization: `Bearer ${access_token}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!profile.ok) return false;
    const rows = (await profile.json()) as Array<{ role: string }>;
    return rows[0]?.role === "admin";
  } catch {
    return false;
  }
}

export default async function globalSetup() {
  const env = { DATABASE_URL: withDatabase(databaseUrl(), DEFAULT_DB_NAME) };

  if (process.env.E2E_EXTERNAL_STACK === "1") {
    // `supabase start` (Docker) or another stack on the same URL and demo
    // keys: the caller resets and seeds it (`supabase db reset`).
    console.info(`[e2e] using the external stack at ${GATEWAY_URL} as it is`);
  } else {
    if (process.env.E2E_RESET !== "0") {
      console.info("[e2e] resetting bicii_dev (set E2E_RESET=0 to skip)");
      run("db.mjs", ["reset"], env);
    }
    run("start.mjs", [], env);
  }

  // After a reset the services reconnect and PostgREST reloads its schema
  // cache; give them a moment.
  const deadline = Date.now() + 60_000;
  while (!(await stackWorks())) {
    if (Date.now() > deadline) {
      throw new Error(
        `[e2e] the devstack at ${GATEWAY_URL} did not accept the seeded admin login. ` +
          "Check `npm run devstack:status` and the logs in .devstack/logs.",
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.info("[e2e] devstack ready");
}
