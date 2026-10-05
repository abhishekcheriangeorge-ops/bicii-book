/**
 * Appointments: capacity, hours and closures, who may book what and when,
 * idempotency, snapshots, the status machine and history (SPEC §6, §22,
 * §23 "Appointment booking cannot exceed configured capacity", §27.2;
 * PLAN D2, D35, D37, D38, D39).
 *
 * Every test sets the schedule it needs (settings, weekly hours, closures,
 * fresh types) as the owner inside its rolled-back transaction, on a clear
 * Tuesday-Friday at least 21 days ahead unless the case is about today, so
 * the seed's schedule and appointments never change a result.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import {
  APPOINTMENT_STATUSES,
  CANCEL,
  MARK_STATUS,
  triggerOutcome,
  type AppointmentStatus,
  type TransitionOutcome,
} from "../fixtures/appointment-transitions";
import { AUTH_USER, BIKE, CUSTOMER, STAFF } from "../fixtures/ids";
import {
  addClosure,
  addDays,
  appointment,
  appointmentEvents,
  book,
  bookMine,
  cancel,
  currentSlot,
  futureDay,
  insertAppointment,
  makeType,
  markStatus,
  setSettings,
  sgt,
  shopToday,
  standardSchedule,
  unitsUsed,
  type AppointmentRow,
} from "./appointment-fixtures";
import { customerClaims, linkCustomerLogin } from "./customer-fixtures";
import { actAs, asAnon, connect, inTransaction, scalar, staffClaims } from "./harness";
import { failsWith, makeCustomer, ownerMode, tryAndUndo } from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const MECHANIC2 = staffClaims(AUTH_USER.mechanic2);
const ADMIN = staffClaims(AUTH_USER.admin);

const p0001 = (message: string) => ({ code: "P0001", message });

/** Standard schedule, a fresh 30-minute 1-unit public type and a fresh customer, on a clear future day. */
async function basics(tx: pg.Client, skip = 0) {
  await standardSchedule(tx);
  const day = await futureDay(tx, skip);
  const typeId = await makeType(tx, { durationMinutes: 30, capacityUnits: 1 });
  const customerId = await makeCustomer(tx);
  return { day, typeId, customerId };
}

/** All-day custom hours on today, so today's current slot is bookable (owner). */
async function openAllDayToday(tx: pg.Client) {
  const today = await shopToday(tx);
  await addClosure(tx, {
    kind: "custom_hours",
    startsAt: sgt(today, "00:00"),
    endsAt: sgt(addDays(today, 1), "00:00"),
    opens: "00:00",
    closes: "24:00",
  });
  return today;
}

const eventCount = (tx: pg.Client, id: string) =>
  appointmentEvents(tx, id).then((events) => events.length);

describe("SPEC §23 Booking cannot exceed capacity (D2)", () => {
  it("a full window refuses the next booking with appointment_capacity_exceeded", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      await actAs(tx, MECHANIC2);
      await book(tx, { customerId, typeId, startsAt: sgt(day, "10:00") });
      await book(tx, { customerId, typeId, startsAt: sgt(day, "10:00") });
      await failsWith(
        tx,
        () => book(tx, { customerId, typeId, startsAt: sgt(day, "10:00") }),
        p0001("appointment_capacity_exceeded"),
      );
      expect(await unitsUsed(tx, sgt(day, "10:00"), sgt(day, "10:30"))).toBe(2);
      // The window next door is untouched.
      await book(tx, { customerId, typeId, startsAt: sgt(day, "10:30") });
    });
  });

  it("a 60-minute type is blocked by either of the windows it overlaps", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      const longType = await makeType(tx, { durationMinutes: 60, capacityUnits: 1 });
      await actAs(tx, MECHANIC2);
      await book(tx, { customerId, typeId, startsAt: sgt(day, "10:00") });
      await book(tx, { customerId, typeId, startsAt: sgt(day, "10:00") });
      // 09:30-10:30 (second window full) and 10:00-11:00 (first window full).
      for (const start of ["09:30", "10:00"]) {
        await failsWith(
          tx,
          () => book(tx, { customerId, typeId: longType, startsAt: sgt(day, start) }),
          p0001("appointment_capacity_exceeded"),
        );
      }
      await book(tx, { customerId, typeId: longType, startsAt: sgt(day, "10:30") });
    });
  });

  it("a 2-unit type needs two free units in every window", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      const bigType = await makeType(tx, { durationMinutes: 60, capacityUnits: 2 });
      await actAs(tx, MECHANIC2);
      await book(tx, { customerId, typeId, startsAt: sgt(day, "11:30") });
      await failsWith(
        tx,
        () => book(tx, { customerId, typeId: bigType, startsAt: sgt(day, "11:00") }),
        p0001("appointment_capacity_exceeded"),
      );
      const ok = await book(tx, { customerId, typeId: bigType, startsAt: sgt(day, "12:00") });
      expect(ok.capacity_units).toBe(2);
    });
  });

  it("cancelled and no-show appointments free their capacity", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      await actAs(tx, MECHANIC2);
      const a = await book(tx, { customerId, typeId, startsAt: sgt(day, "14:00") });
      const b = await book(tx, { customerId, typeId, startsAt: sgt(day, "14:00") });
      await failsWith(
        tx,
        () => book(tx, { customerId, typeId, startsAt: sgt(day, "14:00") }),
        p0001("appointment_capacity_exceeded"),
      );
      await cancel(tx, a.id, "Customer phoned");
      await book(tx, { customerId, typeId, startsAt: sgt(day, "14:00") });
      // A no-show (written by the owner: the RPC waits for the start).
      await ownerMode(tx);
      await tx.query("update public.appointments set status = 'no_show' where id = $1", [b.id]);
      await actAs(tx, MECHANIC2);
      await book(tx, { customerId, typeId, startsAt: sgt(day, "14:00") });
      expect(await unitsUsed(tx, sgt(day, "14:00"), sgt(day, "14:30"))).toBe(2);
    });
  });
});

