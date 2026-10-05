/**
 * Appointments under concurrency (SPEC §6 "Prevent overbooking
 * transactionally", §23 "Appointment booking cannot exceed configured
 * capacity", §25; PLAN D2, D37, D39, D40): real connections, committed
 * transactions. Bookings of one shop day serialise on the per-day advisory
 * lock (customer self-bookings first on the per-customer lock), so the
 * capacity check and the insert cannot interleave; a reinstated no-show
 * re-checks capacity under the same day lock; two check-ins of one
 * appointment serialise on its row lock, so it gets one work order (D40).
 *
 * Commits, so the whole file runs only on a per-file clone. Each case has
 * its own date (or today's current slot); the settings, weekly hours and
 * closures it changes are restored after it. Committed appointments stay
 * in this file's throwaway database (appointments are never deleted).
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER } from "../fixtures/ids";
import {
  addClosure,
  addDays,
  appointmentEvents,
  currentSlot,
  futureDay,
  insertAppointment,
  makeType,
  setSettings,
  sgt,
  shopToday,
  standardSchedule,
  unitsUsed,
  type AppointmentRow,
} from "./appointment-fixtures";
import { customerClaims, linkCustomerLogin } from "./customer-fixtures";
import {
  actAs,
  connect,
  inTransaction,
  isolatedDatabase,
  openConnections,
  scalar,
  staffClaims,
  type Claims,
} from "./harness";
import { makeBike, makeCustomer } from "./workshop-fixtures";

let setup: pg.Client;
let savedSettings: Record<string, unknown>;
let savedHours: Array<Record<string, unknown>>;
const addedClosures: string[] = [];

const STAFF_CLAIMS = staffClaims(AUTH_USER.mechanic2);

const pause = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

type Result<T> = { ok: true; value: T } | { ok: false; error: { code?: string; message?: string } };

/** Runs `fn` as `claims` on `c` in a committed transaction; resolves to its result or error. */
function committed<T>(
  c: pg.Client,
  claims: Claims,
  fn: (tx: pg.Client) => Promise<T>,
): Promise<Result<T>> {
  return inTransaction(
    c,
    async (tx) => {
      await actAs(tx, claims);
      return fn(tx);
    },
    { commit: true },
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: { code?: string; message?: string }) => ({ ok: false as const, error }),
  );
}

const bookSql = (tx: pg.Client, id: string, customerId: string, typeId: string, startsAt: string) =>
  tx
    .query<AppointmentRow>(
      "select (a).* from (select public.book_appointment($1, $2, $3, $4) a) s",
      [id, customerId, typeId, startsAt],
    )
    .then((r) => r.rows[0]);

const bookMineSql = (tx: pg.Client, id: string, typeId: string, startsAt: string) =>
  tx
    .query<{ id: string }>(
      "select (m).id from (select public.book_my_appointment($1, $2, $3) m) s",
      [id, typeId, startsAt],
    )
    .then((r) => r.rows[0]);

/**
 * Starts `first` in an open transaction (it takes the day lock and holds
 * it), starts `second` (which waits), waits, commits `first`, and returns
 * both outcomes.
 */
async function race<A, B>(
  first: { claims: Claims; run: (tx: pg.Client) => Promise<A> },
  second: { claims: Claims; run: (tx: pg.Client) => Promise<B> },
): Promise<[Result<A>, Result<B>]> {
  const [a, b] = await openConnections(2);
  await a.query("begin");
  await actAs(a, first.claims);
  let firstResult: Result<A>;
  try {
    firstResult = { ok: true, value: await first.run(a) };
  } catch (error) {
    await a.query("rollback");
    throw error;
  }
  const secondResult = committed(b, second.claims, second.run);
  await pause();
  await a.query("commit");
  return [firstResult, await secondResult];
}

const exactlyOne = (results: Array<Result<unknown>>, code: string) => {
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  const failed = results.find((r) => !r.ok);
  expect(failed && !failed.ok && failed.error).toMatchObject({ code: "P0001", message: code });
};

