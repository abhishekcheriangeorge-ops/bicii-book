/**
 * Appointment counts for Today and the reports (SPEC §19.1, §19.2; PLAN
 * D30 FIN-ACCESS, D36, D40, D41 APPT-COUNTS).
 *
 *   * reporting.appointment_daily / public.appointment_daily count by the
 *     appointment's SCHEDULED shop day and its CURRENT status (D41):
 *     booked = not cancelled; expected = booked or confirmed; arrived =
 *     arrived, checked_in or completed; checked_in = checked_in or
 *     completed; no_shows; cancelled. Expected values here are computed
 *     from the appointments table in the test, never hard-coded twice.
 *   * daily_summary's appointments_scheduled / arrived / no_show are
 *     appointment_daily's booked / arrived / no_shows, for every staff
 *     member (operational, D30); customers and anonymous visitors get
 *     42501.
 *   * Every checked_in or completed appointment has exactly one work order
 *     of the same customer and bike (D40).
 *
 * Every test rolls back and none consumes a short-ID sequence, so the file
 * also runs against an existing seeded database.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, CUSTOMER_LOGIN, STAFF } from "../fixtures/ids";
import {
  addClosure,
  addDays,
  book,
  currentSlot,
  insertAppointment,
  makeType,
  markStatus,
  setSettings,
  sgt,
  shopToday,
  unitsUsed,
} from "./appointment-fixtures";
import { customerClaims } from "./customer-fixtures";
import {
  actAs,
  asStaff,
  connect,
  inTransaction,
  scalar,
  staffClaims,
  type Claims,
} from "./harness";
import { readAsOwner } from "./inventory-fixtures";
import { TEST_DAY, dailySummary, seedToday } from "./reporting-fixtures";
import { failsWith, makeCustomer, ownerMode } from "./workshop-fixtures";

let conn: pg.Client;
let anchor: string;

beforeAll(async () => {
  conn = await connect();
  anchor = await inTransaction(conn, (tx) => seedToday(tx));
});

type Counts = {
  booked: number;
  expected: number;
  arrived: number;
  checked_in: number;
  no_shows: number;
  cancelled: number;
};

const ZERO: Counts = {
  booked: 0,
  expected: 0,
  arrived: 0,
  checked_in: 0,
  no_shows: 0,
  cancelled: 0,
};

/** D41 from the table: per scheduled shop day, by current status (as the owner). */
async function countsFromTable(
  tx: pg.Client,
  from: string,
  to: string,
): Promise<Map<string, Counts>> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<{ day: string; status: string }>(
      `select to_char((starts_at at time zone 'Asia/Singapore')::date, 'YYYY-MM-DD') as day, status::text
         from public.appointments
        where (starts_at at time zone 'Asia/Singapore')::date between $1::date and $2::date`,
      [from, to],
    ),
  );
  const out = new Map<string, Counts>();
  for (const { day, status } of rows) {
    const c = out.get(day) ?? { ...ZERO };
    if (status !== "cancelled") c.booked++;
    if (status === "booked" || status === "confirmed") c.expected++;
    if (["arrived", "checked_in", "completed"].includes(status)) c.arrived++;
    if (status === "checked_in" || status === "completed") c.checked_in++;
    if (status === "no_show") c.no_shows++;
    if (status === "cancelled") c.cancelled++;
    out.set(day, c);
  }
  return out;
}

/** public.appointment_daily as whoever `tx` is, keyed by day. */
async function appointmentDaily(tx: pg.Client, from: string | null, to: string | null) {
  const { rows } = await tx.query<Counts & { day: string }>(
    `select to_char(day, 'YYYY-MM-DD') as day, booked, expected, arrived, checked_in, no_shows, cancelled
       from public.appointment_daily($1, $2)`,
    [from, to],
  );
  return rows;
}

const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

