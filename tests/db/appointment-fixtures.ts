/**
 * The shared appointment DB fixture module (Phase 2). Tests of the booking
 * rules set the schedule they need inside their own (rolled-back)
 * transaction, so the seed's settings, weekly hours (Tue-Sun), types,
 * closures and appointments (step 2) never change a result:
 *
 *   * setSettings / setHours / addClosure / makeType / insertAppointment
 *     write as the connection's owner and return to the API role `tx` was
 *     acting as (like readAsOwner); setHours replaces every weekly row for
 *     the transaction only;
 *   * futureDay() picks a clear Tuesday-Friday at least 21 shop days ahead
 *     (the seed's appointments and closures reach at most 14 days ahead);
 *   * the RPC helpers call the public RPCs as whoever `tx` is.
 *
 * Nothing here deletes a seeded appointment, closure or type.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";

import type { SlotClosure, SlotHours } from "../fixtures/appointment-slot-cases";
import type { AppointmentStatus } from "../fixtures/appointment-transitions";
import { readAsOwner } from "./inventory-fixtures";
import { addDays, sgt, shopToday } from "./reporting-fixtures";

export { addDays, sgt, shopToday };

export type ShopSettingsPatch = {
  timezone?: string;
  slotMinutes?: number;
  capacityUnits?: number;
  minNoticeMinutes?: number;
  horizonDays?: number;
  customerLimit?: number;
  cancelCutoffMinutes?: number;
};

/** The standard test schedule: 30-minute grid, 2 units, D37's defaults. */
export const STANDARD_SETTINGS: Required<Omit<ShopSettingsPatch, "timezone">> = {
  slotMinutes: 30,
  capacityUnits: 2,
  minNoticeMinutes: 120,
  horizonDays: 60,
  customerLimit: 3,
  cancelCutoffMinutes: 120,
};

/** Every day 09:00-18:00 (tests that need a closed weekday say so). */
export const EVERY_DAY_9_TO_6: SlotHours[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opens: "09:00",
  closes: "18:00",
  active: true,
}));

/** Owner UPDATE of the settings row (only the given fields). */
export async function setSettings(tx: pg.Client, patch: ShopSettingsPatch): Promise<void> {
  const columns: Array<[string, unknown]> = [
    ["timezone", patch.timezone],
    ["intake_slot_minutes", patch.slotMinutes],
    ["intake_capacity_units", patch.capacityUnits],
    ["booking_min_notice_minutes", patch.minNoticeMinutes],
    ["booking_horizon_days", patch.horizonDays],
    ["customer_max_active_bookings", patch.customerLimit],
    ["customer_cancel_cutoff_minutes", patch.cancelCutoffMinutes],
  ];
  const given = columns.filter(([, v]) => v !== undefined);
  if (given.length === 0) return;
  await readAsOwner(tx, () =>
    tx.query(
      `update public.shop_settings set ${given.map(([c], i) => `${c} = $${i + 1}`).join(", ")} where id = 1`,
      given.map(([, v]) => v),
    ),
  );
}

/** Replaces every weekly row (owner; the transaction's rollback restores the seed's). */
export async function setHours(tx: pg.Client, hours: SlotHours[]): Promise<void> {
  await readAsOwner(tx, async () => {
    await tx.query("delete from public.shop_hours");
    for (const h of hours) {
      await tx.query(
        "insert into public.shop_hours (weekday, opens_at, closes_at, active) values ($1, $2, $3, $4)",
        [h.weekday, h.opens, h.closes, h.active],
      );
    }
  });
}

/** The standard schedule: settings (plus `patch`) and hours (every day 09:00-18:00 by default). */
export async function standardSchedule(
  tx: pg.Client,
  patch: ShopSettingsPatch = {},
  hours: SlotHours[] = EVERY_DAY_9_TO_6,
): Promise<void> {
  await setSettings(tx, { ...STANDARD_SETTINGS, ...patch });
  await setHours(tx, hours);
}

/** A closure row as stored (owner insert); returns its id. */
export async function addClosure(
  tx: pg.Client,
  c: SlotClosure,
  reason = "Test closure",
): Promise<string> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<{ id: string }>(
      `insert into public.closure_overrides (kind, starts_at, ends_at, opens_at, closes_at, reason)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [c.kind, c.startsAt, c.endsAt, c.opens ?? null, c.closes ?? null, reason],
    ),
  );
  return rows[0].id;
}

export type TypeSpec = {
  id?: string;
  name?: string;
  durationMinutes?: number;
  capacityUnits?: number;
  public?: boolean;
  active?: boolean;
};

/** A fresh appointment type (owner insert; a name the seed does not use); returns its id. */
export async function makeType(tx: pg.Client, t: TypeSpec = {}): Promise<string> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<{ id: string }>(
      `insert into public.appointment_types (id, name, duration_minutes, capacity_units, public, active)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        t.id ?? randomUUID(),
        t.name ?? `Test type ${randomUUID().slice(0, 8)}`,
        t.durationMinutes ?? 30,
        t.capacityUnits ?? 1,
        t.public ?? true,
        t.active ?? true,
      ],
    ),
  );
  return rows[0].id;
}

