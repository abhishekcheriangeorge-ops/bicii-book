/**
 * The customer access boundary (SPEC §4.2, §23 "Customers cannot read
 * internal notes ..."; DATA-MODEL §15 "Customer access"; PLAN D8, D12):
 *
 *   * private.current_customer_id() is the caller's non-archived customers
 *     row: null for anonymous callers, for staff without a customers row,
 *     and for archived customers;
 *   * a signed-in customer reads no base table at all (zero rows) and
 *     writes none;
 *   * through my_customer_profile / update_my_profile / my_bikes /
 *     my_bike_attachments they see and edit only their own rows, never
 *     internal_notes, never internal attachments;
 *   * customer A cannot reach customer B through any RPC;
 *   * staff RPCs refuse customers; anonymous callers can call nothing.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, BIKE, CUSTOMER, STAFF } from "../fixtures/ids";
import {
  attachmentPath,
  createAuthUser,
  customerClaims,
  linkCustomerLogin,
} from "./customer-fixtures";
import {
  actAs,
  asAnon,
  asStaff,
  connect,
  inTransaction,
  scalar,
  staffClaims,
  withClaims,
} from "./harness";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const PROFILE_COLUMNS = [
  "created_at",
  "display_name",
  "email",
  "first_name",
  "id",
  "last_name",
  "phone",
].sort();

const BIKE_COLUMNS = [
  "brand",
  "colour",
  "created_at",
  "description",
  "frame_size",
  "id",
  "model",
  "serial_number",
  "short_id",
  "variant",
].sort();

const ATTACHMENT_COLUMNS = [
  "caption",
  "created_at",
  "height",
  "id",
  "media_type",
  "storage_bucket",
  "storage_path",
  "visibility",
  "width",
].sort();

/**
 * Runs `fn` as a signed-in customer: links a new login to the seeded
 * customer (as the owner), runs `setup` as the owner, then switches identity.
 */
async function asCustomer<T>(
  customerId: string,
  fn: (tx: pg.Client) => Promise<T>,
  setup: (tx: pg.Client) => Promise<void> = async () => {},
): Promise<T> {
  return inTransaction(conn, async (tx) => {
    const login = await linkCustomerLogin(tx, customerId);
    await setup(tx);
    await actAs(tx, customerClaims(login));
    return fn(tx);
  });
}

/** Inserts attachments directly as the owner (no Storage object needed for a table row). */
async function addBikePhotos(
  tx: pg.Client,
  bikeId: string,
  visibilities: ("internal" | "customer" | "public")[],
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const visibility of visibilities) {
    const id = randomUUID();
    await tx.query(
      `insert into public.attachments
         (id, entity_type, entity_id, storage_bucket, storage_path, media_type, visibility, caption)
       values ($1, 'bike', $2, $3, $4, 'image/jpeg', $5, $6)`,
      [
        id,
        bikeId,
        visibility === "public" ? "media-public" : "media-internal",
        attachmentPath("bike", bikeId, id),
        visibility,
        `${visibility} photo`,
      ],
    );
    ids[visibility] = id;
  }
  return ids;
}

const rowsOf = (tx: pg.Client, sql: string, params: unknown[] = []) =>
  tx.query(sql, params).then((r) => r.rows);

