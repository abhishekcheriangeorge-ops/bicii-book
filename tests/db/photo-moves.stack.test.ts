/**
 * Photo visibility moves and deletes through the real Storage server
 * (SPEC §8 "Storage policies must enforce visibility"; DATA-MODEL §2:
 * media-public holds only public photos; PLAN Phase 1 "attachment
 * visibility move"). Runs the app's own domain code
 * (src/lib/domain/attachments.ts) as mechanic2 against the devstack, and
 * checks the outcome the way a stranger would: by fetching the public URL
 * with no key at all.
 *
 *   * internal -> public: the copy lands in media-public (public URL 200),
 *     the private original is gone; public -> internal: the public URL
 *     stops working; delete: gone from both buckets; a replay is harmless;
 *   * a refused move (customer record, PLAN D13; job, D19; undecoded
 *     original) copies nothing into media-public: the app refuses before
 *     any Storage copy, the database is the backstop;
 *   * a move or delete whose Storage cleanup fails says so (cleanupPending)
 *     and leaves a public copy only until the change is repeated or the
 *     record is shown again (listPhotos sweeps it).
 *
 * Needs the devstack (`npm run db:reset && npm run devstack:start`); skips
 * otherwise, unless BICII_REQUIRE_STACK=1.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { devDatabaseUrl } from "../../scripts/devstack/config.mjs";
import { INTERNAL_BUCKET, PUBLIC_BUCKET, type PhotoTarget } from "@/lib/attachments";
import {
  deletePhoto,
  listPhotos,
  prepareUploads,
  recordPhoto,
  setPhotoVisibility,
  type CleanupReport,
} from "@/lib/domain/attachments";
import type { ServerSupabase } from "@/lib/supabase/server";

import { BIKE, CUSTOMER, WORK_ORDER } from "../fixtures/ids";
import { STACK_URL, anonClient, stackReachable, staffClient } from "./stack";

/** A real 2x2 JPEG (269 bytes). */
const TINY_JPEG = Buffer.from(
  "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCOACqH/9k=",
  "base64",
);

const reachable = await stackReachable("photo moves");

const BIKE_TARGET: PhotoTarget = { entityType: "bike", entityId: BIKE.shopCervelo };
const CUSTOMER_TARGET: PhotoTarget = { entityType: "customer", entityId: CUSTOMER.priya };
const JOB_TARGET: PhotoTarget = {
  entityType: "work_order",
  entityId: WORK_ORDER.chloeGiantInProgress,
};

let staff: ServerSupabase;
/** The devstack's own database, to age objects (as if minutes had passed). */
let db: pg.Client;
const problems: string[] = [];
const report: CleanupReport = (problem) => problems.push(problem);

beforeAll(async () => {
  if (!reachable) return;
  // supabase-js and @supabase/ssr build the same client class.
  staff = (await staffClient("mechanic2")) as unknown as ServerSupabase;
  db = new pg.Client({ connectionString: devDatabaseUrl() });
  await db.connect();
});

afterAll(async () => {
  await db?.end();
});

/** Uploads and records a photo the way the app does (signed upload URL, then record). */
async function addPhoto(
  target: PhotoTarget,
  size: { width: number | null; height: number | null } = { width: 2, height: 2 },
) {
  const [upload] = await prepareUploads(staff, target, ["image/jpeg"]);
  const { error } = await staff.storage
    .from(upload.bucket)
    .uploadToSignedUrl(upload.path, upload.token, new Blob([TINY_JPEG], { type: "image/jpeg" }));
  if (error) throw error;
  const photo = await recordPhoto(staff, {
    ...target,
    attachmentId: upload.attachmentId,
    path: upload.path,
    mediaType: "image/jpeg",
    byteSize: TINY_JPEG.length,
    ...size,
  });
  return { id: photo.id, path: upload.path };
}

const publicUrl = (path: string) =>
  `${STACK_URL}/storage/v1/object/public/${PUBLIC_BUCKET}/${path}`;

/** What a stranger with the link gets: no key, no session. */
const strangerStatus = (path: string) => fetch(publicUrl(path)).then((r) => r.status);

/** Which photo buckets hold an object at `path` (read as the database owner). */
async function bucketsHolding(path: string): Promise<string[]> {
  const { rows } = await db.query<{ bucket_id: string }>(
    "select bucket_id from storage.objects where name = $1 order by bucket_id",
    [path],
  );
  return rows.map((r) => r.bucket_id);
}

/** Makes Storage objects at `path` look `minutes` old. */
async function age(path: string, minutes: number) {
  await db.query(
    "update storage.objects set created_at = now() - make_interval(mins => $2) where name = $1",
    [path, minutes],
  );
}

/**
 * The same client, except that Storage `remove` fails in `buckets`: what a
 * Storage outage between the database change and the cleanup looks like.
 */