export type InsertAppointmentArgs = {
  id?: string;
  customerId: string;
  typeId: string;
  startsAt: string;
  endsAt: string;
  capacityUnits?: number;
  status?: AppointmentStatus;
  source?: "staff" | "customer";
  bikeId?: string | null;
};

/**
 * An appointment written as the owner (no capacity or hours check: the
 * owner and the seed may write history). Cancelled rows get a reason.
 */
export async function insertAppointment(tx: pg.Client, a: InsertAppointmentArgs): Promise<string> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<{ id: string }>(
      `insert into public.appointments
         (id, customer_id, appointment_type_id, starts_at, ends_at, capacity_units, status, source,
          bike_id, cancellation_reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [
        a.id ?? randomUUID(),
        a.customerId,
        a.typeId,
        a.startsAt,
        a.endsAt,
        a.capacityUnits ?? 1,
        a.status ?? "booked",
        a.source ?? "staff",
        a.bikeId ?? null,
        a.status === "cancelled" ? "Test cancellation" : null,
      ],
    ),
  );
  return rows[0].id;
}

export type AppointmentRow = {
  id: string;
  customer_id: string;
  bike_id: string | null;
  appointment_type_id: string;
  starts_at: Date;
  ends_at: Date;
  capacity_units: number;
  status: AppointmentStatus;
  source: "staff" | "customer";
  customer_note: string | null;
  internal_note: string | null;
  confirmed_at: Date | null;
  arrived_at: Date | null;
  checked_in_at: Date | null;
  completed_at: Date | null;
  no_show_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  cancelled_via: "staff" | "customer" | null;
  created_by_user_id: string | null;
  created_by_staff_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type BookArgs = {
  id?: string;
  customerId: string;
  typeId: string;
  startsAt: string;
  bikeId?: string | null;
  customerNote?: string | null;
  internalNote?: string | null;
};

/** public.book_appointment as whoever `tx` is; returns the row. */
export async function book(tx: pg.Client, a: BookArgs): Promise<AppointmentRow> {
  const { rows } = await tx.query<AppointmentRow>(
    `select (a).* from (
       select public.book_appointment($1, $2, $3, $4, $5, $6, $7) a
     ) s`,
    [
      a.id ?? randomUUID(),
      a.customerId,
      a.typeId,
      a.startsAt,
      a.bikeId ?? null,
      a.customerNote ?? null,
      a.internalNote ?? null,
    ],
  );
  return rows[0];
}

export type MyAppointmentRow = {
  id: string;
  appointment_type_id: string;
  appointment_type_name: string;
  starts_at: Date;
  ends_at: Date;
  status: AppointmentStatus;
  bike_id: string | null;
  bike_short_id: string | null;
  bike_title: string | null;
  customer_note: string | null;
  cancelled_at: Date | null;
  cancelled_via: "staff" | "customer" | null;
  created_at: Date;
  can_cancel: boolean;
};

/** D42: exactly these keys, in this order. */
export const MY_APPOINTMENT_COLUMNS = [
  "id",
  "appointment_type_id",
  "appointment_type_name",
  "starts_at",
  "ends_at",
  "status",
  "bike_id",
  "bike_short_id",
  "bike_title",
  "customer_note",
  "cancelled_at",
  "cancelled_via",
  "created_at",
  "can_cancel",
] as const;

/** public.book_my_appointment as whoever `tx` is; returns the projection. */
export async function bookMine(
  tx: pg.Client,
  a: {
    id?: string;
    typeId: string;
    startsAt: string;
    bikeId?: string | null;
    customerNote?: string | null;
  },
): Promise<MyAppointmentRow> {
  const { rows } = await tx.query<MyAppointmentRow>(
    "select (m).* from (select public.book_my_appointment($1, $2, $3, $4, $5) m) s",
    [a.id ?? randomUUID(), a.typeId, a.startsAt, a.bikeId ?? null, a.customerNote ?? null],
  );
  return rows[0];
}

/** public.cancel_my_appointment; the projection, or null (all fields null) for someone else's. */
export async function cancelMine(
  tx: pg.Client,
  id: string,
  reason: string | null = null,
): Promise<MyAppointmentRow | null> {
  const { rows } = await tx.query<MyAppointmentRow>(
    "select (m).* from (select public.cancel_my_appointment($1, $2) m) s",
    [id, reason],
  );
  return rows[0].id === null ? null : rows[0];
}

/** public.mark_appointment_status as whoever `tx` is; returns the row. */
export async function markStatus(
  tx: pg.Client,
  id: string,
  status: AppointmentStatus,
  reason: string | null = null,
): Promise<AppointmentRow> {
  const { rows } = await tx.query<AppointmentRow>(
    "select (a).* from (select public.mark_appointment_status($1, $2, $3) a) s",
    [id, status, reason],
  );
  return rows[0];
}

/** public.cancel_appointment as whoever `tx` is; returns the row. */
export async function cancel(
  tx: pg.Client,
  id: string,
  reason: string | null,
): Promise<AppointmentRow> {
  const { rows } = await tx.query<AppointmentRow>(
    "select (a).* from (select public.cancel_appointment($1, $2) a) s",
    [id, reason],
  );
  return rows[0];
}

/** The appointment as the owner sees it. */
export async function appointment(tx: pg.Client, id: string): Promise<AppointmentRow> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<AppointmentRow>("select * from public.appointments where id = $1", [id]),
  );
  return rows[0];
}

export type AppointmentEventRow = {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  payload: Record<string, unknown>;
  actor_staff_id: string | null;
  actor_user_id: string | null;
  correlation_id: string | null;
  created_at: Date;
};

/** The appointment's events in timeline order (created_at, id), read as the owner. */
export async function appointmentEvents(tx: pg.Client, id: string): Promise<AppointmentEventRow[]> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<AppointmentEventRow>(
      `select id::text, event_type::text, from_status::text, to_status::text, reason, payload,
              actor_staff_id, actor_user_id, correlation_id, created_at
         from public.appointment_events where appointment_id = $1 order by created_at, id`,
      [id],
    ),
  );
  return rows;
}

/** Day of week of 'YYYY-MM-DD' (0 = Sunday). */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/**
 * A clear Tuesday-Friday at least `minDays` shop days after today; `skip`
 * moves on to the next such day that many times (so cases get their own
 * dates).
 */
export async function futureDay(tx: pg.Client, skip = 0, minDays = 21): Promise<string> {
  let day = addDays(await shopToday(tx), minDays);
  let left = skip;
  for (;;) {
    const wd = weekdayOf(day);
    if (wd >= 2 && wd <= 5) {
      if (left === 0) return day;
      left -= 1;
    }
    day = addDays(day, 1);
  }
}

/** The shop-local wall time of an instant, "HH:MM" (read in the database). */
export async function localTime(tx: pg.Client, ts: Date | string): Promise<string> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<{ t: string }>(
      "select to_char(($1::timestamptz at time zone private.shop_timezone()), 'HH24:MI') as t",
      [ts],
    ),
  );
  return rows[0].t;
}

/**
 * Today's grid slot that contains now() (the transaction's): its shop day and
 * its [start, end) as ISO strings. It has started and not ended, so staff may
 * book it and mark it a no-show.
 */
export async function currentSlot(
  tx: pg.Client,
  slotMinutes = 30,
): Promise<{ day: string; start: string; end: string }> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<{ day: string; minutes: number }>(
      `select to_char(private.shop_today(), 'YYYY-MM-DD') as day,
              (extract(hour from now() at time zone private.shop_timezone()) * 60
               + extract(minute from now() at time zone private.shop_timezone()))::int as minutes`,
    ),
  );
  const { day, minutes } = rows[0];
  const startMin = Math.floor(minutes / slotMinutes) * slotMinutes;
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const end = startMin + slotMinutes;
  return {
    day,
    start: sgt(day, hhmm(startMin)),
    end: end === 1440 ? sgt(addDays(day, 1), "00:00") : sgt(day, hhmm(end)),
  };
}

/** Units held in [start, end) by appointments that count (not cancelled or no-show), as the owner. */
export async function unitsUsed(tx: pg.Client, start: string, end: string): Promise<number> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<{ n: number }>(
      `select coalesce(sum(capacity_units), 0)::int as n from public.appointments
        where status not in ('cancelled', 'no_show') and starts_at < $2 and ends_at > $1`,
      [start, end],
    ),
  );
  return rows[0].n;
}
