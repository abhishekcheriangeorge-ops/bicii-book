/**
 * Appointment times for people, in shop time (SPEC §24; D35). Appointments
 * read on a 24-hour clock ("10:00–10:30"), like the shop's hours. Pure.
 */
import { SHOP_TIME_ZONE, formatDayShort, type DateInput } from "@/lib/dates";

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHOP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "09:30" in shop time. */
export function formatClock(value: DateInput): string {
  return clock.format(new Date(value));
}

/** "10:00–10:30" in shop time. */
export function formatTimeRange(start: DateInput, end: DateInput): string {
  return `${formatClock(start)}–${formatClock(end)}`;
}

/** "Tue, 6 Oct, 10:00–10:30": an appointment's heading. */
export function formatAppointmentWhen(start: DateInput, end: DateInput): string {
  return `${formatDayShort(start)}, ${formatTimeRange(start, end)}`;
}

/** "Tue, 6 Oct 10:00": a booking's confirmation toast. */
export function formatAppointmentStart(start: DateInput): string {
  return `${formatDayShort(start)} ${formatClock(start)}`;
}
