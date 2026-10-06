/**
 * QR base cases (PLAN D9, ADR-017): which shop_settings.public_site_url
 * values are a usable QR base. One list drives both sides of the rule:
 * tests/db/labels.test.ts (the shop_settings_public_site_url_check
 * constraint and private.qr_payload) and the TypeScript validator in
 * src/lib/qr.ts (Phase 8 step 2), so the two never disagree.
 *
 * The rule: `^https?://[^/?#[:space:]]+(/[^?#[:space:]]*)?$`, at most 200
 * characters: http or https (lower case), a host, an optional path, no
 * query, no fragment, no whitespace. `payloadBase` is what the payload
 * starts with: the base without trailing slashes, so there is exactly one
 * slash before `q/`.
 */
export type QrBaseCase = {
  base: string;
  valid: boolean;
  /** For valid bases: `${payloadBase}/q/${shortId}` is the payload. */
  payloadBase?: string;
};

export const QR_BASE_CASES: readonly QrBaseCase[] = [
  { base: "http://localhost:4000", valid: true, payloadBase: "http://localhost:4000" },
  { base: "https://bicii.sg", valid: true, payloadBase: "https://bicii.sg" },
  { base: "https://shop.example/", valid: true, payloadBase: "https://shop.example" },
  { base: "https://bicii.sg/shop", valid: true, payloadBase: "https://bicii.sg/shop" },
  { base: "https://bicii.sg/shop/", valid: true, payloadBase: "https://bicii.sg/shop" },
  { base: "https://bicii.sg/a/b", valid: true, payloadBase: "https://bicii.sg/a/b" },
  { base: "http://127.0.0.1:3000", valid: true, payloadBase: "http://127.0.0.1:3000" },
  { base: "javascript:alert(1)", valid: false },
  { base: "https://bicii.sg/?ref=label", valid: false },
  { base: "https://bicii.sg/shop?x=1", valid: false },
  { base: "https://bicii.sg/#top", valid: false },
  { base: "ftp://bicii.sg", valid: false },
  { base: "bicii.sg", valid: false },
  { base: "https://", valid: false },
  { base: "https:///shop", valid: false },
  { base: "https://bicii .sg", valid: false },
  { base: `https://bicii.sg/${"a".repeat(190)}`, valid: false },
];
