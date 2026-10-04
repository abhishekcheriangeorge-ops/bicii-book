/**
 * Live devstack smoke test (not a database-only test): signs in through the
 * gateway with supabase-js exactly as the app will, calls an RPC through
 * PostgREST, and round-trips an object through Storage.
 *
 * Needs `npm run db:reset && npm run devstack:start`. Skips, saying so, when
 * the gateway is not reachable, unless BICII_REQUIRE_STACK=1 (CI), where an
 * unreachable gateway fails the file instead.
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { ANON_KEY, GATEWAY_URL, SERVICE_ROLE_KEY } from "../../scripts/devstack/config.mjs";
import type { Database } from "@/lib/database.types";

import { SEED_PASSWORD, STAFF, STAFF_EMAIL } from "../fixtures/ids";

const url = process.env.BICII_STACK_URL ?? GATEWAY_URL;

async function gatewayHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

const reachable = await gatewayHealthy();
// CI starts the devstack before `npm test` and sets BICII_REQUIRE_STACK=1, so
// an unreachable gateway there is a failure, not a silent skip.
if (!reachable && process.env.BICII_REQUIRE_STACK === "1") {
  throw new Error(
    `[stack smoke] BICII_REQUIRE_STACK=1 but the devstack gateway is not reachable at ${url}/health.`,
  );
}
if (!reachable) {
  console.warn(
    `[stack smoke] SKIPPED: devstack gateway not reachable at ${url}/health. ` +
      "Run `npm run db:reset && npm run devstack:start` to include it.",
  );
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!reachable)("devstack through the gateway", () => {
  it("signs in as the seeded admin and reads my_staff_profile via RPC", async () => {
    const supabase = createClient<Database>(url, ANON_KEY, options);
    const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
      email: STAFF_EMAIL.admin,
      password: SEED_PASSWORD,
    });
    expect(signInError).toBeNull();
    expect(session.user?.email).toBe(STAFF_EMAIL.admin);

    const { data, error } = await supabase.rpc("my_staff_profile").single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: STAFF.admin, role: "admin", active: true });
    expect(data?.permissions).toHaveLength(7);
    await supabase.auth.signOut();
  });

  it("denies anonymous reads of staff", async () => {
    const anon = createClient<Database>(url, ANON_KEY, options);
    const { data, error } = await anon.from("staff").select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("uploads and downloads an object through Storage with the service key", async () => {
    const service = createClient<Database>(url, SERVICE_ROLE_KEY, options);
    const bucket = "devstack-smoke";
    const { error: bucketError } = await service.storage.createBucket(bucket, { public: false });
    if (bucketError && !/already exists/i.test(bucketError.message)) throw bucketError;

    const path = `smoke/${Date.now()}.txt`;
    const body = `bicii devstack ${new Date().toISOString()}`;
    const { error: uploadError } = await service.storage
      .from(bucket)
      .upload(path, new Blob([body], { type: "text/plain" }));
    expect(uploadError).toBeNull();

    const { data: file, error: downloadError } = await service.storage.from(bucket).download(path);
    expect(downloadError).toBeNull();
    expect(await file?.text()).toBe(body);

    const { error: removeError } = await service.storage.from(bucket).remove([path]);
    expect(removeError).toBeNull();
  });
});
