/**
 * The appointment grid in TypeScript (SPEC §6, §27.1 "Appointment capacity
 * calculation"; PLAN D2, D37, D38): an exact mirror of the database's
 * private.shop_hours_ranges, private.closed_ranges,
 * private.appointment_windows, private.appointment_slot_problem and
 * private.available_slots_at (migrations 20261004002800 and
 * 20261004002900). The booking sheet computes every day's times from one
 * schedule load with it, and the day view draws its capacity bars; the
 * database stays the authority and checks every booking again under its
 * locks. tests/unit/appointment-slots.test.ts runs the shared fixtures
 * (tests/fixtures/appointment-slot-cases.ts) that the database test runs,
 * so both sides give the same answers, refusal codes in the same order.
 *
 * Pure: no server-only imports.
 */
import { SHOP_TIME_ZONE } from "@/lib/dates";

import { addDays, localParts, MINUTES_PER_DAY, parseHHMM, weekdayOf, zonedInstant } from "./time";

export type ScheduleSettings = {
  timezone: string;
  slotMinutes: number;
  capacityUnits: number;
  minNoticeMinutes: number;
  horizonDays: number;
};

/** One weekly interval; weekday 0 = Sunday; times "HH:MM" or "HH:MM:SS"; closes may be "24:00". */
export type ScheduleHours = { weekday: number; opens: string; closes: string; active: boolean };

/** A closure as stored: closed blocks [startsAt, endsAt); custom_hours covers whole local days. */
export type ScheduleClosure = {
  kind: "closed" | "custom_hours";
  startsAt: string | Date;
  endsAt: string | Date;
  opens?: string | null;
  closes?: string | null;
};

/** What capacity cares about in an appointment. */
export type ScheduleAppointment = {
  id?: string;
  startsAt: string | Date;
  endsAt: string | Date;
  capacityUnits: number;
  status: string;
};

export type ScheduleType = {
  durationMinutes: number;
  capacityUnits: number;
  public: boolean;
  active: boolean;
};

/**
 * D2 EXTENSION POINT, as private.capacity_for_window: the units one window
 * can take. Defaults to the shop-wide pool (settings.capacityUnits).
 */
export type CapacityForWindow = (windowStart: Date, windowEnd: Date) => number;

export type ScheduleContext = {
  settings: ScheduleSettings;
  hours: readonly ScheduleHours[];
  closures: readonly ScheduleClosure[];
  appointments: readonly ScheduleAppointment[];
  capacityForWindow?: CapacityForWindow;
};

export type SlotProblem =
  | "appointment_slot_misaligned"
  | "appointment_outside_hours"
  | "appointment_closed"
  | "appointment_capacity_exceeded";

/** The order private.appointment_slot_problem checks the rules in (D38). */
export const SLOT_PROBLEM_ORDER: readonly SlotProblem[] = [
  "appointment_slot_misaligned",
  "appointment_outside_hours",
  "appointment_closed",
  "appointment_capacity_exceeded",
];

/** A [start, end) span in epoch milliseconds. */
export type Span = { start: number; end: number };

/** Statuses that hold no capacity (D2): cancelled and no-show appointments free their units. */
const FREES_CAPACITY = new Set(["cancelled", "no_show"]);

const ms = (v: string | Date): number => (v instanceof Date ? v.getTime() : Date.parse(v));

/** Merges overlapping or touching spans (Postgres range_agg). */
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/**
 * The open hours of one shop-local date as instants (private.shop_hours_ranges,
 * D38): a custom_hours closure covering the date's local midnight replaces
 * every weekly interval (the earliest such closure, as `order by starts_at
 * limit 1`); otherwise the ACTIVE weekly intervals of its weekday. Touching
 * intervals merge into one stretch. Closed overrides are not subtracted.
 */
export function shopHoursRanges(
  day: string,
  ctx: Pick<ScheduleContext, "hours" | "closures"> & { timezone?: string },
): Span[] {
  const tz = ctx.timezone ?? SHOP_TIME_ZONE;
  const dayStart = zonedInstant(day, 0, tz).getTime();
  const custom = ctx.closures
    .filter(
      (c) =>
        c.kind === "custom_hours" &&
        c.opens &&
        c.closes &&
        ms(c.startsAt) <= dayStart &&
        dayStart < ms(c.endsAt),
    )
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt))[0];
  if (custom) {
    return [
      {
        start: zonedInstant(day, parseHHMM(custom.opens!), tz).getTime(),
        end: zonedInstant(day, parseHHMM(custom.closes!), tz).getTime(),
      },
    ];
  }
  const weekday = weekdayOf(day);
  return merge(
    ctx.hours
      .filter((h) => h.active && h.weekday === weekday)
      .map((h) => ({
        start: zonedInstant(day, parseHHMM(h.opens), tz).getTime(),
        end: zonedInstant(day, parseHHMM(h.closes), tz).getTime(),
      })),
  );
}