describe("Bookings respect shop hours and closures (D38)", () => {
  it("outside hours, crossing closing time, crossing a lunch gap and an inactive weekday are refused", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      const longType = await makeType(tx, { durationMinutes: 60 });
      const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
      await standardSchedule(tx, {}, [
        ...[0, 1, 2, 3, 4, 5, 6]
          .filter((d) => d !== wd)
          .map((weekday) => ({ weekday, opens: "09:00", closes: "18:00", active: true })),
        { weekday: wd, opens: "09:00", closes: "12:00", active: true },
        { weekday: wd, opens: "13:00", closes: "18:00", active: true },
      ]);
      const nextDay = addDays(day, 1);
      // The next day's weekday becomes inactive.
      await ownerMode(tx);
      await tx.query("update public.shop_hours set active = false where weekday = $1", [
        new Date(`${nextDay}T00:00:00Z`).getUTCDay(),
      ]);
      await actAs(tx, MECHANIC2);
      for (const [type, start] of [
        [typeId, sgt(day, "08:30")],
        [typeId, sgt(day, "18:00")],
        [longType, sgt(day, "17:30")],
        [longType, sgt(day, "11:30")],
        [typeId, sgt(nextDay, "10:00")],
      ] as const) {
        await failsWith(
          tx,
          () => book(tx, { customerId, typeId: type, startsAt: start }),
          p0001("appointment_outside_hours"),
        );
      }
      await book(tx, { customerId, typeId: longType, startsAt: sgt(day, "11:00") });
      await book(tx, { customerId, typeId: longType, startsAt: sgt(day, "13:00") });
    });
  });

  it("a closed override refuses bookings, whole day and part of a day", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      const other = await futureDay(tx, 1);
      await addClosure(tx, {
        kind: "closed",
        startsAt: sgt(day, "00:00"),
        endsAt: sgt(addDays(day, 1), "00:00"),
      });
      await addClosure(tx, {
        kind: "closed",
        startsAt: sgt(other, "14:00"),
        endsAt: sgt(other, "16:00"),
      });
      await actAs(tx, MECHANIC2);
      for (const start of [sgt(day, "10:00"), sgt(other, "14:00"), sgt(other, "15:30")]) {
        await failsWith(
          tx,
          () => book(tx, { customerId, typeId, startsAt: start }),
          p0001("appointment_closed"),
        );
      }
      await book(tx, { customerId, typeId, startsAt: sgt(other, "13:30") });
      await book(tx, { customerId, typeId, startsAt: sgt(other, "16:00") });
    });
  });

  it("custom hours replace the weekly hours in both directions", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      // Shorter: 11:00-13:00 instead of 09:00-18:00. Longer: 07:00-21:00 the next day.
      const longer = addDays(day, 1);
      await addClosure(tx, {
        kind: "custom_hours",
        startsAt: sgt(day, "00:00"),
        endsAt: sgt(addDays(day, 1), "00:00"),
        opens: "11:00",
        closes: "13:00",
      });
      await addClosure(tx, {
        kind: "custom_hours",
        startsAt: sgt(longer, "00:00"),
        endsAt: sgt(addDays(longer, 1), "00:00"),
        opens: "07:00",
        closes: "21:00",
      });
      await actAs(tx, MECHANIC2);
      await failsWith(
        tx,
        () => book(tx, { customerId, typeId, startsAt: sgt(day, "10:00") }),
        p0001("appointment_outside_hours"),
      );
      await book(tx, { customerId, typeId, startsAt: sgt(day, "12:30") });
      await book(tx, { customerId, typeId, startsAt: sgt(longer, "07:00") });
      await book(tx, { customerId, typeId, startsAt: sgt(longer, "20:30") });
    });
  });

  it("a start off the grid is appointment_slot_misaligned", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      await actAs(tx, MECHANIC2);
      for (const time of ["10:15", "10:00:30"]) {
        await failsWith(
          tx,
          () => book(tx, { customerId, typeId, startsAt: sgt(day, time) }),
          p0001("appointment_slot_misaligned"),
        );
      }
    });
  });
});

