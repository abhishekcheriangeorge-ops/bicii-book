/**
 * Reading list filters from the URL (`?q=…&archived=1`). Search lives in
 * the URL so a result list can be shared, reloaded and gone back to. Pure:
 * used by Server Component pages (from `searchParams`) and by the client
 * search field.
 */

/** staff_search cuts the query at 200 characters; so do we. */
export const MAX_QUERY_LENGTH = 200;

type ParamValue = string | string[] | undefined | null;

const first = (value: ParamValue): string => (Array.isArray(value) ? value[0] : value) ?? "";

/** The search text: first value only, trimmed, inner whitespace collapsed, at most 200 characters. */
export function readQuery(value: ParamValue): string {
  return first(value).replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH).trim();
}

/** A boolean flag: "1", "true", "yes" and "on" are true; anything else is false. */
export function readFlag(value: ParamValue): boolean {
  return ["1", "true", "yes", "on"].includes(first(value).trim().toLowerCase());
}

/**
 * The query string after setting `key` to `value` (removed when empty),
 * keeping every other parameter: "?q=tan&archived=1", or "" when nothing is
 * left.
 */
export function withParam(
  current: string | URLSearchParams,
  key: string,
  value: string | null | undefined,
): string {
  const params = new URLSearchParams(current);
  const next = value?.trim() ?? "";
  if (next) params.set(key, next);
  else params.delete(key);
  const s = params.toString();
  return s ? `?${s}` : "";
}
