/**
 * The environment's public site URL the E2E web server is given as
 * NEXT_PUBLIC_PUBLIC_SITE_URL (playwright.config.mts): since Phase 8 only an
 * EXTRA base the scanner accepts (scanBases, src/lib/qr.ts; PLAN D9,
 * ADR-017). Labels encode, and the Admin displays, the database QR base
 * (shop_settings.public_site_url, SHOP.publicSiteUrl in tests/fixtures/ids.ts,
 * http://localhost:4000). The default here is deliberately a different
 * port, so E2E proves displayed and printed URLs come from the database
 * and scanning still accepts this base. Trailing slashes are dropped, as
 * src/lib/env.ts does.
 */
export const E2E_PUBLIC_SITE_URL = (
  process.env.NEXT_PUBLIC_PUBLIC_SITE_URL ?? "http://localhost:4001"
).replace(/\/+$/, "");
