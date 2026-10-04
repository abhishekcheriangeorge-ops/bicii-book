/**
 * Photo buckets and their storage.objects policies (SPEC §8 "Storage
 * policies must enforce visibility"; DATA-MODEL §2):
 *
 *   media-internal  private: active staff read and write; anonymous
 *                   visitors, signed-in customers and inactive staff can
 *                   do nothing.
 *   media-public    public: anyone reads; only active staff write.
 *
 * Storage runs each request as the caller's API role with RLS on
 * storage.objects, which is exactly what these tests do. (The live
 * round trip through the Storage server is in stack.smoke.test.ts.)
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, BIKE, CUSTOMER, STAFF } from "../fixtures/ids";
import {
  attachmentPath,
  customerClaims,
  linkCustomerLogin,
  putStorageObject,
} from "./customer-fixtures";
import { actAs, connect, inTransaction, scalar, staffClaims } from "./harness";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const objectName = () => attachmentPath("bike", BIKE.tanTarmac, randomUUID());

/** Owner setup (an object already in `bucket`), then run `fn` as `who`. */
async function withObject<T>(
  bucket: string,
  who: "anon" | "customer" | "staff" | "inactive staff",
  fn: (tx: pg.Client, name: string) => Promise<T>,
): Promise<T> {
  return inTransaction(conn, async (tx) => {
    const name = objectName();
    await putStorageObject(tx, bucket, name);
    if (who === "anon") {
      await actAs(tx, { role: "anon" });
    } else if (who === "customer") {
      await actAs(tx, customerClaims(await linkCustomerLogin(tx, CUSTOMER.tan)));
    } else {
      if (who === "inactive staff") {
        await tx.query("update public.staff set active = false where id = $1", [STAFF.mechanic2]);
      }
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
    }
    return fn(tx, name);
  });
}

const visible = (tx: pg.Client, bucket: string, name: string) =>
  scalar<number>(
    tx,
    "select count(*)::int from storage.objects where bucket_id = $1 and name = $2",
    [bucket, name],
  );

const insertAs = (tx: pg.Client, bucket: string) =>
  tx.query("insert into storage.objects (bucket_id, name, metadata) values ($1, $2, '{}')", [
    bucket,
    objectName(),
  ]);

/** Storage's own guard blocks SQL deletes unless this is set (the Storage API sets it). */
const allowDelete = (tx: pg.Client) =>
  tx.query("select set_config('storage.allow_delete_query', 'true', true)");

describe("buckets", () => {
  it("media-internal is private and media-public public, both photo-only up to 20 MiB", async () => {
    const { rows } = await conn.query(
      `select id, public, file_size_limit::int as limit, allowed_mime_types
         from storage.buckets where id in ('media-internal', 'media-public') order by id`,
    );
    const photos = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    expect(rows).toEqual([
      { id: "media-internal", public: false, limit: 20971520, allowed_mime_types: photos },
      { id: "media-public", public: true, limit: 20971520, allowed_mime_types: photos },
    ]);
  });
});

