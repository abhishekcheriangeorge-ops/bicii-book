/**
 * Live devstack: the Admin's own sign-in limits (PLAN D72) through the
 * app's module (src/lib/admin/sign-in-throttle.ts) and PostgREST, with the
 * real limits (no multiplier):
 *
 *   * one email past its limit is refused whatever client asks, and other
 *     emails from those clients are not;
 *   * one client past its limit is refused whatever email it asks for, and
 *     other clients are not;
 *   * an email with a login and an unknown email are counted alike (D70:
 *     a refusal reveals nothing about the account);
 *   * requests and verifications are counted apart;
 *   * only the service role can count: the anon key and a staff session
 *     get permission denied, and the module answers "unavailable" with the
 *     cause it logs (a wrong key in SUPABASE_SERVICE_ROLE_KEY locks every
 *     sign-in out, so the log must say why).
 *
 * Needs `npm run db:reset && npm run devstack:start`; skips like the other
 * stack tests unless BICII_REQUIRE_STACK=1. Buckets are unique per run
 * (random client addresses and .test emails); the counters expire.
 */
import { randomInt, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { checkSignInAttempt, countSignInAttempt } from "@/lib/admin/sign-in-throttle";
import { SIGN_IN_LIMITS } from "@/lib/auth/sign-in-limits";

import { STAFF_EMAIL } from "../fixtures/ids";
import { anonClient, serviceClient, stackReachable, staffClient } from "./stack";

const reachable = await stackReachable("sign-in throttle");

/** A random documentation-range client address (198.18.0.0/15, benchmarking). */
function client(): string {
  return `198.${18 + randomInt(2)}.${randomInt(256)}.${randomInt(256)}`;
}

function unknownEmail(): string {
  return `stack-throttle-${Date.now()}-${randomUUID().slice(0, 8)}@bicii.test`;
}

describe.skipIf(!reachable)("the Admin's sign-in limits on the live stack (D72)", () => {
  it("refuses one email past its limit from any client, and nothing else", async () => {
    const service = serviceClient();
    const email = unknownEmail();
    const { email: limit } = SIGN_IN_LIMITS.request;
    for (let i = 1; i <= limit; i++) {
      expect(await countSignInAttempt(service, "request", client(), email)).toBe("ok");
    }
    expect(await countSignInAttempt(service, "request", client(), email)).toBe("limited");
    // Another email is unaffected, and so are verifications for this one.
    expect(await countSignInAttempt(service, "request", client(), unknownEmail())).toBe("ok");
    expect(await countSignInAttempt(service, "verify", client(), email)).toBe("ok");
  });

  it("refuses one client past its limit for any email, and nothing else", async () => {
    const service = serviceClient();
    const address = client();
    const { client: limit } = SIGN_IN_LIMITS.verify;
    for (let i = 1; i <= limit; i++) {
      expect(await countSignInAttempt(service, "verify", address, unknownEmail())).toBe("ok");
    }
    expect(await countSignInAttempt(service, "verify", address, unknownEmail())).toBe("limited");
    expect(await countSignInAttempt(service, "verify", client(), unknownEmail())).toBe("ok");
    expect(await countSignInAttempt(service, "request", address, unknownEmail())).toBe("ok");
  });

  it("counts an email with a login exactly like an unknown one (D70)", async () => {
    const service = serviceClient();
    const { email: limit } = SIGN_IN_LIMITS.request;
    /** Answers for `email`, each from a fresh client, until the first refusal. */
    async function untilLimited(email: string): Promise<string[]> {
      const answers: string[] = [];
      while (answers.length <= limit && answers.at(-1) !== "limited") {
        answers.push(await countSignInAttempt(service, "request", client(), email));
      }
      return answers;
    }
    const unknown = await untilLimited(unknownEmail());
    expect(unknown).toEqual([...Array(limit).fill("ok"), "limited"]);
    // The staff email's counter may already hold attempts from this window
    // (E2E, the smoke test), so it may be refused sooner, never later.
    const staff = await untilLimited(STAFF_EMAIL.mechanic2);
    expect(staff.at(-1)).toBe("limited");
    expect(staff.length).toBeLessThanOrEqual(limit + 1);
  });

  it("only the service role can count attempts", async () => {
    const args = { buckets: ["request:client:x"], window_seconds: 300 };
    const anon = await anonClient().rpc("note_sign_in_attempt", args);
    expect(anon.error?.code).toBe("42501");
    const staff = await (await staffClient("mechanic1")).rpc("note_sign_in_attempt", args);
    expect(staff.error?.code).toBe("42501");
    // The anon key where the service-role key belongs: every attempt is
    // unavailable, with a cause that names the refusal and not the email.
    const email = unknownEmail();
    const wrongKey = await checkSignInAttempt(anonClient(), "request", client(), email);
    expect(wrongKey.throttle).toBe("unavailable");
    expect(wrongKey.cause).toMatchObject({ reason: "rpc_error", code: "42501" });
    expect(JSON.stringify(wrongKey.cause)).not.toContain(email);
  });
});
