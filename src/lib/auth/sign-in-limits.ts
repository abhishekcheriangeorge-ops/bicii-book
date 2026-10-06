import { createHash } from "node:crypto";

/**
 * The Admin's own limits on /login (PLAN D72). Pure, so it is unit-tested
 * directly; src/lib/admin/sign-in-throttle.ts counts the attempts in
 * Postgres (public.note_sign_in_attempt).
 *
 * Why the Admin needs its own: the login Server Actions call Supabase Auth
 * from the Admin's server, so Auth's per-IP limits (code requests and
 * verifications per 5 minutes) count the server's address, one bucket
 * shared by every staff member and every visitor. Without these limits one
 * visitor posting bogus emails or wrong codes could keep the whole shop on
 * "Too many attempts". Each attempt is counted per client address and per
 * email, whether or not the email has a login, so a refusal reveals
 * nothing about the account (D70).
 */

export type SignInAttempt = "request" | "verify";

/** Length of one counting window: the same 5 minutes Auth counts in. */
export const SIGN_IN_WINDOW_SECONDS = 300;

/**
 * Attempts allowed per window. Per client: a shop's staff share one
 * address (the shop's connection), so a few people signing in at opening
 * time, with retries, must fit. Per email: Auth emails one address at most
 * once a minute anyway; verifications are the brake on guessing a code
 * that holds whatever addresses the guesser uses.
 */
export const SIGN_IN_LIMITS: Readonly<
  Record<SignInAttempt, Readonly<{ client: number; email: number }>>
> = {
  request: { client: 10, email: 5 },
  verify: { client: 20, email: 10 },
};

function ipv4(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes.join(".") : null;
}

/** The first 64 bits of an IPv6 address ("2001:db8:0:1::/64"), or null. */
function ipv6Prefix(value: string): string | null {
  const address = value.replace(/^\[|\]$/g, "").split("%")[0];
  if (!/^[0-9a-f:.]+$/.test(address) || !address.includes(":")) return null;
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  // An IPv4-mapped address (::ffff:192.0.2.1) is that IPv4 address.
  const last = tail.length > 0 ? tail[tail.length - 1] : head[head.length - 1];
  if (last?.includes(".")) {
    const v4 = ipv4(last);
    const rest = [...head, ...tail.slice(0, -1)];
    if (v4 && rest.length <= 1 && rest.every((g) => /^0*ffff$/.test(g)) && halves.length === 2) {
      return v4;
    }
    return null;
  }
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const full = [...head, ...Array<string>(Math.max(missing, 0)).fill("0"), ...tail];
  if (!full.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return `${full
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * The client's address as the bucket key: the first `x-forwarded-for`
 * entry, else `x-real-ip`. Vercel sets both to the connecting client and
 * overwrites whatever the client sent (RUNBOOK: a host that does not would
 * let a client pick its own bucket; the per-email limit still holds). IPv6
 * clients are counted per /64, the block one subscriber usually gets.
 * Null when there is no usable address.
 */
export function clientAddress(headers: Pick<Headers, "get">): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = (forwarded || headers.get("x-real-ip")?.trim() || "").toLowerCase();
  if (!raw) return null;
  return ipv4(raw.replace(/:\d+$/, "")) ?? ipv6Prefix(raw);
}

export type SignInBucket = { key: string; limit: number };

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The counters one attempt adds to: per client and per email. Keys hold a
 * SHA-256 of the address and of the email, never either in clear. Clients
 * without a usable address share one "unknown" bucket. `multiplier` raises
 * every limit (SIGN_IN_LIMIT_MULTIPLIER; the E2E suite signs in hundreds
 * of times from one address).
 */
export function signInBuckets(
  attempt: SignInAttempt,
  client: string | null,
  email: string,
  multiplier = 1,
): SignInBucket[] {
  const limits = SIGN_IN_LIMITS[attempt];
  return [
    { key: `${attempt}:client:${digest(client ?? "unknown")}`, limit: limits.client * multiplier },
    {
      key: `${attempt}:email:${digest(email.trim().toLowerCase())}`,
      limit: limits.email * multiplier,
    },
  ];
}

/** True when any bucket's count in this window (including this attempt) is over its limit. */
export function overSignInLimit(
  buckets: readonly SignInBucket[],
  hits: ReadonlyMap<string, number>,
): boolean {
  return buckets.some((b) => (hits.get(b.key) ?? 0) > b.limit);
}