describe("D37 APPT-SELF-BOOKING: types, time limits and the per-customer limit", () => {
  it("an inactive type is appointment_type_unavailable; an unknown one P0002", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, customerId } = await basics(tx);
      const inactive = await makeType(tx, { active: false });
      await actAs(tx, MECHANIC2);
      await failsWith(
        tx,
        () => book(tx, { customerId, typeId: inactive, startsAt: sgt(day, "10:00") }),
        p0001("appointment_type_unavailable"),
      );
      await failsWith(
        tx,
        () => book(tx, { customerId, typeId: randomUUID(), startsAt: sgt(day, "10:00") }),
        { code: "P0002" },
      );
    });
  });

  it("staff cannot book an appointment that is already over, but may book one that has started", async () => {
    await inTransaction(conn, async (tx) => {
      const { typeId, customerId } = await basics(tx);
      const lastWeek = addDays(await shopToday(tx), -7);
      await openAllDayToday(tx);
      const slot = await currentSlot(tx);
      await setSettings(tx, { capacityUnits: 50 });
      await actAs(tx, MECHANIC2);
      await failsWith(
        tx,
        () => book(tx, { customerId, typeId, startsAt: sgt(lastWeek, "10:00") }),
        p0001("appointment_in_past"),
      );
      const started = await book(tx, { customerId, typeId, startsAt: slot.start });
      expect(started.ends_at.toISOString()).toBe(new Date(slot.end).toISOString());
      // Staff need no notice and no public flag.
      const hidden = await makeType(tx, { public: false });
      await book(tx, { customerId, typeId: hidden, startsAt: slot.start });
    });
  });

  it("customers book only public types, with the notice and within the horizon", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      const hidden = await makeType(tx, { public: false });
      const auth = await linkCustomerLogin(tx, customerId);
      const today = await openAllDayToday(tx);
      const slot = await currentSlot(tx);
      const tooFar = addDays(today, 61);
      await setSettings(tx, { capacityUnits: 50 });
      await actAs(tx, customerClaims(auth));
      await failsWith(
        tx,
        () => bookMine(tx, { typeId, startsAt: slot.start }),
        p0001("appointment_too_soon"),
      );
      await failsWith(
        tx,
        () => bookMine(tx, { typeId, startsAt: sgt(tooFar, "10:00") }),
        p0001("appointment_too_far_ahead"),
      );
      await failsWith(
        tx,
        () => bookMine(tx, { typeId: hidden, startsAt: sgt(day, "10:00") }),
        p0001("appointment_type_unavailable"),
      );
      const mine = await bookMine(tx, { typeId, startsAt: sgt(day, "10:00") });
      expect(mine.status).toBe("booked");
    });
  });

  it("the per-customer limit counts only the customer's own upcoming online bookings; staff bookings never count", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      const auth = await linkCustomerLogin(tx, customerId);
      await setSettings(tx, { customerLimit: 2 });
      // Precondition: no upcoming booked/confirmed appointment.
      expect(
        await scalar(
          tx,
          `select count(*)::int from public.appointments
            where customer_id = $1 and status in ('booked', 'confirmed') and starts_at > now()`,
          [customerId],
        ),
      ).toBe(0);
      await actAs(tx, MECHANIC2);
      await book(tx, { customerId, typeId, startsAt: sgt(day, "09:00") });
      await actAs(tx, customerClaims(auth));
      await bookMine(tx, { typeId, startsAt: sgt(day, "10:00") });
      const second = await bookMine(tx, { typeId, startsAt: sgt(day, "11:00") });
      await failsWith(
        tx,
        () => bookMine(tx, { typeId, startsAt: sgt(day, "12:00") }),
        p0001("appointment_customer_limit"),
      );
      // A replay of a booking already made is not a new booking.
      expect((await bookMine(tx, { id: second.id, typeId, startsAt: sgt(day, "11:00") })).id).toBe(
        second.id,
      );
      await actAs(tx, MECHANIC2);
      await book(tx, { customerId, typeId, startsAt: sgt(day, "13:00") });
      // Cancelling one frees a place.
      await cancel(tx, second.id, "Rebooking");
      await actAs(tx, customerClaims(auth));
      await bookMine(tx, { typeId, startsAt: sgt(day, "12:00") });
    });
  });
});

