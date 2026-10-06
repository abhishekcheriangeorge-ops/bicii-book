import "server-only";

import { timingSafeEqual } from "node:crypto";

import type { Logger } from "pino";

import { getServerEnv } from "@/lib/env";
import { child } from "@/lib/logger";
import { REQUEST_ID_HEADER, requestIdFrom } from "@/lib/request-id";

import { defaultDeps } from "./deps";
import { runDueJobs, type DueJobsSummary } from "./queue";

/**
 * GET /api/cron/integrations (D87; RUNBOOK "Shopify"): the Vercel cron
 * (vercel.json, every 5 minutes) runs due integration jobs. Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; anything else is refused.
 *
 *   503  CRON_SECRET unset (the route is off)
 *   401  a missing or wrong bearer
 *   200  the run's summary { claimed, done, failed, needsAttention, deferred }
 */

export type CronDeps = {
  secret: string | undefined;
  runDue: (
    options: { limit: number; budgetMs: number },
    correlationId: string,
  ) => Promise<DueJobsSummary>;
  log: Logger;
};

function respond(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Constant-time comparison of the presented bearer with the secret. */
export function bearerMatches(authorization: string | null, secret: string): boolean {
  if (!authorization) return false;
  const m = /^Bearer (.+)$/.exec(authorization.trim());
  if (!m) return false;
  const presented = Buffer.from(m[1], "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

export async function handleCronRequest(
  request: Request,
  overrides: Partial<CronDeps> = {},
): Promise<Response> {
  const correlationId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const deps: CronDeps = {
    secret: Object.prototype.hasOwnProperty.call(overrides, "secret")
      ? overrides.secret
      : getServerEnv().CRON_SECRET,
    runDue: overrides.runDue ?? ((options, cid) => runDueJobs(options, defaultDeps(cid))),
    log: overrides.log ?? child(correlationId, { integration: "shopify", route: "cron" }),
  };
  if (!deps.secret) {
    deps.log.warn({ status: 503 }, "integration cron called without CRON_SECRET configured");
    return respond(503, { error: "cron_not_configured" });
  }
  if (!bearerMatches(request.headers.get("authorization"), deps.secret)) {
    deps.log.warn({ status: 401 }, "integration cron refused a bad bearer");
    return respond(401, { error: "unauthorized" });
  }
  const summary = await deps.runDue({ limit: 25, budgetMs: 25_000 }, correlationId);
  return respond(200, summary);
}
