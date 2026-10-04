/**
 * Where to send a user after signing in. `next` comes from the query string,
 * so it is attacker-controlled: only same-origin relative paths survive.
 * Anything else (absolute URLs, protocol-relative `//host`, backslash
 * tricks, `javascript:`, control characters, the login page itself) falls
 * back to the Today dashboard.
 */
export const DEFAULT_AFTER_LOGIN = "/";

const BASE = "http://bicii.invalid";

export function safeNextPath(next: unknown): string {
  if (typeof next !== "string") return DEFAULT_AFTER_LOGIN;
  const value = next.trim();
  if (value === "" || value.length > 2048) return DEFAULT_AFTER_LOGIN;
  // Must be a path: one leading slash, not `//` or `/\` (browsers treat both
  // as protocol-relative), no backslashes or control characters anywhere.
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_AFTER_LOGIN;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return DEFAULT_AFTER_LOGIN;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  if (url.origin !== BASE) return DEFAULT_AFTER_LOGIN;
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return DEFAULT_AFTER_LOGIN;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** /login?next=<path>, for redirects from guarded pages. */
export function loginUrlFor(pathWithSearch: string): string {
  const next = safeNextPath(pathWithSearch);
  return next === DEFAULT_AFTER_LOGIN ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
