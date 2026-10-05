/**
 * The slot grid and the booking rules as data (SPEC §6, §27.1 "Appointment
 * capacity calculation"; PLAN D2, D37, D38): every case in
 * tests/fixtures/appointment-slot-cases.ts runs through
 * private.available_slots_at and private.appointment_slot_problem inside a
 * rolled-back owner transaction that sets exactly the case's schedule
 * (settings, weekly hours, closures, one fresh type, its appointments), so
 * the seed's schedule never changes a result. Step 3's TypeScript mirror
 * runs the same cases.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import {
  problemCases,
  slotCases,
  type ExpectedSlot,
  type SlotContext,
} from "../fixtures/appointment-slot-cases";
import { AUTH_USER, CUSTOMER, STAFF } from "../fixtures/ids";
import {
  addClosure,
  futureDay,
  insertAppointment,
  makeType,
  setHours,
  setSettings,
  sgt,
  standardSchedule,
} from "./appointment-fixtures";
import { customerClaims, linkCustomerLogin } from "./customer-fixtures";
import { actAs, asAnon, asStaff, connect, inTransaction, staffClaims } from "./harness";
import { makeCustomer, ownerMode } from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

/** Applies a case's schedule as the owner; returns the fresh type's id. */
async function applyContext(tx: pg.Client, c: SlotContext): Promise<string> {
  await setSettings(tx, {
    timezone: c.settings.timezone,
    slotMinutes: c.settings.slotMinutes,
    capacityUnits: c.settings.capacityUnits,
    minNoticeMinutes: c.settings.minNoticeMinutes,
    horizonDays: c.settings.horizonDays,
  });
  await setHours(tx, c.hours);
  for (const closure of c.closures) await addClosure(tx, closure);
  const typeId = await makeType(tx, {
    durationMinutes: c.type.durationMinutes,
    capacityUnits: c.type.capacityUnits,
    public: c.type.public,
    active: c.type.active,
  });
  if (c.appointments.length > 0) {
    const customerId = await makeCustomer(tx);
    const holderType = await makeType(tx, { durationMinutes: 30 });
    for (const a of c.appointments) {
      await insertAppointment(tx, {
        customerId,
        typeId: holderType,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        capacityUnits: a.capacityUnits,
        status: a.status,
      });
    }
  }
  return typeId;
}

const SLOT_SQL = `
  select to_char(s.slot_start at time zone private.shop_timezone(), 'HH24:MI') as start,
         case when (s.slot_end at time zone private.shop_timezone())::date > $1::date then '24:00'
              else to_char(s.slot_end at time zone private.shop_timezone(), 'HH24:MI') end as "end",
         s.remaining_units as remaining
    from private.available_slots_at($1::date, $2::uuid, $3::timestamptz, $4::boolean) s
   order by s.slot_start`;

describe("D38 APPT-GRID: available slots (private.available_slots_at) for every slot case", () => {
  for (const c of slotCases) {
    it(c.name, async () => {
      await inTransaction(conn, async (tx) => {
        const typeId = await applyContext(tx, c);
        const { rows } = await tx.query<ExpectedSlot>(SLOT_SQL, [
          c.day,
          typeId,
          c.asOf,
          c.forStaff,
        ]);
        expect(rows).toEqual(c.expected);
      });
    });
  }
});

describe("D38 APPT-GRID: the first rule a booking breaks (private.appointment_slot_problem), in order", () => {
  for (const c of problemCases) {
    it(c.name, async () => {
      await inTransaction(conn, async (tx) => {
        await applyContext(tx, c);
        const { rows } = await tx.query<{ problem: string | null }>(
          "select private.appointment_slot_problem($1, $2, $3, null) as problem",
          [c.startsAt, c.endsAt, c.capacityUnits],
        );
        expect(rows[0].problem).toBe(c.expected);
      });
    });
  }

  it("every problem code and null are covered by the cases", () => {
    expect(new Set(problemCases.map((c) => c.expected))).toEqual(
      new Set([
        null,
        "appointment_slot_misaligned",
        "appointment_outside_hours",
        "appointment_closed",
        "appointment_capacity_exceeded",
      ]),
    );
  });
});

