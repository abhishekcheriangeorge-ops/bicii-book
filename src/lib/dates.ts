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
