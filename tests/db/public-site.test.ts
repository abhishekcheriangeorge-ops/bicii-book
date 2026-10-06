/**
 * The public site's backend (Phase 11; PLAN D121-D124, ADR-023; DATA-MODEL
 * §2, §3, §15, §16; SPEC §4.1, §4.2, §18, §23, §27.2):
 *
 *   claim_my_customer   links a confirmed login to the one unlinked,
 *                       non-archived customer with its email, or creates
 *                       a customer at the first booking; never two rows,
 *                       never someone else's record, never an archived one.
 *   bookable_slots      the bookable starts of up to 31 days, exactly the
 *                       union of available_slots for each day (D37 rules
 *                       live there), for anon and signed-in callers.
 *   media-internal      a customer reads the objects behind exactly their
 *                       own customer-visible bike and job photos, so their
 *                       session can sign URLs; nothing else (D124).
 *
 * Template: customer-access.test.ts (rolled-back transactions, owner
 * inserts, actAs for identity). The concurrency case commits, so it runs
 * only on this file's clone.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, BIKE, CUSTOMER } from "../fixtures/ids";
import { addDays, futureDay, makeType, shopToday, standardSchedule } from "./appointment-fixtures";
import {
  attachmentPath,
  createAuthUser,
  customerClaims,
  linkCustomerLogin,
  putStorageObject,
} from "./customer-fixtures";
import {
  actAs,
  connect,
  inTransaction,
  isolatedDatabase,
  openConnections,
  scalar,
  staffClaims,
} from "./harness";
import {
  createWorkOrder,
  failsWith,
  makeBike,
  makeCustomer,
  ownerMode,
  setStatus,
} from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const p0001 = (message: string) => ({ code: "P0001", message });

type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: Date;
};

const PROFILE_COLUMNS = [
  "created_at",
  "display_name",
  "email",
  "first_name",
  "id",
  "last_name",
  "phone",
];

/** A login with a confirmed email (what verifying the first code leaves). */
async function confirmedLogin(tx: pg.Client, email: string): Promise<string> {
  const id = await createAuthUser(tx, email);
  await tx.query("update auth.users set email_confirmed_at = now() where id = $1", [id]);
  return id;
}

const uniqueEmail = (prefix = "signup") => `${prefix}-${randomUUID().slice(0, 8)}@example.com`;

async function claim(
  tx: pg.Client,
  args: {
    create?: boolean;
    first?: string | null;
    last?: string | null;
    phone?: string | null;
  } = {},
): Promise<Profile[]> {
  const { rows } = await tx.query<Profile>(
    "select * from public.claim_my_customer($1, $2, $3, $4)",
    [args.create ?? false, args.first ?? null, args.last ?? null, args.phone ?? null],
  );
  return rows;
}

async function customersWithEmail(tx: pg.Client, email: string) {
  await ownerMode(tx);
  const { rows } = await tx.query<{
    id: string;
    auth_user_id: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    archived_at: Date | null;
  }>(
    `select id, auth_user_id, first_name, last_name, phone, archived_at
     from public.customers where email = $1::extensions.citext order by created_at, id`,
    [email],
  );
  return rows;
}

