/**
 * Wall-clock helpers for the appointment grid (PLAN D35, D38). Pure: safe in
 * Client Components and unit tests. Calendar days are "YYYY-MM-DD" strings
 * (src/lib/dates.ts parses, shifts and formats them; nothing here repeats
 * that); instants are Dates. Zone conversions go through Intl with an
 * explicit time zone, so they are right in any zone with daylight saving,
 * although the shop's own zone (Asia/Singapore, SHOP_TIME_ZONE) has none.
 */
import { SHOP_TIME_ZONE, parseShopDay, shiftShopDay } from "@/lib/dates";

/** Minutes in a day: "24:00" is the next midnight. */
export const MINUTES_PER_DAY = 1440;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormat(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** An instant's wall clock in `timeZone`: its date, minutes since midnight, seconds and milliseconds. */
export type LocalParts = { dateKey: string; minutes: number; seconds: number; ms: number };

export function localParts(instant: Date, timeZone: string = SHOP_TIME_ZONE): LocalParts {
  const parts = partsFormat(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  // Some engines print midnight as "24" with hourCycle h23 in older builds.
  const hour = Number(get("hour")) % 24;
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
    seconds: Number(get("second")),
    ms: ((instant.getTime() % 1000) + 1000) % 1000,
  };
}

/** Minutes since local midnight of `instant` in `timeZone` (seconds dropped). */
export function localMinutes(instant: Date, timeZone: string = SHOP_TIME_ZONE): number {
  return localParts(instant, timeZone).minutes;
}

/** The local calendar day of `instant` in `timeZone`, "YYYY-MM-DD". */
export function localDay(instant: Date, timeZone: string = SHOP_TIME_ZONE): string {
  return localParts(instant, timeZone).dateKey;
}

/** The zone's offset from UTC at `instant`, in milliseconds (Singapore: +8 h). */
function offsetAt(instantMs: number, timeZone: string): number {
  const p = localParts(new Date(instantMs), timeZone);
  const [y, m, d] = p.dateKey.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, p.minutes, p.seconds);
  return wall - (instantMs - (((instantMs % 1000) + 1000) % 1000));
}

/**
 * The instant at which the wall clock in `timeZone` reads `dateKey` plus
 * `minutes` since midnight (1440 = the next midnight), like Postgres's
 * `(day + interval) at time zone tz`. Two passes over Intl's offset make it
 * right on daylight-saving days too; a wall time that a spring-forward gap
 * skips resolves with the offset in force before the change.
 */
export function zonedInstant(
  dateKey: string,
  minutes: number,
  timeZone: string = SHOP_TIME_ZONE,
): Date {
  const valid = parseShopDay(dateKey);
  if (valid === null) throw new RangeError(`Invalid day: ${String(dateKey)}`);
  const [y, m, d] = valid.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  const first = wall - offsetAt(wall, timeZone);
  const second = wall - offsetAt(first, timeZone);
  if (second === first) return new Date(first);
  // A gap or an overlap: keep the candidate whose wall clock reads back.
  return new Date(offsetAt(second, timeZone) === wall - second ? second : first);
}

/** The day `n` calendar days after `dateKey` (negative: before). */
export function addDays(dateKey: string, n: number): string {
  return shiftShopDay(dateKey, n);
}

/** The weekday of a calendar day, 0 = Sunday .. 6 = Saturday (as Postgres extract(dow)). */
export function weekdayOf(dateKey: string): number {
  const valid = parseShopDay(dateKey);
  if (valid === null) throw new RangeError(`Invalid day: ${String(dateKey)}`);
  return new Date(`${valid}T00:00:00Z`).getUTCDay();
}

/** The Monday on or before `dateKey`: the first day of the week strip. */
export function weekStart(dateKey: string): string {
  return addDays(dateKey, -((weekdayOf(dateKey) + 6) % 7));
}

/** The calendar days from `dateKey`, `count` of them. */
export function daysFrom(dateKey: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(dateKey, i));
}

const HHMM = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/**
 * "HH:MM" (or Postgres's "HH:MM:SS") as minutes since midnight; "24:00" is
 * 1440. Throws a RangeError for anything else.
 */
export function parseHHMM(value: string): number {
  const m = HHMM.exec(value.trim());
  if (!m) throw new RangeError(`Invalid time: ${String(value)}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3] ?? "0");
  if (h === 24 && min === 0 && sec === 0) return MINUTES_PER_DAY;
  if (h > 23 || min > 59 || sec > 59) throw new RangeError(`Invalid time: ${String(value)}`);
  return h * 60 + min;
}

/** Minutes since midnight as "HH:MM"; 1440 is "24:00". */
export function formatHHMM(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) {
    throw new RangeError(`Invalid minutes: ${String(minutes)}`);
  }
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
