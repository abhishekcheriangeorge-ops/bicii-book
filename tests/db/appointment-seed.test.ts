/**
 * The seeded schedule and appointments (DATA-MODEL §18 "Phase 2 part";
 * TESTING.md "Seed data"; PLAN D9, D36, D37, D38, D40, D41, D42) match
 * tests/fixtures/ids.ts, and the guarantees other tests rely on hold:
 * nothing seeded is more than 14 days ahead (tests book on clear days at
 * least 21 days ahead), Daniel has no upcoming booked or confirmed
 * appointment (customer-limit tests), Chloe's login is linked and has at
 * most two upcoming online bookings (E2E journey 2 adds one under the
 * limit of 3), today has at most three expected arrivals.
 *
 * Days are counted from the seed's anchor (seedToday(), the shop day
 * `db:reset` ran), so the file holds on an old seed too. Reads only.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import {
  APPOINTMENT,
  APPOINTMENT_TYPE,
  BIKE,
  CLOSURE,
  CUSTOMER,
  CUSTOMER_LOGIN,
  REPORT_JOB,
  SHOP_HOURS,
  type SeedAppointment,
} from "../fixtures/ids";
import { MY_APPOINTMENT_COLUMNS, addDays, weekdayOf } from "./appointment-fixtures";
import { asAnon, asAuthUser, connect, inTransaction } from "./harness";
import { readAsOwner } from "./inventory-fixtures";
import { seedToday } from "./reporting-fixtures";

let conn: pg.Client;
let anchor: string;

beforeAll(async () => {
  conn = await connect();
  anchor = await inTransaction(conn, (tx) => seedToday(tx));
});

/** Reads as the owner in a rolled-back transaction. */
const owner = <T>(fn: (tx: pg.Client) => Promise<T>) =>
  inTransaction(conn, (tx) => readAsOwner(tx, () => fn(tx)));

/** First Tuesday-Friday at least n days after `day`. */
function firstTueToFri(day: string, n: number): string {
  let d = addDays(day, n);
  while (weekdayOf(d) < 2 || weekdayOf(d) > 5) d = addDays(d, 1);
  return d;
}

/** First day at least n days after `day` with weekday `wd`. */
function firstWeekday(day: string, n: number, wd: number): string {
  let d = addDays(day, n);
  while (weekdayOf(d) !== wd) d = addDays(d, 1);
  return d;
}

type Expected = {
  customer: string;
  bike: string;
  type: string;
  day: (anchor: string) => string;
  time: string;
  status: string;
  source: "staff" | "customer";
};

const SEEDED: Record<SeedAppointment, Expected> = {
  tanTarmacCompleted: {
    customer: CUSTOMER.tan,
    bike: BIKE.tanTarmac,
    type: APPOINTMENT_TYPE.repairAssessment,
    day: (a) => addDays(a, -3),
    time: "10:00",
    status: "completed",
    source: "staff",
  },
  danielNoShow: {
    customer: CUSTOMER.daniel,
    bike: BIKE.danielCannondale,
    type: APPOINTMENT_TYPE.serviceDropOff,
    day: (a) => addDays(a, -1),
    time: "11:00",
    status: "no_show",
    source: "staff",
  },
  priyaArrived: {
    customer: CUSTOMER.priya,
    bike: BIKE.priyaDomane,
    type: APPOINTMENT_TYPE.serviceDropOff,
    day: (a) => a,
    time: "10:00",
    status: "arrived",
    source: "staff",
  },
  hafizConfirmed: {
    customer: CUSTOMER.hafiz,
    bike: BIKE.hafizBrompton,
    type: APPOINTMENT_TYPE.repairAssessment,
    day: (a) => a,
    time: "10:30",
    status: "confirmed",
    source: "staff",
  },
  chloeGiantOnline: {
    customer: CUSTOMER.chloe,
    bike: BIKE.chloeGiant,
    type: APPOINTMENT_TYPE.serviceDropOff,
    day: (a) => a,
    time: "15:00",
    status: "booked",
    source: "customer",
  },
  nurulBooked: {
    customer: CUSTOMER.nurul,
    bike: BIKE.nurulBianchi,
    type: APPOINTMENT_TYPE.repairAssessment,
    day: (a) => a,
    time: "16:00",
    status: "booked",
    source: "staff",
  },
  tanBromptonConfirmed: {
    customer: CUSTOMER.tan,
    bike: BIKE.tanBrompton,
    type: APPOINTMENT_TYPE.serviceDropOff,
    day: (a) => firstTueToFri(a, 1),
    time: "11:00",
    status: "confirmed",
    source: "staff",
  },
  priyaTernCancelled: {
    customer: CUSTOMER.priya,
    bike: BIKE.priyaTern,
    type: APPOINTMENT_TYPE.repairAssessment,
    day: (a) => firstTueToFri(a, 3),
    time: "10:00",
    status: "cancelled",
    source: "staff",
  },
  chloeSurlyOnline: {
    customer: CUSTOMER.chloe,
    bike: BIKE.chloeSurly,
    type: APPOINTMENT_TYPE.buildConsultation,
    day: (a) => firstTueToFri(a, 5),
    time: "14:00",
    status: "booked",
    source: "customer",
  },
};