function withFailingRemove(client: ServerSupabase, buckets: string[]): ServerSupabase {
  const wrapStorage = (storage: ServerSupabase["storage"]) =>
    new Proxy(storage, {
      get(target, prop) {
        if (prop === "from") {
          return (bucket: string) => {
            const api = target.from(bucket);
            if (!buckets.includes(bucket)) return api;
            return new Proxy(api, {
              get(inner, key) {
                if (key === "remove") {
                  return async () => ({
                    data: null,
                    error: Object.assign(new Error("simulated outage"), { status: 503 }),
                  });
                }
                const value = Reflect.get(inner, key, inner);
                return typeof value === "function" ? value.bind(inner) : value;
              },
            });
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "storage") return wrapStorage(target.storage);
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe.skipIf(!reachable)("photo visibility moves through real Storage", () => {
  it("internal -> public -> internal -> deleted: a stranger can fetch it only while it is public", async () => {
    const { id, path } = await addPhoto(BIKE_TARGET);
    expect(await bucketsHolding(path)).toEqual([INTERNAL_BUCKET]);
    expect(await strangerStatus(path)).not.toBe(200);

    expect(await setPhotoVisibility(staff, id, "public", report)).toEqual({
      cleanupPending: false,
    });
    // Moved, not copied: the private original is gone.
    expect(await bucketsHolding(path)).toEqual([PUBLIC_BUCKET]);
    expect(await strangerStatus(path)).toBe(200);
    // A public URL is the only way in: strangers cannot list the bucket.
    const { data: listed } = await anonClient().storage.from(PUBLIC_BUCKET).list("bike");
    expect(listed ?? []).toEqual([]);
    const shown = await listPhotos(staff, BIKE_TARGET);
    expect(shown.find((p) => p.id === id)).toMatchObject({
      visibility: "public",
      url: publicUrl(path),
    });

    expect(await setPhotoVisibility(staff, id, "internal", report)).toEqual({
      cleanupPending: false,
    });
    expect(await bucketsHolding(path)).toEqual([INTERNAL_BUCKET]);
    expect(await strangerStatus(path)).not.toBe(200);

    expect(await deletePhoto(staff, id, "Stack test", report)).toEqual({ cleanupPending: false });
    expect(await bucketsHolding(path)).toEqual([]);
    // A replay (the answer was lost) is harmless.
    expect(await deletePhoto(staff, id, "Stack test", report)).toEqual({ cleanupPending: false });
    expect(problems).toEqual([]);
  });

  it("a refused move copies nothing into media-public", async () => {
    const onCustomer = await addPhoto(CUSTOMER_TARGET);
    await expect(setPhotoVisibility(staff, onCustomer.id, "public", report)).rejects.toThrow(
      /customer record/,
    );
    expect(await bucketsHolding(onCustomer.path)).toEqual([INTERNAL_BUCKET]);

    // D19: a job photo is never public either.
    const onJob = await addPhoto(JOB_TARGET);
    await expect(setPhotoVisibility(staff, onJob.id, "public", report)).rejects.toThrow(/on a job/);
    expect(await bucketsHolding(onJob.path)).toEqual([INTERNAL_BUCKET]);

    // An original the phone could not decode (no dimensions) may carry GPS.
    const original = await addPhoto(BIKE_TARGET, { width: null, height: null });
    await expect(setPhotoVisibility(staff, original.id, "public", report)).rejects.toThrow(
      /original file/,
    );
    expect(await bucketsHolding(original.path)).toEqual([INTERNAL_BUCKET]);

    for (const photo of [onCustomer, onJob, original]) {
      await deletePhoto(staff, photo.id, "Stack test", report);
    }
  });

  it("a public -> internal move whose public copy cannot be removed says so, and Finish removes it", async () => {
    const { id, path } = await addPhoto(BIKE_TARGET);
    await setPhotoVisibility(staff, id, "public", report);

    const outage = withFailingRemove(staff, [PUBLIC_BUCKET]);
    expect(await setPhotoVisibility(outage, id, "internal", report)).toEqual({
      cleanupPending: true,
    });
    expect(problems.splice(0)).toEqual(["original_not_removed"]);
    // The row is internal; the public copy is still out there for now.
    const shown = await listPhotos(staff, BIKE_TARGET);
    expect(shown.find((p) => p.id === id)?.visibility).toBe("internal");
    expect(await strangerStatus(path)).toBe(200);

    // "Finish": the same setting again.
    expect(await setPhotoVisibility(staff, id, "internal", report)).toEqual({
      cleanupPending: false,
    });
    expect(await bucketsHolding(path)).toEqual([INTERNAL_BUCKET]);
    expect(await strangerStatus(path)).not.toBe(200);

    await deletePhoto(staff, id, "Stack test", report);
  });

  it("a leftover nobody finishes is removed the next time the record is shown", async () => {
    const { id, path } = await addPhoto(BIKE_TARGET);
    await setPhotoVisibility(staff, id, "public", report);
    await setPhotoVisibility(withFailingRemove(staff, [PUBLIC_BUCKET]), id, "internal", report);
    problems.splice(0);
    expect(await strangerStatus(path)).toBe(200);

    // Later (the 10-minute grace for a move still running has passed):
    await age(path, 15);
    await listPhotos(staff, BIKE_TARGET);
    expect(await bucketsHolding(path)).toEqual([INTERNAL_BUCKET]);
    expect(await strangerStatus(path)).not.toBe(200);

    await deletePhoto(staff, id, "Stack test", report);
  });

  it("a deleted public photo whose file cannot be removed is swept, not left public", async () => {
    const { id, path } = await addPhoto(BIKE_TARGET);
    await setPhotoVisibility(staff, id, "public", report);

    const outage = withFailingRemove(staff, [INTERNAL_BUCKET, PUBLIC_BUCKET]);
    expect(await deletePhoto(outage, id, "Published by mistake", report)).toEqual({
      cleanupPending: true,
    });
    expect(problems.splice(0)).toEqual(["deleted_object_not_removed"]);
    expect((await listPhotos(staff, BIKE_TARGET)).map((p) => p.id)).not.toContain(id);
    expect(await strangerStatus(path)).toBe(200);

    await age(path, 15);
    await listPhotos(staff, BIKE_TARGET);
    expect(await bucketsHolding(path)).toEqual([]);
    expect(await strangerStatus(path)).not.toBe(200);
  });
});