describe.skipIf(!isolatedDatabase())("appointments under concurrency", () => {
  beforeAll(async () => {
    setup = await connect();
    savedSettings = (await setup.query("select * from public.shop_settings where id = 1")).rows[0];
    savedHours = (
      await setup.query("select id, weekday, opens_at, closes_at, active from public.shop_hours")
    ).rows;
  });

  afterEach(async () => {
    const s = savedSettings;
    await setup.query(
      `update public.shop_settings
          set intake_slot_minutes = $1, intake_capacity_units = $2, booking_min_notice_minutes = $3,
              booking_horizon_days = $4, customer_max_active_bookings = $5, customer_cancel_cutoff_minutes = $6
        where id = 1`,
      [
        s.intake_slot_minutes,
        s.intake_capacity_units,
        s.booking_min_notice_minutes,
        s.booking_horizon_days,
        s.customer_max_active_bookings,
        s.customer_cancel_cutoff_minutes,
      ],
    );
    await setup.query("delete from public.shop_hours");
    for (const h of savedHours) {
      await setup.query(
        "insert into public.shop_hours (id, weekday, opens_at, closes_at, active) values ($1, $2, $3, $4, $5)",
        [h.id, h.weekday, h.opens_at, h.closes_at, h.active],
      );
    }
    while (addedClosures.length > 0) {
      await setup.query("delete from public.closure_overrides where id = $1", [
        addedClosures.pop(),
      ]);
    }
  });

  it("SPEC §23: two bookings for the last unit of a window, exactly one succeeds and used units equal capacity", async () => {
    await standardSchedule(setup);
    const day = await futureDay(setup, 0);
    const typeId = await makeType(setup, { durationMinutes: 30, capacityUnits: 1 });
    const customerId = await makeCustomer(setup);
    const start = sgt(day, "10:00");
    const pre = await committed(setup, STAFF_CLAIMS, (tx) =>
      bookSql(tx, randomUUID(), customerId, typeId, start),
    );
    expect(pre.ok).toBe(true);

    const results = await race(
      { claims: STAFF_CLAIMS, run: (tx) => bookSql(tx, randomUUID(), customerId, typeId, start) },
      { claims: STAFF_CLAIMS, run: (tx) => bookSql(tx, randomUUID(), customerId, typeId, start) },
    );
    exactlyOne(results, "appointment_capacity_exceeded");
    expect(await unitsUsed(setup, start, sgt(day, "10:30"))).toBe(2);
  });

  it("D2: a 60-minute and a 30-minute booking racing for their shared second window, exactly one succeeds", async () => {
    await standardSchedule(setup, { capacityUnits: 1 });
    const day = await futureDay(setup, 1);
    const shortType = await makeType(setup, { durationMinutes: 30, capacityUnits: 1 });
    const longType = await makeType(setup, { durationMinutes: 60, capacityUnits: 1 });
    const customerId = await makeCustomer(setup);

    const results = await race(
      {
        claims: STAFF_CLAIMS,
        run: (tx) => bookSql(tx, randomUUID(), customerId, longType, sgt(day, "10:00")),
      },
      {
        claims: STAFF_CLAIMS,
        run: (tx) => bookSql(tx, randomUUID(), customerId, shortType, sgt(day, "10:30")),
      },
    );
    exactlyOne(results, "appointment_capacity_exceeded");
    expect(await unitsUsed(setup, sgt(day, "10:30"), sgt(day, "11:00"))).toBe(1);
  });

  it("D37: a staff booking and a customer booking racing for the last unit, exactly one succeeds", async () => {
    await standardSchedule(setup, { capacityUnits: 1 });
    const day = await futureDay(setup, 2);
    const typeId = await makeType(setup, { durationMinutes: 30, capacityUnits: 1 });
    const staffCustomer = await makeCustomer(setup);
    const onlineCustomer = await makeCustomer(setup);
    const auth = await linkCustomerLogin(setup, onlineCustomer);
    const start = sgt(day, "11:00");

    const results = await race(
      { claims: customerClaims(auth), run: (tx) => bookMineSql(tx, randomUUID(), typeId, start) },
      {
        claims: STAFF_CLAIMS,
        run: (tx) => bookSql(tx, randomUUID(), staffCustomer, typeId, start),
      },
    );
    exactlyOne(results, "appointment_capacity_exceeded");
    expect(await unitsUsed(setup, start, sgt(day, "11:30"))).toBe(1);
  });

  it("SPEC §2: the same appointment id on two connections makes one row, both get its id, one booked event", async () => {
    await standardSchedule(setup);
    const day = await futureDay(setup, 3);
    const typeId = await makeType(setup, { durationMinutes: 30, capacityUnits: 1 });
    const customerId = await makeCustomer(setup);
    const id = randomUUID();
    const [a, b] = await openConnections(2);
    const results = await Promise.all([
      committed(a, STAFF_CLAIMS, (tx) => bookSql(tx, id, customerId, typeId, sgt(day, "12:00"))),
      committed(b, STAFF_CLAIMS, (tx) => bookSql(tx, id, customerId, typeId, sgt(day, "12:00"))),
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(results.map((r) => (r.ok ? r.value.id : null))).toEqual([id, id]);
    expect(
      await scalar(setup, "select count(*)::int from public.appointments where id = $1", [id]),
    ).toBe(1);
    expect((await appointmentEvents(setup, id)).map((e) => e.event_type)).toEqual(["booked"]);
  });

  it("D39: a no-show reinstated as arrived racing a new booking for its freed unit, exactly one succeeds", async () => {
    await standardSchedule(setup);
    const today = await shopToday(setup);
    addedClosures.push(
      await addClosure(setup, {
        kind: "custom_hours",
        startsAt: sgt(today, "00:00"),
        endsAt: sgt(addDays(today, 1), "00:00"),
        opens: "00:00",
        closes: "24:00",
      }),
    );
    const slot = await currentSlot(setup);
    const typeId = await makeType(setup, { durationMinutes: 30, capacityUnits: 1 });
    const customerId = await makeCustomer(setup);
    const missed = await insertAppointment(setup, {
      customerId,
      typeId,
      startsAt: slot.start,
      endsAt: slot.end,
      status: "no_show",
    });
    // Exactly one unit free in the slot (the no-show holds none).
    const used = await unitsUsed(setup, slot.start, slot.end);
    await setSettings(setup, { capacityUnits: used + 1 });

    const results = await race(
      {
        claims: STAFF_CLAIMS,
        run: (tx) => tx.query("select public.mark_appointment_status($1, 'arrived')", [missed]),
      },
      {
        claims: STAFF_CLAIMS,
        run: (tx) => bookSql(tx, randomUUID(), customerId, typeId, slot.start),
      },
    );
    exactlyOne(results, "appointment_capacity_exceeded");
    expect(await unitsUsed(setup, slot.start, slot.end)).toBe(used + 1);
    expect(
      await scalar(setup, "select status::text from public.appointments where id = $1", [missed]),
    ).toBe("arrived");
  });

  it("D37: one customer books two different days at once with one booking left, exactly one succeeds, the other raises appointment_customer_limit", async () => {
    await standardSchedule(setup, { customerLimit: 1 });
    const first = await futureDay(setup, 4);
    const second = await futureDay(setup, 5);
    const typeId = await makeType(setup, { durationMinutes: 30, capacityUnits: 1 });
    const customerId = await makeCustomer(setup);
    const auth = await linkCustomerLogin(setup, customerId);

    const results = await race(
      {
        claims: customerClaims(auth),
        run: (tx) => bookMineSql(tx, randomUUID(), typeId, sgt(first, "10:00")),
      },
      {
        claims: customerClaims(auth),
        run: (tx) => bookMineSql(tx, randomUUID(), typeId, sgt(second, "10:00")),
      },
    );
    exactlyOne(results, "appointment_customer_limit");
    expect(
      await scalar(
        setup,
        "select count(*)::int from public.appointments where customer_id = $1 and source = 'customer'",
        [customerId],
      ),
    ).toBe(1);
  });

  it("D40: two concurrent check-ins of one appointment make one work order; the second returns created = false with the same work_order_id", async () => {
    const typeId = await makeType(setup, { durationMinutes: 30, capacityUnits: 1 });
    const customerId = await makeCustomer(setup);
    const bikeId = await makeBike(setup, customerId);
    const day = await futureDay(setup, 6);
    const appointmentId = await insertAppointment(setup, {
      customerId,
      typeId,
      bikeId,
      startsAt: sgt(day, "10:00"),
      endsAt: sgt(day, "10:30"),
      status: "confirmed",
    });
    const checkInSql = (tx: pg.Client, workOrderId: string) =>
      tx
        .query<{ work_order_id: string; job_number: string; created: boolean }>(
          `select (c).work_order_id, (c).job_number, (c).created from (
             select public.check_in_appointment($1, $2, $3, false, 'Booked service') c
           ) s`,
          [appointmentId, bikeId, workOrderId],
        )
        .then((r) => r.rows[0]);

    const [first, second] = await race(
      { claims: STAFF_CLAIMS, run: (tx) => checkInSql(tx, randomUUID()) },
      { claims: staffClaims(AUTH_USER.admin), run: (tx) => checkInSql(tx, randomUUID()) },
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.created).toBe(true);
    expect(second.value).toEqual({ ...first.value, created: false });
    expect(
      await scalar(
        setup,
        "select count(*)::int from public.work_orders where appointment_id = $1 or customer_id = $2",
        [appointmentId, customerId],
      ),
    ).toBe(1);
    expect((await appointmentEvents(setup, appointmentId)).map((e) => e.event_type)).toEqual([
      "booked",
      "checked_in",
      "work_order_linked",
    ]);
  });
});
