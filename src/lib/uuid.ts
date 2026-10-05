/**
 * UUIDs chosen by the client, e.g. a form's idempotency key: a new customer
 * or bike keeps one id across retries, so a repeated submit finds the row it
 * already created instead of creating a second one.
 *
 * `crypto.randomUUID()` exists only in secure contexts (https, localhost);
 * a shop iPad on a plain-http LAN address would not have it, so this falls
 * back to `crypto.getRandomValues()`, which every browser has everywhere.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** A random (version 4) UUID. */
export function newId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