describe("The seeded schedule matches ids.ts (Phase 2)", () => {
  it("settings: D37's defaults and the local public site URL (D9 note)", async () => {
    const { rows } = await owner((tx) => tx.query("select * from public.shop_settings"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      timezone: "Asia/Singapore",
      default_currency: "SGD",
      intake_slot_minutes: 30,
      intake_capacity_units: 2,
      booking_min_notice_minutes: 120,
      booking_horizon_days: 60,
      customer_max_active_bookings: 3,
      customer_cancel_cutoff_minutes: 120,
      public_site_url: "http://localhost:4000",
    });
  });

  it("weekly hours: Tuesday-Friday 10-19, a split Saturday, a short Sunday, Monday inactive", async () => {
    const { rows } = await owner((tx) =>
      tx.query(
        `select id, weekday, to_char(opens_at, 'HH24:MI') as opens, to_char(closes_at, 'HH24:MI') as closes, active
           from public.shop_hours order by weekday, opens_at`,
      ),
    );
    expect(rows).toEqual([
      { id: SHOP_HOURS.sunday, weekday: 0, opens: "09:00", closes: "13:00", active: true },
      { id: SHOP_HOURS.mondayInactive, weekday: 1, opens: "10:00", closes: "19:00", active: false },
      { id: SHOP_HOURS.tuesday, weekday: 2, opens: "10:00", closes: "19:00", active: true },
      { id: SHOP_HOURS.wednesday, weekday: 3, opens: "10:00", closes: "19:00", active: true },
      { id: SHOP_HOURS.thursday, weekday: 4, opens: "10:00", closes: "19:00", active: true },
      { id: SHOP_HOURS.friday, weekday: 5, opens: "10:00", closes: "19:00", active: true },
      { id: SHOP_HOURS.saturdayMorning, weekday: 6, opens: "09:00", closes: "12:30", active: true },
      {
        id: SHOP_HOURS.saturdayAfternoon,
        weekday: 6,
        opens: "13:30",
        closes: "18:00",
        active: true,
      },
    ]);
  });

  it("four appointment types, one staff-only; anonymous visitors see the three public ones in order", async () => {
    const { rows } = await owner((tx) =>
      tx.query(
        `select id, name, duration_minutes, capacity_units, public, active, sort_order
           from public.appointment_types where id = any ($1::uuid[]) order by sort_order`,
        [Object.values(APPOINTMENT_TYPE)],
      ),
    );
    expect(
      rows.map((r) => [r.id, r.name, r.duration_minutes, r.capacity_units, r.public, r.active]),
    ).toEqual([
      [APPOINTMENT_TYPE.serviceDropOff, "Service drop-off", 30, 1, true, true],
      [APPOINTMENT_TYPE.repairAssessment, "Repair assessment", 30, 1, true, true],
      [APPOINTMENT_TYPE.buildConsultation, "Custom build consultation", 60, 2, true, true],
      [APPOINTMENT_TYPE.warrantyInspection, "Warranty inspection", 30, 1, false, true],
    ]);
    const visible = await asAnon(conn, async (tx) =>
      (await tx.query<{ id: string }>("select id from public.public_appointment_types()")).rows.map(
        (r) => r.id,
      ),
    );
    expect(visible).toEqual([
      APPOINTMENT_TYPE.serviceDropOff,
      APPOINTMENT_TYPE.repairAssessment,
      APPOINTMENT_TYPE.buildConsultation,
    ]);
  });

  it("two closures within 14 days, whole shop-local days, never on the anchor day", async () => {
    const { rows } = await owner((tx) =>
      tx.query(
        `select id, kind::text,
                to_char((starts_at at time zone 'Asia/Singapore'), 'YYYY-MM-DD HH24:MI') as starts,
                to_char((ends_at at time zone 'Asia/Singapore'), 'YYYY-MM-DD HH24:MI') as ends,
                to_char(opens_at, 'HH24:MI') as opens, to_char(closes_at, 'HH24:MI') as closes, reason
           from public.closure_overrides order by starts_at`,
      ),
    );
    const wednesday = firstWeekday(anchor, 7, 3);
    const thursday = firstWeekday(anchor, 8, 4);
    expect(rows).toEqual([
      {
        id: CLOSURE.taipeiShow,
        kind: "closed",
        starts: `${wednesday} 00:00`,
        ends: `${addDays(wednesday, 1)} 00:00`,
        opens: null,
        closes: null,
        reason: "Team at the Taipei Cycle show",
      },
      {
        id: CLOSURE.stocktake,
        kind: "custom_hours",
        starts: `${thursday} 00:00`,
        ends: `${addDays(thursday, 1)} 00:00`,
        opens: "12:00",
        closes: "16:00",
        reason: "Short day for stocktake",
      },
    ]);
    for (const d of [wednesday, thursday]) expect(d <= addDays(anchor, 14)).toBe(true);
  });
});

