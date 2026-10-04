/**
 * Attachments and their history (SPEC §8, §22; DATA-MODEL §2, §15, §16):
 *
 *   * record_attachment (active staff) records an object that is really in
 *     Storage at {entity_type}/{entity_id}/{attachment_id}.{ext}, in the
 *     bucket of its visibility, for an entity that exists; it is
 *     replay-safe and never reuses an id;
 *   * set_attachment_visibility moves between media-internal and
 *     media-public only once the object is at the new location;
 *   * delete_attachment needs a reason and keeps who/why/what in
 *     attachment_events, which is append-only;
 *   * staff cannot insert, delete or move attachments directly; captions
 *     they may edit (recorded); a customer record's photo is never public,
 *     nor is an original stored without its dimensions (it may carry GPS);
 *   * attachment_stray_objects lists the objects under a record that no
 *     row points at and that are safe to remove now.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, BIKE, CUSTOMER, PRODUCT, STAFF, UNIT } from "../fixtures/ids";
import {
  attachmentPath,
  customerClaims,
  linkCustomerLogin,
  putStorageObject,
} from "./customer-fixtures";
import { actAs, asAnon, asStaff, connect, inTransaction, scalar, staffClaims } from "./harness";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

type RecordArgs = {
  id: string;
  entityType?: string;
  entityId?: string;
  bucket?: string;
  path?: string;
  mediaType?: string;
  byteSize?: number | null;
  width?: number | null;
  height?: number | null;
  caption?: string | null;
  visibility?: string;
};

function withDefaults(a: RecordArgs) {
  const entityType = a.entityType ?? "bike";
  const entityId = a.entityId ?? BIKE.tanTarmac;
  const visibility = a.visibility ?? "internal";
  return {
    id: a.id,
    entityType,
    entityId,
    visibility,
    bucket: a.bucket ?? (visibility === "public" ? "media-public" : "media-internal"),
    path: a.path ?? attachmentPath(entityType, entityId, a.id),
    mediaType: a.mediaType ?? "image/jpeg",
    byteSize: a.byteSize ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
    caption: a.caption ?? null,
  };
}

/** Calls record_attachment as whoever `tx` currently is. */
async function record(tx: pg.Client, args: RecordArgs) {
  const a = withDefaults(args);
  const { rows } = await tx.query(
    `select (r).* from (
       select public.record_attachment($1, $2::public.attachment_entity, $3, $4, $5, $6,
                                       $7, $8, $9, $10, $11::public.attachment_visibility) r
     ) s`,
    [
      a.id,
      a.entityType,
      a.entityId,
      a.bucket,
      a.path,
      a.mediaType,
      a.byteSize,
      a.width,
      a.height,
      a.caption,
      a.visibility,
    ],
  );
  return rows[0];
}

/** Puts the object where record() will look for it (as the owner). */
async function upload(
  tx: pg.Client,
  args: RecordArgs,
  meta?: { mimetype?: string; size?: number },
) {
  const a = withDefaults(args);
  await putStorageObject(tx, a.bucket, a.path, meta);
}

type EventRow = {
  attachment_id: string;
  entity_type: string;
  entity_id: string;
  event_type: string;
  actor_staff_id: string | null;
  payload: Record<string, unknown>;
  reason: string | null;
};

async function events(tx: pg.Client, attachmentId: string): Promise<EventRow[]> {
  const { rows } = await tx.query<EventRow>(
    `select attachment_id, entity_type::text, entity_id, event_type::text, actor_staff_id, payload, reason
       from public.attachment_events where attachment_id = $1 order by created_at`,
    [attachmentId],
  );
  return rows;
}

/** Owner setup, then act as mechanic2 (active staff, no permissions). */
async function asMechanic<T>(
  setup: (tx: pg.Client) => Promise<void>,
  fn: (tx: pg.Client) => Promise<T>,
): Promise<T> {
  return inTransaction(conn, async (tx) => {
    await setup(tx);
    await actAs(tx, staffClaims(AUTH_USER.mechanic2));
    return fn(tx);
  });
}

const setVisibility = (
  tx: pg.Client,
  id: string,
  visibility: string,
  bucket: string | null = null,
  path: string | null = null,
) =>
  tx
    .query(
      `select (v).* from (
         select public.set_attachment_visibility($1, $2::public.attachment_visibility, $3, $4) v
       ) s`,
      [id, visibility, bucket, path],
    )
    .then((r) => r.rows[0]);