describe("Bikes and customers on a booking", () => {
  it("a bike must be the customer's and not archived; the customer must not be archived", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId } = await basics(tx);
      await ownerMode(tx);
      await tx.query("update public.bikes set archived_at = now() where id = $1", [
        BIKE.tanBrompton,
      ]);
      const archivedCustomer = await makeCustomer(tx);
      await tx.query("update public.customers set archived_at = now() where id = $1", [
        archivedCustomer,
      ]);
      await actAs(tx, MECHANIC2);
      const at = sgt(day, "10:00");
      await failsWith(
        tx,
        () =>
          book(tx, { customerId: CUSTOMER.tan, typeId, startsAt: at, bikeId: BIKE.priyaDomane }),
        p0001("appointment_bike_not_owned"),
      );
      await failsWith(
        tx,
        () =>
          book(tx, { customerId: CUSTOMER.tan, typeId, startsAt: at, bikeId: BIKE.shopCervelo }),
        p0001("appointment_bike_not_owned"),
      );
      await failsWith(
        tx,
        () =>
          book(tx, { customerId: CUSTOMER.tan, typeId, startsAt: at, bikeId: BIKE.tanBrompton }),
        p0001("appointment_bike_archived"),
      );
      await failsWith(
        tx,
        () => book(tx, { customerId: CUSTOMER.tan, typeId, startsAt: at, bikeId: randomUUID() }),
        { code: "P0002" },
      );
      await failsWith(
        tx,
        () => book(tx, { customerId: archivedCustomer, typeId, startsAt: at }),
        p0001("customer_archived"),
      );
      await failsWith(tx, () => book(tx, { customerId: randomUUID(), typeId, startsAt: at }), {
        code: "P0002",
      });
      const ok = await book(tx, {
        customerId: CUSTOMER.tan,
        typeId,
        startsAt: at,
        bikeId: BIKE.tanTarmac,
      });
      expect(ok.bike_id).toBe(BIKE.tanTarmac);
    });
  });
});

describe("Booking is idempotent on its client-made id (SPEC §2)", () => {
  it("the same id with the same arguments returns the same row and one booked event; other arguments are appointment_conflict", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      const other = await makeCustomer(tx);
      await actAs(tx, MECHANIC2);
      const id = randomUUID();
      const first = await book(tx, { id, customerId, typeId, startsAt: sgt(day, "10:00") });
      const again = await book(tx, { id, customerId, typeId, startsAt: sgt(day, "10:00") });
      expect(again).toEqual(first);
      expect((await appointmentEvents(tx, id)).map((e) => e.event_type)).toEqual(["booked"]);
      for (const changed of [
        { customerId, typeId, startsAt: sgt(day, "10:30") },
        { customerId: other, typeId, startsAt: sgt(day, "10:00") },
        { customerId, typeId: await makeType(tx, {}), startsAt: sgt(day, "10:00") },
        // Another day takes another day lock and meets the primary key.
        { customerId, typeId, startsAt: sgt(addDays(day, 1), "10:00") },
      ]) {
        await failsWith(tx, () => book(tx, { id, ...changed }), p0001("appointment_conflict"));
      }
      expect(await eventCount(tx, id)).toBe(1);
    });
  });

  it("a replay after the type is deactivated returns the original row and appends no event", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      await actAs(tx, MECHANIC2);
      const id = randomUUID();
      const first = await book(tx, { id, customerId, typeId, startsAt: sgt(day, "10:00") });
      await ownerMode(tx);
      await tx.query("update public.appointment_types set active = false where id = $1", [typeId]);
      // ... and the shop closed that day since.
      await addClosure(tx, {
        kind: "closed",
        startsAt: sgt(day, "00:00"),
        endsAt: sgt(addDays(day, 1), "00:00"),
      });
      await actAs(tx, MECHANIC2);
      expect(await book(tx, { id, customerId, typeId, startsAt: sgt(day, "10:00") })).toEqual(
        first,
      );
      expect(await eventCount(tx, id)).toBe(1);
    });
  });

  it("a customer's replay after the type stops being public returns the original and appends no event", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      const auth = await linkCustomerLogin(tx, customerId);
      await actAs(tx, customerClaims(auth));
      const id = randomUUID();
      const first = await bookMine(tx, { id, typeId, startsAt: sgt(day, "10:00") });
      await ownerMode(tx);
      await tx.query("update public.appointment_types set public = false where id = $1", [typeId]);
      await actAs(tx, customerClaims(auth));
      expect(await bookMine(tx, { id, typeId, startsAt: sgt(day, "10:00") })).toEqual(first);
      expect(await eventCount(tx, id)).toBe(1);
    });
  });
});

