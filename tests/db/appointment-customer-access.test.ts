/**
 * Customers and their own appointments: the contract the public site
 * (Phase 11) consumes (SPEC §4.2, §6, §23 "Customers cannot read internal
 * notes ...", §27.2 "RLS: customer A cannot read customer B"; DATA-MODEL
 * §15 "Customer access pattern"; PLAN D8, D12, D37, D42). Template:
 * customer-access.test.ts. Customers get logins with linkCustomerLogin
 * inside each rolled-back transaction.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, BIKE, CUSTOMER, STAFF } from "../fixtures/ids";
import {
  MY_APPOINTMENT_COLUMNS,
  addDays,
  appointment,
  appointmentEvents,
  book,
  bookMine,
  cancelMine,
  futureDay,
  insertAppointment,
  makeType,
  setHours,
  sgt,
  shopToday,
  standardSchedule,
  type MyAppointmentRow,
} from "./appointment-fixtures";
import { customerClaims, linkCustomerLogin } from "./customer-fixtures";
import { actAs, asAnon, asStaff, connect, inTransaction, scalar, staffClaims } from "./harness";
import { failsWith, makeCustomer, ownerMode } from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const ADMIN = staffClaims(AUTH_USER.admin);
const p0001 = (message: string) => ({ code: "P0001", message });

const myAppointments = (tx: pg.Client, includePast?: boolean) =>
  tx
    .query<MyAppointmentRow>(
      includePast === undefined
        ? "select * from public.my_appointments()"
        : "select * from public.my_appointments($1)",
      includePast === undefined ? [] : [includePast],
    )
    .then((r) => r.rows);

/** Two fresh customers with logins, the standard schedule, a public type and a future day. */
async function twoCustomers(tx: pg.Client) {
  await standardSchedule(tx);
  const day = await futureDay(tx);
  const typeId = await makeType(tx, {
    durationMinutes: 30,
    name: `Online check ${randomUUID().slice(0, 6)}`,
  });
  const a = await makeCustomer(tx, "Customer A");
  const b = await makeCustomer(tx, "Customer B");
  const authA = await linkCustomerLogin(tx, a);
  const authB = await linkCustomerLogin(tx, b);
  return { day, typeId, a, b, authA, authB };
}