/** The deleted row, or undefined on a replay (delete_attachment returns a set). */
const remove = (tx: pg.Client, id: string, reason: string | null) =>
  tx.query("select * from public.delete_attachment($1, $2)", [id, reason]).then((r) => r.rows[0]);

describe("record_attachment", () => {
  it("records an uploaded photo with its uploader, Storage's own size, and a created event", async () => {
    const id = randomUUID();
    await asMechanic(
      (tx) => upload(tx, { id }, { size: 51234 }),
      async (tx) => {
        const row = await record(tx, {
          id,
          byteSize: 1,
          width: 3024,
          height: 4032,
          caption: " Intake ",
        });
        expect(row).toMatchObject({
          id,
          entity_type: "bike",
          entity_id: BIKE.tanTarmac,
          storage_bucket: "media-internal",
          storage_path: `bike/${BIKE.tanTarmac}/${id}.jpg`,
          media_type: "image/jpeg",
          byte_size: 51234,
          width: 3024,
          height: 4032,
          caption: "Intake",
          visibility: "internal",
          created_by: STAFF.mechanic2,
        });
        expect(await events(tx, id)).toEqual([
          expect.objectContaining({
            event_type: "created",
            entity_type: "bike",
            entity_id: BIKE.tanTarmac,
            actor_staff_id: STAFF.mechanic2,
            reason: null,
          }),
        ]);
      },
    );
  });

  it("works for customer records too, and in media-public for public bike photos", async () => {
    const onCustomer = randomUUID();
    const publicBike = randomUUID();
    await asMechanic(
      async (tx) => {
        await upload(tx, {
          id: onCustomer,
          entityType: "customer",
          entityId: CUSTOMER.priya,
          visibility: "customer",
        });
        await upload(
          tx,
          {
            id: publicBike,
            entityId: BIKE.shopCervelo,
            visibility: "public",
            path: attachmentPath("bike", BIKE.shopCervelo, publicBike, "webp"),
          },
          { mimetype: "image/webp" },
        );
      },
      async (tx) => {
        expect(
          await record(tx, {
            id: onCustomer,
            entityType: "customer",
            entityId: CUSTOMER.priya,
            visibility: "customer",
          }),
        ).toMatchObject({ storage_bucket: "media-internal", visibility: "customer" });
        expect(
          await record(tx, {
            id: publicBike,
            entityId: BIKE.shopCervelo,
            visibility: "public",
            mediaType: "image/webp",
            path: attachmentPath("bike", BIKE.shopCervelo, publicBike, "webp"),
            width: 2048,
            height: 1536,
          }),
        ).toMatchObject({ storage_bucket: "media-public", visibility: "public" });
      },
    );
  });

  it("is replay-safe: the same call returns the same row and records one event", async () => {
    const id = randomUUID();
    await asMechanic(
      (tx) => upload(tx, { id }),
      async (tx) => {
        const first = await record(tx, { id });
        const again = await record(tx, { id });
        expect(again).toEqual(first);
        expect(await events(tx, id)).toHaveLength(1);
      },
    );
  });

  it("rejects a path that is not {entity_type}/{entity_id}/{attachment_id}.{ext}", async () => {
    const id = randomUUID();
    const bad = [
      `bike/${BIKE.priyaDomane}/${id}.jpg`, // another bike
      `bike/${BIKE.tanTarmac}/${randomUUID()}.jpg`, // another attachment id
      `customer/${BIKE.tanTarmac}/${id}.jpg`, // another entity type
      `bike/${BIKE.tanTarmac}/extra/${id}.jpg`, // nested
      `/bike/${BIKE.tanTarmac}/${id}.jpg`, // leading slash
      `bike/${BIKE.tanTarmac}/${id}`, // no extension
      `bike/${BIKE.tanTarmac}/${id}.png`, // extension of another type
      `bike/${BIKE.tanTarmac}/${id}.jpg.exe`, // trailing junk
    ];
    for (const path of bad) {
      await expect(
        asMechanic(
          (tx) => putStorageObject(tx, "media-internal", path),
          (tx) => record(tx, { id, path }),
        ),
      ).rejects.toMatchObject({ code: "P0001", message: "attachment_path_mismatch" });
    }
  });

  it("rejects an object that is not in Storage, or is in the other bucket", async () => {
    const id = randomUUID();
    await expect(
      asMechanic(
        async () => {},
        (tx) => record(tx, { id }),
      ),
    ).rejects.toMatchObject({
      code: "P0001",
      message: "attachment_object_missing",
    });
    await expect(
      asMechanic(
        (tx) => putStorageObject(tx, "media-public", attachmentPath("bike", BIKE.tanTarmac, id)),
        (tx) => record(tx, { id }),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "attachment_object_missing" });
  });

  it("rejects a bucket that does not match the visibility", async () => {
    const id = randomUUID();
    for (const [visibility, bucket] of [
      ["internal", "media-public"],
      ["customer", "media-public"],
      ["public", "media-internal"],
      ["internal", "devstack-smoke"],
    ]) {
      await expect(
        asMechanic(
          (tx) => upload(tx, { id, bucket: "media-internal" }),
          (tx) => record(tx, { id, visibility, bucket }),
        ),
      ).rejects.toMatchObject({ code: "P0001", message: "attachment_bucket_mismatch" });
    }
  });

  it("rejects unknown records and entity types this phase cannot attach to", async () => {
    const id = randomUUID();
    const nowhere = randomUUID();
    await expect(
      asMechanic(
        (tx) => upload(tx, { id, entityId: nowhere }),
        (tx) => record(tx, { id, entityId: nowhere }),
      ),
    ).rejects.toMatchObject({ code: "P0002" });
    // Products and units are attachable from Phase 4: an unknown one is P0002.
    for (const entityType of ["product", "inventory_unit"]) {
      await expect(
        asMechanic(
          (tx) => upload(tx, { id, entityType, entityId: nowhere }),
          (tx) => record(tx, { id, entityType, entityId: nowhere }),
        ),
      ).rejects.toMatchObject({ code: "P0002" });
    }
    // Consignment items arrive with Phase 6.
    await expect(
      asMechanic(
        (tx) => upload(tx, { id, entityType: "consignment_item", entityId: nowhere }),
        (tx) => record(tx, { id, entityType: "consignment_item", entityId: nowhere }),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "attachment_entity_unsupported" });
  });

  it("rejects files that are not photos, and photos whose stored type differs", async () => {
    const id = randomUUID();
    await expect(
      asMechanic(
        (tx) => upload(tx, { id }),
        (tx) => record(tx, { id, mediaType: "application/pdf" }),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "attachment_media_type_unsupported" });
    await expect(
      asMechanic(
        (tx) => upload(tx, { id }, { mimetype: "image/png" }),
        (tx) => record(tx, { id }),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "attachment_media_type_mismatch" });
  });

  it("never records an original without dimensions as public", async () => {
    const id = randomUUID();
    const args = { id, entityId: BIKE.shopCervelo, visibility: "public" };
    await expect(
      asMechanic(
        (tx) => upload(tx, args),
        (tx) => record(tx, { ...args, width: 2048 }),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "attachment_original_never_public" });
  });

  it("never records a customer record's photo as public", async () => {
    const id = randomUUID();
    const args = { id, entityType: "customer", entityId: CUSTOMER.tan, visibility: "public" };
    await expect(
      asMechanic(
        (tx) => upload(tx, args),
        (tx) => record(tx, args),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "attachment_customer_never_public" });
  });

  it("refuses an id already used for another file, or one that was deleted", async () => {
    const id = randomUUID();
    await asMechanic(
      async (tx) => {
        await upload(tx, { id });
        await upload(tx, { id, entityId: BIKE.priyaDomane });
      },
      async (tx) => {
        await record(tx, { id });
        await tx.query("savepoint s");
        await expect(record(tx, { id, entityId: BIKE.priyaDomane })).rejects.toMatchObject({
          code: "P0001",
          message: "attachment_conflict",
        });
        await tx.query("rollback to savepoint s");
        await remove(tx, id, "Blurry");
        await expect(record(tx, { id })).rejects.toMatchObject({
          code: "P0001",
          message: "attachment_deleted",
        });
      },
    );
  });

  it("is for active staff only", async () => {
    const id = randomUUID();
    await expect(
      inTransaction(conn, async (tx) => {
        await upload(tx, { id });
        const login = await linkCustomerLogin(tx, CUSTOMER.tan);
        await actAs(tx, customerClaims(login));
        return record(tx, { id });
      }),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(asAnon(conn, (tx) => record(tx, { id }))).rejects.toMatchObject({ code: "42501" });
    await expect(
      inTransaction(conn, async (tx) => {
        await upload(tx, { id });
        await tx.query("update public.staff set active = false where id = $1", [STAFF.mechanic2]);
        await actAs(tx, staffClaims(AUTH_USER.mechanic2));
        return record(tx, { id });
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("photos on stock (D13 extended, D19's pattern)", () => {
  it("accepts internal and public photos of a product and of a unit", async () => {
    for (const [entityType, entityId] of [
      ["product", PRODUCT.brakePads],
      ["inventory_unit", UNIT.colnago],
    ] as const) {
      for (const visibility of ["internal", "public"]) {
        const id = randomUUID();
        const args = { id, entityType, entityId, visibility, width: 1600, height: 1200 };
        await asMechanic(
          (tx) => upload(tx, args),
          async (tx) => {
            expect(await record(tx, args)).toMatchObject({ entity_type: entityType, visibility });
          },
        );
      }
    }
  });

  it("never records or moves a stock photo to customer visibility", async () => {
    for (const [entityType, entityId] of [
      ["product", PRODUCT.brakePads],
      ["inventory_unit", UNIT.colnago],
    ] as const) {
      const id = randomUUID();
      await expect(
        asMechanic(
          (tx) => upload(tx, { id, entityType, entityId, visibility: "customer" }),
          (tx) => record(tx, { id, entityType, entityId, visibility: "customer" }),
        ),
      ).rejects.toMatchObject({ code: "P0001", message: "attachment_stock_never_customer" });
      await expect(
        asMechanic(
          (tx) => upload(tx, { id, entityType, entityId }),
          async (tx) => {
            await record(tx, { id, entityType, entityId });
            return setVisibility(tx, id, "customer");
          },
        ),
      ).rejects.toMatchObject({ code: "P0001", message: "attachment_stock_never_customer" });
    }
  });

  it("the CHECK attachments_stock_never_customer backs it up for a writer past the trigger", async () => {
    const id = randomUUID();
    await expect(
      inTransaction(conn, async (tx) => {
        // Triggers off (the owner, replica mode): only the table's CHECKs run.
        await tx.query("set local session_replication_role = replica");
        await tx.query(
          `insert into public.attachments
             (id, entity_type, entity_id, storage_bucket, storage_path, media_type, visibility)
           values ($1, 'product', $2, 'media-internal', $3, 'image/jpeg', 'customer')`,
          [id, PRODUCT.brakePads, attachmentPath("product", PRODUCT.brakePads, id)],
        );
      }),
    ).rejects.toMatchObject({ code: "23514", constraint: "attachments_stock_never_customer" });
  });
});

describe("set_attachment_visibility", () => {
  /** Owner: an internal photo of Tan's Tarmac (re-encoded, so with dimensions), recorded by mechanic1. */
  async function internalPhoto(
    tx: pg.Client,
    id: string,
    size: { width: number | null; height: number | null } = { width: 2048, height: 1536 },
  ): Promise<void> {
    await upload(tx, { id });
    await actAs(tx, staffClaims(AUTH_USER.mechanic1));
    await record(tx, { id, ...size });
    await tx.query("reset role");
  }

  it("internal -> customer stays in media-internal and records the change", async () => {
    const id = randomUUID();
    await asMechanic(
      (tx) => internalPhoto(tx, id),
      async (tx) => {
        const row = await setVisibility(tx, id, "customer");
        expect(row).toMatchObject({ visibility: "customer", storage_bucket: "media-internal" });
        const history = await events(tx, id);
        expect(history.map((e) => e.event_type)).toEqual(["created", "visibility_changed"]);
        expect(history[1]).toMatchObject({
          actor_staff_id: STAFF.mechanic2,
          payload: {
            visibility: { from: "internal", to: "customer" },
            storage_bucket: { from: "media-internal", to: "media-internal" },
          },
        });
      },
    );
  });

  it("to public only once the object has been copied to media-public, and back again", async () => {
    const id = randomUUID();
    const path = attachmentPath("bike", BIKE.tanTarmac, id);
    await asMechanic(
      (tx) => internalPhoto(tx, id),
      async (tx) => {
        await tx.query("savepoint s");
        await expect(setVisibility(tx, id, "public", "media-public", path)).rejects.toMatchObject({
          code: "P0001",
          message: "attachment_object_missing",
        });
        await tx.query("rollback to savepoint s");

        // The server copies the object (staff may write media-public), then calls the RPC.
        await putStorageObject(tx, "media-public", path);
        expect(await setVisibility(tx, id, "public", "media-public", path)).toMatchObject({
          visibility: "public",
          storage_bucket: "media-public",
          storage_path: path,
        });
        // Back to internal: media-internal still holds it in this test.
        expect(await setVisibility(tx, id, "internal")).toMatchObject({
          visibility: "internal",
          storage_bucket: "media-internal",
        });
        expect((await events(tx, id)).map((e) => e.event_type)).toEqual([
          "created",
          "visibility_changed",
          "visibility_changed",
        ]);
      },
    );
  });

  it("rejects a bucket or path that does not fit the attachment", async () => {
    const id = randomUUID();
    await expect(
      asMechanic(
        (tx) => internalPhoto(tx, id),
        (tx) => setVisibility(tx, id, "public", "media-internal"),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "attachment_bucket_mismatch" });
    await expect(
      asMechanic(
        (tx) => internalPhoto(tx, id),
        (tx) =>
          setVisibility(
            tx,
            id,
            "public",
            "media-public",
            attachmentPath("bike", BIKE.priyaDomane, id),
          ),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "attachment_path_mismatch" });
  });

  it("replaying the current visibility changes nothing and records nothing", async () => {
    const id = randomUUID();
    await asMechanic(
      (tx) => internalPhoto(tx, id),
      async (tx) => {
        expect(await setVisibility(tx, id, "internal")).toMatchObject({ visibility: "internal" });
        expect(await events(tx, id)).toHaveLength(1);
      },
    );
  });

  it("never makes a customer record's photo public", async () => {
    const id = randomUUID();
    const args = { id, entityType: "customer", entityId: CUSTOMER.tan };
    await expect(
      asMechanic(
        async (tx) => {
          await upload(tx, args);
          await putStorageObject(tx, "media-public", attachmentPath("customer", CUSTOMER.tan, id));
          await actAs(tx, staffClaims(AUTH_USER.mechanic1));
          await record(tx, args);
          await tx.query("reset role");
        },
        (tx) => setVisibility(tx, id, "public"),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "attachment_customer_never_public" });
  });

  it("never makes public an original stored without its dimensions (it may carry GPS)", async () => {
    const id = randomUUID();
    const path = attachmentPath("bike", BIKE.tanTarmac, id);
    await expect(
      asMechanic(
        async (tx) => {
          await internalPhoto(tx, id, { width: null, height: null });
          await putStorageObject(tx, "media-public", path);
        },
        (tx) => setVisibility(tx, id, "public", "media-public", path),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "attachment_original_never_public" });
    // Customer is fine: it stays private.
    await asMechanic(
      (tx) => internalPhoto(tx, id, { width: null, height: null }),
      async (tx) => {
        expect(await setVisibility(tx, id, "customer")).toMatchObject({ visibility: "customer" });
      },
    );
  });

  it("raises P0002 for an unknown attachment", async () => {
    await expect(
      asStaff(conn, STAFF.mechanic2, (tx) => setVisibility(tx, randomUUID(), "customer")),
    ).rejects.toMatchObject({ code: "P0002" });
  });
});

describe("delete_attachment", () => {
  async function photo(tx: pg.Client, id: string): Promise<void> {
    await upload(tx, { id });
    await actAs(tx, staffClaims(AUTH_USER.mechanic1));
    await record(tx, { id, caption: "Before" });
    await tx.query("reset role");
  }

  it("needs a reason, and without one nothing is deleted", async () => {
    const id = randomUUID();
    await asMechanic(
      (tx) => photo(tx, id),
      async (tx) => {
        for (const reason of [null, "", "  "]) {
          await tx.query("savepoint s");
          await expect(remove(tx, id, reason)).rejects.toMatchObject({
            code: "P0001",
            message: "reason_required",
          });
          await tx.query("rollback to savepoint s");
        }
        expect(
          await scalar(tx, "select count(*)::int from public.attachments where id = $1", [id]),
        ).toBe(1);
      },
    );
  });

  it("deletes the row and keeps who, why and what in attachment_events", async () => {
    const id = randomUUID();
    await asMechanic(
      (tx) => photo(tx, id),
      async (tx) => {
        const removed = await remove(tx, id, " Wrong bike ");
        // The server deletes this object next.
        expect(removed).toMatchObject({
          id,
          storage_bucket: "media-internal",
          storage_path: attachmentPath("bike", BIKE.tanTarmac, id),
        });
        expect(
          await scalar(tx, "select count(*)::int from public.attachments where id = $1", [id]),
        ).toBe(0);
        const history = await events(tx, id);
        expect(history.map((e) => e.event_type)).toEqual(["created", "deleted"]);
        expect(history[1]).toMatchObject({
          actor_staff_id: STAFF.mechanic2,
          reason: "Wrong bike",
          entity_type: "bike",
          entity_id: BIKE.tanTarmac,
          payload: expect.objectContaining({
            id,
            caption: "Before",
            created_by: STAFF.mechanic1,
            storage_path: attachmentPath("bike", BIKE.tanTarmac, id),
          }),
        });
      },
    );
  });

  it("is replay-safe: deleting again returns no row and records nothing", async () => {
    const id = randomUUID();
    await asMechanic(
      (tx) => photo(tx, id),
      async (tx) => {
        expect(await remove(tx, id, "Duplicate")).toMatchObject({ id });
        // A set: a replay is no row at all (PostgREST answers []), not a row of nulls.
        expect(await remove(tx, id, "Duplicate")).toBeUndefined();
        expect(await events(tx, id)).toHaveLength(2);
      },
    );
  });

  it("raises P0002 for an id that never existed", async () => {
    await expect(
      asStaff(conn, STAFF.mechanic2, (tx) => remove(tx, randomUUID(), "Gone")),
    ).rejects.toMatchObject({ code: "P0002" });
  });
});

describe("direct table access", () => {
  async function photo(tx: pg.Client, id: string): Promise<void> {
    await upload(tx, { id });
    await actAs(tx, staffClaims(AUTH_USER.mechanic1));
    await record(tx, { id });
    await tx.query("reset role");
  }

  it("staff cannot insert, delete, move or re-visibility attachments directly", async () => {
    const id = randomUUID();
    for (const sql of [
      `insert into public.attachments (entity_type, entity_id, storage_bucket, storage_path, media_type)
       values ('bike', '${BIKE.tanTarmac}', 'media-internal', 'bike/${BIKE.tanTarmac}/${id}.jpg', 'image/jpeg')`,
      `delete from public.attachments where id = '${id}'`,
      `update public.attachments set visibility = 'public' where id = '${id}'`,
      `update public.attachments set storage_path = 'x' where id = '${id}'`,
      `update public.attachments set entity_id = '${BIKE.priyaDomane}' where id = '${id}'`,
      `insert into public.attachment_events (attachment_id, entity_type, entity_id, event_type)
       values ('${id}', 'bike', '${BIKE.tanTarmac}', 'created')`,
    ]) {
      await expect(
        asMechanic(
          (tx) => photo(tx, id),
          (tx) => tx.query(sql),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("staff may edit a caption, and the change is recorded", async () => {
    const id = randomUUID();
    await asMechanic(
      (tx) => photo(tx, id),
      async (tx) => {
        await tx.query(
          "update public.attachments set caption = ' Scratch on top tube ' where id = $1",
          [id],
        );
        expect(await scalar(tx, "select caption from public.attachments where id = $1", [id])).toBe(
          "Scratch on top tube",
        );
        const history = await events(tx, id);
        expect(history[1]).toMatchObject({
          event_type: "caption_changed",
          actor_staff_id: STAFF.mechanic2,
          payload: { caption: { from: null, to: "Scratch on top tube" } },
        });
      },
    );
  });

  it("every writer, the owner included, needs a reason to delete and cannot re-home an attachment", async () => {
    const id = randomUUID();
    await expect(
      inTransaction(conn, async (tx) => {
        await photo(tx, id);
        await tx.query("delete from public.attachments where id = $1", [id]);
      }),
    ).rejects.toMatchObject({ code: "P0001", message: "reason_required" });
    await expect(
      inTransaction(conn, async (tx) => {
        await photo(tx, id);
        await tx.query("update public.attachments set entity_id = $1 where id = $2", [
          BIKE.priyaDomane,
          id,
        ]);
      }),
    ).rejects.toMatchObject({ code: "P0001", message: "attachment_immutable" });
  });

  it("the table itself rejects a path or bucket that does not fit the row", async () => {
    const id = randomUUID();
    const insert = (bucket: string, path: string, visibility = "internal") =>
      inTransaction(conn, (tx) =>
        tx.query(
          `insert into public.attachments
             (id, entity_type, entity_id, storage_bucket, storage_path, media_type, visibility)
           values ($1, 'bike', $2, $3, $4, 'image/jpeg', $5)`,
          [id, BIKE.tanTarmac, bucket, path, visibility],
        ),
      );
    await expect(
      insert("media-internal", attachmentPath("bike", BIKE.priyaDomane, id)),
    ).rejects.toMatchObject({ code: "23514", constraint: "attachments_path_shape" });
    await expect(
      insert("media-internal", attachmentPath("bike", BIKE.tanTarmac, id, "png")),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "attachments_extension_matches_media_type",
    });
    await expect(
      insert("media-public", attachmentPath("bike", BIKE.tanTarmac, id)),
    ).rejects.toMatchObject({ code: "23514", constraint: "attachments_bucket_matches_visibility" });
  });

  it("attachment_events is append-only for every writer", async () => {
    const id = randomUUID();
    for (const sql of [
      `update public.attachment_events set reason = 'Rewritten' where attachment_id = '${id}'`,
      `delete from public.attachment_events where attachment_id = '${id}'`,
    ]) {
      await expect(
        inTransaction(conn, async (tx) => {
          await photo(tx, id);
          await tx.query(sql);
        }),
      ).rejects.toMatchObject({ code: "P0001", message: "attachment_history_append_only" });
    }
  });
});

describe("attachment_stray_objects", () => {
  /** An object under Tan's Tarmac, created `ageMinutes` ago (as the owner). */
  async function object(tx: pg.Client, bucket: string, name: string, ageMinutes: number) {
    await putStorageObject(tx, bucket, name);
    await tx.query(
      `update storage.objects set created_at = now() - make_interval(mins => $3)
        where bucket_id = $1 and name = $2`,
      [bucket, name, ageMinutes],
    );
  }
  const strays = (tx: pg.Client, entityType = "bike", entityId: string = BIKE.tanTarmac) =>
    tx
      .query<{ bucket: string; path: string }>(
        "select bucket, path from public.attachment_stray_objects($1::public.attachment_entity, $2)",
        [entityType, entityId],
      )
      .then((r) => r.rows);

  it("lists what no row points at, once it is safe to remove, and nothing a row needs", async () => {
    await inTransaction(conn, async (tx) => {
      const current = randomUUID(); // a public photo, its private original left behind
      const deleted = randomUUID(); // deleted, its file still there
      const leftover = randomUUID(); // made internal, its public copy still there
      const fresh = randomUUID(); // a copy made a moment ago for a move still running
      const unrecorded = randomUUID(); // an upload not recorded yet
      const abandoned = randomUUID(); // an upload never recorded, two days old
      const p = (id: string) => attachmentPath("bike", BIKE.tanTarmac, id);

      for (const id of [current, deleted, leftover]) {
        await object(tx, "media-internal", p(id), 60);
        await actAs(tx, staffClaims(AUTH_USER.mechanic1));
        await record(tx, { id, width: 640, height: 480 });
        await tx.query("reset role");
      }
      await object(tx, "media-public", p(current), 60);
      await object(tx, "media-public", p(leftover), 60);
      await object(tx, "media-public", p(fresh), 1);
      await object(tx, "media-internal", p(unrecorded), 60);
      await object(tx, "media-internal", p(abandoned), 2 * 24 * 60);
      // Another record's stray is not this record's business.
      await object(tx, "media-public", attachmentPath("bike", BIKE.priyaDomane, randomUUID()), 60);

      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
      await setVisibility(tx, current, "public", "media-public", p(current));
      await remove(tx, deleted, "Blurred");

      expect(await strays(tx)).toEqual(
        [
          { bucket: "media-internal", path: p(abandoned) },
          { bucket: "media-internal", path: p(current) },
          { bucket: "media-internal", path: p(deleted) },
          { bucket: "media-public", path: p(leftover) },
        ].sort((a, b) => (a.bucket + a.path).localeCompare(b.bucket + b.path)),
      );
    });
  });

  it("is for active staff only", async () => {
    await expect(asAnon(conn, (tx) => strays(tx))).rejects.toMatchObject({ code: "42501" });
    await expect(
      inTransaction(conn, async (tx) => {
        await actAs(tx, customerClaims(await linkCustomerLogin(tx, CUSTOMER.tan)));
        return strays(tx);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