describe("D38 APPT-GRID: settings and type changes never move existing appointments", () => {
  it("changing the type's duration and units leaves ends_at and capacity_units as booked", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      await actAs(tx, MECHANIC2);
      const booked = await book(tx, { customerId, typeId, startsAt: sgt(day, "10:00") });
      await ownerMode(tx);
      await tx.query(
        "update public.appointment_types set duration_minutes = 90, capacity_units = 2 where id = $1",
        [typeId],
      );
      await setSettings(tx, { slotMinutes: 60, capacityUnits: 1 });
      await tx.query("delete from public.shop_hours");
      const after = await appointment(tx, booked.id);
      expect(after.ends_at).toEqual(booked.ends_at);
      expect(after.capacity_units).toBe(1);
      expect(after.status).toBe("booked");
      await failsWith(
        tx,
        () =>
          tx.query(
            "update public.appointments set ends_at = ends_at + interval '30 minutes' where id = $1",
            [booked.id],
          ),
        p0001("appointment_immutable"),
      );
    });
  });
});

/** An appointment of `status` in today's current slot (started, not ended), written by the owner. */
async function todayAppointment(
  tx: pg.Client,
  typeId: string,
  customerId: string,
  status: AppointmentStatus,
): Promise<string> {
  const slot = await currentSlot(tx);
  return insertAppointment(tx, {
    customerId,
    typeId,
    startsAt: slot.start,
    endsAt: slot.end,
    status,
  });
}

async function outcome(fn: () => Promise<AppointmentRow>, tx: pg.Client, id: string) {
  const before = await eventCount(tx, id);
  const status = (await appointment(tx, id)).status;
  try {
    const row = await fn();
    const after = await eventCount(tx, id);
    if (row.status === status && after === before) return "replay" as TransitionOutcome;
    expect(after).toBe(before + 1);
    return "ok" as TransitionOutcome;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code !== "P0001") throw err;
    return e.message as TransitionOutcome;
  }
}

