/**
 * Correlation IDs (ADR-001 A8). proxy.ts keeps a well-formed incoming
 * `x-request-id` (from a load balancer or Vercel) so logs line up across
 * hops, and mints a UUID otherwise. Anything odd is replaced, never trusted:
 * the value ends up in logs and database rows.
 */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * The same ID on requests from the server to Supabase. A header name of our
 * own, so no gateway in between rewrites it; PostgREST hands it to SQL in
 * `request.headers` (private.current_correlation_id()).
 */
export const CORRELATION_HEADER = "x-correlation-id";

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function requestIdFrom(incoming: string | null | undefined): string {
  if (incoming && SAFE.test(incoming)) return incoming;
  return crypto.randomUUID();
}