async function customerWithEmail(
  tx: pg.Client,
  email: string,
  fields: { first?: string; last?: string; phone?: string; archived?: boolean } = {},
): Promise<string> {
  await ownerMode(tx);
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.customers (first_name, last_name, email, phone, internal_notes, archived_at)
     values ($1, $2, $3, $4, 'Staff only: never shown', case when $5 then now() end)
     returning id`,
    [
      fields.first ?? "Staff",
      fields.last ?? "Entered",
      email,
      fields.phone ?? null,
      fields.archived ?? false,
    ],
  );
  return rows[0].id;
}

describe("claim_my_customer (D121, D122)", () => {
  it("anonymous callers cannot call it", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, { role: "anon" });
      await failsWith(tx, () => claim(tx), { code: "42501" });
    });
  });

  it("refuses a login whose email is not confirmed yet", async () => {
    await inTransaction(conn, async (tx) => {
      const email = uniqueEmail();
      await customerWithEmail(tx, email);
      const login = await createAuthUser(tx, email);
      await actAs(tx, customerClaims(login));
      await failsWith(
        tx,
        () => claim(tx, { create: true, first: "Ann" }),
        p0001("customer_email_unconfirmed"),
      );
      expect((await customersWithEmail(tx, email)).map((c) => c.auth_user_id)).toEqual([null]);
    });
  });

  it("with no matching record and no booking yet, returns nothing and creates nothing", async () => {
    await inTransaction(conn, async (tx) => {
      const email = uniqueEmail();
      const login = await confirmedLogin(tx, email);
      await actAs(tx, customerClaims(login));
      expect(await claim(tx, { first: "Ann" })).toEqual([]);
      expect(await customersWithEmail(tx, email)).toEqual([]);
    });
  });

  it("at the first booking, creates one customer with the login's email and the given name and phone, once", async () => {
    await inTransaction(conn, async (tx) => {
      const email = uniqueEmail();
      const login = await confirmedLogin(tx, email);
      await actAs(tx, customerClaims(login));
      const [created] = await claim(tx, {
        create: true,
        first: "  Ann ",
        last: "Lee",
        phone: "+65 8000 0000",
      });
      expect(Object.keys(created).sort()).toEqual(PROFILE_COLUMNS);
      expect(created).toMatchObject({
        first_name: "Ann",
        last_name: "Lee",
        email,
        phone: "+65 8000 0000",
      });
      // Now the customer RPCs see it, and a repeat returns the same row.
      expect(await scalar(tx, "select private.current_customer_id()")).toBe(created.id);
      const [again] = await claim(tx, { create: true, first: "Someone else" });
      expect(again).toEqual(created);
      const rows = await customersWithEmail(tx, email);
      expect(rows).toHaveLength(1);
      expect(rows[0].auth_user_id).toBe(login);
    });
  });

  it("refuses to create without a first name, with an overlong name or phone", async () => {
    await inTransaction(conn, async (tx) => {
      const login = await confirmedLogin(tx, uniqueEmail());
      await actAs(tx, customerClaims(login));
      await failsWith(
        tx,
        () => claim(tx, { create: true, first: "   " }),
        p0001("customer_name_required"),
      );
      await failsWith(
        tx,
        () => claim(tx, { create: true, first: "A".repeat(101) }),
        p0001("customer_name_too_long"),
      );
      await failsWith(
        tx,
        () => claim(tx, { create: true, first: "Ann", last: "B".repeat(101) }),
        p0001("customer_name_too_long"),
      );
      await failsWith(
        tx,
        () => claim(tx, { create: true, first: "Ann", phone: "9".repeat(41) }),
        p0001("customer_phone_too_long"),
      );
    });
  });

  it("links the one unlinked record with the same email (any case) and keeps what staff entered", async () => {
    await inTransaction(conn, async (tx) => {
      const email = uniqueEmail("Mixed.Case");
      const customerId = await customerWithEmail(tx, email, {
        first: "Wei Ming",
        last: "Tan",
        phone: "+65 9123 0000",
      });
      const login = await confirmedLogin(tx, email.toLowerCase());
      await actAs(tx, customerClaims(login));
      const [linked] = await claim(tx, {
        create: true,
        first: "Typed",
        last: "Online",
        phone: "1",
      });
      expect(linked).toMatchObject({
        id: customerId,
        first_name: "Wei Ming",
        last_name: "Tan",
        phone: "+65 9123 0000",
      });
      expect(Object.keys(linked)).not.toContain("internal_notes");
      const rows = await customersWithEmail(tx, email);
      expect(rows.map((r) => [r.id, r.auth_user_id])).toEqual([[customerId, login]]);
    });
  });

  it("links nothing when two unlinked records share the email (staff resolve it)", async () => {
    await inTransaction(conn, async (tx) => {
      const email = uniqueEmail();
      await customerWithEmail(tx, email);
      await customerWithEmail(tx, email);
      const login = await confirmedLogin(tx, email);
      await actAs(tx, customerClaims(login));
      await failsWith(tx, () => claim(tx), p0001("customer_link_ambiguous"));
      await failsWith(
        tx,
        () => claim(tx, { create: true, first: "Ann" }),
        p0001("customer_link_ambiguous"),
      );
      expect((await customersWithEmail(tx, email)).map((r) => r.auth_user_id)).toEqual([
        null,
        null,
      ]);
    });
  });

  it("never links an archived record or one that already has a login; at a booking it makes a new one", async () => {
    await inTransaction(conn, async (tx) => {
      const email = uniqueEmail();
      const archived = await customerWithEmail(tx, email, { archived: true });
      const taken = await customerWithEmail(tx, email);
      const otherLogin = await createAuthUser(tx, uniqueEmail("other"));
      await tx.query("update public.customers set auth_user_id = $1 where id = $2", [
        otherLogin,
        taken,
      ]);

      const login = await confirmedLogin(tx, email);
      await actAs(tx, customerClaims(login));
      expect(await claim(tx)).toEqual([]);
      const [created] = await claim(tx, { create: true, first: "Ann" });
      expect([archived, taken]).not.toContain(created.id);

      const rows = await customersWithEmail(tx, email);
      expect(rows.find((r) => r.id === archived)?.auth_user_id).toBeNull();
      expect(rows.find((r) => r.id === taken)?.auth_user_id).toBe(otherLogin);
    });
  });

  it("refuses a login whose own record was archived, rather than making a second one", async () => {
    await inTransaction(conn, async (tx) => {
      const email = uniqueEmail();
      const customerId = await customerWithEmail(tx, email);
      const login = await confirmedLogin(tx, email);
      await tx.query(
        "update public.customers set auth_user_id = $1, archived_at = now() where id = $2",
        [login, customerId],
      );
      await actAs(tx, customerClaims(login));
      await failsWith(tx, () => claim(tx), p0001("customer_archived"));
      await failsWith(
        tx,
        () => claim(tx, { create: true, first: "Ann" }),
        p0001("customer_archived"),
      );
      expect(await customersWithEmail(tx, email)).toHaveLength(1);
    });
  });

  it("a linked login keeps its record after either email changes, and never takes another", async () => {
    await inTransaction(conn, async (tx) => {
      const email = uniqueEmail();
      const customerId = await customerWithEmail(tx, email);
      const login = await confirmedLogin(tx, email);
      await actAs(tx, customerClaims(login));
      expect((await claim(tx))[0].id).toBe(customerId);

      // Staff change the record's email; a second record gets the old one.
      await ownerMode(tx);
      await tx.query("update public.customers set email = $1 where id = $2", [
        uniqueEmail("moved"),
        customerId,
      ]);
      await customerWithEmail(tx, email);
      await actAs(tx, customerClaims(login));
      expect((await claim(tx, { create: true, first: "Ann" }))[0].id).toBe(customerId);
    });
  });

  it.skipIf(!isolatedDatabase())(
    "two simultaneous first bookings by one login create one customer (the claim serialises)",
    async () => {
      const email = uniqueEmail("race");
      const setup = await connect();
      const login = await inTransaction(setup, (tx) => confirmedLogin(tx, email), { commit: true });
      const [c1, c2] = await openConnections(2);
      const run = (c: pg.Client) =>
        inTransaction(
          c,
          async (tx) => {
            await actAs(tx, customerClaims(login));
            const rows = await claim(tx, { create: true, first: "Race" });
            // Hold the transaction open a moment so the other call queues.
            await tx.query("select pg_sleep(0.2)");
            return rows[0].id;
          },
          { commit: true },
        );
      const [a, b] = await Promise.all([run(c1), run(c2)]);
      expect(a).toBe(b);
      const count = await scalar<number>(
        setup,
        "select count(*)::int from public.customers where email = $1::extensions.citext",
        [email],
      );
      expect(count).toBe(1);
    },
  );
});

describe("bookable_slots (D123)", () => {
  type Slot = { slot_start: Date; slot_end: Date };
  const key = (s: Slot) => `${s.slot_start.toISOString()}/${s.slot_end.toISOString()}`;

  async function perDay(
    tx: pg.Client,
    from: string,
    to: string,
    typeId: string,
  ): Promise<string[]> {
    const out: string[] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const { rows } = await tx.query<Slot>(
        "select slot_start, slot_end from public.available_slots($1::date, $2) order by slot_start",
        [day, typeId],
      );
      out.push(...rows.map(key));
    }
    return out;
  }

  async function ranged(tx: pg.Client, from: string, to: string, typeId: string) {
    const { rows } = await tx.query<Slot & { slot_day: string }>(
      "select slot_day::text, slot_start, slot_end from public.bookable_slots($1::date, $2::date, $3)",
      [from, to, typeId],
    );
    return rows;
  }

  for (const who of ["anon", "customer", "staff"] as const) {
    it(`for ${who}, equals available_slots day by day over the range, each slot tagged with its shop day`, async () => {
      await inTransaction(conn, async (tx) => {
        await standardSchedule(tx);
        const typeId = await makeType(tx, { durationMinutes: 30 });
        // Today (inside the notice window for customers) through a week on.
        const from = await shopToday(tx);
        const to = addDays(from, 7);
        if (who === "anon") await actAs(tx, { role: "anon" });
        if (who === "customer") {
          await actAs(tx, customerClaims(await linkCustomerLogin(tx, CUSTOMER.tan)));
        }
        if (who === "staff") await actAs(tx, staffClaims(AUTH_USER.mechanic2));
        const rows = await ranged(tx, from, to, typeId);
        expect(rows.map(key)).toEqual(await perDay(tx, from, to, typeId));
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) {
          expect(r.slot_day >= from && r.slot_day <= to).toBe(true);
          expect(Object.keys(r).sort()).toEqual(["slot_day", "slot_end", "slot_start"]);
        }
      });
    });
  }

  it("follows D37: a customer gets nothing for a type that is not public, staff still do", async () => {
    await inTransaction(conn, async (tx) => {
      await standardSchedule(tx);
      const typeId = await makeType(tx, { public: false });
      const day = await futureDay(tx, 0, 3);
      await actAs(tx, { role: "anon" });
      expect(await ranged(tx, day, addDays(day, 2), typeId)).toEqual([]);
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
      expect((await ranged(tx, day, addDays(day, 2), typeId)).length).toBeGreaterThan(0);
    });
  });

  it("takes at most 31 days and refuses missing or reversed bounds", async () => {
    await inTransaction(conn, async (tx) => {
      await standardSchedule(tx);
      const typeId = await makeType(tx);
      const from = await shopToday(tx);
      await actAs(tx, { role: "anon" });
      await ranged(tx, from, addDays(from, 30), typeId);
      await failsWith(
        tx,
        () => ranged(tx, from, addDays(from, 31), typeId),
        p0001("slot_range_too_long"),
      );
      await failsWith(
        tx,
        () => ranged(tx, from, addDays(from, -1), typeId),
        p0001("slot_range_invalid"),
      );
      await failsWith(
        tx,
        () => tx.query("select * from public.bookable_slots(null, $1::date, $2)", [from, typeId]),
        { code: "22004" },
      );
      await failsWith(
        tx,
        () => tx.query("select * from public.bookable_slots($1::date, $1::date, null)", [from]),
        { code: "22004" },
      );
    });
  });
});

describe("media-internal: customers read their own customer-visible photos (D124)", () => {
  type Visibility = "internal" | "customer" | "public";

  /** An attachment row and its Storage object (owner inserts); returns the object name. */
  async function photo(
    tx: pg.Client,
    entityType: "bike" | "work_order" | "customer",
    entityId: string,
    visibility: Visibility,
  ): Promise<string> {
    await ownerMode(tx);
    const id = randomUUID();
    const bucket = visibility === "public" ? "media-public" : "media-internal";
    const name = attachmentPath(entityType, entityId, id);
    await putStorageObject(tx, bucket, name);
    await tx.query(
      `insert into public.attachments (id, entity_type, entity_id, storage_bucket, storage_path, media_type, visibility)
       values ($1, $2, $3, $4, $5, 'image/jpeg', $6)`,
      [id, entityType, entityId, bucket, name, visibility],
    );
    return name;
  }

  const readable = async (tx: pg.Client, bucket: string) =>
    (
      await tx.query<{ name: string }>(
        "select name from storage.objects where bucket_id = $1 order by name",
        [bucket],
      )
    ).rows.map((r) => r.name);

  async function jobFor(tx: pg.Client, customerId: string, bikeId: string): Promise<string> {
    await actAs(tx, staffClaims(AUTH_USER.admin));
    const job = await createWorkOrder(tx, { customerId, bikeId });
    await ownerMode(tx);
    return job.id;
  }

  it("lists exactly their own bike's and job's customer- and internal-bucket photos, nothing else", async () => {
    await inTransaction(conn, async (tx) => {
      const mine = await makeCustomer(tx, "Photo Owner");
      const bike = await makeBike(tx, mine);
      const job = await jobFor(tx, mine, bike);
      const otherBike = await makeBike(tx, await makeCustomer(tx, "Someone Else"));

      const bikeCustomer = await photo(tx, "bike", bike, "customer");
      await photo(tx, "bike", bike, "internal");
      const jobCustomer = await photo(tx, "work_order", job, "customer");
      await photo(tx, "work_order", job, "internal");
      await photo(tx, "bike", otherBike, "customer");
      await photo(tx, "customer", mine, "customer");
      await photo(tx, "bike", BIKE.tanTarmac, "customer");
      await photo(tx, "bike", bike, "public");

      await actAs(tx, customerClaims(await linkCustomerLogin(tx, mine)));
      expect(await readable(tx, "media-internal")).toEqual([bikeCustomer, jobCustomer].sort());
      // The public bucket is never listed through the API (public URLs only).
      expect(await readable(tx, "media-public")).toEqual([]);
    });
  });

  it("stops when the bike is archived or passes to someone else, and when the job is cancelled", async () => {
    await inTransaction(conn, async (tx) => {
      const mine = await makeCustomer(tx, "Photo Owner");
      const bike = await makeBike(tx, mine);
      const job = await jobFor(tx, mine, bike);
      const bikePhoto = await photo(tx, "bike", bike, "customer");
      const jobPhoto = await photo(tx, "work_order", job, "customer");
      const login = await linkCustomerLogin(tx, mine);

      await actAs(tx, customerClaims(login));
      expect(await readable(tx, "media-internal")).toEqual([bikePhoto, jobPhoto].sort());

      await actAs(tx, staffClaims(AUTH_USER.admin));
      await setStatus(tx, job, "cancelled", "Customer changed their mind");
      await actAs(tx, customerClaims(login));
      expect(await readable(tx, "media-internal")).toEqual([bikePhoto]);

      await ownerMode(tx);
      await tx.query("update public.bikes set archived_at = now() where id = $1", [bike]);
      await actAs(tx, customerClaims(login));
      expect(await readable(tx, "media-internal")).toEqual([]);
    });
  });

  it("gives anonymous callers and signed-in logins without a customer record nothing", async () => {
    await inTransaction(conn, async (tx) => {
      const mine = await makeCustomer(tx, "Photo Owner");
      const bike = await makeBike(tx, mine);
      await photo(tx, "bike", bike, "customer");
      await actAs(tx, { role: "anon" });
      expect(await readable(tx, "media-internal")).toEqual([]);
      await ownerMode(tx);
      const stranger = await confirmedLogin(tx, uniqueEmail("stranger"));
      await actAs(tx, customerClaims(stranger));
      expect(await readable(tx, "media-internal")).toEqual([]);
    });
  });

  it("is read-only for customers: no upload, no delete", async () => {
    await inTransaction(conn, async (tx) => {
      const mine = await makeCustomer(tx, "Photo Owner");
      const bike = await makeBike(tx, mine);
      const name = await photo(tx, "bike", bike, "customer");
      await actAs(tx, customerClaims(await linkCustomerLogin(tx, mine)));
      await failsWith(
        tx,
        () =>
          tx.query(
            "insert into storage.objects (bucket_id, name, metadata) values ('media-internal', $1, '{}')",
            [attachmentPath("bike", bike, randomUUID())],
          ),
        { code: "42501" },
      );
      // Storage's guard against direct deletes is lifted, as the Storage
      // server does, so only RLS decides (media-storage.test.ts allowDelete).
      await tx.query("select set_config('storage.allow_delete_query', 'true', true)");
      const { rowCount } = await tx.query(
        "delete from storage.objects where bucket_id = 'media-internal' and name = $1",
        [name],
      );
      expect(rowCount).toBe(0);
    });
  });
});

describe("short IDs: every prefix the Admin's /q resolves exists and is readable by staff (Phase 11 check)", () => {
  // src/lib/domain/scan.ts resolveShortId: prefix -> table and column.
  const RESOLVED = [
    ["B", "bikes", "short_id"],
    ["J", "work_orders", "job_number"],
    ["P", "products", "short_id"],
    ["U", "inventory_units", "short_id"],
    ["C", "consignment_items", "short_id"],
    ["S", "sales", "sale_number"],
    ["PO", "purchase_orders", "po_number"],
  ] as const;

  for (const [prefix, table, column] of RESOLVED) {
    it(`${prefix}- is ${table}.${column}: well formed, unique, and present in the seed`, async () => {
      await inTransaction(conn, async (tx) => {
        await actAs(tx, staffClaims(AUTH_USER.mechanic2));
        const { rows } = await tx.query<{ total: number; malformed: number; distinct_ids: number }>(
          `select count(*)::int as total,
                  count(*) filter (where ${column} !~ '^${prefix}-[0-9]{6}$')::int as malformed,
                  count(distinct ${column})::int as distinct_ids
           from public.${table}`,
        );
        expect(rows[0].total).toBeGreaterThan(0);
        expect(rows[0].malformed).toBe(0);
        expect(rows[0].distinct_ids).toBe(rows[0].total);
      });
    });
  }
});
