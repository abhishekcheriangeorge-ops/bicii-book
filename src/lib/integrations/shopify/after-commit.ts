import "server-only";

import type { Logger } from "pino";

/**
 * Work an action does after its write is committed: running the job the
 * RPC queued and reading the result back (D86, D87). The queue is
 * authoritative and the immediate run only speeds things up, so a failure
 * here (no service-role key, Shopify down, a failed read) must not report
 * the committed write as failed: it is logged and `fallback` is returned
 * ("saved; the queue runs it"). The cron or a retry runs the job later.
 */
export async function afterCommit<T>(
  what: string,
  log: Pick<Logger, "error">,
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    log.error(
      { step: what, err: e instanceof Error ? e.message : String(e) },
      "follow-up after a committed write failed; the job stays in the queue",
    );
    return fallback;
  }
}
