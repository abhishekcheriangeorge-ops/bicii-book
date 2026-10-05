/**
 * Workshop catalog (SPEC §4.2, §9, §10; DATA-MODEL §5, §15, §16; PLAN D14,
 * D21):
 *
 *   * the Cult Commons rate is effective-dated: the base 0.3000 row ships
 *     with the migration; private.cult_commons_rate_at picks the latest
 *     non-cancelled row in force; rates are append-only for every writer;
 *     only admins schedule (never backdated) or cancel (only before the
 *     rate starts) them; only view_costs holders read them;
 *   * services' default direct cost is staff financial data: no column
 *     grant, read through services_staff (view_costs); services are written
 *     only through the RPCs (manage_inventory; a cost needs view_costs);
 *   * categories: staff read, manage_inventory writes.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, CULT_COMMONS_BASE_RATE, STAFF } from "../fixtures/ids";
import { actAs, asStaff, connect, inTransaction, scalar, staffClaims, withClaims } from "./harness";
import { failsWith, makeService, ownerMode } from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const rateAt = (tx: pg.Client, at: string) =>
  scalar<string>(tx, "select private.cult_commons_rate_at($1::timestamptz)::text", [at]);

const schedule = (
  tx: pg.Client,
  rate: string,
  effectiveFrom: string | null = null,
  id: string = randomUUID(),
) =>
  tx
    .query("select (r).* from (select public.schedule_cult_commons_rate($1, $2, $3) r) s", [
      id,
      rate,
      effectiveFrom,
    ])
    .then((r) => r.rows[0]);

const cancel = (tx: pg.Client, id: string) =>
  tx
    .query("select (r).* from (select public.cancel_cult_commons_rate($1) r) s", [id])
    .then((r) => r.rows[0]);

const inDays = async (tx: pg.Client, days: number) =>
  scalar<string>(tx, "select (now() + make_interval(days => $1))::text", [days]);

describe("Cult Commons rates (SPEC §10, D21)", () => {
  it("the base 0.3000 rate from 1970 ships with the migration", async () => {
    const { rows } = await conn.query(
      `select id, rate::text, effective_from = '1970-01-01 00:00:00+00' as from_1970,
              created_by, cancelled_at
         from public.cult_commons_rates`,
    );
    expect(rows).toEqual([
      {
        id: CULT_COMMONS_BASE_RATE,
        rate: "0.3000",
        from_1970: true,
        created_by: null,
        cancelled_at: null,
      },
    ]);
  });

  it("cult_commons_rate_at uses the latest rate in force, from exactly its effective_from", async () => {
    await inTransaction(conn, async (tx) => {
      await tx.query(
        "insert into public.cult_commons_rates (rate, effective_from) values (0.25, '2030-01-01 00:00:00+00')",
      );
      expect(await rateAt(tx, "2030-01-01 00:00:00+00")).toBe("0.2500");
      expect(await rateAt(tx, "2029-12-31 23:59:59.999999+00")).toBe("0.3000");
      expect(await rateAt(tx, "2040-06-01 00:00:00+00")).toBe("0.2500");
      expect(await rateAt(tx, "1970-01-01 00:00:00+00")).toBe("0.3000");
      await failsWith(tx, () => rateAt(tx, "1969-12-31 23:59:59+00"), {
        code: "P0001",
        message: "cult_commons_rate_missing",
      });
    });
  });

  it("rates are append-only for every writer, the owner included", async () => {
    for (const sql of [
      "update public.cult_commons_rates set rate = 0.5",
      "update public.cult_commons_rates set effective_from = now() + interval '1 day'",
      "delete from public.cult_commons_rates",
    ]) {
      await expect(inTransaction(conn, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "P0001",
        message: "cult_commons_rates_append_only",
      });
      await expect(asStaff(conn, STAFF.admin, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "42501",
      });
    }
    await expect(
      asStaff(conn, STAFF.admin, (tx) =>
        tx.query(
          "insert into public.cult_commons_rates (rate, effective_from) values (0.2, now())",
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("only view_costs holders read the rates", async () => {
    expect(
      await asStaff(conn, STAFF.mechanic2, (tx) =>
        scalar(tx, "select count(*)::int from public.cult_commons_rates"),
      ),
    ).toBe(0);
    for (const who of [STAFF.mechanic1, STAFF.admin]) {
      expect(
        await asStaff(conn, who, (tx) =>
          scalar(tx, "select count(*)::int from public.cult_commons_rates"),
        ),
      ).toBe(1);
    }
  });

  it("schedule_cult_commons_rate is admin only: view_costs is not enough", async () => {
    for (const who of [STAFF.mechanic1, STAFF.mechanic2]) {
      await expect(asStaff(conn, who, (tx) => schedule(tx, "0.25"))).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  // withClaims: the admin's identity for the RPCs, while staying the owner
  // to call private.cult_commons_rate_at.
  it("schedules a rate now (null) or later, records who, and never backdates", async () => {
    await withClaims(conn, staffClaims(AUTH_USER.admin), async (tx) => {
      const now = await schedule(tx, "0.2800");
      expect(now).toMatchObject({ rate: "0.2800", created_by: STAFF.admin, cancelled_at: null });
      expect(await rateAt(tx, new Date(Date.now() + 1000).toISOString())).toBe("0.2800");

      const later = await inDays(tx, 30);
      expect((await schedule(tx, "0.3500", later)).rate).toBe("0.3500");

      await failsWith(tx, () => schedule(tx, "0.2000", "2020-01-01T00:00:00Z"), {
        code: "P0001",
        message: "rate_backdated",
      });
      await failsWith(tx, () => schedule(tx, "0.2000", later), {
        code: "23505",
        constraint: "cult_commons_rates_effective_from_key",
      });
      await failsWith(tx, () => schedule(tx, "1.5000"), {
        code: "23514",
        constraint: "cult_commons_rates_rate_check",
      });
      await failsWith(tx, () => schedule(tx, "NaN"), { code: "23514" });
      await failsWith(tx, () => tx.query("select public.schedule_cult_commons_rate(null, 0.2)"), {
        code: "22004",
      });
    });
  });

  it("is replay-safe by id: a retried 'start now' adds no second rate", async () => {
    await withClaims(conn, staffClaims(AUTH_USER.admin), async (tx) => {
      const id = randomUUID();
      const first = await schedule(tx, "0.2700", null, id);
      const again = await schedule(tx, "0.2700", null, id);
      expect(again).toEqual(first);
      expect(
        await scalar(tx, "select count(*)::int from public.cult_commons_rates where rate = 0.27"),
      ).toBe(1);
      await failsWith(tx, () => schedule(tx, "0.2600", null, id), {
        code: "P0001",
        message: "rate_conflict",
      });
      // A replay still returns the row once it has been cancelled.
      const future = randomUUID();
      const later = await schedule(tx, "0.3300", await inDays(tx, 5), future);
      await cancel(tx, later.id);
      expect(await schedule(tx, "0.3300", await inDays(tx, 5), future)).toMatchObject({
        id: future,
        cancelled_by: STAFF.admin,
      });
    });
  });

  it("cancelling a future rate restores the previous one; replay returns the row", async () => {
    await withClaims(conn, staffClaims(AUTH_USER.admin), async (tx) => {
      const start = await inDays(tx, 30);
      const after = await inDays(tx, 31);
      const future = await schedule(tx, "0.2000", start);
      expect(await rateAt(tx, after)).toBe("0.2000");

      const cancelled = await cancel(tx, future.id);
      expect(cancelled).toMatchObject({ id: future.id, cancelled_by: STAFF.admin });
      expect(cancelled.cancelled_at).not.toBeNull();
      expect(await rateAt(tx, after)).toBe("0.3000");

      const replay = await cancel(tx, future.id);
      expect(replay.cancelled_at).toEqual(cancelled.cancelled_at);

      // The cancelled row no longer holds its start time.
      expect((await schedule(tx, "0.2200", start)).rate).toBe("0.2200");
      expect(await rateAt(tx, after)).toBe("0.2200");
    });
  });

  it("a rate already in effect cannot be cancelled, by the RPC or by the owner", async () => {
    await expect(
      asStaff(conn, STAFF.admin, (tx) => cancel(tx, CULT_COMMONS_BASE_RATE)),
    ).rejects.toMatchObject({ code: "P0001", message: "cult_commons_rate_in_effect" });
    await expect(
      inTransaction(conn, (tx) =>
        tx.query("update public.cult_commons_rates set cancelled_at = now() where id = $1", [
          CULT_COMMONS_BASE_RATE,
        ]),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "cult_commons_rate_in_effect" });
  });

  it("the owner cannot un-cancel a rate", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, staffClaims(AUTH_USER.admin));
      const future = await schedule(tx, "0.2000", await inDays(tx, 10));
      await cancel(tx, future.id);
      await ownerMode(tx);
      await failsWith(
        tx,
        () =>
          tx.query("update public.cult_commons_rates set cancelled_at = null where id = $1", [
            future.id,
          ]),
        { code: "P0001", message: "cult_commons_rates_append_only" },
      );
    });
  });

  it("cancel is admin only and P0002 for an unknown rate", async () => {
    await expect(
      asStaff(conn, STAFF.mechanic1, (tx) => cancel(tx, CULT_COMMONS_BASE_RATE)),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asStaff(conn, STAFF.admin, (tx) => cancel(tx, randomUUID())),
    ).rejects.toMatchObject({ code: "P0002" });
  });
});

describe("services: the default direct cost is gated by view_costs (SPEC §4.2)", () => {
  it("staff without view_costs cannot select the cost column and see no services_staff rows", async () => {
    await inTransaction(conn, async (tx) => {
      const id = await makeService(tx, { name: "Headset Service", price: "60.00", cost: "12.00" });
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
      await failsWith(tx, () => tx.query("select default_direct_cost from public.services"), {
        code: "42501",
      });
      await failsWith(tx, () => tx.query("select * from public.services"), { code: "42501" });
      expect(
        (await tx.query("select name, default_sale_price from public.services where id = $1", [id]))
          .rows,
      ).toEqual([{ name: "Headset Service", default_sale_price: "60.00" }]);
      expect(await scalar(tx, "select count(*)::int from public.services_staff")).toBe(0);
    });
  });

  it("view_costs holders and admins read the cost through services_staff", async () => {
    for (const who of [AUTH_USER.mechanic1, AUTH_USER.admin]) {
      await inTransaction(conn, async (tx) => {
        const id = await makeService(tx, { price: "60.00", cost: "12.00" });
        await actAs(tx, staffClaims(who));
        expect(
          (
            await tx.query(
              "select default_sale_price, default_direct_cost from public.services_staff where id = $1",
              [id],
            )
          ).rows,
        ).toEqual([{ default_sale_price: "60.00", default_direct_cost: "12.00" }]);
      });
    }
  });

  it("nobody writes services directly", async () => {
    for (const sql of [
      "insert into public.services (name, default_sale_price) values ('X', 1)",
      "update public.services set default_sale_price = 1",
      "delete from public.services",
    ]) {
      await expect(asStaff(conn, STAFF.admin, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "42501",
      });
    }
  });
});

const createService = (
  tx: pg.Client,
  a: {
    id?: string;
    name: string;
    price?: string;
    cost?: string | null;
    categoryId?: string | null;
  },
) =>
  scalar<string>(tx, "select public.create_service($1, $2, $3, null, $4, $5)", [
    a.id ?? randomUUID(),
    a.name,
    a.price ?? "80.00",
    a.categoryId ?? null,
    a.cost ?? null,
  ]);

const updateService = (
  tx: pg.Client,
  id: string,
  a: { name: string; price: string; cost?: string | null; active?: boolean },
) =>
  scalar<string>(tx, "select public.update_service($1, $2, $3, null, null, $4, false, $5)", [
    id,
    a.name,
    a.price,
    a.active ?? true,
    a.cost ?? null,
  ]);

const costOf = (tx: pg.Client, id: string) =>
  scalar<string>(tx, "select default_direct_cost::text from public.services where id = $1", [id]);

describe("service RPCs (manage_inventory; a cost needs view_costs, D14)", () => {
  it("view_costs alone cannot create, update or archive a service; admins can", async () => {
    await expect(
      asStaff(conn, STAFF.mechanic1, (tx) => createService(tx, { name: "Hub Overhaul" })),
    ).rejects.toMatchObject({ code: "42501" });
    await asStaff(conn, STAFF.admin, async (tx) => {
      const id = await createService(tx, { name: "Hub Overhaul", price: "35.00", cost: "5.00" });
      await actAs(tx, staffClaims(AUTH_USER.mechanic1));
      await failsWith(tx, () => updateService(tx, id, { name: "Hub Overhaul", price: "40.00" }), {
        code: "42501",
      });
      await failsWith(tx, () => tx.query("select public.set_service_archived($1, true)", [id]), {
        code: "42501",
      });
    });
  });

  it("a manage_inventory holder without view_costs may create and edit, but never set a cost", async () => {
    await inTransaction(conn, async (tx) => {
      await tx.query(
        "insert into public.staff_permissions (staff_id, permission) values ($1, 'manage_inventory')",
        [STAFF.mechanic2],
      );
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
      const id = await createService(tx, { name: "Tubeless Conversion", price: "15.00" });
      await failsWith(tx, () => createService(tx, { name: "Wheel Build", cost: "10.00" }), {
        code: "42501",
      });
      await failsWith(
        tx,
        () => updateService(tx, id, { name: "Tubeless Conversion", price: "18.00", cost: "3.00" }),
        { code: "42501" },
      );

      await ownerMode(tx);
      expect(await costOf(tx, id)).toBe("0.00");
      await tx.query("update public.services set default_direct_cost = 4 where id = $1", [id]);
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
      expect(
        await updateService(tx, id, { name: "Tubeless Convert", price: "18.00", active: false }),
      ).toBe(id);
      await ownerMode(tx);
      expect(
        (
          await tx.query(
            "select name, default_sale_price, default_direct_cost, active from public.services where id = $1",
            [id],
          )
        ).rows[0],
      ).toEqual({
        name: "Tubeless Convert",
        default_sale_price: "18.00",
        default_direct_cost: "4.00",
        active: false,
      });
    });
  });

  it("a manage_inventory holder without view_costs never reads the cost through an error's DETAIL", async () => {
    // update_service keeps the stored cost in the new row; a check violation
    // inside the definer function would print that row (cost included).
    await inTransaction(conn, async (tx) => {
      const id = await makeService(tx, { name: "Secret Cost Tune", price: "60.00", cost: "13.57" });
      await tx.query(
        "insert into public.staff_permissions (staff_id, permission) values ($1, 'manage_inventory')",
        [STAFF.mechanic2],
      );
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
      for (const [args, constraint] of [
        [{ name: "Secret Cost Tune", price: "-1" }, "services_default_sale_price_check"],
        [{ name: "   ", price: "60.00" }, "services_name_check"],
        [{ name: "x".repeat(121), price: "60.00" }, "services_name_check"],
      ] as const) {
        await tx.query("savepoint probe");
        const err = await updateService(tx, id, args).then(
          () => null,
          (e: unknown) => e as { code?: string; constraint?: string; detail?: string },
        );
        await tx.query("rollback to savepoint probe");
        expect(err, constraint).toMatchObject({ code: "23514", constraint });
        expect(err?.detail).toBeUndefined();
        expect(JSON.stringify(err)).not.toMatch(/13\.57|Failing row/);
      }
      await tx.query("savepoint probe");
      const long = await tx
        .query("select public.update_service($1, 'Secret Cost Tune', 60, $2)", [
          id,
          "d".repeat(2001),
        ])
        .then(
          () => null,
          (e: unknown) => e as { code?: string; constraint?: string; detail?: string },
        );
      await tx.query("rollback to savepoint probe");
      expect(long).toMatchObject({ code: "23514", constraint: "services_description_check" });
      expect(long?.detail).toBeUndefined();
    });
  });

  it("an admin sets and changes the cost; null on update keeps it", async () => {
    await withClaims(conn, staffClaims(AUTH_USER.admin), async (tx) => {
      const id = await createService(tx, { name: "Race Prep", price: "180.00", cost: "20.00" });
      expect(await costOf(tx, id)).toBe("20.00");
      await updateService(tx, id, { name: "Race Prep", price: "190.00", cost: "25.00" });
      expect(await costOf(tx, id)).toBe("25.00");
      await updateService(tx, id, { name: "Race Prep", price: "195.00" });
      expect(await costOf(tx, id)).toBe("25.00");
    });
  });

  it("create_service is replay-safe by id; another name under the same id is a conflict", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      const id = randomUUID();
      expect(await createService(tx, { id, name: "Chain Replacement" })).toBe(id);
      expect(await createService(tx, { id, name: "  Chain Replacement " })).toBe(id);
      expect(
        await scalar(
          tx,
          "select count(*)::int from public.services where lower(name) = 'chain replacement'",
        ),
      ).toBe(1);
      await failsWith(tx, () => createService(tx, { id, name: "Something else" }), {
        code: "P0001",
        message: "service_conflict",
      });
    });
  });

  it("refuses a product category for a service (category_kind_mismatch)", async () => {
    await inTransaction(conn, async (tx) => {
      const { rows } = await tx.query(
        "insert into public.categories (kind, name) values ('product', 'Tyres'), ('service', 'Fitting') returning id, kind",
      );
      const product = rows.find((r) => r.kind === "product").id;
      const service = rows.find((r) => r.kind === "service").id;
      await actAs(tx, staffClaims(AUTH_USER.admin));
      await failsWith(
        tx,
        () => createService(tx, { name: "Tubeless setup", categoryId: product }),
        {
          code: "P0001",
          message: "category_kind_mismatch",
        },
      );
      expect(await createService(tx, { name: "Tubeless setup", categoryId: service })).toEqual(
        expect.any(String),
      );
    });
  });

  it("active names are unique ignoring case; an archived name can be reused", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      const first = await createService(tx, { name: "Puncture Repair" });
      await failsWith(tx, () => createService(tx, { name: "puncture repair" }), {
        code: "23505",
        constraint: "services_active_name_key",
      });
      expect(await scalar(tx, "select public.set_service_archived($1, true)", [first])).toBe(first);
      const archivedAt = await scalar(
        tx,
        "select archived_at::text from public.services where id = $1",
        [first],
      );
      // Replaying the current state changes nothing.
      await tx.query("select public.set_service_archived($1, true)", [first]);
      expect(
        await scalar(tx, "select archived_at::text from public.services where id = $1", [first]),
      ).toBe(archivedAt);
      expect(await createService(tx, { name: "Puncture Repair" })).not.toBe(first);
      // Unarchiving the old one would now clash.
      await failsWith(
        tx,
        () => tx.query("select public.set_service_archived($1, false)", [first]),
        {
          code: "23505",
          constraint: "services_active_name_key",
        },
      );
    });
  });

  it("rejects bad values: blank name, negative price, unknown service", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      await failsWith(tx, () => createService(tx, { name: "   " }), {
        code: "23514",
        constraint: "services_name_check",
      });
      await failsWith(tx, () => createService(tx, { name: "Negative", price: "-1.00" }), {
        code: "23514",
        constraint: "services_default_sale_price_check",
      });
      await failsWith(tx, () => updateService(tx, randomUUID(), { name: "X", price: "1" }), {
        code: "P0002",
      });
    });
  });
});

describe("categories (staff read; manage_inventory writes)", () => {
  it("every active staff member reads them; only manage_inventory holders write", async () => {
    await inTransaction(conn, async (tx) => {
      await tx.query("insert into public.categories (kind, name) values ('service', '  Wheels ')");
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
      // The seeded categories plus the new one, trimmed.
      expect((await tx.query("select name from public.categories")).rows).toContainEqual({
        name: "Wheels",
      });
      await failsWith(
        tx,
        () =>
          tx.query("insert into public.categories (kind, name) values ('service', 'Suspension')"),
        { code: "42501" },
      );
      await ownerMode(tx);
      await tx.query(
        "insert into public.staff_permissions (staff_id, permission) values ($1, 'manage_inventory')",
        [STAFF.mechanic2],
      );
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
      await tx.query("insert into public.categories (kind, name) values ('service', 'Suspension')");
      await failsWith(
        tx,
        () =>
          tx.query("insert into public.categories (kind, name) values ('service', 'suspension')"),
        { code: "23505", constraint: "categories_active_name_key" },
      );
      await failsWith(tx, () => tx.query("delete from public.categories"), { code: "42501" });
    });
  });
});