describe("RLS: customer A cannot read B (appointments, Phase 2)", () => {
  it("a signed-in customer reads zero rows from every appointment and schedule table, even with their own booking", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, authA } = await twoCustomers(tx);
      await actAs(tx, customerClaims(authA));
      await bookMine(tx, { typeId, startsAt: sgt(day, "10:00"), customerNote: "Mine" });
      for (const table of [
        "appointments",
        "appointment_events",
        "appointment_types",
        "shop_hours",
        "closure_overrides",
        "shop_settings",
        "schedule_events",
      ]) {
        expect(await scalar(tx, `select count(*)::int from public.${table}`), table).toBe(0);
      }
    });
  });

  it("my_appointments returns only their own rows, upcoming soonest first; include_past adds the past, latest first", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, a, b, authA } = await twoCustomers(tx);
      const today = await shopToday(tx);
      const ins = (
        customerId: string,
        d: string,
        time: string,
        status: "booked" | "completed" = "booked",
      ) =>
        insertAppointment(tx, {
          customerId,
          typeId,
          startsAt: sgt(d, time),
          endsAt: sgt(d, `${time.slice(0, 2)}:30`),
          status,
        });
      const later = await ins(a, addDays(day, 1), "10:00");
      const sooner = await ins(a, day, "11:00");
      const lastWeek = await ins(a, addDays(today, -7), "10:00", "completed");
      const lastMonth = await ins(a, addDays(today, -30), "10:00", "completed");
      await ins(b, day, "12:00");
      await actAs(tx, customerClaims(authA));
      const upcoming = await myAppointments(tx);
      expect(upcoming.map((r) => r.id)).toEqual([sooner, later]);
      expect(await myAppointments(tx, false)).toEqual(upcoming);
      expect((await myAppointments(tx, true)).map((r) => r.id)).toEqual([
        sooner,
        later,
        lastWeek,
        lastMonth,
      ]);
      for (const row of await myAppointments(tx, true)) {
        expect(Object.keys(row)).toEqual([...MY_APPOINTMENT_COLUMNS]);
      }
    });
  });

  it("shows exactly the D42 fields: never the internal note, cancellation reason, units, source or actors", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, a, authA } = await twoCustomers(tx);
      await actAs(tx, ADMIN);
      const staffMade = await book(tx, {
        customerId: a,
        typeId,
        startsAt: sgt(day, "10:00"),
        customerNote: "Brakes rub",
        internalNote: "Haggles on price",
      });
      await actAs(tx, customerClaims(authA));
      const [row] = await myAppointments(tx);
      expect(row).toMatchObject({
        id: staffMade.id,
        appointment_type_id: typeId,
        status: "booked",
        customer_note: "Brakes rub",
        bike_id: null,
        cancelled_at: null,
        cancelled_via: null,
        can_cancel: true,
      });
      expect(row.appointment_type_name).toMatch(/^Online check/);
      expect(JSON.stringify(row)).not.toMatch(/Haggles/);
    });
  });

  it("D12: the bike shows only while it is still theirs and not archived", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, a, b, authA } = await twoCustomers(tx);
      await actAs(tx, ADMIN);
      await tx.query("select public.transfer_bike_ownership($1, $2, 'Bought it')", [
        BIKE.hafizBrompton,
        a,
      ]);
      await actAs(tx, customerClaims(authA));
      const mine = await bookMine(tx, {
        typeId,
        startsAt: sgt(day, "10:00"),
        bikeId: BIKE.hafizBrompton,
      });
      const bike = (
        await (async () => {
          await ownerMode(tx);
          return tx.query<{ short_id: string; brand: string; model: string }>(
            "select short_id, brand, model from public.bikes where id = $1",
            [BIKE.hafizBrompton],
          );
        })()
      ).rows[0];
      expect(mine).toMatchObject({
        bike_id: BIKE.hafizBrompton,
        bike_short_id: bike.short_id,
        bike_title: `${bike.brand} ${bike.model}`,
      });
      // Archived: hidden.
      await tx.query("update public.bikes set archived_at = now() where id = $1", [
        BIKE.hafizBrompton,
      ]);
      await actAs(tx, customerClaims(authA));
      expect((await myAppointments(tx))[0]).toMatchObject({
        bike_id: null,
        bike_short_id: null,
        bike_title: null,
      });
      // Unarchived and transferred to someone else: hidden from the previous owner.
      await ownerMode(tx);
      await tx.query("update public.bikes set archived_at = null where id = $1", [
        BIKE.hafizBrompton,
      ]);
      await actAs(tx, ADMIN);
      await tx.query("select public.transfer_bike_ownership($1, $2, 'Sold on')", [
        BIKE.hafizBrompton,
        b,
      ]);
      await actAs(tx, customerClaims(authA));
      const [after] = await myAppointments(tx);
      expect(after).toMatchObject({
        id: mine.id,
        bike_id: null,
        bike_short_id: null,
        bike_title: null,
      });
    });
  });
});

describe("D37 APPT-SELF-BOOKING: book_my_appointment books for the caller only", () => {
  it("books with source customer and the caller's login; another customer's or an unknown bike is appointment_bike_not_owned", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, a, authA } = await twoCustomers(tx);
      await ownerMode(tx);
      await tx.query("select private.set_change_reason('Test')");
      await tx.query("update public.bikes set customer_id = $2 where id = $1", [
        BIKE.hafizDahon,
        a,
      ]);
      await tx.query("update public.bikes set archived_at = now() where id = $1", [
        BIKE.hafizDahon,
      ]);
      await tx.query("select private.set_change_reason(null)");
      await actAs(tx, customerClaims(authA));
      for (const bikeId of [BIKE.priyaDomane, randomUUID()]) {
        await failsWith(tx, () => bookMine(tx, { typeId, startsAt: sgt(day, "10:00"), bikeId }), {
          ...p0001("appointment_bike_not_owned"),
          detail: "Pick one of your own bikes.",
        });
      }
      await failsWith(
        tx,
        () => bookMine(tx, { typeId, startsAt: sgt(day, "10:00"), bikeId: BIKE.hafizDahon }),
        p0001("appointment_bike_archived"),
      );
      const mine = await bookMine(tx, {
        typeId,
        startsAt: sgt(day, "10:00"),
        customerNote: "  Gears  ",
      });
      expect(mine.customer_note).toBe("Gears");
      const stored = await appointment(tx, mine.id);
      expect(stored).toMatchObject({
        customer_id: a,
        source: "customer",
        created_by_user_id: authA,
        created_by_staff_id: null,
        internal_note: null,
      });
      const [event] = await appointmentEvents(tx, mine.id);
      expect(event).toMatchObject({
        event_type: "booked",
        actor_user_id: authA,
        actor_staff_id: null,
      });
      expect(event.payload).toMatchObject({ source: "customer" });
    });
  });
});

