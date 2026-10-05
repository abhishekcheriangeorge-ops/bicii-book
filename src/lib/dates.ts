/**
 * Date display (SPEC §24): timestamps are stored with time zone and shown in
 * Singapore local time by default. Formatting goes through Intl with an
 * explicit timeZone, so output never depends on the server's or browser's zone.
 */

export const SHOP_TIME_ZONE = "Asia/Singapore";
export const SHOP_LOCALE = "en-SG";

export type DateInput = Date | string | number;

export type ZoneOptions = { timeZone?: string; locale?: string };

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(options: Intl.DateTimeFormatOptions, zone: ZoneOptions = {}): Intl.DateTimeFormat {
  const timeZone = zone.timeZone ?? SHOP_TIME_ZONE;
  const locale = zone.locale ?? SHOP_LOCALE;
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    cache.set(key, f);
  }
  return f;
}

export function toDate(value: DateInput): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid date: ${String(value)}`);
  return d;
}

/** "5 Oct 2026" */
export function formatDate(value: DateInput, zone?: ZoneOptions): string {
  return fmt({ day: "numeric", month: "short", year: "numeric" }, zone).format(toDate(value));
}

/** "5 Oct 2026, 12:30 am" */
export function formatDateTime(value: DateInput, zone?: ZoneOptions): string {
  return fmt(
    { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" },
    zone,
  ).format(toDate(value));
}

/** "12:30 am" */
export function formatTime(value: DateInput, zone?: ZoneOptions): string {
  return fmt({ hour: "numeric", minute: "2-digit" }, zone).format(toDate(value));
}

/** "Mon, 5 Oct" — for day strips and board cards. */
export function formatDayShort(value: DateInput, zone?: ZoneOptions): string {
  return fmt({ weekday: "short", day: "numeric", month: "short" }, zone).format(toDate(value));
}

/**
 * The shop-local calendar day as "YYYY-MM-DD". Use it to group by day: the
 * UTC date is wrong for eight hours of every Singapore day.
 */
export function shopDateKey(value: DateInput, zone?: ZoneOptions): string {
  const parts = fmt({ year: "numeric", month: "2-digit", day: "2-digit" }, zone).formatToParts(
    toDate(value),
  );
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whole shop-local calendar days from `from` to `to` (job age, overdue). */
export function shopDaysBetween(from: DateInput, to: DateInput, zone?: ZoneOptions): number {
  const a = Date.parse(`${shopDateKey(from, zone)}T00:00:00Z`);
  const b = Date.parse(`${shopDateKey(to, zone)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** "Good morning" / "Good afternoon" / "Good evening" for the shop's local time. */
export function greetingFor(value: DateInput, zone?: ZoneOptions): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: zone?.timeZone ?? SHOP_TIME_ZONE,
    }).format(toDate(value)),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Singapore's UTC offset. It has had no daylight saving since 1982, so a
 * shop-local wall-clock time converts with a fixed offset.
 */
export const SHOP_UTC_OFFSET = "+08:00";

/** Midnight (shop time) at the start of the day `daysBack` days before `now`'s shop day. */
export function shopDayStart(now: DateInput, daysBack = 0): Date {
  const start = new Date(`${shopDateKey(now)}T00:00:00${SHOP_UTC_OFFSET}`);
  return new Date(start.getTime() - daysBack * 86_400_000);
}

/**
 * A shop-local wall-clock time from `<input type="datetime-local">`
 * ("2026-10-05T09:30", seconds optional) as an instant; null when malformed.
 */
export function fromShopLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}${SHOP_UTC_OFFSET}`);
  if (Number.isNaN(d.getTime())) return null;
  // Reject rollovers such as 31 February: the shop-local date must read back unchanged.
  return shopDateKey(d) === `${m[1]}-${m[2]}-${m[3]}` ? d : null;
}

/** An instant as the value of `<input type="datetime-local">` in shop time ("2026-10-05T09:30"). */
export function toShopLocal(value: DateInput): string {
  const parts = fmt(
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    },
    { locale: "en-GB" },
  ).formatToParts(toDate(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

const SHOP_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A shop day as "YYYY-MM-DD" when `value` is exactly that and a real
 * calendar date (no 31 February, no extra text); otherwise null. For
 * `?day=` parameters and other untrusted input.
 */
export function parseShopDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = SHOP_DAY.exec(value);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === value ? value : null;
}

/**
 * The shop day `n` calendar days after `day` (negative: before), across
 * month and year ends. Throws a RangeError for a day that is not
 * "YYYY-MM-DD".
 */
export function shiftShopDay(day: string, n: number): string {
  const valid = parseShopDay(day);
  if (valid === null) throw new RangeError(`Invalid shop day: ${String(day)}`);
  if (!Number.isInteger(n)) throw new RangeError(`Invalid day offset: ${String(n)}`);
  return new Date(Date.parse(`${valid}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The shop's calendar day at `now` (default: this instant) as "YYYY-MM-DD".
 * Display only: the database decides which day is today for reports (D35).
 */
export function shopToday(now: DateInput = new Date()): string {
  return shopDateKey(now);
}