describe("D39 APPT-LATE-ARRIVAL: the status machine (tests/fixtures/appointment-transitions.ts)", () => {
  it("mark_appointment_status gives the documented outcome for every pair", async () => {
    await inTransaction(conn, async (tx) => {
      const { typeId, customerId } = await basics(tx);
      await setSettings(tx, { capacityUnits: 50 });
      const results: Record<string, TransitionOutcome> = {};
      const expected: Record<string, TransitionOutcome> = {};
      for (const from of APPOINTMENT_STATUSES) {
        const id = await todayAppointment(tx, typeId, customerId, from);
        for (const to of APPOINTMENT_STATUSES) {
          expected[`${from}->${to}`] = MARK_STATUS[from][to];
          results[`${from}->${to}`] = await tryAndUndo(tx, async () => {
            await actAs(tx, MECHANIC2);
            return outcome(() => markStatus(tx, id, to, "Test"), tx, id);
          });
        }
      }
      expect(results).toEqual(expected);
    });
  });

  it("no_show only once the appointment has started (appointment_not_started)", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      await actAs(tx, MECHANIC2);
      const future = await book(tx, { customerId, typeId, startsAt: sgt(day, "10:00") });
      await failsWith(
        tx,
        () => markStatus(tx, future.id, "no_show"),
        p0001("appointment_not_started"),
      );
      await failsWith(tx, () => markStatus(tx, randomUUID(), "confirmed"), { code: "P0002" });
    });
  });

  it("no_show -> arrived on its own date re-checks capacity; on another date it is refused", async () => {
    await inTransaction(conn, async (tx) => {
      const { typeId, customerId } = await basics(tx);
      const today = await openAllDayToday(tx);
      const slot = await currentSlot(tx);
      const missed = await todayAppointment(tx, typeId, customerId, "no_show");
      const yesterday = addDays(today, -1);
      const old = await insertAppointment(tx, {
        customerId,
        typeId,
        startsAt: sgt(yesterday, "10:00"),
        endsAt: sgt(yesterday, "10:30"),
        status: "no_show",
      });
      // Its place is taken: the window is full without it.
      const used = await unitsUsed(tx, slot.start, slot.end);
      await setSettings(tx, { capacityUnits: Math.max(used, 1) });
      if (used === 0) {
        await insertAppointment(tx, { customerId, typeId, startsAt: slot.start, endsAt: slot.end });
      }
      await actAs(tx, MECHANIC2);
      await failsWith(
        tx,
        () => markStatus(tx, missed, "arrived"),
        p0001("appointment_capacity_exceeded"),
      );
      await failsWith(
        tx,
        () => markStatus(tx, old, "arrived"),
        p0001("appointment_transition_invalid"),
      );
      // A unit frees up: the late arrival is reinstated, with one event.
      await setSettings(tx, { capacityUnits: Math.max(used, 1) + 1 });
      const back = await markStatus(tx, missed, "arrived", "Came after all");
      expect(back.status).toBe("arrived");
      expect(back.arrived_at).not.toBeNull();
      expect(back.no_show_at).not.toBeNull();
      const events = await appointmentEvents(tx, missed);
      expect(events.at(-1)).toMatchObject({
        event_type: "arrived",
        from_status: "no_show",
        to_status: "arrived",
        reason: "Came after all",
        actor_staff_id: STAFF.mechanic2,
      });
    });
  });

  it("the trigger enforces the same table for every writer, the owner included", async () => {
    await inTransaction(conn, async (tx) => {
      const { typeId, customerId } = await basics(tx);
      const results: Record<string, TransitionOutcome> = {};
      const expected: Record<string, TransitionOutcome> = {};
      for (const from of APPOINTMENT_STATUSES) {
        const id = await todayAppointment(tx, typeId, customerId, from);
        for (const to of APPOINTMENT_STATUSES) {
          if (from === to) continue;
          expected[`${from}->${to}`] = triggerOutcome(from, to);
          results[`${from}->${to}`] = await tryAndUndo(tx, async () => {
            if (to === "cancelled")
              await tx.query("select private.set_change_reason('Owner test')");
            try {
              await tx.query("update public.appointments set status = $2 where id = $1", [id, to]);
              return "ok" as TransitionOutcome;
            } catch (err) {
              const e = err as { code?: string; message?: string };
              if (e.code !== "P0001") throw err;
              return e.message as TransitionOutcome;
            }
          });
        }
      }
      expect(results).toEqual(expected);
      // Cancelling needs a reason, even for the owner.
      const id = await todayAppointment(tx, typeId, customerId, "booked");
      await failsWith(
        tx,
        () => tx.query("update public.appointments set status = 'cancelled' where id = $1", [id]),
        p0001("reason_required"),
      );
    });
  });

  it("cancel_appointment from every status: booked, confirmed and arrived only; a replay returns the row", async () => {
    await inTransaction(conn, async (tx) => {
      const { typeId, customerId } = await basics(tx);
      const results: Record<string, TransitionOutcome> = {};
      for (const from of APPOINTMENT_STATUSES) {
        const id = await todayAppointment(tx, typeId, customerId, from);
        results[from] = await tryAndUndo(tx, async () => {
          await actAs(tx, MECHANIC2);
          return outcome(() => cancel(tx, id, "Shop closed early"), tx, id);
        });
      }
      expect(results).toEqual(CANCEL);
    });
  });
});

