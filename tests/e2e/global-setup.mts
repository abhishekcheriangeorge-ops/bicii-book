/**
 * E2E global setup: make sure the devstack serves a freshly seeded
 * bicii_dev before any test runs.
 *
 *   1. Reset bicii_dev (roles -> Auth -> Storage -> migrations -> seed)
 *      unless E2E_RESET=0.
 *   2. Start the devstack services if they are not running (idempotent).
 *   3. Wait until a seeded login works end to end through the gateway
 *      (Auth issues a JWT, PostgREST answers my_staff_profile with it).
 *   4. Hand the gateway URL and anon key to the workers (E2E_GATEWAY_URL,
 *      E2E_ANON_KEY) for tests/e2e/api.ts: Playwright loads specs as
 *      CommonJS, which cannot import scripts/devstack/config.mjs.
 *   5. Read the seed's anchor day once (the shop day `db:reset` ran, from
 *      REPORT_JOB.todayReceived's check-in) into E2E_SEED_ANCHOR, which the
 *      Playwright workers inherit (helpers.ts seedAnchor(), anchorDay()).
 *
 * Needs Postgres 16 and the devstack cache (`npm run devstack:setup`, once).
 * E2E_EXTERNAL_STACK=1 skips steps 1 and 2 for a stack this script does not
 * manage (`supabase start`, already reset and seeded); steps 3 and 4 still
 * run (same DATABASE_URL). With E2E_RESET=0 or an external stack the anchor
 * may be an earlier day than today: tests count days from it.
 */
import { execFileSync } from "node:child_process";

import pg from "pg";

import {
  ANON_KEY,
  GATEWAY_URL,
  ROOT,
  databaseName,
  devDatabaseUrl,
} from "../../scripts/devstack/config.mjs";
import { REPORT_JOB, SEED_PASSWORD, STAFF_EMAIL } from "../fixtures/ids";

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

/** The seed's anchor day ('YYYY-MM-DD'), read the way tests/db seedToday() reads it. */
async function readSeedAnchor(url: string): Promise<string> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ d: string }>(
      `select (checked_in_at at time zone 'Asia/Singapore')::date::text as d
         from public.work_orders where id = $1`,
      [REPORT_JOB.todayReceived],
    );
    if (rows.length === 0) {
      throw new Error(
        "[e2e] the seed's anchor job (REPORT_JOB.todayReceived) is missing: reset the database (`npm run db:reset`).",
      );
    }
    return rows[0].d;
  } finally {
    await client.end();
  }
}

export default async function globalSetup() {
  const env = { DATABASE_URL: devDatabaseUrl() };

  if (process.env.E2E_EXTERNAL_STACK === "1") {
    // `supabase start` (Docker) or another stack on the same URL and demo
    // keys: the caller resets and seeds it (`supabase db reset`).
    console.info(`[e2e] using the external stack at ${GATEWAY_URL} as it is`);
  } else {
    if (process.env.E2E_RESET !== "0") {
      console.info(`[e2e] resetting ${databaseName(env.DATABASE_URL)} (set E2E_RESET=0 to skip)`);
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

  process.env.E2E_GATEWAY_URL = GATEWAY_URL;
  process.env.E2E_ANON_KEY = ANON_KEY;
  process.env.E2E_SEED_ANCHOR = await readSeedAnchor(env.DATABASE_URL);
  console.info(`[e2e] seed anchor (day 0): ${process.env.E2E_SEED_ANCHOR}`);
}