/** The closed overrides overlapping [from, to), merged (private.closed_ranges). */
export function closedRanges(
  closures: readonly ScheduleClosure[],
  from: number,
  to: number,
): Span[] {
  return merge(
    closures
      .filter((c) => c.kind === "closed")
      .map((c) => ({ start: ms(c.startsAt), end: ms(c.endsAt) }))
      .filter((c) => c.start < to && from < c.end),
  );
}

/**
 * The intake windows overlapping [from, to) (private.appointment_windows):
 * `slotMinutes` long, aligned to shop-local midnight (D38), on every local
 * date from `from`'s to the date of the last instant before `to`.
 */
export function appointmentWindows(settings: ScheduleSettings, from: number, to: number): Span[] {
  const tz = settings.timezone;
  const first = localParts(new Date(from), tz).dateKey;
  const last = localParts(new Date(to - 1), tz).dateKey;
  const out: Span[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) {
    for (let m = 0; m <= MINUTES_PER_DAY - settings.slotMinutes; m += settings.slotMinutes) {
      const start = zonedInstant(day, m, tz).getTime();
      const end = zonedInstant(day, m + settings.slotMinutes, tz).getTime();
      if (start < to && end > from) out.push({ start, end });
    }
  }
  return out;
}

/** Units already held in a window: every appointment that overlaps it, except cancelled and no-show ones. */
export function unitsUsed(
  appointments: readonly ScheduleAppointment[],
  window: Span,
  excludeId?: string | null,
): number {
  let used = 0;
  for (const a of appointments) {
    if (FREES_CAPACITY.has(a.status)) continue;
    if (excludeId && a.id === excludeId) continue;
    if (ms(a.startsAt) < window.end && ms(a.endsAt) > window.start) used += a.capacityUnits;
  }
  return used;
}

function capacityOf(ctx: ScheduleContext, w: Span): number {
  return ctx.capacityForWindow
    ? ctx.capacityForWindow(new Date(w.start), new Date(w.end))
    : ctx.settings.capacityUnits;
}

export type SlotProblemInput = {
  startsAt: string | Date;
  endsAt: string | Date;
  capacityUnits: number;
  /** Leave this appointment out of the capacity count (a reinstated no-show, D39). */
  excludeId?: string | null;
};

/**
 * The first rule a booking of [startsAt, endsAt) breaks, or null, in the
 * order private.appointment_slot_problem checks them (D38):
 * appointment_slot_misaligned, appointment_outside_hours,
 * appointment_closed, appointment_capacity_exceeded. `ignoreCapacity` stops
 * after the closure check (the day view's "Outside opening hours" / "Shop
 * closed" warnings on bookings a settings change left behind).
 */
export function slotProblem(
  input: SlotProblemInput,
  ctx: ScheduleContext,
  { ignoreCapacity = false }: { ignoreCapacity?: boolean } = {},
): SlotProblem | null {
  const start = ms(input.startsAt);
  const end = ms(input.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new RangeError("startsAt and endsAt must be instants");
  }
  if (end <= start) throw new RangeError("endsAt must be after startsAt");
  const tz = ctx.settings.timezone;
  const local = localParts(new Date(start), tz);

  if (local.seconds !== 0 || local.ms !== 0 || local.minutes % ctx.settings.slotMinutes !== 0) {
    return "appointment_slot_misaligned";
  }

  const endDay = localParts(new Date(end - 1), tz).dateKey;
  const open = shopHoursRanges(local.dateKey, { ...ctx, timezone: tz });
  if (endDay !== local.dateKey || !open.some((r) => r.start <= start && end <= r.end)) {
    return "appointment_outside_hours";
  }

  if (closedRanges(ctx.closures, start, end).some((c) => c.start < end && start < c.end)) {
    return "appointment_closed";
  }

  if (ignoreCapacity) return null;
  const exceeded = appointmentWindows(ctx.settings, start, end).some(
    (w) =>
      unitsUsed(ctx.appointments, w, input.excludeId) + input.capacityUnits > capacityOf(ctx, w),
  );
  return exceeded ? "appointment_capacity_exceeded" : null;
}

export type AvailableSlot = {
  start: Date;
  end: Date;
  /** The least free capacity over the windows the slot overlaps, before this booking. */
  remaining: number | null;
};

