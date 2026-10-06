// @vitest-environment node
/**
 * GET /api/cron/integrations (D87): off without CRON_SECRET, refused
 * without the bearer, otherwise one bounded run of due jobs.
 */
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { bearerMatches, handleCronRequest } = await import("@/lib/integrations/shopify/cron");

const SUMMARY = { claimed: 2, done: 1, failed: 0, needsAttention: 1, deferred: 0 };
const log = pino({ level: "silent" });
const req = (authorization?: string) =>
  new Request("http://localhost:3000/api/cron/integrations", {
    headers: authorization ? { authorization } : {},
  });

describe("handleCronRequest", () => {
  it("503 when CRON_SECRET is not configured, without running anything", async () => {
    const runDue = vi.fn();
    const res = await handleCronRequest(req("Bearer x"), { secret: undefined, runDue, log });
    expect(res.status).toBe(503);
    expect(runDue).not.toHaveBeenCalled();
  });

  it("401 for a missing, malformed or wrong bearer", async () => {
    const runDue = vi.fn();
    for (const auth of [
      undefined,
      "secret-1",
      "Basic secret-1",
      "Bearer secret-2",
      "Bearer secret-1x",
      "Bearer ",
    ]) {
      const res = await handleCronRequest(req(auth), { secret: "secret-1", runDue, log });
      expect(res.status).toBe(401);
    }
    expect(runDue).not.toHaveBeenCalled();
  });

  it("200 with the run's summary for the right bearer", async () => {
    const runDue = vi.fn(async () => SUMMARY);
    const res = await handleCronRequest(req("Bearer secret-1"), {
      secret: "secret-1",
      runDue,
      log,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(SUMMARY);
    expect(runDue).toHaveBeenCalledExactlyOnceWith(
      { limit: 25, budgetMs: 25_000 },
      expect.any(String),
    );
  });

  it("compares the bearer exactly", () => {
    expect(bearerMatches("Bearer a-b", "a-b")).toBe(true);
    expect(bearerMatches("bearer a-b", "a-b")).toBe(false);
    expect(bearerMatches(null, "a-b")).toBe(false);
  });
});

describe("the route modules", () => {
  it("run on Node with a 60 s budget and export only their method", async () => {
    vi.doMock("@/lib/integrations/shopify/cron", () => ({
      handleCronRequest: async () => new Response("cron"),
    }));
    vi.doMock("@/lib/integrations/shopify/webhooks", () => ({
      handleShopifyWebhook: async () => new Response("webhook"),
    }));
    const cron = await import("@/app/api/cron/integrations/route");
    const webhooks = await import("@/app/api/shopify/webhooks/route");
    expect(cron.runtime).toBe("nodejs");
    expect(cron.maxDuration).toBe(60);
    expect(Object.keys(cron).sort()).toEqual(["GET", "maxDuration", "runtime"]);
    expect(await (await cron.GET(req())).text()).toBe("cron");
    expect(webhooks.runtime).toBe("nodejs");
    expect(webhooks.maxDuration).toBe(60);
    expect(Object.keys(webhooks).sort()).toEqual(["POST", "maxDuration", "runtime"]);
    expect(await (await webhooks.POST(req())).text()).toBe("webhook");
  });
});
