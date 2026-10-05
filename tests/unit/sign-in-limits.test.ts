import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SIGN_IN_LIMITS,
  SIGN_IN_WINDOW_SECONDS,
  clientAddress,
  overSignInLimit,
  signInBuckets,
} from "@/lib/auth/sign-in-limits";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const h = (entries: Record<string, string>) => new Headers(entries);

describe("clientAddress (PLAN D72)", () => {
  it("takes the first x-forwarded-for entry, else x-real-ip", () => {
    expect(clientAddress(h({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientAddress(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientAddress(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(
      clientAddress(h({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.2" })),
    ).toBe("203.0.113.7");
    expect(clientAddress(h({ "x-forwarded-for": "", "x-real-ip": "198.51.100.2" }))).toBe(
      "198.51.100.2",
    );
  });

  it("counts an IPv6 client per /64 and an IPv4-mapped one as its IPv4 address", () => {
    expect(clientAddress(h({ "x-forwarded-for": "2001:db8:0:1:aaaa:bbbb:cccc:dddd" }))).toBe(
      "2001:db8:0:1::/64",
    );
    expect(clientAddress(h({ "x-forwarded-for": "2001:DB8:0:1::5" }))).toBe("2001:db8:0:1::/64");
    expect(clientAddress(h({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8:0:0::/64");
    expect(clientAddress(h({ "x-forwarded-for": "::1" }))).toBe("0:0:0:0::/64");
    expect(clientAddress(h({ "x-forwarded-for": "::ffff:192.0.2.1" }))).toBe("192.0.2.1");
    // Two addresses in one /64 share a bucket; another /64 does not.
    expect(clientAddress(h({ "x-forwarded-for": "2001:db8:0:1::1" }))).toBe(
      clientAddress(h({ "x-forwarded-for": "2001:db8:0:1:ffff::2" })),
    );
    expect(clientAddress(h({ "x-forwarded-for": "2001:db8:0:2::1" }))).not.toBe(
      clientAddress(h({ "x-forwarded-for": "2001:db8:0:1::1" })),
    );
  });

  it("drops an IPv4 port and refuses anything that is not an address", () => {
    expect(clientAddress(h({ "x-forwarded-for": "203.0.113.7:51000" }))).toBe("203.0.113.7");
    expect(clientAddress(h({}))).toBeNull();
    for (const bad of ["unknown", "999.1.1.1", "1.2.3", "2001:db8::1::2", "1:2:3:4:5:6:7:8:9"]) {
      expect(clientAddress(h({ "x-forwarded-for": bad }))).toBeNull();
    }
  });
});

describe("signInBuckets and overSignInLimit (PLAN D72)", () => {
  it("counts per client and per email, hashing both, the email case-insensitively", () => {
    const buckets = signInBuckets("request", "203.0.113.7", "Asha@Example.test");
    expect(buckets).toEqual([
      { key: `request:client:${sha("203.0.113.7")}`, limit: SIGN_IN_LIMITS.request.client },
      { key: `request:email:${sha("asha@example.test")}`, limit: SIGN_IN_LIMITS.request.email },
    ]);
    for (const b of buckets) {
      expect(b.key).not.toContain("203.0.113.7");
      expect(b.key.toLowerCase()).not.toContain("asha");
    }
  });

  it("keeps requests and verifications apart, and clients without an address share one bucket", () => {
    const request = signInBuckets("request", null, "a@example.test");
    const verify = signInBuckets("verify", null, "a@example.test");
    expect(request[0].key).toBe(`request:client:${sha("unknown")}`);
    expect(verify[0].key).toBe(`verify:client:${sha("unknown")}`);
    expect(verify.map((b) => b.limit)).toEqual([
      SIGN_IN_LIMITS.verify.client,
      SIGN_IN_LIMITS.verify.email,
    ]);
  });

  it("the multiplier raises every limit", () => {
    expect(
      signInBuckets("verify", "203.0.113.7", "a@example.test", 1000).map((b) => b.limit),
    ).toEqual([SIGN_IN_LIMITS.verify.client * 1000, SIGN_IN_LIMITS.verify.email * 1000]);
  });

  it("allows up to the limit, including this attempt, and refuses past it", () => {
    const [client, email] = signInBuckets("request", "203.0.113.7", "a@example.test");
    const at = (c: number, e: number) =>
      new Map([
        [client.key, c],
        [email.key, e],
      ]);
    expect(overSignInLimit([client, email], at(1, 1))).toBe(false);
    expect(overSignInLimit([client, email], at(client.limit, email.limit))).toBe(false);
    expect(overSignInLimit([client, email], at(client.limit + 1, 1))).toBe(true);
    expect(overSignInLimit([client, email], at(1, email.limit + 1))).toBe(true);
    expect(overSignInLimit([client, email], new Map())).toBe(false);
  });

  it("uses Auth's 5-minute window and leaves room for a shop's staff behind one address", () => {
    expect(SIGN_IN_WINDOW_SECONDS).toBe(300);
    expect(SIGN_IN_LIMITS).toEqual({
      request: { client: 10, email: 5 },
      verify: { client: 20, email: 10 },
    });
  });
});