export type AvailableSlotsInput = {
  /** The shop-local date, "YYYY-MM-DD". */
  day: string;
  type: ScheduleType;
  /** The instant the question is asked. */
  asOf: Date;
  forStaff: boolean;
};

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * The bookable starts of one shop-local date for one type, as of `asOf`
 * (private.available_slots_at, exactly): nothing for an inactive type, or a
 * non-public one unless `forStaff`; candidates every `slotMinutes` from
 * local midnight, each [s, s + duration) with no slot problem; staff keep
 * the slots that have not ended (end > asOf; D37: exempt from notice,
 * horizon and the public flag), everyone else the starts at least the
 * notice ahead and at most the horizon ahead (and nothing on a date past
 * the horizon). `remaining` is the least free capacity over the overlapped
 * windows before this booking (the database shows it to staff only).
 */
export function availableSlots(input: AvailableSlotsInput, ctx: ScheduleContext): AvailableSlot[] {
  const { day, type, asOf, forStaff } = input;
  const { settings } = ctx;
  if (!type.active || (!forStaff && !type.public)) return [];
  const asOfMs = asOf.getTime();
  if (!forStaff) {
    const today = localParts(asOf, settings.timezone).dateKey;
    if (day > addDays(today, settings.horizonDays)) return [];
  }
  const out: AvailableSlot[] = [];
  for (let m = 0; m <= MINUTES_PER_DAY - settings.slotMinutes; m += settings.slotMinutes) {
    const start = zonedInstant(day, m, settings.timezone).getTime();
    const end = start + type.durationMinutes * MINUTE;
    const timely = forStaff
      ? end > asOfMs
      : start >= asOfMs + settings.minNoticeMinutes * MINUTE &&
        start <= asOfMs + settings.horizonDays * DAY;
    if (!timely) continue;
    if (
      slotProblem(
        { startsAt: new Date(start), endsAt: new Date(end), capacityUnits: type.capacityUnits },
        ctx,
      ) !== null
    ) {
      continue;
    }
    const remaining = Math.min(
      ...appointmentWindows(settings, start, end).map(
        (w) => capacityOf(ctx, w) - unitsUsed(ctx.appointments, w),
      ),
    );
    out.push({ start: new Date(start), end: new Date(end), remaining });
  }
  return out;
}

export type WindowUsage = {
  start: Date;
  end: Date;
  /** Units held by the day's appointments (may exceed capacity after a settings change, D38). */
  used: number;
  capacity: number;
  /** Inside the day's open hours. */
  open: boolean;
  /** Overlaps a closed override. */
  closed: boolean;
};

/**
 * Each grid window of one shop-local date that is inside its open hours or
 * holds units, with the units used and the window's capacity, for the day
 * view's capacity bars. A booking left outside the hours by a settings
 * change keeps its window in the list (D38: screens flag them).
 */
export function windowUsage(day: string, ctx: ScheduleContext): WindowUsage[] {
  const tz = ctx.settings.timezone;
  const open = shopHoursRanges(day, { ...ctx, timezone: tz });
  const dayStart = zonedInstant(day, 0, tz).getTime();
  const dayEnd = zonedInstant(day, MINUTES_PER_DAY, tz).getTime();
  const closed = closedRanges(ctx.closures, dayStart, dayEnd);
  return appointmentWindows(ctx.settings, dayStart, dayEnd)
    .map((w) => ({
      start: new Date(w.start),
      end: new Date(w.end),
      used: unitsUsed(ctx.appointments, w),
      capacity: capacityOf(ctx, w),
      open: open.some((r) => r.start < w.end && w.start < r.end),
      closed: closed.some((c) => c.start < w.end && w.start < c.end),
    }))
    .filter((w) => w.open || w.used > 0);
}

/**
 * The open stretches of a date with its closed overrides taken out: empty
 * when the shop is closed all day (weekly closed, or a closure covering
 * every open hour).
 */
export function openStretches(
  day: string,
  ctx: Pick<ScheduleContext, "settings" | "hours" | "closures">,
): Span[] {
  const tz = ctx.settings.timezone;
  const open = shopHoursRanges(day, { ...ctx, timezone: tz });
  const dayStart = zonedInstant(day, 0, tz).getTime();
  const dayEnd = zonedInstant(day, MINUTES_PER_DAY, tz).getTime();
  const closed = closedRanges(ctx.closures, dayStart, dayEnd);
  const out: Span[] = [];
  for (const r of open) {
    let pieces: Span[] = [r];
    for (const c of closed) {
      pieces = pieces.flatMap((p) => {
        if (c.end <= p.start || p.end <= c.start) return [p];
        const keep: Span[] = [];
        if (p.start < c.start) keep.push({ start: p.start, end: c.start });
        if (c.end < p.end) keep.push({ start: c.end, end: p.end });
        return keep;
      });
    }
    out.push(...pieces);
  }
  return out;
}
