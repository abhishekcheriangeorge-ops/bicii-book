/**
 * Global staff search (SPEC §5 "Search by customer, brand/model, serial
 * number and BICII ID", §20; DATA-MODEL §16 staff_search):
 *
 *   * finds bikes by short ID and serial number (ignoring case, spaces and
 *     dashes), by brand/model and by owner; customers by name in any word
 *     order, email and phone (with or without spaces or +65);
 *   * exact short ID and serial matches rank first (rank 1), above every
 *     fuzzy hit;
 *   * kinds filter and result limit; unknown kinds raise; blank finds
 *     nothing; LIKE metacharacters are literal; archived rows are left out;
 *   * active staff only.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, BIKE, BIKE_SERIAL, BIKE_SHORT_ID, CUSTOMER, STAFF } from "../fixtures/ids";
import { customerClaims, linkCustomerLogin } from "./customer-fixtures";
import { actAs, asAnon, asStaff, connect, inTransaction, staffClaims } from "./harness";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

type Hit = {
  kind: string;
  id: string;
  title: string;
  subtitle: string | null;
  short_id: string | null;
  rank: number;
};

const search = (tx: pg.Client, q: string | null, kinds: string[] | null = null, max = 20) =>
  tx
    .query<Hit>("select * from public.staff_search($1, $2, $3)", [q, kinds, max])
    .then((r) => r.rows);

/** Searches as mechanic2 (active staff, no permissions). */
const find = (q: string | null, kinds: string[] | null = null, max = 20) =>
  asStaff(conn, STAFF.mechanic2, (tx) => search(tx, q, kinds, max));

const ids = (hits: Hit[]) => hits.map((h) => h.id);

describe("bikes by short ID and serial number", () => {
  it("an exact serial number finds the bike first, ignoring case, spaces and dashes", async () => {
    for (const q of [
      BIKE_SERIAL.tanTarmac,
      "wsbc604123456n",
      "WSBC 6041 2345 6N",
      "wsbc-604123456-n",
    ]) {
      const hits = await find(q);
      expect(hits[0]).toMatchObject({
        kind: "bike",
        id: BIKE.tanTarmac,
        short_id: BIKE_SHORT_ID.tanTarmac,
        rank: 1,
      });
    }
    expect((await find("TRN190045821"))[0]).toMatchObject({ id: BIKE.priyaTern, rank: 1 });
  });

  it("part of a serial number finds the bike", async () => {
    const hits = await find("604123");
    expect(ids(hits)).toContain(BIKE.tanTarmac);
    expect(hits.find((h) => h.id === BIKE.tanTarmac)?.rank).toBeLessThan(1);
  });

  it("a short ID finds the bike first, with or without the dash, in any case", async () => {
    for (const q of ["B-000003", "b-000003", "B000003", " b 000003 "]) {
      expect((await find(q))[0]).toMatchObject({
        kind: "bike",
        id: BIKE.priyaDomane,
        title: "Trek Domane SL 6",
        short_id: "B-000003",
        rank: 1,
      });
    }
  });

  it("exact short ID and serial matches rank above every other kind of hit", async () => {
    await inTransaction(conn, async (tx) => {
      // Records whose words contain the same text, matched fuzzily.
      await tx.query(
        `insert into public.customers (display_name) values
           ('B-000003 Owners Club'), ('WTU291C1234K Fan Club')`,
      );
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
      for (const q of ["B-000003", BIKE_SERIAL.priyaDomane]) {
        const hits = await search(tx, q);
        expect(hits.length).toBeGreaterThan(1);
        expect(hits[0]).toMatchObject({ id: BIKE.priyaDomane, rank: 1 });
        for (const other of hits.slice(1)) expect(other.rank).toBeLessThan(1);
        expect(hits.some((h) => h.kind === "customer")).toBe(true);
      }
    });
  });
});

describe("customers by name, email and phone", () => {
  it("finds a customer by any of their names, in any word order", async () => {
    for (const q of ["Tan", "wei ming", "Ming Tan", "tan wei ming", "TAN WEI"]) {
      const hits = await find(q, ["customer"]);
      expect(ids(hits)).toEqual([CUSTOMER.tan]);
      expect(hits[0]).toMatchObject({
        title: "Tan Wei Ming",
        subtitle: "weiming.tan@example.com · +65 9123 4567",
      });
    }
    // display_name falls back to first + last.
    expect((await find("ramasamy", ["customer"]))[0]).toMatchObject({
      id: CUSTOMER.priya,
      title: "Priya Ramasamy",
    });
  });

  it("finds a customer by phone, with or without spaces or +65, and by part of it", async () => {
    for (const q of ["9123 4567", "91234567", "+65 9123 4567", "+6591234567", "6591234567"]) {
      expect((await find(q))[0]).toMatchObject({ id: CUSTOMER.tan, rank: 0.95 });
    }
    const partial = await find("4567");
    expect(ids(partial)).toContain(CUSTOMER.tan);
    expect(partial.find((h) => h.id === CUSTOMER.tan)?.rank).toBeLessThan(0.95);
    // A walk-in with a phone number only.
    expect((await find("8678 9012"))[0]).toMatchObject({
      id: CUSTOMER.nurul,
      title: "Nurul Huda Ismail",
    });
  });

  it("finds a customer by email, an exact address ranking high", async () => {
    expect((await find("Priya.Ramasamy@example.com"))[0]).toMatchObject({
      id: CUSTOMER.priya,
      rank: 0.95,
    });
    // Part of an address: the customer first, then her bikes (by owner).
    const partial = await find("priya.rama");
    expect(partial[0]).toMatchObject({ kind: "customer", id: CUSTOMER.priya });
    expect(ids(partial.slice(1)).sort()).toEqual([BIKE.priyaDomane, BIKE.priyaTern].sort());
  });
});