describe("private.current_customer_id()", () => {
  it("is null for anonymous callers, who cannot even call it", async () => {
    expect(
      await withClaims(conn, null, (tx) => scalar(tx, "select private.current_customer_id()")),
    ).toBeNull();
    await expect(
      asAnon(conn, (tx) => tx.query("select private.current_customer_id()")),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("is null for staff without a customers row", async () => {
    expect(
      await withClaims(conn, staffClaims(AUTH_USER.mechanic1), (tx) =>
        scalar(tx, "select private.current_customer_id()"),
      ),
    ).toBeNull();
    expect(
      await asStaff(conn, STAFF.admin, (tx) => scalar(tx, "select private.current_customer_id()")),
    ).toBeNull();
  });

  it("is null for a signed-in login without a customers row", async () => {
    await inTransaction(conn, async (tx) => {
      const login = await createAuthUser(tx, "stranger@example.com");
      await actAs(tx, customerClaims(login));
      expect(await scalar(tx, "select private.current_customer_id()")).toBeNull();
    });
  });

  it("is the caller's own customers row, and null once it is archived", async () => {
    await asCustomer(CUSTOMER.tan, async (tx) => {
      expect(await scalar(tx, "select private.current_customer_id()")).toBe(CUSTOMER.tan);
    });
    await asCustomer(
      CUSTOMER.tan,
      async (tx) => {
        expect(await scalar(tx, "select private.current_customer_id()")).toBeNull();
        expect(await rowsOf(tx, "select * from public.my_customer_profile()")).toEqual([]);
        expect(await rowsOf(tx, "select * from public.my_bikes()")).toEqual([]);
      },
      (tx) =>
        tx
          .query("update public.customers set archived_at = now() where id = $1", [CUSTOMER.tan])
          .then(() => {}),
    );
  });
});

describe("a signed-in customer and the base tables", () => {
  it("reads nothing at all, not even their own rows", async () => {
    await asCustomer(
      CUSTOMER.tan,
      async (tx) => {
        for (const table of [
          "customers",
          "bikes",
          "bike_ownership_events",
          "attachments",
          "attachment_events",
        ]) {
          expect(await scalar(tx, `select count(*)::int from public.${table}`)).toBe(0);
        }
        expect(
          await rowsOf(tx, "select internal_notes from public.customers where id = $1", [
            CUSTOMER.tan,
          ]),
        ).toEqual([]);
      },
      async (tx) => {
        await addBikePhotos(tx, BIKE.tanTarmac, ["internal", "customer"]);
      },
    );
  });

  it("writes nothing: inserts are refused and updates match no row", async () => {
    await asCustomer(CUSTOMER.tan, async (tx) => {
      for (const sql of [
        "insert into public.customers (first_name) values ('Me again')",
        "insert into public.bikes (brand, model) values ('My', 'Bike')",
      ]) {
        await expect(tx.query("savepoint s").then(() => tx.query(sql))).rejects.toMatchObject({
          code: "42501",
        });
        await tx.query("rollback to savepoint s");
      }
      const updated = await tx.query(
        "update public.customers set internal_notes = 'VIP', first_name = 'Hacked' where id = $1",
        [CUSTOMER.tan],
      );
      expect(updated.rowCount).toBe(0);
      const bikes = await tx.query("update public.bikes set internal_notes = 'x' where id = $1", [
        BIKE.tanTarmac,
      ]);
      expect(bikes.rowCount).toBe(0);
    });
    expect(
      await scalar(conn, "select first_name from public.customers where id = $1", [CUSTOMER.tan]),
    ).toBe("Wei Ming");
  });
});

describe("my_customer_profile / update_my_profile", () => {
  it("return only the caller's own profile, without internal notes", async () => {
    const rows = await asCustomer(CUSTOMER.tan, (tx) =>
      rowsOf(tx, "select * from public.my_customer_profile()"),
    );
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(PROFILE_COLUMNS);
    expect(rows[0]).toMatchObject({
      id: CUSTOMER.tan,
      first_name: "Wei Ming",
      last_name: "Tan",
      display_name: "Tan Wei Ming",
      email: "weiming.tan@example.com",
      phone: "+65 9123 4567",
    });
    expect(JSON.stringify(rows)).not.toMatch(/WhatsApp/);
  });

  it("change only the caller's own name and phone: null keeps, empty clears", async () => {
    await inTransaction(conn, async (tx) => {
      const login = await linkCustomerLogin(tx, CUSTOMER.tan);
      const priyaBefore = await rowsOf(tx, "select * from public.customers where id = $1", [
        CUSTOMER.priya,
      ]);
      await actAs(tx, customerClaims(login));
      const updated = await rowsOf(
        tx,
        "select (p).* from (select public.update_my_profile('Wei', null, '', ' +65 9000 0000 ') p) s",
      );
      expect(updated).toEqual([
        expect.objectContaining({
          id: CUSTOMER.tan,
          first_name: "Wei",
          last_name: "Tan",
          display_name: null,
          phone: "+65 9000 0000",
        }),
      ]);
      expect(Object.keys(updated[0]).sort()).toEqual(PROFILE_COLUMNS);

      await tx.query("reset role");
      const tan = await rowsOf(
        tx,
        "select internal_notes, email::text from public.customers where id = $1",
        [CUSTOMER.tan],
      );
      expect(tan[0]).toEqual({
        internal_notes: "Prefers WhatsApp. Rides with the Sunday Coast Road group.",
        email: "weiming.tan@example.com",
      });
      expect(
        await rowsOf(tx, "select * from public.customers where id = $1", [CUSTOMER.priya]),
      ).toEqual(priyaBefore);
    });
  });
});

describe("my_bikes / my_bike_attachments", () => {
  it("list only the caller's own bikes, without internal notes", async () => {
    const rows = await asCustomer(CUSTOMER.tan, (tx) =>
      rowsOf(tx, "select * from public.my_bikes()"),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([BIKE.tanTarmac, BIKE.tanBrompton].sort());
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(BIKE_COLUMNS);
    expect(JSON.stringify(rows)).not.toMatch(/hanger replaced/);
  });

  it("leave out archived bikes and bikes the caller no longer owns", async () => {
    // Daniel sold his Bianchi to Nurul in the seed.
    expect(
      await asCustomer(CUSTOMER.daniel, (tx) => rowsOf(tx, "select id from public.my_bikes()")),
    ).toEqual([{ id: BIKE.danielCannondale }]);
    expect(
      await asCustomer(CUSTOMER.nurul, (tx) => rowsOf(tx, "select id from public.my_bikes()")),
    ).toEqual([{ id: BIKE.nurulBianchi }]);
    expect(
      await asCustomer(
        CUSTOMER.tan,
        (tx) => rowsOf(tx, "select id from public.my_bikes()"),
        (tx) =>
          tx
            .query("update public.bikes set archived_at = now() where id = $1", [BIKE.tanBrompton])
            .then(() => {}),
      ),
    ).toEqual([{ id: BIKE.tanTarmac }]);
  });

  it("show customer and public photos of the caller's own bike, never internal ones", async () => {
    let ids: Record<string, string> = {};
    const rows = await asCustomer(
      CUSTOMER.tan,
      (tx) => rowsOf(tx, "select * from public.my_bike_attachments($1)", [BIKE.tanTarmac]),
      async (tx) => {
        ids = await addBikePhotos(tx, BIKE.tanTarmac, ["internal", "customer", "public"]);
      },
    );
    expect(rows.map((r) => r.id).sort()).toEqual([ids.customer, ids.public].sort());
    expect(rows.map((r) => r.visibility).sort()).toEqual(["customer", "public"]);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(ATTACHMENT_COLUMNS);
  });
});

describe("customer A and customer B", () => {
  it("A cannot reach B's profile, bikes or photos through any RPC", async () => {
    await inTransaction(conn, async (tx) => {
      await addBikePhotos(tx, BIKE.priyaDomane, ["customer", "public"]);
      const tan = await linkCustomerLogin(tx, CUSTOMER.tan);
      await linkCustomerLogin(tx, CUSTOMER.priya);
      await actAs(tx, customerClaims(tan));

      expect(
        (await rowsOf(tx, "select id from public.my_customer_profile()")).map((r) => r.id),
      ).toEqual([CUSTOMER.tan]);
      const bikes = (await rowsOf(tx, "select id from public.my_bikes()")).map((r) => r.id);
      expect(bikes).not.toContain(BIKE.priyaDomane);
      expect(bikes).not.toContain(BIKE.priyaTern);
      // Photos of Priya's bike, even public ones, are not Tan's to list.
      expect(
        await rowsOf(tx, "select * from public.my_bike_attachments($1)", [BIKE.priyaDomane]),
      ).toEqual([]);
      // update_my_profile has no target parameter: it can only ever be Tan.
      await tx.query("select public.update_my_profile('Changed')");
      await tx.query("reset role");
      expect(
        await scalar(tx, "select first_name from public.customers where id = $1", [CUSTOMER.priya]),
      ).toBe("Priya");
    });
  });

  it("an unknown bike id returns nothing rather than an error", async () => {
    expect(
      await asCustomer(CUSTOMER.tan, (tx) =>
        rowsOf(tx, "select * from public.my_bike_attachments($1)", [randomUUID()]),
      ),
    ).toEqual([]);
  });

  it("customers cannot call staff RPCs", async () => {
    for (const sql of [
      `select public.transfer_bike_ownership('${BIKE.priyaDomane}', '${CUSTOMER.tan}', 'Mine now')`,
      `select public.delete_attachment('${randomUUID()}', 'Mine')`,
      `select public.set_attachment_visibility('${randomUUID()}', 'public')`,
      `select public.record_attachment('${randomUUID()}', 'bike', '${BIKE.tanTarmac}',
         'media-internal', 'bike/x.jpg', 'image/jpeg')`,
      "select * from public.staff_directory()",
    ]) {
      await expect(asCustomer(CUSTOMER.tan, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "42501",
      });
    }
  });
});

describe("staff and the customer RPCs", () => {
  it("staff without a customers row get nothing, and cannot update a profile", async () => {
    await asStaff(conn, STAFF.mechanic1, async (tx) => {
      expect(await rowsOf(tx, "select * from public.my_customer_profile()")).toEqual([]);
      expect(await rowsOf(tx, "select * from public.my_bikes()")).toEqual([]);
      expect(
        await rowsOf(tx, "select * from public.my_bike_attachments($1)", [BIKE.tanTarmac]),
      ).toEqual([]);
    });
    await expect(
      asStaff(conn, STAFF.mechanic1, (tx) => tx.query("select public.update_my_profile('Marcus')")),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("a staff member who is also a customer sees their own customer profile", async () => {
    await inTransaction(conn, async (tx) => {
      await tx.query("update public.customers set auth_user_id = $1 where id = $2", [
        AUTH_USER.mechanic1,
        CUSTOMER.hafiz,
      ]);
      await actAs(tx, staffClaims(AUTH_USER.mechanic1));
      expect(
        (await rowsOf(tx, "select id from public.my_customer_profile()")).map((r) => r.id),
      ).toEqual([CUSTOMER.hafiz]);
      // ... and, being staff, still reads the base tables.
      expect(await scalar(tx, "select count(*)::int from public.customers")).toBe(6);
    });
  });
});

describe("anonymous callers", () => {
  it("cannot call the customer RPCs", async () => {
    for (const sql of [
      "select * from public.my_customer_profile()",
      "select public.update_my_profile('Anon')",
      "select * from public.my_bikes()",
      `select * from public.my_bike_attachments('${BIKE.tanTarmac}')`,
    ]) {
      await expect(asAnon(conn, (tx) => tx.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });
});
