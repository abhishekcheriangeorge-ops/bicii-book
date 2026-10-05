/**
 * Schedule configuration: settings, weekly hours, closures and appointment
 * types, written only by admins through RPCs, with their history (SPEC §6,
 * §21 "shop-hours settings", §22 "Destructive actions require reason";
 * DATA-MODEL §3, §15; PLAN D2, D9, D35, D38).
 *
 * Every test runs in a rolled-back transaction; appointment types get
 * fresh ids and names, and nothing seeded is deleted.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, STAFF } from "../fixtures/ids";
import {
  addDays,
  appointment,
  book,
  futureDay,
  makeType,
  sgt,
  standardSchedule,
} from "./appointment-fixtures";
import { actAs, asAnon, asStaff, connect, inTransaction, scalar, staffClaims } from "./harness";
import { failsWith, makeCustomer, ownerMode } from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const ADMIN = staffClaims(AUTH_USER.admin);
const p0001 = (message: string) => ({ code: "P0001", message });

type ClosureRow = {
  id: string;
  kind: string;
  starts_at: Date;
  ends_at: Date;
  opens_at: string | null;
  closes_at: string | null;
  reason: string;
  created_by: string | null;
};

type TypeRow = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  capacity_units: number;
  public: boolean;
  active: boolean;
  sort_order: number;
};

const saveClosure = (
  tx: pg.Client,
  a: {
    id: string;
    isNew: boolean;
    kind: "closed" | "custom_hours";
    first: string;
    last: string;
    reason: string | null;
    from?: string | null;
    to?: string | null;
  },
) =>
  tx
    .query<ClosureRow>(
      `select (c).* from (select public.save_closure_override($1, $2, $3, $4, $5, $6, $7, $8) c) s`,
      [a.id, a.isNew, a.kind, a.first, a.last, a.reason, a.from ?? null, a.to ?? null],
    )
    .then((r) => r.rows[0]);

const saveType = (
  tx: pg.Client,
  a: {
    id: string;
    isNew: boolean;
    name: string;
    description?: string | null;
    duration?: number;
    units?: number;
    isPublic?: boolean;
    active?: boolean;
    sortOrder?: number;
  },
) =>
  tx
    .query<TypeRow>(
      `select (t).* from (select public.save_appointment_type($1, $2, $3, $4, $5, $6, $7, $8, $9) t) s`,
      [
        a.id,
        a.isNew,
        a.name,
        a.description ?? null,
        a.duration ?? 60,
        a.units ?? 1,
        a.isPublic ?? true,
        a.active ?? true,
        a.sortOrder ?? 0,
      ],
    )
    .then((r) => r.rows[0]);

const scheduleEvents = (tx: pg.Client, entity: string, entityId: string | null) =>
  tx
    .query<{
      event_type: string;
      payload: Record<string, unknown>;
      reason: string | null;
      actor_staff_id: string | null;
    }>(
      `select event_type::text, payload, reason, actor_staff_id from public.schedule_events
        where entity = $1 and entity_id is not distinct from $2 order by id`,
      [entity, entityId],
    )
    .then((r) => r.rows);

const iso = (d: Date) => d.toISOString();

describe("Only admins change the schedule (DATA-MODEL §15)", () => {
  it("mechanic1 and mechanic2 get 42501 from all five admin RPCs; anonymous callers too", async () => {
    const calls = [
      "select public.update_shop_settings(intake_capacity_units => 3)",
      `select public.set_shop_hours(2::smallint, '[]'::jsonb)`,
      `select public.save_closure_override('${randomUUID()}', true, 'closed', current_date, current_date, 'Holiday')`,
      `select public.delete_closure_override('${randomUUID()}', 'Mistake')`,
      `select public.save_appointment_type('${randomUUID()}', true, 'Nope', null, 30, 1, true, true)`,
    ];
    for (const sql of calls) {
      for (const staff of [STAFF.mechanic1, STAFF.mechanic2]) {
        await expect(asStaff(conn, staff, (tx) => tx.query(sql))).rejects.toMatchObject({
          code: "42501",
        });
      }
      await expect(asAnon(conn, (tx) => tx.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("every active staff member reads the configuration tables; nobody writes them directly", async () => {
    await asStaff(conn, STAFF.mechanic2, async (tx) => {
      expect(await scalar(tx, "select count(*)::int from public.shop_settings")).toBe(1);
      for (const table of [
        "shop_hours",
        "closure_overrides",
        "appointment_types",
        "schedule_events",
      ]) {
        await tx.query(`select count(*) from public.${table}`);
      }
    });
    for (const sql of [
      "update public.shop_settings set intake_capacity_units = 9",
      "insert into public.shop_hours (weekday, opens_at, closes_at) values (1, '08:00', '09:00')",
      "delete from public.closure_overrides",
      "insert into public.appointment_types (name, duration_minutes) values ('Direct', 30)",
    ]) {
      await expect(asStaff(conn, STAFF.admin, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "42501",
      });
    }
  });
});

describe("update_shop_settings (D35: no time zone or currency; D37 limits)", () => {
  it("has no timezone or currency parameter, and an owner write of an unknown time zone is refused", async () => {
    const args = await scalar<string>(
      conn,
      `select pg_get_function_identity_arguments('public.update_shop_settings(integer, integer, integer, integer, integer, integer, text)'::regprocedure)`,
    );
    expect(args).not.toMatch(/timezone|currency/);
    await inTransaction(conn, async (tx) => {
      await failsWith(
        tx,
        () => tx.query("update public.shop_settings set timezone = 'Nowhere/Land' where id = 1"),
        p0001("shop_timezone_invalid"),
      );
      await tx.query("update public.shop_settings set timezone = '  Asia/Singapore ' where id = 1");
      expect(await scalar(tx, "select timezone from public.shop_settings")).toBe("Asia/Singapore");
    });
  });

  it("null keeps a field, values round-trip (customer_cancel_cutoff_minutes too), '' clears the public site URL", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, ADMIN);
      const before = (await tx.query("select * from public.shop_settings")).rows[0];
      const set = (sql: string, params: unknown[] = []) =>
        tx.query(`select (s).* from (select ${sql} s) x`, params).then((r) => r.rows[0]);
      const a = await set(
        "public.update_shop_settings(customer_cancel_cutoff_minutes => 240, public_site_url => 'https://bicii.example')",
      );
      expect(a).toMatchObject({
        customer_cancel_cutoff_minutes: 240,
        public_site_url: "https://bicii.example",
        intake_slot_minutes: before.intake_slot_minutes,
        intake_capacity_units: before.intake_capacity_units,
        updated_by: STAFF.admin,
      });
      const b = await set("public.update_shop_settings(booking_horizon_days => 30)");
      expect(b).toMatchObject({ customer_cancel_cutoff_minutes: 240, booking_horizon_days: 30 });
      const c = await set("public.update_shop_settings(public_site_url => '')");
      expect(c.public_site_url).toBeNull();
      await failsWith(
        tx,
        () =>
          tx.query("select public.update_shop_settings(customer_cancel_cutoff_minutes => 10081)"),
        { code: "23514", constraint: "shop_settings_cancel_cutoff_check" },
      );
      await failsWith(
        tx,
        () => tx.query("select public.update_shop_settings(intake_slot_minutes => 7)"),
        { code: "23514", constraint: "shop_settings_slot_minutes_check" },
      );
      await failsWith(
        tx,
        () => tx.query("select public.update_shop_settings(public_site_url => 'not a url')"),
        { code: "23514", constraint: "shop_settings_public_site_url_check" },
      );
    });
  });

  it("refuses a capacity below an active type's units (shop_capacity_below_type); inactive types do not count", async () => {
    await inTransaction(conn, async (tx) => {
      await tx.query("update public.shop_settings set intake_capacity_units = 6 where id = 1");
      const big = await makeType(tx, { capacityUnits: 6 });
      await makeType(tx, { capacityUnits: 50, active: false });
      await actAs(tx, ADMIN);
      await failsWith(
        tx,
        () => tx.query("select public.update_shop_settings(intake_capacity_units => 5)"),
        p0001("shop_capacity_below_type"),
      );
      await ownerMode(tx);
      await tx.query("update public.appointment_types set active = false where id = $1", [big]);
      const maxActive = await scalar<number>(
        tx,
        "select coalesce(max(capacity_units), 1)::int from public.appointment_types where active",
      );
      await actAs(tx, ADMIN);
      await tx.query("select public.update_shop_settings(intake_capacity_units => $1)", [
        maxActive,
      ]);
      expect(await scalar(tx, "select intake_capacity_units from public.shop_settings")).toBe(
        maxActive,
      );
    });
  });

  it("the settings row cannot be deleted, even by the owner", async () => {
    await inTransaction(conn, async (tx) => {
      await failsWith(
        tx,
        () => tx.query("delete from public.shop_settings"),
        p0001("shop_settings_required"),
      );
    });
  });
});

describe("set_shop_hours replaces a weekday atomically", () => {
  it("replaces the rows, rejects overlaps and bad input, and a replay appends no events", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, ADMIN);
      const setHours = (weekday: number, intervals: unknown, active = true) =>
        tx
          .query<{ weekday: number; opens_at: string; closes_at: string; active: boolean }>(
            "select weekday, opens_at::text, closes_at::text, active from public.set_shop_hours($1::smallint, $2::jsonb, $3)",
            [weekday, JSON.stringify(intervals), active],
          )
          .then((r) => r.rows);
      const count = () => scalar<number>(tx, "select count(*)::int from public.schedule_events");

      const rows = await setHours(1, [
        { opens_at: "13:00", closes_at: "24:00" },
        { opens_at: "08:00", closes_at: "12:00" },
      ]);
      expect(rows).toEqual([
        { weekday: 1, opens_at: "08:00:00", closes_at: "12:00:00", active: true },
        { weekday: 1, opens_at: "13:00:00", closes_at: "24:00:00", active: true },
      ]);
      const afterFirst = await count();
      // The same intervals and flag again: the same rows, no events.
      expect(
        await setHours(1, [
          { opens_at: "08:00", closes_at: "12:00" },
          { opens_at: "13:00", closes_at: "24:00" },
        ]),
      ).toEqual(rows);
      expect(await count()).toBe(afterFirst);
      // Deactivating keeps the intervals.
      expect(
        (await setHours(1, [{ opens_at: "08:00", closes_at: "12:00" }], false)).map(
          (r) => r.active,
        ),
      ).toEqual([false]);

      await failsWith(
        tx,
        () =>
          setHours(1, [
            { opens_at: "08:00", closes_at: "12:00" },
            { opens_at: "11:30", closes_at: "14:00" },
          ]),
        p0001("shop_hours_overlap"),
      );
      for (const bad of [
        { not: "an array" },
        [{ opens_at: "8:00", closes_at: "12:00" }],
        [{ opens_at: "08:00" }],
        [{ opens_at: "08:00", closes_at: "25:00" }],
        ["08:00-12:00"],
        Array(5).fill({ opens_at: "08:00", closes_at: "09:00" }),
      ]) {
        await failsWith(tx, () => setHours(1, bad), { code: "22023" });
      }
      await failsWith(tx, () => setHours(7, []), { code: "22023" });
      await failsWith(tx, () => setHours(1, [{ opens_at: "12:00", closes_at: "08:00" }]), {
        code: "23514",
        constraint: "shop_hours_interval_check",
      });
      // Nothing above changed the rows.
      expect(await setHours(1, [{ opens_at: "08:00", closes_at: "12:00" }], false)).toHaveLength(1);
      // An empty list closes the weekday.
      expect(await setHours(1, [])).toEqual([]);
    });
  });

  it("the overlap rule holds for every writer", async () => {
    await inTransaction(conn, async (tx) => {
      await tx.query("delete from public.shop_hours where weekday = 1");
      await tx.query(
        "insert into public.shop_hours (weekday, opens_at, closes_at) values (1, '09:00', '12:00')",
      );
      await failsWith(
        tx,
        () =>
          tx.query(
            "insert into public.shop_hours (weekday, opens_at, closes_at) values (1, '11:00', '13:00')",
          ),
        p0001("shop_hours_overlap"),
      );
    });
  });
});

describe("Closures (D38): shapes, idempotency and deletion with a reason", () => {
  it("whole days, part of one day and custom hours store the documented Singapore instants", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, ADMIN);
      const whole = await saveClosure(tx, {
        id: randomUUID(),
        isNew: true,
        kind: "closed",
        first: "2031-03-04",
        last: "2031-03-06",
        reason: "  Stocktake  ",
      });
      expect(whole).toMatchObject({
        kind: "closed",
        opens_at: null,
        closes_at: null,
        reason: "Stocktake",
      });
      expect(iso(whole.starts_at)).toBe("2031-03-03T16:00:00.000Z");
      expect(iso(whole.ends_at)).toBe("2031-03-06T16:00:00.000Z");
      expect(whole.created_by).toBe(STAFF.admin);

      const part = await saveClosure(tx, {
        id: randomUUID(),
        isNew: true,
        kind: "closed",
        first: "2031-03-10",
        last: "2031-03-10",
        reason: "Staff training",
        from: "14:00",
        to: "24:00",
      });
      expect(iso(part.starts_at)).toBe("2031-03-10T06:00:00.000Z");
      expect(iso(part.ends_at)).toBe("2031-03-10T16:00:00.000Z");

      const custom = await saveClosure(tx, {
        id: randomUUID(),
        isNew: true,
        kind: "custom_hours",
        first: "2031-03-11",
        last: "2031-03-12",
        reason: "Short days",
        from: "10:00",
        to: "14:00",
      });
      expect(custom).toMatchObject({ opens_at: "10:00:00", closes_at: "14:00:00" });
      expect(iso(custom.starts_at)).toBe("2031-03-10T16:00:00.000Z");
      expect(iso(custom.ends_at)).toBe("2031-03-12T16:00:00.000Z");

      // A closed day may sit inside custom hours; two custom-hours ranges may not overlap.
      await saveClosure(tx, {
        id: randomUUID(),
        isNew: true,
        kind: "closed",
        first: "2031-03-12",
        last: "2031-03-12",
        reason: "Closed after all",
      });
      await failsWith(
        tx,
        () =>
          saveClosure(tx, {
            id: randomUUID(),
            isNew: true,
            kind: "custom_hours",
            first: "2031-03-12",
            last: "2031-03-13",
            reason: "Overlap",
            from: "09:00",
            to: "12:00",
          }),
        p0001("closure_custom_hours_overlap"),
      );
      // Editing custom hours over its own days is not an overlap.
      const edited = await saveClosure(tx, {
        id: custom.id,
        isNew: false,
        kind: "custom_hours",
        first: "2031-03-11",
        last: "2031-03-13",
        reason: "Short days",
        from: "10:00",
        to: "15:00",
      });
      expect(iso(edited.ends_at)).toBe("2031-03-13T16:00:00.000Z");
    });
  });

  it("refuses bad ranges and reasons", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, ADMIN);
      const base = { id: randomUUID(), isNew: true, reason: "Test" } as const;
      for (const bad of [
        { kind: "closed", first: "2031-03-05", last: "2031-03-04" },
        { kind: "closed", first: "2031-03-04", last: "2031-03-04", from: "10:00" },
        { kind: "closed", first: "2031-03-04", last: "2031-03-05", from: "10:00", to: "12:00" },
        { kind: "closed", first: "2031-03-04", last: "2031-03-04", from: "12:00", to: "10:00" },
        { kind: "custom_hours", first: "2031-03-04", last: "2031-03-04" },
        {
          kind: "custom_hours",
          first: "2031-03-04",
          last: "2031-03-04",
          from: "12:00",
          to: "12:00",
        },
        { kind: "closed", first: "2031-01-01", last: "2032-01-02" },
      ] as const) {
        await failsWith(
          tx,
          () => saveClosure(tx, { ...base, ...bad }),
          p0001("closure_invalid_range"),
        );
      }
      // 366 days is the most.
      await saveClosure(tx, { ...base, kind: "closed", first: "2031-01-01", last: "2032-01-01" });
      for (const reason of [null, "", "  "]) {
        await failsWith(
          tx,
          () =>
            saveClosure(tx, {
              ...base,
              id: randomUUID(),
              kind: "closed",
              first: "2031-03-04",
              last: "2031-03-04",
              reason,
            }),
          p0001("reason_required"),
        );
      }
      await failsWith(
        tx,
        () =>
          saveClosure(tx, {
            ...base,
            id: randomUUID(),
            kind: "closed",
            first: "2031-03-04",
            last: "2031-03-04",
            reason: "x".repeat(201),
          }),
        { code: "23514", constraint: "closure_overrides_reason_check" },
      );
    });
  });

  it("is_new replays return the row with no event; a late create replay after an edit is closure_conflict; editing a missing id is P0002", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, ADMIN);
      const id = randomUUID();
      const create = {
        id,
        isNew: true,
        kind: "closed",
        first: "2031-04-01",
        last: "2031-04-01",
        reason: "Holiday",
      } as const;
      const first = await saveClosure(tx, create);
      expect(await saveClosure(tx, create)).toEqual(first);
      expect((await scheduleEvents(tx, "closure_override", id)).map((e) => e.event_type)).toEqual([
        "created",
      ]);
      // Editing with the same values: no event.
      expect(await saveClosure(tx, { ...create, isNew: false })).toEqual(first);
      const edited = await saveClosure(tx, { ...create, isNew: false, reason: "Public holiday" });
      expect(edited.reason).toBe("Public holiday");
      await failsWith(tx, () => saveClosure(tx, create), p0001("closure_conflict"));
      expect(
        (await tx.query("select reason from public.closure_overrides where id = $1", [id])).rows[0]
          .reason,
      ).toBe("Public holiday");
      const events = await scheduleEvents(tx, "closure_override", id);
      expect(events.map((e) => e.event_type)).toEqual(["created", "updated"]);
      expect(events[1].payload).toEqual({ reason: { from: "Holiday", to: "Public holiday" } });
      expect(events.every((e) => e.actor_staff_id === STAFF.admin)).toBe(true);
      await failsWith(tx, () => saveClosure(tx, { ...create, id: randomUUID(), isNew: false }), {
        code: "P0002",
      });
    });
  });

  it("deleting needs a reason, returns the deleted row, then null on replay; history keeps the row and reason", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, ADMIN);
      const id = randomUUID();
      await saveClosure(tx, {
        id,
        isNew: true,
        kind: "closed",
        first: "2031-04-02",
        last: "2031-04-02",
        reason: "Holiday",
      });
      const del = (reason: string | null) =>
        tx
          .query<ClosureRow & { gone: boolean }>(
            "select (c).*, (c).id is null as gone from (select public.delete_closure_override($1, $2) c) s",
            [id, reason],
          )
          .then((r) => r.rows[0]);
      for (const reason of [null, "", " "]) {
        await failsWith(tx, () => del(reason), p0001("reason_required"));
      }
      await failsWith(tx, () => del("x".repeat(501)), p0001("reason_too_long"));
      const deleted = await del("  Opened after all  ");
      expect(deleted).toMatchObject({ id, reason: "Holiday", gone: false });
      expect((await del("Again")).gone).toBe(true);
      const events = await scheduleEvents(tx, "closure_override", id);
      expect(events.map((e) => e.event_type)).toEqual(["created", "deleted"]);
      expect(events[1]).toMatchObject({ reason: "Opened after all", actor_staff_id: STAFF.admin });
      expect(events[1].payload).toMatchObject({ id, reason: "Holiday", kind: "closed" });
      // The reason does not leak into later writes of the transaction.
      await ownerMode(tx);
      expect(await scalar(tx, "select private.change_reason()")).toBeNull();
    });
  });
});

describe("Appointment types: idempotent saves, capacity and names", () => {
  it("is_new replays return the row with no event; a late create replay after an edit is appointment_type_conflict; P0002 for a missing edit", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, ADMIN);
      const id = randomUUID();
      const name = `Wheel build ${id.slice(0, 6)}`;
      const create = { id, isNew: true, name, description: " Spokes ", duration: 120, units: 2 };
      const first = await saveType(tx, create);
      expect(first).toMatchObject({
        name,
        description: "Spokes",
        duration_minutes: 120,
        capacity_units: 2,
      });
      expect(await saveType(tx, create)).toEqual(first);
      const edited = await saveType(tx, { ...create, isNew: false, duration: 90 });
      expect(edited.duration_minutes).toBe(90);
      await failsWith(tx, () => saveType(tx, create), p0001("appointment_type_conflict"));
      expect(
        await scalar(tx, "select duration_minutes from public.appointment_types where id = $1", [
          id,
        ]),
      ).toBe(90);
      const events = await scheduleEvents(tx, "appointment_type", id);
      expect(events.map((e) => e.event_type)).toEqual(["created", "updated"]);
      expect(events[1].payload).toEqual({ duration_minutes: { from: 120, to: 90 } });
      await failsWith(tx, () => saveType(tx, { ...create, id: randomUUID(), isNew: false }), {
        code: "P0002",
      });
    });
  });

  it("an active type cannot take more units than the shop; names are unique ignoring case; checks hold", async () => {
    await inTransaction(conn, async (tx) => {
      const capacity = await scalar<number>(
        tx,
        "select intake_capacity_units from public.shop_settings",
      );
      await actAs(tx, ADMIN);
      const name = `Fitting ${randomUUID().slice(0, 6)}`;
      await failsWith(
        tx,
        () => saveType(tx, { id: randomUUID(), isNew: true, name, units: capacity + 1 }),
        p0001("appointment_type_capacity_too_large"),
      );
      // Inactive, it may wait for the capacity to grow.
      await saveType(tx, {
        id: randomUUID(),
        isNew: true,
        name: `${name} later`,
        units: capacity + 1,
        active: false,
      });
      await saveType(tx, { id: randomUUID(), isNew: true, name });
      await failsWith(
        tx,
        () => saveType(tx, { id: randomUUID(), isNew: true, name: name.toUpperCase() }),
        {
          code: "23505",
          constraint: "appointment_types_name_key",
        },
      );
      await failsWith(
        tx,
        () => saveType(tx, { id: randomUUID(), isNew: true, name: `${name} odd`, duration: 7 }),
        {
          code: "23514",
          constraint: "appointment_types_duration_check",
        },
      );
    });
  });
});

describe("History: schedule_events", () => {
  it("one event per real change with its actor; no-ops append nothing; append-only", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, ADMIN);
      const before = await scheduleEvents(tx, "shop_settings", null);
      await tx.query("select public.update_shop_settings(booking_min_notice_minutes => 90)");
      await tx.query("select public.update_shop_settings(booking_min_notice_minutes => 90)");
      await tx.query("select public.update_shop_settings()");
      const after = await scheduleEvents(tx, "shop_settings", null);
      expect(after.length).toBe(before.length + 1);
      expect(after.at(-1)).toMatchObject({
        event_type: "updated",
        actor_staff_id: STAFF.admin,
        payload: { booking_min_notice_minutes: { from: 120, to: 90 } },
      });
      await ownerMode(tx);
      await failsWith(
        tx,
        () => tx.query("update public.schedule_events set reason = 'x'"),
        p0001("schedule_history_append_only"),
      );
      await failsWith(
        tx,
        () => tx.query("delete from public.schedule_events"),
        p0001("schedule_history_append_only"),
      );
    });
  });
});

describe("D38 APPT-GRID: settings changes never move, shrink or cancel existing appointments", () => {
  it("slot length, capacity, hours, closures and type changes leave a booked appointment as it was", async () => {
    await inTransaction(conn, async (tx) => {
      await standardSchedule(tx);
      const day = await futureDay(tx);
      const typeId = await makeType(tx, { durationMinutes: 30, capacityUnits: 1 });
      const customerId = await makeCustomer(tx);
      await actAs(tx, ADMIN);
      const booked = await book(tx, { customerId, typeId, startsAt: sgt(day, "10:00") });
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      await tx.query("select public.update_shop_settings(intake_slot_minutes => 60)");
      await tx.query("select * from public.set_shop_hours($1::smallint, '[]'::jsonb)", [weekday]);
      await saveClosure(tx, {
        id: randomUUID(),
        isNew: true,
        kind: "closed",
        first: day,
        last: addDays(day, 1),
        reason: "Flood",
      });
      await tx.query(
        `select public.save_appointment_type($1, false, (select name from public.appointment_types where id = $1), null, 45, 1, true, true)`,
        [typeId],
      );
      const after = await appointment(tx, booked.id);
      expect(after).toMatchObject({ status: "booked", capacity_units: 1 });
      expect(after.starts_at).toEqual(booked.starts_at);
      expect(after.ends_at).toEqual(booked.ends_at);
      expect(after.updated_at).toEqual(booked.updated_at);
    });
  });
});
