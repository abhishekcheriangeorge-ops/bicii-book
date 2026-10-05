/**
 * Direct API calls for E2E setup and for acting as a customer (the public
 * site's frontend is Phase 11): password sign-in through the devstack's
 * Auth, PostgREST RPCs and RLS reads through the gateway, exactly as
 * tests/e2e/global-setup.mts reaches them (it hands the gateway URL and the
 * anon key from scripts/devstack/config.mjs to the workers as
 * E2E_GATEWAY_URL and E2E_ANON_KEY: specs load as CommonJS and cannot
 * import that ES module). Everything runs as the signed-in user, so RLS and
 * the RPCs' own checks apply.
 */

function env(name: "E2E_GATEWAY_URL" | "E2E_ANON_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set: tests/e2e/global-setup.mts sets it; run \`npm run test:e2e\`.`,
    );
  }
  return value;
}

const GATEWAY_URL = () => env("E2E_GATEWAY_URL");
const ANON_KEY = () => env("E2E_ANON_KEY");

/** An access token for a seeded or test login. */
export async function signInApi(email: string, password: string): Promise<string> {
  const res = await fetch(`${GATEWAY_URL()}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY(), "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign-in as ${email} failed: ${res.status} ${await res.text()}`);
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

function headers(token: string): Record<string, string> {
  return {
    apikey: ANON_KEY(),
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

/** Calls public.<name>(args) as the token's user; throws with PostgREST's error on failure. */
export async function rpc<T = unknown>(
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${GATEWAY_URL()}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${name} failed: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** GET /rest/v1/<pathAndQuery> as the token's user (RLS reads), e.g. "appointments?select=id&id=eq.…". */
export async function select<T = unknown>(token: string, pathAndQuery: string): Promise<T[]> {
  const res = await fetch(`${GATEWAY_URL()}/rest/v1/${pathAndQuery}`, { headers: headers(token) });
  const text = await res.text();
  if (!res.ok) throw new Error(`select ${pathAndQuery} failed: ${res.status} ${text}`);
  return JSON.parse(text) as T[];
}