describe("The seeded appointments (Phase 2; D36, D40, D41)", () => {
  it("each appointment is where ids.ts says: customer, bike, type snapshot, scheduled day and time, status, source", async () => {
    const { rows } = await owner((tx) =>
      tx.query(
        `select a.id, a.customer_id, a.bike_id, a.appointment_type_id, a.status::text, a.source::text,
                to_char((a.starts_at at time zone 'Asia/Singapore'), 'YYYY-MM-DD') as day,
                to_char((a.starts_at at time zone 'Asia/Singapore'), 'HH24:MI') as time,
                extract(epoch from a.ends_at - a.starts_at)::int / 60 = t.duration_minutes as ends_snapshot,
                a.capacity_units = t.capacity_units as units_snapshot,
                a.created_at < a.starts_at as booked_ahead,
                a.created_by_staff_id, a.created_by_user_id, a.cancellation_reason, a.cancelled_via::text
           from public.appointments a join public.appointment_types t on t.id = a.appointment_type_id
          where a.id = any ($1::uuid[])`,
        [Object.values(APPOINTMENT)],
      ),
    );
    expect(rows).toHaveLength(Object.keys(APPOINTMENT).length);
    for (const [key, want] of Object.entries(SEEDED) as Array<[SeedAppointment, Expected]>) {
      const row = rows.find((r) => r.id === APPOINTMENT[key]);
      expect({ key, ...row }).toMatchObject({
        key,
        customer_id: want.customer,
        bike_id: want.bike,
        appointment_type_id: want.type,
        status: want.status,
        source: want.source,
        day: want.day(anchor),
        time: want.time,
        ends_snapshot: true,
        units_snapshot: true,
        booked_ahead: true,
        created_by_user_id: want.source === "customer" ? CUSTOMER_LOGIN.chloe.authUserId : null,
      });
      expect(row.created_by_staff_id === null).toBe(want.source === "customer");
    }
    expect(rows.find((r) => r.id === APPOINTMENT.priyaTernCancelled)).toMatchObject({
      cancellation_reason: "Customer travelling",
      cancelled_via: "staff",
    });
  });

  it("nothing is more than 14 days ahead; upcoming days are Tuesday-Friday and miss the closures", async () => {
    const { rows } = await owner((tx) =>
      tx.query<{ day: string }>(
        `select to_char((starts_at at time zone 'Asia/Singapore'), 'YYYY-MM-DD') as day
           from public.appointments where id = any ($1::uuid[])`,
        [Object.values(APPOINTMENT)],
      ),
    );
    const closures = [firstWeekday(anchor, 7, 3), firstWeekday(anchor, 8, 4)];
    for (const { day } of rows) {
      expect(day <= addDays(anchor, 14)).toBe(true);
      if (day > anchor) {
        expect([2, 3, 4, 5]).toContain(weekdayOf(day));
        expect(closures).not.toContain(day);
      }
    }
  });

  it("Daniel has no upcoming booked or confirmed appointment; Chloe at most two upcoming online bookings; today at most three expected arrivals", async () => {
    const counts = await owner(async (tx) => {
      const { rows } = await tx.query(
        `select
           (count(*) filter (where customer_id = $1 and status in ('booked', 'confirmed') and starts_at > now()))::int as daniel,
           (count(*) filter (where customer_id = $2 and source = 'customer' and status in ('booked', 'confirmed')
                              and starts_at > now()))::int as chloe,
           (count(*) filter (where status in ('booked', 'confirmed')
                              and (starts_at at time zone 'Asia/Singapore')::date = $3::date))::int as today
         from public.appointments`,
        [CUSTOMER.daniel, CUSTOMER.chloe, anchor],
      );
      return rows[0];
    });
    expect(counts.daniel).toBe(0);
    expect(counts.chloe).toBeLessThanOrEqual(2);
    expect(counts.today).toBeLessThanOrEqual(3);
  });

  it("Tan's appointment is linked to J-000014 and completed with it, dated at its check-in and completion (D36, D40)", async () => {
    await owner(async (tx) => {
      const { rows } = await tx.query(
        `select a.status::text, a.checked_in_at = w.checked_in_at as checked_in_with_job,
                a.arrived_at = w.checked_in_at as arrived_with_job,
                a.completed_at = w.completed_at as completed_with_job, w.id as job
           from public.appointments a join public.work_orders w on w.appointment_id = a.id
          where a.id = $1`,
        [APPOINTMENT.tanTarmacCompleted],
      );
      expect(rows).toEqual([
        {
          status: "completed",
          checked_in_with_job: true,
          arrived_with_job: true,
          completed_with_job: true,
          job: REPORT_JOB.lossLine,
        },
      ]);
      const history = await tx.query(
        `select event_type::text, payload from public.appointment_events
          where appointment_id = $1 order by created_at, id`,
        [APPOINTMENT.tanTarmacCompleted],
      );
      expect(history.rows.map((r) => r.event_type)).toEqual([
        "booked",
        "checked_in",
        "work_order_linked",
        "completed",
      ]);
      expect(history.rows[2].payload).toEqual({
        work_order_id: REPORT_JOB.lossLine,
        job_number: "J-000014",
        created: false,
      });
      const timeline = await tx.query(
        `select event_type::text, created_at = (select checked_in_at from public.work_orders where id = $1) as at_check_in
           from public.work_order_events where work_order_id = $1 order by created_at, id limit 2`,
        [REPORT_JOB.lossLine],
      );
      expect(timeline.rows).toEqual([
        { event_type: "checked_in", at_check_in: true },
        { event_type: "appointment_linked", at_check_in: true },
      ]);
    });
  });

  it("each seeded status was reached one UPDATE at a time, so every history reads true", async () => {
    const { rows } = await owner((tx) =>
      tx.query(
        `select a.id, array_agg(e.event_type::text order by e.created_at, e.id) as history
           from public.appointments a join public.appointment_events e on e.appointment_id = a.id
          where a.id = any ($1::uuid[]) group by a.id`,
        [Object.values(APPOINTMENT)],
      ),
    );
    const history = Object.fromEntries(rows.map((r) => [r.id, r.history]));
    expect(history[APPOINTMENT.danielNoShow]).toEqual(["booked", "no_show"]);
    expect(history[APPOINTMENT.priyaArrived]).toEqual(["booked", "arrived"]);
    expect(history[APPOINTMENT.hafizConfirmed]).toEqual(["booked", "confirmed"]);
    expect(history[APPOINTMENT.chloeGiantOnline]).toEqual(["booked"]);
    expect(history[APPOINTMENT.priyaTernCancelled]).toEqual(["booked", "cancelled"]);
  });
});