describe("media-internal", () => {
  it("anonymous visitors cannot read or write it", async () => {
    await withObject("media-internal", "anon", async (tx, name) => {
      expect(await visible(tx, "media-internal", name)).toBe(0);
      await expect(insertAs(tx, "media-internal")).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("a signed-in customer cannot read or write it, not even their own bike's photos", async () => {
    await withObject("media-internal", "customer", async (tx, name) => {
      expect(await visible(tx, "media-internal", name)).toBe(0);
      expect(
        await scalar(
          tx,
          "select count(*)::int from storage.objects where bucket_id = 'media-internal'",
        ),
      ).toBe(0);
      await expect(insertAs(tx, "media-internal")).rejects.toMatchObject({ code: "42501" });
    });
    await withObject("media-internal", "customer", async (tx, name) => {
      const upd = await tx.query(
        "update storage.objects set metadata = '{}' where bucket_id = 'media-internal' and name = $1",
        [name],
      );
      expect(upd.rowCount).toBe(0);
      await allowDelete(tx);
      const del = await tx.query(
        "delete from storage.objects where bucket_id = 'media-internal' and name = $1",
        [name],
      );
      expect(del.rowCount).toBe(0);
    });
  });

  it("active staff upload, read, update and delete", async () => {
    await withObject("media-internal", "staff", async (tx, name) => {
      expect(await visible(tx, "media-internal", name)).toBe(1);
      await insertAs(tx, "media-internal");
      const upd = await tx.query(
        `update storage.objects set metadata = '{"mimetype": "image/jpeg"}'
          where bucket_id = 'media-internal' and name = $1`,
        [name],
      );
      expect(upd.rowCount).toBe(1);
      await allowDelete(tx);
      const del = await tx.query(
        "delete from storage.objects where bucket_id = 'media-internal' and name = $1",
        [name],
      );
      expect(del.rowCount).toBe(1);
    });
  });

  it("inactive staff cannot read or write it", async () => {
    await withObject("media-internal", "inactive staff", async (tx, name) => {
      expect(await visible(tx, "media-internal", name)).toBe(0);
      await expect(insertAs(tx, "media-internal")).rejects.toMatchObject({ code: "42501" });
    });
  });
});

describe("media-public", () => {
  it("anyone reads it: anonymous visitors and customers", async () => {
    await withObject("media-public", "anon", async (tx, name) => {
      expect(await visible(tx, "media-public", name)).toBe(1);
    });
    await withObject("media-public", "customer", async (tx, name) => {
      expect(await visible(tx, "media-public", name)).toBe(1);
    });
  });

  it("only active staff write it", async () => {
    await withObject("media-public", "anon", async (tx) => {
      await expect(insertAs(tx, "media-public")).rejects.toMatchObject({ code: "42501" });
    });
    await withObject("media-public", "customer", async (tx, name) => {
      await tx.query("savepoint s");
      await expect(insertAs(tx, "media-public")).rejects.toMatchObject({ code: "42501" });
      await tx.query("rollback to savepoint s");
      const upd = await tx.query(
        "update storage.objects set metadata = '{}' where bucket_id = 'media-public' and name = $1",
        [name],
      );
      expect(upd.rowCount).toBe(0);
      await allowDelete(tx);
      const del = await tx.query(
        "delete from storage.objects where bucket_id = 'media-public' and name = $1",
        [name],
      );
      expect(del.rowCount).toBe(0);
    });
    await withObject("media-public", "staff", async (tx, name) => {
      await insertAs(tx, "media-public");
      await allowDelete(tx);
      const del = await tx.query(
        "delete from storage.objects where bucket_id = 'media-public' and name = $1",
        [name],
      );
      expect(del.rowCount).toBe(1);
    });
  });

  it("anonymous visitors still see nothing of media-internal next to it", async () => {
    await inTransaction(conn, async (tx) => {
      await putStorageObject(tx, "media-internal", objectName());
      await putStorageObject(tx, "media-public", objectName());
      await actAs(tx, { role: "anon" });
      const { rows } = await tx.query("select distinct bucket_id from storage.objects");
      expect(rows).toEqual([{ bucket_id: "media-public" }]);
    });
  });
});

describe("other buckets", () => {
  it("these policies grant nothing outside media-internal and media-public", async () => {
    await inTransaction(conn, async (tx) => {
      await tx.query(
        "insert into storage.buckets (id, name, public) values ('elsewhere', 'elsewhere', false)",
      );
      await putStorageObject(tx, "elsewhere", "x/y.jpg");
      await actAs(tx, staffClaims(AUTH_USER.admin));
      expect(await visible(tx, "elsewhere", "x/y.jpg")).toBe(0);
      await expect(insertAs(tx, "elsewhere")).rejects.toMatchObject({ code: "42501" });
    });
  });
});
