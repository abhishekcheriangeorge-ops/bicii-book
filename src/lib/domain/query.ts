import "server-only";

/**
 * Helpers for the few list queries that filter with ILIKE through PostgREST
 * (archived lists, which staff_search leaves out by design).
 */

/** `%text%` with LIKE's own metacharacters (% _ \) matched literally. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}

/** Lower-cased words of a query, at most eight (as private.search_terms). */
export function queryWords(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 8);
}

/**
 * A value inside a PostgREST `or=(…)` filter, double-quoted so commas,
 * dots, colons and parentheses in what staff typed stay literal.
 */
export function orValue(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}
