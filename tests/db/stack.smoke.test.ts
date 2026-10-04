/**
 * Live devstack smoke test (not a database-only test): signs in through the
 * gateway with supabase-js exactly as the app will, calls an RPC through
 * PostgREST, and round-trips an object through Storage.
 *
 * Needs `npm run db:reset && npm run devstack:start`. Skips, saying so, when
 * the gateway is not reachable, unless BICII_REQUIRE_STACK=1 (CI), where an
 * unreachable gateway fails the file instead.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { ANON_KEY, SERVICE_ROLE_KEY } from "../../scripts/devstack/config.mjs";
import type { Database } from "@/lib/database.types";

import { BIKE, SEED_PASSWORD, STAFF, STAFF_EMAIL } from "../fixtures/ids";
import { STACK_URL, stackReachable } from "./stack";

/** A real 2x2 JPEG (269 bytes), so Storage sees a genuine photo. */
const TINY_JPEG = Buffer.from(
  "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCOACqH/9k=",
  "base64",
);

const url = STACK_URL;
const reachable = await stackReachable("stack smoke");

const options = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!reachable)("devstack through the gateway", () => {
  it("signs in as the seeded admin and reads my_staff_profile via RPC", async () => {
    const supabase = createClient<Database>(url, ANON_KEY, options);
    const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
      email: STAFF_EMAIL.admin,
      password: SEED_PASSWORD,
    });
    expect(signInError).toBeNull();
    expect(session.user?.email).toBe(STAFF_EMAIL.admin);

    const { data, error } = await supabase.rpc("my_staff_profile").single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: STAFF.admin, role: "admin", active: true });
    expect(data?.permissions).toHaveLength(7);
    await supabase.auth.signOut();
  });

  it("denies anonymous reads of staff", async () => {
    const anon = createClient<Database>(url, ANON_KEY, options);
    const { data, error } = await anon.from("staff").select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("staff upload a photo to media-internal through a signed URL and record it; anonymous visitors cannot fetch it", async () => {
    const staff = createClient<Database>(url, ANON_KEY, options);
    const { error: signInError } = await staff.auth.signInWithPassword({
      email: STAFF_EMAIL.mechanic2,
      password: SEED_PASSWORD,
    });
    expect(signInError).toBeNull();

    // The app's flow (ADR-001 A7): the server mints a signed upload URL for
    // the exact path, the phone uploads to it, the server records the row.
    const id = randomUUID();
    const path = `bike/${BIKE.shopCervelo}/${id}.jpg`;
    const bucket = staff.storage.from("media-internal");
    const { data: signed, error: signError } = await bucket.createSignedUploadUrl(path);
    expect(signError).toBeNull();
    const { error: uploadError } = await bucket.uploadToSignedUrl(
      path,
      signed!.token,
      new Blob([TINY_JPEG], { type: "image/jpeg" }),
    );
    expect(uploadError).toBeNull();

    const { data: row, error: recordError } = await staff.rpc("record_attachment", {
      attachment_id: id,
      entity_type: "bike",
      entity_id: BIKE.shopCervelo,
      storage_bucket: "media-internal",
      storage_path: path,
      media_type: "image/jpeg",
    });
    expect(recordError).toBeNull();
    expect(row).toMatchObject({ id, byte_size: TINY_JPEG.length, created_by: STAFF.mechanic2 });

    const anon = createClient<Database>(url, ANON_KEY, options);
    const { data: anonFile, error: anonError } = await anon.storage
      .from("media-internal")
      .download(path);
    expect(anonFile).toBeNull();
    expect(anonError).not.toBeNull();
    const { data: staffFile, error: staffError } = await bucket.download(path);
    expect(staffError).toBeNull();
    expect(staffFile?.size).toBe(TINY_JPEG.length);

    // Recorded, so not even its uploader can remove it with a bare Storage call.
    const { data: refused } = await bucket.remove([path]);
    expect(refused).toEqual([]);
    const { data: stillThere } = await bucket.download(path);
    expect(stillThere?.size).toBe(TINY_JPEG.length);

    // Clean up the way the app deletes: RPC with a reason, then the object.
    const { data: deleted, error: deleteError } = await staff.rpc("delete_attachment", {
      attachment_id: id,
      reason: "Stack smoke test cleanup",
    });
    expect(deleteError).toBeNull();
    expect(deleted).toMatchObject([{ id, storage_path: path }]);
    // A replay through PostgREST is an empty list, not a row of nulls.
    const { data: replay, error: replayError } = await staff.rpc("delete_attachment", {
      attachment_id: id,
      reason: "Stack smoke test cleanup",
    });
    expect(replayError).toBeNull();
    expect(replay).toEqual([]);
    const { data: removed, error: removeError } = await bucket.remove([path]);
    expect(removeError).toBeNull();
    expect(removed).toHaveLength(1);
    await staff.auth.signOut();
  });

  it("uploads and downloads an object through Storage with the service key", async () => {
    const service = createClient<Database>(url, SERVICE_ROLE_KEY, options);
    const bucket = "devstack-smoke";
    const { error: bucketError } = await service.storage.createBucket(bucket, { public: false });
    if (bucketError && !/already exists/i.test(bucketError.message)) throw bucketError;

    const path = `smoke/${Date.now()}.txt`;
    const body = `bicii devstack ${new Date().toISOString()}`;
    const { error: uploadError } = await service.storage
      .from(bucket)
      .upload(path, new Blob([body], { type: "text/plain" }));
    expect(uploadError).toBeNull();

    const { data: file, error: downloadError } = await service.storage.from(bucket).download(path);
    expect(downloadError).toBeNull();
    expect(await file?.text()).toBe(body);

    const { error: removeError } = await service.storage.from(bucket).remove([path]);
    expect(removeError).toBeNull();
  });
});