describe("Today and report counts are by scheduled day and current status (D41) — seeded", () => {
  it("appointment_daily equals the counts the appointments table implies, zero-filled, past and upcoming", async () => {
    const from = addDays(anchor, -10);
    const to = addDays(anchor, 21);
    await asStaff(conn, STAFF.admin, async (tx) => {
      const want = await countsFromTable(tx, from, to);
      const rows = await appointmentDaily(tx, from, to);
      expect(rows.map((r) => r.day)).toEqual(daysBetween(from, to));
      for (const r of rows) {
        const { day, ...counts } = r;
        expect({ day, ...counts }).toEqual({ day, ...(want.get(day) ?? ZERO) });
      }
      // The seed has appointments on day -3, day -1, the anchor and after it.
      expect(rows.filter((r) => r.booked + r.cancelled > 0).length).toBeGreaterThanOrEqual(5);

      // The view (owner) holds exactly the days that have appointments.
      const view = await readAsOwner(tx, () =>
        tx.query<Counts & { day: string }>(
          `select to_char(day, 'YYYY-MM-DD') as day, booked, expected, arrived, checked_in, no_shows, cancelled
             from reporting.appointment_daily where day between $1::date and $2::date order by day`,
          [from, to],
        ),
      );
      expect(view.rows).toEqual(rows.filter((r) => want.has(r.day)));
    });
  });

  it("daily_summary's appointment columns are appointment_daily's booked, arrived and no_shows for every seeded day", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      const today = await shopToday(tx);
      const from = addDays(anchor, -6);
      const to = anchor < today ? anchor : today;
      const counts = new Map((await appointmentDaily(tx, from, to)).map((r) => [r.day, r]));
      for (const r of await dailySummary(tx, from, to)) {
        const c = counts.get(r.day)!;
        expect({
          day: r.day,
          scheduled: r.appointments_scheduled,
          arrived: r.appointments_arrived,
          noShow: r.appointments_no_show,
        }).toEqual({ day: r.day, scheduled: c.booked, arrived: c.arrived, noShow: c.no_shows });
      }
    });
  });

  it("today_dashboard(null) gives mechanic2 (no permissions) the same three counts as the admin (D30)", async () => {
    const read = (staffId: string) =>
      asStaff(conn, staffId, async (tx) => {
        const { rows } = await tx.query(
          `select appointments_scheduled, appointments_arrived, appointments_no_show
             from public.today_dashboard(null)`,
        );
        const [today] = await appointmentDaily(tx, null, null);
        return { dashboard: rows[0], today };
      });
    const admin = await read(STAFF.admin);
    const mechanic2 = await read(STAFF.mechanic2);
    expect(mechanic2.dashboard).toEqual(admin.dashboard);
    expect(admin.dashboard).toEqual({
      appointments_scheduled: admin.today.booked,
      appointments_arrived: admin.today.arrived,
      appointments_no_show: admin.today.no_shows,
    });
  });

  it("customers (Chloe's seeded login) and anonymous visitors get 42501 from appointment_daily", async () => {
    await inTransaction(conn, async (tx) => {
      for (const claims of [
        customerClaims(CUSTOMER_LOGIN.chloe.authUserId),
        { role: "anon" } as Claims,
      ]) {
        await ownerMode(tx);
        await actAs(tx, claims);
        await failsWith(tx, () => tx.query("select * from public.appointment_daily(null, null)"), {
          code: "42501",
        });
      }
    });
  });

  it("refuses a range over 366 days or backwards (report_range_invalid), like daily_summary", async () => {
    await asStaff(conn, STAFF.mechanic2, async (tx) => {
      expect(await appointmentDaily(tx, anchor, addDays(anchor, 365))).toHaveLength(366);
      for (const [from, to] of [
        [anchor, addDays(anchor, 366)],
        [anchor, addDays(anchor, -1)],
      ])
        await failsWith(tx, () => appointmentDaily(tx, from, to), {
          code: "P0001",
          message: "report_range_invalid",
        });
      // One bound: that day.
      expect((await appointmentDaily(tx, anchor, null)).map((r) => r.day)).toEqual([anchor]);
      expect((await appointmentDaily(tx, null, anchor)).map((r) => r.day)).toEqual([anchor]);
    });
  });
});