describe("cancel_appointment: reason first, then the row, then the status (D39)", () => {
  it("validates the reason before anything else, records cancelled_via = staff, and replays without an event", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      await actAs(tx, MECHANIC2);
      const a = await book(tx, { customerId, typeId, startsAt: sgt(day, "10:00") });
      for (const reason of [null, "", "   "]) {
        await failsWith(tx, () => cancel(tx, randomUUID(), reason), p0001("reason_required"));
      }
      await failsWith(tx, () => cancel(tx, a.id, "x".repeat(501)), p0001("reason_too_long"));
      await failsWith(tx, () => cancel(tx, randomUUID(), "Gone"), { code: "P0002" });
      const cancelled = await cancel(tx, a.id, "  Customer phoned  ");
      expect(cancelled).toMatchObject({
        status: "cancelled",
        cancelled_via: "staff",
        cancellation_reason: "Customer phoned",
      });
      expect(cancelled.cancelled_at).not.toBeNull();
      const again = await cancel(tx, a.id, "Another reason");
      expect(again).toEqual(cancelled);
      expect((await appointmentEvents(tx, a.id)).map((e) => e.event_type)).toEqual([
        "booked",
        "cancelled",
      ]);
      expect((await appointmentEvents(tx, a.id))[1]).toMatchObject({
        reason: "Customer phoned",
        payload: { via: "staff" },
      });
    });
  });
});

describe("Appointment changes leave history (SPEC §2, §22)", () => {
  it("exactly one event per change with actor, reason and correlation ID; replays and no-ops append none", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId } = await basics(tx);
      await actAs(tx, MECHANIC2);
      await tx.query("select set_config('app.correlation_id', 'corr-appt-1', true)");
      const a = await book(tx, {
        customerId: CUSTOMER.tan,
        typeId,
        startsAt: sgt(day, "10:00"),
        customerNote: " Squeaky brakes ",
        internalNote: "Regular",
      });
      expect(a).toMatchObject({
        source: "staff",
        customer_note: "Squeaky brakes",
        created_by_staff_id: STAFF.mechanic2,
        created_by_user_id: AUTH_USER.mechanic2,
        capacity_units: 1,
      });
      await markStatus(tx, a.id, "confirmed", "Phoned to confirm");
      await markStatus(tx, a.id, "confirmed", "Again");
      const upd = (sql: string, params: unknown[]) =>
        tx.query(`select (a).* from (select ${sql} a) s`, params).then((r) => r.rows[0]);
      await upd("public.update_appointment($1, bike_id => $2)", [a.id, BIKE.tanTarmac]);
      await upd("public.update_appointment($1, bike_id => $2)", [a.id, BIKE.tanTarmac]);
      await upd("public.update_appointment($1, customer_note => $2, internal_note => $3)", [
        a.id,
        "Squeaky brakes and gears",
        "",
      ]);
      await upd("public.update_appointment($1, clear_bike => true)", [a.id]);
      const events = await appointmentEvents(tx, a.id);
      expect(events.map((e) => e.event_type)).toEqual([
        "booked",
        "confirmed",
        "details_changed",
        "details_changed",
        "details_changed",
      ]);
      for (const e of events) {
        expect(e).toMatchObject({
          actor_staff_id: STAFF.mechanic2,
          actor_user_id: AUTH_USER.mechanic2,
          correlation_id: "corr-appt-1",
        });
      }
      expect(events[0].payload).toMatchObject({
        appointment_type_id: typeId,
        source: "staff",
        status: "booked",
      });
      expect(events[1]).toMatchObject({
        from_status: "booked",
        to_status: "confirmed",
        reason: "Phoned to confirm",
      });
      expect(events[2].payload).toEqual({ bike_id: { from: null, to: BIKE.tanTarmac } });
      expect(events[3].payload).toEqual({
        customer_note: { from: "Squeaky brakes", to: "Squeaky brakes and gears" },
        internal_note: { from: "Regular", to: null },
      });
      expect(events[4].payload).toEqual({ bike_id: { from: BIKE.tanTarmac, to: null } });
    });
  });

  it("the bike changes only before check-in and must stay the customer's; the customer's note freezes once it is over", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId } = await basics(tx);
      await actAs(tx, MECHANIC2);
      const a = await book(tx, { customerId: CUSTOMER.tan, typeId, startsAt: sgt(day, "10:00") });
      const update = (args: string, params: unknown[]) =>
        tx.query(`select public.update_appointment($1, ${args})`, [a.id, ...params]);
      await failsWith(
        tx,
        () => update("bike_id => $2", [BIKE.priyaDomane]),
        p0001("appointment_bike_not_owned"),
      );
      await failsWith(tx, () => update("bike_id => $2", [randomUUID()]), { code: "P0002" });
      await cancel(tx, a.id, "Not needed");
      await failsWith(
        tx,
        () => update("bike_id => $2", [BIKE.tanTarmac]),
        p0001("appointment_immutable"),
      );
      await failsWith(
        tx,
        () => update("customer_note => $2", ["Late note"]),
        p0001("appointment_immutable"),
      );
      await update("internal_note => $2", ["Called twice"]);
      await failsWith(tx, () => tx.query("select public.update_appointment($1)", [randomUUID()]), {
        code: "P0002",
      });
    });
  });

  it("appointment_events refuse update and delete, for the owner too", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      await actAs(tx, MECHANIC2);
      const a = await book(tx, { customerId, typeId, startsAt: sgt(day, "10:00") });
      await ownerMode(tx);
      await failsWith(
        tx,
        () =>
          tx.query("update public.appointment_events set reason = 'x' where appointment_id = $1", [
            a.id,
          ]),
        p0001("appointment_history_append_only"),
      );
      await failsWith(
        tx,
        () => tx.query("delete from public.appointment_events where appointment_id = $1", [a.id]),
        p0001("appointment_history_append_only"),
      );
    });
  });
});