describe("Chloe Lim's seeded customer login (D42)", () => {
  it("is linked to CUSTOMER.chloe, and my_appointments() returns exactly her upcoming rows without internal fields", async () => {
    const linked = await owner(async (tx) => {
      const { rows } = await tx.query(
        `select c.id, u.email::text from public.customers c join auth.users u on u.id = c.auth_user_id
          where c.auth_user_id = $1`,
        [CUSTOMER_LOGIN.chloe.authUserId],
      );
      return rows;
    });
    expect(linked).toEqual([{ id: CUSTOMER.chloe, email: CUSTOMER_LOGIN.chloe.email }]);

    const upcoming = await owner(async (tx) =>
      (
        await tx.query<{ id: string }>(
          "select id from public.appointments where customer_id = $1 and ends_at > now() order by starts_at",
          [CUSTOMER.chloe],
        )
      ).rows.map((r) => r.id),
    );
    expect(
      upcoming.every((id) =>
        [APPOINTMENT.chloeGiantOnline, APPOINTMENT.chloeSurlyOnline].includes(id as never),
      ),
    ).toBe(true);
    expect(upcoming).toContain(APPOINTMENT.chloeSurlyOnline);

    await asAuthUser(conn, CUSTOMER_LOGIN.chloe.authUserId, async (tx) => {
      const { rows, fields } = await tx.query("select * from public.my_appointments()");
      expect(fields.map((f) => f.name)).toEqual([...MY_APPOINTMENT_COLUMNS]);
      expect(rows.map((r) => r.id)).toEqual(upcoming);
      const surly = rows.find((r) => r.id === APPOINTMENT.chloeSurlyOnline);
      expect(surly).toMatchObject({
        appointment_type_name: "Custom build consultation",
        status: "booked",
        bike_id: BIKE.chloeSurly,
        customer_note: "Planning a touring rebuild with dynamo lights.",
        can_cancel: true,
      });
    });
  });
});
