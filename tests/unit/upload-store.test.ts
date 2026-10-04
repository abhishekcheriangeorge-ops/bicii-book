import { describe, expect, it, vi } from "vitest";

import {
  UPLOAD_URL_MAX_AGE_MS,
  UploadStore,
  type UploadDeps,
} from "@/components/domain/upload-store";
import type { ToastOptions } from "@/components/ui/toast";

const BIKE = { entityType: "bike" as const, entityId: "b1000000-0000-4000-8000-000000000001" };
const OTHER = { entityType: "bike" as const, entityId: "b1000000-0000-4000-8000-000000000002" };

/** Lets every queued promise settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(overrides: Partial<UploadDeps> = {}) {
  let clock = 1_000_000;
  let n = 0;
  const deps: UploadDeps = {
    preparePhoto: vi.fn(async (file: File) => ({
      blob: file,
      mediaType: "image/jpeg" as const,
      width: 2048,
      height: 1536,
    })),
    prepareUploads: vi.fn(async () => {
      n++;
      return {
        ok: true as const,
        data: [
          {
            attachmentId: `att-${n}`,
            bucket: "media-internal",
            path: `bike/x/att-${n}.jpg`,
            token: `t${n}`,
            mediaType: "image/jpeg" as const,
          },
        ],
      };
    }),
    upload: vi.fn(async () => ({ error: null })),
    recordPhoto: vi.fn(async () => ({ ok: true as const, data: null })),
    createPreview: () => "blob:preview",
    revokePreview: vi.fn(),
    newKey: (() => {
      let k = 0;
      return () => `k${++k}`;
    })(),
    now: () => clock,
    ...overrides,
  };
  const store = new UploadStore(deps);
  const toasts: ToastOptions[] = [];
  const dismissed: string[] = [];
  const refresh = vi.fn();
  store.setUi({ toast: (t) => toasts.push(t), dismissToast: (k) => dismissed.push(k), refresh });
  return {
    store,
    deps,
    toasts,
    dismissed,
    refresh,
    later: (ms: number) => {
      clock += ms;
    },
  };
}

const file = (name = "image.jpg") => new File(["x"], name, { type: "image/jpeg" });

describe("photo upload queue", () => {
  it("saves a batch and refreshes the record's page once, when its queue drains", async () => {
    const { store, refresh, deps } = setup();
    const unwatch = store.watch(BIKE);
    store.add(BIKE, [file(), file(), file()]);
    await settle();
    expect(deps.recordPhoto).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.getItems().map((i) => i.status)).toEqual(["done", "done", "done"]);
    expect(store.getItems().map((i) => i.label)).toEqual([
      "New photo 1",
      "New photo 2",
      "New photo 3",
    ]);
    store.forgetShown(["att-1", "att-2", "att-3"]);
    expect(store.getItems()).toEqual([]);
    unwatch();
  });

  it("after leaving the record, says the photos saved instead of refreshing another page", async () => {
    const { store, refresh, toasts } = setup();
    store.add(BIKE, [file(), file()]);
    await settle();
    expect(refresh).not.toHaveBeenCalled();
    expect(toasts.at(-1)).toMatchObject({ title: "2 photos saved", tone: "success" });
  });

  it("when recording fails, Retry records again without uploading the photo again", async () => {
    const recordPhoto = vi
      .fn<UploadDeps["recordPhoto"]>()
      .mockResolvedValueOnce({ ok: false, error: "The database is unavailable." })
      .mockResolvedValue({ ok: true, data: null });
    const { store, deps, later } = setup({ recordPhoto });
    store.add(BIKE, [file()]);
    await settle();
    expect(store.getItems()[0]).toMatchObject({ status: "failed", retryable: true });
    // Even long after the upload URL expired: the object is there, no new one.
    later(UPLOAD_URL_MAX_AGE_MS + 60_000);
    store.retry(store.getItems()[0].key);
    await settle();
    expect(store.getItems()[0].status).toBe("done");
    expect(deps.upload).toHaveBeenCalledTimes(1);
    expect(deps.prepareUploads).toHaveBeenCalledTimes(1);
    expect(recordPhoto).toHaveBeenCalledTimes(2);
  });

  it("uploads again only when the server says the object is missing", async () => {
    const recordPhoto = vi
      .fn<UploadDeps["recordPhoto"]>()
      .mockResolvedValueOnce({
        ok: false,
        error: "The photo did not finish uploading. Try again.",
        code: "attachment_object_missing",
      })
      .mockResolvedValue({ ok: true, data: null });
    const { store, deps } = setup({ recordPhoto });
    store.add(BIKE, [file()]);
    await settle();
    store.retry(store.getItems()[0].key);
    await settle();
    expect(store.getItems()[0].status).toBe("done");
    expect(deps.upload).toHaveBeenCalledTimes(2);
  });

  it("keeps one toast per record for its failed photos, never pushed out, with Retry all", async () => {
    let failing = true;
    const upload = vi.fn(async () =>
      failing ? Promise.reject(new TypeError("Failed to fetch")) : { error: null },
    );
    const { store, toasts, dismissed } = setup({ upload });
    store.add(BIKE, [file(), file(), file()]);
    await settle();
    const failures = toasts.filter((t) => t.key === `photo-uploads:bike:${BIKE.entityId}`);
    expect(failures.map((t) => t.title)).toEqual([
      "1 photo not saved",
      "2 photos not saved",
      "3 photos not saved",
    ]);
    expect(failures.at(-1)).toMatchObject({
      tone: "error",
      description: "The upload did not go through. Check the connection.",
      action: { label: "Retry all" },
    });
    expect(store.unsaved()).toHaveLength(3);

    failing = false;
    failures.at(-1)!.action!.onAction();
    await settle();
    expect(store.unsaved()).toHaveLength(0);
    expect(dismissed).toContain(`photo-uploads:bike:${BIKE.entityId}`);
  });

  it("a file Storage refuses is not retried, and says what to do", async () => {
    const upload = vi.fn(async () => ({
      error: { message: "mime type application/octet-stream is not supported", statusCode: "415" },
    }));
    const { store, toasts } = setup({ upload });
    store.add(BIKE, [file("IMG_0001.HEIC")]);
    await settle();
    expect(store.getItems()[0]).toMatchObject({ status: "failed", retryable: false });
    expect(store.getItems()[0].error).toMatch(/JPEG/);
    expect(toasts.find((t) => t.action)).toBeUndefined();
  });

  it("an upload that already landed (409) is not an error", async () => {
    const upload = vi.fn(async () => ({
      error: { message: "The resource already exists", statusCode: "409" },
    }));
    const { store } = setup({ upload });
    store.add(BIKE, [file()]);
    await settle();
    expect(store.getItems()[0].status).toBe("done");
  });

  it("keeps each record's photos apart, and discarding a failure updates its toast", async () => {
    const upload = vi.fn(async () => Promise.reject(new TypeError("offline")));
    const { store, toasts, dismissed } = setup({ upload });
    store.add(BIKE, [file()]);
    store.add(OTHER, [file()]);
    await settle();
    const keys = new Set(toasts.map((t) => t.key));
    expect(keys).toEqual(
      new Set([`photo-uploads:bike:${BIKE.entityId}`, `photo-uploads:bike:${OTHER.entityId}`]),
    );
    const first = store.getItems().find((i) => i.target.entityId === BIKE.entityId)!;
    store.discard(first.key);
    expect(dismissed).toEqual([`photo-uploads:bike:${BIKE.entityId}`]);
    expect(store.unsaved()).toHaveLength(1);
  });
});
