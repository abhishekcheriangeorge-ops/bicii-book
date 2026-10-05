/**
 * The public site URL the E2E web server is given as
 * NEXT_PUBLIC_PUBLIC_SITE_URL (playwright.config.mts), shared so a spec
 * can build the exact QR payload `{base}/q/{shortId}` the app accepts
 * (PLAN D9). Trailing slashes are dropped, as src/lib/env.ts does.
 */
export const E2E_PUBLIC_SITE_URL = (
  process.env.NEXT_PUBLIC_PUBLIC_SITE_URL ?? "http://localhost:4000"
).replace(/\/+$/, "");