describe("Counts move by scheduled day and current status, not by when staff tapped (D41)", () => {
  it("booking, arriving and a no-show today move today's counts; a no-show marked now on an older appointment counts on its own day", async () => {
    await inTransaction(conn, async (tx) => {
      // Today's current slot open and with room (owner).
      const today = await shopToday(tx);
      await addClosure(tx, {
        kind: "custom_hours",
        startsAt: sgt(today, "00:00"),
        endsAt: sgt(addDays(today, 1), "00:00"),
        opens: "00:00",
        closes: "24:00",
      });
      const slot = await currentSlot(tx);
      await setSettings(tx, {
        slotMinutes: 30,
        capacityUnits: (await unitsUsed(tx, slot.start, slot.end)) + 5,
      });
      const typeId = await makeType(tx, { durationMinutes: 30, capacityUnits: 1 });
      const customerId = await makeCustomer(tx);
      const past = TEST_DAY(80);
      const older = await insertAppointment(tx, {
        customerId,
        typeId,
        startsAt: sgt(past, "10:00"),
        endsAt: sgt(past, "10:30"),
        status: "booked",
      });
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));

      const todayCounts = async () => (await appointmentDaily(tx, today, today))[0];
      const summary = async () => (await dailySummary(tx, today, today))[0];
      const base = await todayCounts();
      const baseSummary = await summary();

      const a = await book(tx, { customerId, typeId, startsAt: slot.start });
      const b = await book(tx, { customerId, typeId, startsAt: slot.start });
      expect(await todayCounts()).toEqual({
        ...base,
        booked: base.booked + 2,
        expected: base.expected + 2,
      });
      await markStatus(tx, a.id, "arrived");
      await markStatus(tx, b.id, "no_show");
      const after = await todayCounts();
      expect(after).toEqual({
        ...base,
        booked: base.booked + 2,
        arrived: base.arrived + 1,
        no_shows: base.no_shows + 1,
      });
      expect(await summary()).toMatchObject({
        appointments_scheduled: Number(baseSummary.appointments_scheduled) + 2,
        appointments_arrived: Number(baseSummary.appointments_arrived) + 1,
        appointments_no_show: Number(baseSummary.appointments_no_show) + 1,
      });

      // A no-show tapped today on an appointment of an older day counts on
      // that day; today does not move.
      const [olderBefore] = await appointmentDaily(tx, past, past);
      await markStatus(tx, older, "no_show");
      expect((await appointmentDaily(tx, past, past))[0]).toEqual({
        ...olderBefore,
        expected: olderBefore.expected - 1,
        no_shows: olderBefore.no_shows + 1,
      });
      expect(await todayCounts()).toEqual(after);

      // Cancelling takes it out of booked (and arrived) on its own day.
      await tx.query("select public.cancel_appointment($1, 'Left before check-in')", [a.id]);
      expect(await todayCounts()).toEqual({
        ...after,
        booked: after.booked - 1,
        arrived: after.arrived - 1,
        cancelled: after.cancelled + 1,
      });
    });
  });
});

describe("Every checked_in or completed appointment has exactly one work order (D40)", () => {
  it("holds over every row, and every linked job has its appointment's customer and bike", async () => {
    await inTransaction(conn, (tx) =>
      readAsOwner(tx, async () => {
        const { rows: orphans } = await tx.query(
          `select a.id, a.status::text, count(w.id)::int as jobs
             from public.appointments a
             left join public.work_orders w on w.appointment_id = a.id
            group by a.id, a.status
           having (a.status in ('checked_in', 'completed')) <> (count(w.id) = 1)
               or count(w.id) > 1`,
        );
        expect(orphans).toEqual([]);
        const { rows: mismatched } = await tx.query(
          `select w.job_number
             from public.work_orders w
             join public.appointments a on a.id = w.appointment_id
            where a.customer_id <> w.customer_id or a.bike_id is distinct from w.bike_id`,
        );
        expect(mismatched).toEqual([]);
        expect(
          await scalar<number>(
            tx,
            "select count(*)::int from public.work_orders where appointment_id is not null",
          ),
        ).toBeGreaterThanOrEqual(1);
      }),
    );
  });
});
