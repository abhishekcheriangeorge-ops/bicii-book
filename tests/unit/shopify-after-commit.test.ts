// @vitest-environment node
/**
 * Actions that commit a Shopify change and then run its job (D86, D87):
 * the run is best effort. When it cannot happen (here: the service-role
 * deps cannot be built, as with SUPABASE_SERVICE_ROLE_KEY unset) the
 * action still reports the committed state and refreshes the page, and
 * the queue runs the job later.
 */
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

const log = pino({ level: "silent" });
// staffAction without auth: the handler with a fake context.
vi.mock("@/lib/actions", () => ({
  ActionError: class extends Error {},
  staffAction:
    (_schema: unknown, _options: unknown, handler: (input: unknown, ctx: unknown) => unknown) =>
    async (input: unknown) => {
      try {
        return {
          ok: true,
          data: await handler(input, {
            supabase: {},
            correlationId: "c-1",
            log,
            staff: { role: "admin", active: true, permissions: [] },
          }),
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
}));

const setPublishOnline = vi.fn();
const productSyncStatus = vi.fn();
const requestProductSync = vi.fn();
const retryJob = vi.fn();
vi.mock("@/lib/domain/shopify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/domain/shopify")>()),
  setPublishOnline: (...a: unknown[]) => setPublishOnline(...a),
  productSyncStatus: (...a: unknown[]) => productSyncStatus(...a),
  requestProductSync: (...a: unknown[]) => requestProductSync(...a),
  retryJob: (...a: unknown[]) => retryJob(...a),
}));

const defaultDeps = vi.fn(() => {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
});
vi.mock("@/lib/integrations/shopify/deps", () => ({ defaultDeps: () => defaultDeps() }));

const { setPublishOnlineAction, syncNowAction } = await import("@/app/(staff)/inventory/actions");
const { retryJobAction } = await import("@/app/(staff)/shopify/actions");
const { afterCommit } = await import("@/lib/integrations/shopify/after-commit");
const { SYNC_QUEUED_MESSAGE } = await import("@/lib/shopify");

const PRODUCT = "d1000000-0000-4000-8000-000000000004";
const JOB = "e3000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a committed change whose run cannot happen", () => {
  it("Publish online reports the committed state and refreshes", async () => {
    setPublishOnline.mockResolvedValue({ publishOnline: true, syncStatus: "pending", jobId: JOB });
    const result = await setPublishOnlineAction({ productId: PRODUCT, publish: true });
    expect(result).toEqual({
      ok: true,
      data: { publishOnline: true, syncStatus: "pending", message: SYNC_QUEUED_MESSAGE },
    });
    expect(setPublishOnline).toHaveBeenCalledOnce();
    expect(defaultDeps).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("Publish online still fails when the write itself fails", async () => {
    setPublishOnline.mockRejectedValue(new Error("refused"));
    const result = await setPublishOnlineAction({ productId: PRODUCT, publish: true });
    expect(result).toMatchObject({ ok: false });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("Sync now and Retry say the job is queued", async () => {
    requestProductSync.mockResolvedValue(JOB);
    expect(await syncNowAction({ productId: PRODUCT })).toEqual({
      ok: true,
      data: {
        title: "Sync queued",
        description: SYNC_QUEUED_MESSAGE,
        tone: "neutral",
        saleNumber: null,
      },
    });
    retryJob.mockResolvedValue({ id: JOB, kind: "shopify_event", productId: null, eventId: null });
    expect(await retryJobAction({ jobId: JOB })).toMatchObject({
      ok: true,
      data: { title: "Retry queued", tone: "neutral" },
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("afterCommit returns the run's value, or logs and returns the fallback", async () => {
    const error = vi.fn();
    expect(await afterCommit("x", { error }, async () => 1, 2)).toBe(1);
    expect(error).not.toHaveBeenCalled();
    expect(
      await afterCommit(
        "x",
        { error },
        async () => {
          throw new Error("down");
        },
        2,
      ),
    ).toBe(2);
    expect(error).toHaveBeenCalledOnce();
  });
});