describe("D37 APPT-SELF-BOOKING: cancel_my_appointment", () => {
  it("someone else's appointment returns NULL and changes nothing", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, authA, authB } = await twoCustomers(tx);
      await actAs(tx, customerClaims(authB));
      const theirs = await bookMine(tx, { typeId, startsAt: sgt(day, "10:00") });
      await actAs(tx, customerClaims(authA));
      expect(await cancelMine(tx, theirs.id)).toBeNull();
      expect(await cancelMine(tx, randomUUID())).toBeNull();
      expect((await appointment(tx, theirs.id)).status).toBe("booked");
      expect(await appointmentEvents(tx, theirs.id)).toHaveLength(1);
    });
  });

  it("cancels their own (also a staff-made one) with the default reason, cancelled_via customer; a replay adds no event", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, a, authA } = await twoCustomers(tx);
      await actAs(tx, ADMIN);
      const staffMade = await book(tx, { customerId: a, typeId, startsAt: sgt(day, "11:00") });
      await tx.query("select public.mark_appointment_status($1, 'confirmed')", [staffMade.id]);
      await actAs(tx, customerClaims(authA));
      const online = await bookMine(tx, { typeId, startsAt: sgt(day, "10:00") });
      expect(online.can_cancel).toBe(true);
      await failsWith(
        tx,
        () => cancelMine(tx, online.id, "x".repeat(501)),
        p0001("reason_too_long"),
      );
      const cancelled = await cancelMine(tx, online.id);
      expect(cancelled).toMatchObject({
        id: online.id,
        status: "cancelled",
        cancelled_via: "customer",
        can_cancel: false,
      });
      expect(cancelled?.cancelled_at).not.toBeNull();
      const stored = await appointment(tx, online.id);
      expect(stored).toMatchObject({
        cancellation_reason: "Cancelled by the customer",
        cancelled_via: "customer",
      });
      expect(await cancelMine(tx, online.id, "Again")).toEqual(cancelled);
      const events = await appointmentEvents(tx, online.id);
      expect(events.map((e) => e.event_type)).toEqual(["booked", "cancelled"]);
      expect(events[1]).toMatchObject({
        reason: "Cancelled by the customer",
        payload: { via: "customer" },
        actor_user_id: authA,
        actor_staff_id: null,
      });
      // The staff-made, confirmed one: theirs to cancel too, with their own words.
      const second = await cancelMine(tx, staffMade.id, " Away that week ");
      expect(second).toMatchObject({ status: "cancelled", cancelled_via: "customer" });
      expect((await appointment(tx, staffMade.id)).cancellation_reason).toBe("Away that week");
    });
  });

  it("inside the cutoff, after the start or once arrived it is appointment_not_cancellable (can_cancel false); outside the cutoff can_cancel is true", async () => {
    await inTransaction(conn, async (tx) => {
      const { typeId, a, authA } = await twoCustomers(tx);
      const at = (offset: string, plusMinutes = 0) =>
        scalar<string>(
          tx,
          `select to_char((now() + $1::interval + make_interval(mins => $2)) at time zone 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          [offset, plusMinutes],
        );
      const ins = async (
        startOffset: string,
        status: "booked" | "confirmed" | "arrived" = "booked",
      ) =>
        insertAppointment(tx, {
          customerId: a,
          typeId,
          startsAt: await at(startOffset),
          endsAt: await at(startOffset, 30),
          status,
        });
      const insideCutoff = await ins("60 minutes");
      const started = await ins("-10 minutes");
      const arrived = await ins("3 hours", "arrived");
      const outside = await ins("3 hours", "confirmed");
      await actAs(tx, customerClaims(authA));
      const rows = new Map((await myAppointments(tx)).map((r) => [r.id, r]));
      expect(rows.get(insideCutoff)?.can_cancel).toBe(false);
      expect(rows.get(started)?.can_cancel).toBe(false);
      expect(rows.get(arrived)?.can_cancel).toBe(false);
      expect(rows.get(outside)?.can_cancel).toBe(true);
      for (const id of [insideCutoff, started, arrived]) {
        await failsWith(tx, () => cancelMine(tx, id), p0001("appointment_not_cancellable"));
      }
      expect(await cancelMine(tx, outside)).toMatchObject({ status: "cancelled" });
    });
  });

  it("the cutoff follows customer_cancel_cutoff_minutes", async () => {
    await inTransaction(conn, async (tx) => {
      const { typeId, a, authA } = await twoCustomers(tx);
      await tx.query(
        "update public.shop_settings set customer_cancel_cutoff_minutes = 0 where id = 1",
      );
      const startsAt = await scalar<string>(tx, "select (now() + interval '5 minutes')::text");
      const endsAt = await scalar<string>(tx, "select (now() + interval '35 minutes')::text");
      const id = await insertAppointment(tx, { customerId: a, typeId, startsAt, endsAt });
      await actAs(tx, customerClaims(authA));
      expect((await myAppointments(tx)).find((r) => r.id === id)?.can_cancel).toBe(true);
      expect(await cancelMine(tx, id)).toMatchObject({ status: "cancelled" });
    });
  });
});

describe("Staff and the customer appointment RPCs", () => {
  it("staff without a customers row get nothing from my_appointments and 42501 from booking and cancelling", async () => {
    await asStaff(conn, STAFF.mechanic1, async (tx) => {
      expect(await myAppointments(tx, true)).toEqual([]);
    });
    for (const sql of [
      `select public.book_my_appointment('${randomUUID()}', '${randomUUID()}', now())`,
      `select public.cancel_my_appointment('${randomUUID()}')`,
    ]) {
      await expect(asStaff(conn, STAFF.mechanic1, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "42501",
      });
    }
  });
});

describe("Anonymous sees public appointment types only (PLAN Phase 2)", () => {
  it("public_appointment_types lists only active public types, without capacity units; public_shop_hours the active rows", async () => {
    await inTransaction(conn, async (tx) => {
      const tag = randomUUID().slice(0, 6);
      const shown = await makeType(tx, {
        name: `Public ${tag}`,
        public: true,
        active: true,
        capacityUnits: 2,
      });
      const inactive = await makeType(tx, { name: `Retired ${tag}`, public: true, active: false });
      const internal = await makeType(tx, { name: `Internal ${tag}`, public: false, active: true });
      await setHours(tx, [
        { weekday: 2, opens: "13:00", closes: "18:00", active: true },
        { weekday: 2, opens: "09:00", closes: "12:00", active: true },
        { weekday: 1, opens: "09:00", closes: "18:00", active: false },
        { weekday: 0, opens: "10:00", closes: "16:00", active: true },
      ]);
      await actAs(tx, { role: "anon" });
      const { rows: types } = await tx.query("select * from public.public_appointment_types()");
      for (const row of types)
        expect(Object.keys(row)).toEqual(["id", "name", "description", "duration_minutes"]);
      const ids = types.map((r) => r.id);
      expect(ids).toContain(shown);
      expect(ids).not.toContain(inactive);
      expect(ids).not.toContain(internal);
      const { rows: hours } = await tx.query(
        "select weekday, opens_at::text, closes_at::text from public.public_shop_hours()",
      );
      expect(hours).toEqual([
        { weekday: 0, opens_at: "10:00:00", closes_at: "16:00:00" },
        { weekday: 2, opens_at: "09:00:00", closes_at: "12:00:00" },
        { weekday: 2, opens_at: "13:00:00", closes_at: "18:00:00" },
      ]);
    });
  });

  it("available_slots works for a public type and is empty for a non-public one", async () => {
    await inTransaction(conn, async (tx) => {
      await standardSchedule(tx);
      const day = await futureDay(tx);
      const open = await makeType(tx, { public: true });
      const hidden = await makeType(tx, { public: false });
      await actAs(tx, { role: "anon" });
      const count = (typeId: string) =>
        scalar<number>(tx, "select count(*)::int from public.available_slots($1, $2)", [
          day,
          typeId,
        ]);
      expect(await count(open)).toBe(18);
      expect(await count(hidden)).toBe(0);
    });
  });

  it("cannot execute any staff, admin or my_* appointment RPC and reads no table", async () => {
    const id = randomUUID();
    for (const sql of [
      `select public.book_appointment('${id}', '${CUSTOMER.tan}', '${id}', now())`,
      `select public.mark_appointment_status('${id}', 'arrived')`,
      `select public.cancel_appointment('${id}', 'x')`,
      `select public.update_appointment('${id}')`,
      "select public.update_shop_settings()",
      "select * from public.set_shop_hours(1::smallint, '[]'::jsonb)",
      `select public.save_closure_override('${id}', true, 'closed', current_date, current_date, 'x')`,
      `select public.delete_closure_override('${id}', 'x')`,
      `select public.save_appointment_type('${id}', true, 'x', null, 30, 1, true, true)`,
      "select * from public.my_appointments()",
      `select public.book_my_appointment('${id}', '${id}', now())`,
      `select public.cancel_my_appointment('${id}')`,
      "select * from public.appointments",
      "select * from public.appointment_events",
      "select * from public.appointment_types",
      "select * from public.shop_hours",
      "select * from public.closure_overrides",
      "select * from public.shop_settings",
      "select * from public.schedule_events",
    ]) {
      await expect(
        asAnon(conn, (tx) => tx.query(sql)),
        sql,
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});