describe("D37 APPT-SELF-BOOKING: public.available_slots is readable by everyone, units for staff only", () => {
  /** Standard schedule, one public and one staff-only type; returns them and the day. */
  async function setup(tx: pg.Client) {
    await standardSchedule(tx);
    const day = await futureDay(tx);
    const publicType = await makeType(tx, { durationMinutes: 60, public: true });
    const staffType = await makeType(tx, { durationMinutes: 60, public: false });
    const customerId = await makeCustomer(tx);
    const holder = await makeType(tx, { durationMinutes: 30 });
    await insertAppointment(tx, {
      customerId,
      typeId: holder,
      startsAt: sgt(day, "10:00"),
      endsAt: sgt(day, "10:30"),
      capacityUnits: 1,
    });
    return { day, publicType, staffType };
  }

  const slotsOf = (tx: pg.Client, day: string, typeId: string) =>
    tx
      .query<{ slot_start: Date; slot_end: Date; remaining_units: number | null }>(
        "select * from public.available_slots($1, $2)",
        [day, typeId],
      )
      .then((r) => r.rows);

  it("anonymous visitors see public types' times with remaining_units NULL, and nothing for a staff-only type", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, publicType, staffType } = await setup(tx);
      await actAs(tx, { role: "anon" });
      const rows = await slotsOf(tx, day, publicType);
      expect(rows.length).toBe(17); // 09:00 .. 17:00, 60 minutes each
      expect(rows.every((r) => r.remaining_units === null)).toBe(true);
      expect(await slotsOf(tx, day, staffType)).toEqual([]);
    });
  });

  it("a signed-in customer sees the same as an anonymous visitor", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, publicType, staffType } = await setup(tx);
      const auth = await linkCustomerLogin(tx, CUSTOMER.hafiz);
      await actAs(tx, customerClaims(auth));
      const rows = await slotsOf(tx, day, publicType);
      expect(rows.length).toBe(17);
      expect(rows.every((r) => r.remaining_units === null)).toBe(true);
      expect(await slotsOf(tx, day, staffType)).toEqual([]);
    });
  });

  it("staff see every active type with its remaining units", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, publicType, staffType } = await setup(tx);
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
      const rows = await slotsOf(tx, day, publicType);
      expect(rows.map((r) => r.remaining_units)).toEqual([
        2, // 09:00
        1, // 09:30-10:30 overlaps 10:00
        1, // 10:00
        ...Array(14).fill(2),
      ]);
      expect((await slotsOf(tx, day, staffType)).length).toBe(17);
    });
  });

  it("a null day or type is 22004", async () => {
    await expect(
      asAnon(conn, (tx) =>
        tx.query("select * from public.available_slots(null, gen_random_uuid())"),
      ),
    ).rejects.toMatchObject({ code: "22004" });
    await expect(
      asStaff(conn, STAFF.admin, (tx) =>
        tx.query("select * from public.available_slots(current_date, null)"),
      ),
    ).rejects.toMatchObject({ code: "22004" });
  });

  it("the owner-run helpers stay private: anonymous and signed-in callers cannot reach them", async () => {
    for (const sql of [
      "select * from private.available_slots_at(current_date, gen_random_uuid(), now(), true)",
      "select private.appointment_slot_problem(now(), now() + interval '30 minutes', 1, null)",
    ]) {
      await expect(asAnon(conn, (tx) => tx.query(sql))).rejects.toMatchObject({ code: "42501" });
      await expect(asStaff(conn, STAFF.admin, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "42501",
      });
    }
    await inTransaction(conn, async (tx) => {
      await ownerMode(tx);
      await expect(
        tx.query("select private.appointment_slot_problem(null, now(), 1, null)"),
      ).rejects.toMatchObject({ code: "22004" });
    });
  });
});