describe("bikes by brand, model and owner", () => {
  it("finds bikes by brand or model", async () => {
    expect(ids(await find("brompton")).sort()).toEqual(
      [BIKE.tanBrompton, BIKE.hafizBrompton].sort(),
    );
    expect(ids(await find("long haul"))).toEqual([BIKE.chloeSurly]);
  });

  it("finds an owner's bikes by the owner's name, alone or with the brand", async () => {
    const hits = await find("tan");
    expect(hits[0]).toMatchObject({ kind: "customer", id: CUSTOMER.tan });
    expect(ids(hits.filter((h) => h.kind === "bike")).sort()).toEqual(
      [BIKE.tanTarmac, BIKE.tanBrompton].sort(),
    );
    expect(ids(await find("brompton hafiz"))).toEqual([BIKE.hafizBrompton]);
    expect(ids(await find("rahman brompton"))).toEqual([BIKE.hafizBrompton]);
  });

  it("labels a bike without an owner as a shop bike", async () => {
    expect((await find("cervelo"))[0]).toMatchObject({
      kind: "bike",
      id: BIKE.shopCervelo,
      title: "Cervelo Caledonia-5",
      subtitle: "Shop bike · Five Black · S/N CV-CAL5-0921",
      short_id: BIKE_SHORT_ID.shopCervelo,
    });
  });
});

describe("query handling", () => {
  it("returns typed hits", async () => {
    const [hit] = await find("tarmac");
    expect(Object.keys(hit).sort()).toEqual([
      "id",
      "kind",
      "rank",
      "short_id",
      "subtitle",
      "title",
    ]);
    expect(typeof hit.rank).toBe("number");
  });

  it("treats % and _ as plain characters", async () => {
    for (const q of ["%", "_", "%%", "a%", "\\"]) {
      expect(await find(q)).toEqual([]);
    }
  });

  it("returns nothing for a blank query", async () => {
    for (const q of [null, "", "   "]) expect(await find(q)).toEqual([]);
  });

  it("filters by kind and limits the number of hits", async () => {
    expect(new Set((await find("tan", ["bike"])).map((h) => h.kind))).toEqual(new Set(["bike"]));
    expect(new Set((await find("tan", ["customer"])).map((h) => h.kind))).toEqual(
      new Set(["customer"]),
    );
    expect(await find("tan", [])).toEqual([]);
    expect(await find("tan", null, 1)).toHaveLength(1);
    expect(await find("tan", null, 0)).toHaveLength(1); // clamped to 1..100
  });

  it("never returns more than 100 hits", async () => {
    await inTransaction(conn, async (tx) => {
      await tx.query(
        "insert into public.customers (last_name) select 'Lee ' || n from generate_series(1, 120) n",
      );
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
      expect(await search(tx, "lee", null, 1000)).toHaveLength(100);
      expect(await search(tx, "lee", null, null as unknown as number)).toHaveLength(20);
    });
  });

  it("raises 22023 for a kind it does not know", async () => {
    await expect(find("tan", ["work_order"])).rejects.toMatchObject({ code: "22023" });
    await expect(find("tan", ["bike", null as unknown as string])).rejects.toMatchObject({
      code: "22023",
    });
  });

  it("leaves out archived customers and bikes", async () => {
    await inTransaction(conn, async (tx) => {
      await tx.query("update public.customers set archived_at = now() where id = $1", [
        CUSTOMER.tan,
      ]);
      await tx.query("update public.bikes set archived_at = now() where id = $1", [BIKE.tanTarmac]);
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
      expect(ids(await search(tx, "tan wei ming", ["customer"]))).toEqual([]);
      expect(await search(tx, BIKE_SERIAL.tanTarmac)).toEqual([]);
      // His other bike is still found, by his name too.
      expect(ids(await search(tx, "tan", ["bike"]))).toEqual([BIKE.tanBrompton]);
    });
  });
});

describe("access", () => {
  it("is for active staff only", async () => {
    await expect(asAnon(conn, (tx) => search(tx, "tan"))).rejects.toMatchObject({ code: "42501" });
    await expect(
      inTransaction(conn, async (tx) => {
        await actAs(tx, customerClaims(await linkCustomerLogin(tx, CUSTOMER.priya)));
        return search(tx, "tan");
      }),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      inTransaction(conn, async (tx) => {
        await tx.query("update public.staff set active = false where id = $1", [STAFF.mechanic2]);
        await actAs(tx, staffClaims(AUTH_USER.mechanic2));
        return search(tx, "tan");
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