describe("Mechanic permission boundaries: appointments are for every active staff member", () => {
  it("mechanic2 (no permissions) can book, mark, update and cancel; reads the tables", async () => {
    await inTransaction(conn, async (tx) => {
      const { day, typeId, customerId } = await basics(tx);
      await actAs(tx, MECHANIC2);
      const a = await book(tx, { customerId, typeId, startsAt: sgt(day, "10:00") });
      await markStatus(tx, a.id, "confirmed");
      await tx.query("select public.update_appointment($1, internal_note => 'ok')", [a.id]);
      await cancel(tx, a.id, "Done");
      expect(
        await scalar(tx, "select count(*)::int from public.appointments where id = $1", [a.id]),
      ).toBe(1);
      expect(
        await scalar(
          tx,
          "select count(*)::int from public.appointment_events where appointment_id = $1",
          [a.id],
        ),
      ).toBe(4); // booked, confirmed, details_changed, cancelled
    });
  });

  it("customers and anonymous callers cannot call the staff RPCs (42501); nobody writes the tables directly", async () => {
    const id = randomUUID();
    const calls = [
      `select public.book_appointment('${id}', '${CUSTOMER.tan}', '${randomUUID()}', now())`,
      `select public.mark_appointment_status('${id}', 'arrived')`,
      `select public.cancel_appointment('${id}', 'Mine')`,
      `select public.update_appointment('${id}', internal_note => 'x')`,
    ];
    for (const sql of calls) {
      await expect(asAnon(conn, (tx) => tx.query(sql))).rejects.toMatchObject({ code: "42501" });
      await expect(
        inTransaction(conn, async (tx) => {
          const auth = await linkCustomerLogin(tx, CUSTOMER.tan);
          await actAs(tx, customerClaims(auth));
          return tx.query(sql);
        }),
      ).rejects.toMatchObject({ code: "42501" });
    }
    for (const sql of [
      `insert into public.appointments (customer_id, appointment_type_id, starts_at, ends_at, capacity_units, source)
       values ('${CUSTOMER.tan}', '${randomUUID()}', now(), now() + interval '1 hour', 1, 'staff')`,
      "update public.appointments set internal_note = 'x'",
      "delete from public.appointment_events",
    ]) {
      await expect(
        inTransaction(conn, async (tx) => {
          await actAs(tx, ADMIN);
          return tx.query(sql);
        }),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});

describe("D35 SHOP-TZ: the calendar helpers follow the settings row", () => {
  it("private.shop_timezone() and shop_currency() read shop_settings, with the Phase 5 values by default", async () => {
    await inTransaction(conn, async (tx) => {
      expect(await scalar(tx, "select private.shop_timezone()")).toBe("Asia/Singapore");
      expect(await scalar(tx, "select private.shop_currency()")).toBe("SGD");
      await tx.query(
        "update public.shop_settings set timezone = 'Europe/London', default_currency = 'GBP' where id = 1",
      );
      expect(await scalar(tx, "select private.shop_timezone()")).toBe("Europe/London");
      expect(await scalar(tx, "select private.shop_currency()")).toBe("GBP");
      expect(await scalar(tx, "select private.shop_day('2025-06-01 23:30:00+00')::text")).toBe(
        "2025-06-02",
      ); // 00:30 BST
      await failsWith(
        tx,
        () => tx.query("update public.shop_settings set timezone = 'Mars/Olympus' where id = 1"),
        p0001("shop_timezone_invalid"),
      );
    });
  });
});
