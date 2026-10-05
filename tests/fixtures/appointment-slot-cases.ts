/**
 * Slot and booking-rule cases for the appointment grid (SPEC §6, §27.1
 * "Appointment capacity calculation"; DATA-MODEL §3; PLAN D2, D37, D38).
 *
 * Shared by the database tests (tests/db/appointment-slots.test.ts runs
 * every case through private.available_slots_at and
 * private.appointment_slot_problem) and by step 3's TypeScript mirror, so
 * both sides are proven against the same data. Every date is fixed in 2031
 * (no dependence on now()); the shop time zone is Asia/Singapore (D35).
 *
 *   * `expected` lists the slots private.available_slots_at returns, in
 *     order, as shop-local wall times. A slot ending at the next midnight
 *     ends at "24:00". `remaining` is the least free capacity over the
 *     windows the slot overlaps BEFORE this booking (the private function
 *     returns it for everyone; public.available_slots shows it to staff
 *     only and returns NULL to everyone else).
 *   * `problemCases` give the FIRST rule a booking breaks, in this order:
 *     appointment_slot_misaligned, appointment_outside_hours,
 *     appointment_closed, appointment_capacity_exceeded (null: bookable).
 *
 * 2031-03-03 is a Monday (weekday 1), 2031-03-04 a Tuesday (weekday 2),
 * 2031-03-05 a Wednesday (weekday 3).
 */
import type { AppointmentStatus } from "./appointment-transitions";

export type SlotSettings = {
  timezone: string;
  slotMinutes: number;
  capacityUnits: number;
  minNoticeMinutes: number;
  horizonDays: number;
};

/** One weekly interval; weekday 0 = Sunday (as extract(dow)); closes may be "24:00". */
export type SlotHours = { weekday: number; opens: string; closes: string; active: boolean };

/** A closure as stored: closed blocks [startsAt, endsAt); custom_hours covers whole days. */
export type SlotClosure = {
  kind: "closed" | "custom_hours";
  startsAt: string;
  endsAt: string;
  opens?: string;
  closes?: string;
};

/** An existing appointment (only its time, units and status matter). */
export type SlotAppointment = {
  startsAt: string;
  endsAt: string;
  capacityUnits: number;
  status: AppointmentStatus;
};

export type SlotType = {
  durationMinutes: number;
  capacityUnits: number;
  public: boolean;
  active: boolean;
};

export type SlotContext = {
  settings: SlotSettings;
  hours: SlotHours[];
  closures: SlotClosure[];
  appointments: SlotAppointment[];
  type: SlotType;
};

export type ExpectedSlot = { start: string; end: string; remaining: number | null };

export type SlotCase = SlotContext & {
  name: string;
  /** The shop-local date asked for, YYYY-MM-DD. */
  day: string;
  /** The instant the question is asked (ISO). */
  asOf: string;
  forStaff: boolean;
  expected: ExpectedSlot[];
};

export type SlotProblemCode =
  | "appointment_slot_misaligned"
  | "appointment_outside_hours"
  | "appointment_closed"
  | "appointment_capacity_exceeded";

export type ProblemCase = SlotContext & {
  name: string;
  startsAt: string;
  endsAt: string;
  capacityUnits: number;
  expected: SlotProblemCode | null;
};

export const SETTINGS: SlotSettings = {
  timezone: "Asia/Singapore",
  slotMinutes: 30,
  capacityUnits: 2,
  minNoticeMinutes: 120,
  horizonDays: 60,
};

const DAY = "2031-03-04"; // Tuesday
const MONDAY = "2031-03-03";

/** 09:00-18:00 every day except Monday, whose row is inactive. */
export const WEEK: SlotHours[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opens: "09:00",
  closes: "18:00",
  active: weekday !== 1,
}));

/** The Tuesday rows replaced by `intervals` (other days as WEEK). */
function tuesday(...intervals: Array<[string, string]>): SlotHours[] {
  return [
    ...WEEK.filter((h) => h.weekday !== 2),
    ...intervals.map(([opens, closes]) => ({ weekday: 2, opens, closes, active: true })),
  ];
}

const TYPE_30: SlotType = { durationMinutes: 30, capacityUnits: 1, public: true, active: true };
const TYPE_60: SlotType = { durationMinutes: 60, capacityUnits: 1, public: true, active: true };

/** A Singapore wall time on a 2031 day as ISO: at("10:00") → 2031-03-04T10:00:00+08:00. */
export function at(time: string, day = DAY): string {
  const t = time === "24:00" ? "00:00" : time;
  const d =
    time === "24:00"
      ? new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
      : day;
  return `${d}T${t.length === 5 ? `${t}:00` : t}+08:00`;
}

/** "HH:MM" plus minutes, as "HH:MM" ("24:00" at midnight). */
function plus(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Slots starting every `step` minutes from `first` to `last` inclusive, each
 * `duration` long, all with `remaining` (a list builder for readability;
 * the rules themselves are only in the cases' expectations).
 */
export function slots(
  first: string,
  last: string,
  {
    step = 30,
    duration = 30,
    remaining = 2,
  }: { step?: number; duration?: number; remaining?: number | null } = {},
): ExpectedSlot[] {
  const out: ExpectedSlot[] = [];
  for (let t = first; t <= last; t = plus(t, step)) {
    out.push({ start: t, end: plus(t, duration), remaining });
  }
  return out;
}

const BASE: SlotContext = {
  settings: SETTINGS,
  hours: WEEK,
  closures: [],
  appointments: [],
  type: TYPE_30,
};

const STAFF_AS_OF = "2031-03-01T00:00:00+08:00";

export const slotCases: SlotCase[] = [
  {
    ...BASE,
    name: "a plain open day: every grid start from opening to the last that ends by closing",
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: slots("09:00", "17:30"),
  },
  {
    ...BASE,
    name: "a split day: no slot crosses the lunch gap",
    hours: tuesday(["09:00", "12:00"], ["13:00", "18:00"]),
    type: TYPE_60,
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: [
      ...slots("09:00", "11:00", { duration: 60 }),
      ...slots("13:00", "17:00", { duration: 60 }),
    ],
  },
  {
    ...BASE,
    name: "adjacent intervals form one continuous stretch",
    hours: tuesday(["09:00", "12:00"], ["12:00", "14:00"]),
    type: TYPE_60,
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: slots("09:00", "13:00", { duration: 60 }),
  },
  {
    ...BASE,
    name: "Monday's row is inactive: no slots",
    day: MONDAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: [],
  },
  {
    ...BASE,
    name: "a whole-day closure: no slots",
    closures: [{ kind: "closed", startsAt: at("00:00"), endsAt: at("24:00") }],
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: [],
  },
  {
    ...BASE,
    name: "a partial closure 14:00-16:00 removes the slots that overlap it",
    closures: [{ kind: "closed", startsAt: at("14:00"), endsAt: at("16:00") }],
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: [...slots("09:00", "13:30"), ...slots("16:00", "17:30")],
  },
  {
    ...BASE,
    name: "custom hours replace the weekly hours on that date",
    closures: [
      {
        kind: "custom_hours",
        startsAt: at("00:00"),
        endsAt: at("24:00"),
        opens: "10:00",
        closes: "14:00",
      },
    ],
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: slots("10:00", "13:30"),
  },
  {
    ...BASE,
    name: "custom hours open an otherwise closed Monday",
    closures: [
      {
        kind: "custom_hours",
        startsAt: at("00:00", MONDAY),
        endsAt: at("24:00", MONDAY),
        opens: "11:00",
        closes: "13:00",
      },
    ],
    day: MONDAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: slots("11:00", "12:30"),
  },
  {
    ...BASE,
    name: "custom hours plus a partial closure: the closure still wins",
    closures: [
      {
        kind: "custom_hours",
        startsAt: at("00:00"),
        endsAt: at("24:00"),
        opens: "10:00",
        closes: "14:00",
      },
      { kind: "closed", startsAt: at("11:00"), endsAt: at("12:00") },
    ],
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: [...slots("10:00", "10:30"), ...slots("12:00", "13:30")],
  },
  {
    ...BASE,
    name: "a whole-day closure beats custom hours",
    closures: [
      {
        kind: "custom_hours",
        startsAt: at("00:00"),
        endsAt: at("24:00"),
        opens: "10:00",
        closes: "14:00",
      },
      { kind: "closed", startsAt: at("00:00"), endsAt: at("24:00") },
    ],
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: [],
  },
  {
    ...BASE,
    name: "a 60-minute 2-unit type is excluded wherever one overlapped window already has 1 used",
    appointments: [
      { startsAt: at("10:30"), endsAt: at("11:00"), capacityUnits: 1, status: "booked" },
    ],
    type: { durationMinutes: 60, capacityUnits: 2, public: true, active: true },
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: [
      ...slots("09:00", "09:30", { duration: 60 }),
      ...slots("11:00", "17:00", { duration: 60 }),
    ],
  },
  {
    ...BASE,
    name: "remaining is the least free capacity over the overlapped windows",
    settings: { ...SETTINGS, capacityUnits: 3 },
    appointments: [
      { startsAt: at("10:00"), endsAt: at("10:30"), capacityUnits: 1, status: "booked" },
      { startsAt: at("10:30"), endsAt: at("11:00"), capacityUnits: 2, status: "confirmed" },
    ],
    hours: tuesday(["09:00", "12:00"]),
    type: TYPE_60,
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: [
      { start: "09:00", end: "10:00", remaining: 3 },
      { start: "09:30", end: "10:30", remaining: 2 },
      { start: "10:00", end: "11:00", remaining: 1 },
      { start: "10:30", end: "11:30", remaining: 1 },
      { start: "11:00", end: "12:00", remaining: 3 },
    ],
  },
  {
    ...BASE,
    name: "cancelled and no-show appointments consume nothing",
    settings: { ...SETTINGS, capacityUnits: 1 },
    hours: tuesday(["09:00", "13:00"]),
    appointments: [
      { startsAt: at("10:00"), endsAt: at("10:30"), capacityUnits: 1, status: "cancelled" },
      { startsAt: at("11:00"), endsAt: at("11:30"), capacityUnits: 1, status: "no_show" },
      { startsAt: at("12:00"), endsAt: at("12:30"), capacityUnits: 1, status: "booked" },
    ],
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: [
      ...slots("09:00", "11:30", { remaining: 1 }),
      ...slots("12:30", "12:30", { remaining: 1 }),
    ],
  },
  {
    ...BASE,
    name: "opening at 10:15 on a 30-minute grid: the first slot is 10:30",
    hours: tuesday(["10:15", "12:00"]),
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: slots("10:30", "11:30"),
  },
  {
    ...BASE,
    name: "a 15-minute grid offers starts every 15 minutes",
    settings: { ...SETTINGS, slotMinutes: 15 },
    hours: tuesday(["09:00", "10:00"]),
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: slots("09:00", "09:30", { step: 15 }),
  },
  {
    ...BASE,
    name: "staff asking mid-day lose only the slots that have ended",
    day: DAY,
    asOf: at("12:10"),
    forStaff: true,
    expected: slots("12:00", "17:30"),
  },
  {
    ...BASE,
    name: "the public with 120 minutes' notice lose the slots starting too soon",
    day: DAY,
    asOf: at("10:05"),
    forStaff: false,
    expected: slots("12:30", "17:30"),
  },
  {
    ...BASE,
    name: "beyond the horizon the public get nothing",
    day: DAY,
    asOf: "2031-01-01T00:00:00+08:00",
    forStaff: false,
    expected: [],
  },
  {
    ...BASE,
    name: "on the horizon's last day the public get the starts up to that time of day",
    day: DAY,
    asOf: "2031-01-03T12:00:00+08:00",
    forStaff: false,
    expected: slots("09:00", "12:00"),
  },
  {
    ...BASE,
    name: "staff are not bound by the horizon",
    day: DAY,
    asOf: "2031-01-01T00:00:00+08:00",
    forStaff: true,
    expected: slots("09:00", "17:30"),
  },
  {
    ...BASE,
    name: "a non-public type offers the public nothing",
    type: { ...TYPE_30, public: false },
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: false,
    expected: [],
  },
  {
    ...BASE,
    name: "a non-public type is still bookable by staff",
    type: { ...TYPE_30, public: false },
    hours: tuesday(["09:00", "10:00"]),
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: slots("09:00", "09:30"),
  },
  {
    ...BASE,
    name: "an inactive type offers nothing, even to staff",
    type: { ...TYPE_30, active: false },
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: [],
  },
  {
    ...BASE,
    name: "closing at 24:00: the last slot is 23:30",
    hours: tuesday(["20:00", "24:00"]),
    day: DAY,
    asOf: STAFF_AS_OF,
    forStaff: true,
    expected: slots("20:00", "23:30"),
  },
];

export const problemCases: ProblemCase[] = [
  {
    ...BASE,
    name: "exactly fitting at opening: bookable",
    startsAt: at("09:00"),
    endsAt: at("09:30"),
    capacityUnits: 1,
    expected: null,
  },
  {
    ...BASE,
    name: "exactly fitting at closing: bookable",
    startsAt: at("17:30"),
    endsAt: at("18:00"),
    capacityUnits: 1,
    expected: null,
  },
  {
    ...BASE,
    name: "off the grid: misaligned",
    startsAt: at("09:15"),
    endsAt: at("09:45"),
    capacityUnits: 1,
    expected: "appointment_slot_misaligned",
  },
  {
    ...BASE,
    name: "seconds past a grid start: misaligned",
    startsAt: at("09:00:30"),
    endsAt: at("09:30:30"),
    capacityUnits: 1,
    expected: "appointment_slot_misaligned",
  },
  {
    ...BASE,
    name: "misaligned and outside hours: misaligned first",
    startsAt: at("08:45"),
    endsAt: at("09:15"),
    capacityUnits: 1,
    expected: "appointment_slot_misaligned",
  },
  {
    ...BASE,
    name: "before opening: outside hours",
    startsAt: at("08:30"),
    endsAt: at("09:00"),
    capacityUnits: 1,
    expected: "appointment_outside_hours",
  },
  {
    ...BASE,
    name: "crossing closing time: outside hours",
    startsAt: at("17:30"),
    endsAt: at("18:30"),
    capacityUnits: 1,
    expected: "appointment_outside_hours",
  },
  {
    ...BASE,
    name: "crossing the lunch gap: outside hours",
    hours: tuesday(["09:00", "12:00"], ["13:00", "18:00"]),
    startsAt: at("11:30"),
    endsAt: at("12:30"),
    capacityUnits: 1,
    expected: "appointment_outside_hours",
  },
  {
    ...BASE,
    name: "an inactive weekday: outside hours",
    startsAt: at("10:00", MONDAY),
    endsAt: at("10:30", MONDAY),
    capacityUnits: 1,
    expected: "appointment_outside_hours",
  },
  {
    ...BASE,
    name: "crossing local midnight, even with both sides open: outside hours",
    hours: [
      ...WEEK.filter((h) => h.weekday !== 2 && h.weekday !== 3),
      { weekday: 2, opens: "20:00", closes: "24:00", active: true },
      { weekday: 3, opens: "00:00", closes: "02:00", active: true },
    ],
    startsAt: at("23:30"),
    endsAt: at("00:30", "2031-03-05"),
    capacityUnits: 1,
    expected: "appointment_outside_hours",
  },
  {
    ...BASE,
    name: "custom hours replace the weekly hours: weekly-open time is outside hours",
    closures: [
      {
        kind: "custom_hours",
        startsAt: at("00:00"),
        endsAt: at("24:00"),
        opens: "10:00",
        closes: "14:00",
      },
    ],
    startsAt: at("09:00"),
    endsAt: at("09:30"),
    capacityUnits: 1,
    expected: "appointment_outside_hours",
  },
  {
    ...BASE,
    name: "inside custom hours: bookable",
    closures: [
      {
        kind: "custom_hours",
        startsAt: at("00:00"),
        endsAt: at("24:00"),
        opens: "10:00",
        closes: "14:00",
      },
    ],
    startsAt: at("13:30"),
    endsAt: at("14:00"),
    capacityUnits: 1,
    expected: null,
  },
  {
    ...BASE,
    name: "outside hours and closed: outside hours first",
    closures: [{ kind: "closed", startsAt: at("00:00"), endsAt: at("24:00") }],
    startsAt: at("08:00"),
    endsAt: at("08:30"),
    capacityUnits: 1,
    expected: "appointment_outside_hours",
  },
  {
    ...BASE,
    name: "touching a partial closure's start overlaps it: closed",
    closures: [{ kind: "closed", startsAt: at("14:00"), endsAt: at("16:00") }],
    startsAt: at("13:30"),
    endsAt: at("14:30"),
    capacityUnits: 1,
    expected: "appointment_closed",
  },
  {
    ...BASE,
    name: "ending exactly when a closure starts: bookable",
    closures: [{ kind: "closed", startsAt: at("14:00"), endsAt: at("16:00") }],
    startsAt: at("13:30"),
    endsAt: at("14:00"),
    capacityUnits: 1,
    expected: null,
  },
  {
    ...BASE,
    name: "closed and full: closed first",
    closures: [{ kind: "closed", startsAt: at("10:00"), endsAt: at("11:00") }],
    appointments: [
      { startsAt: at("10:00"), endsAt: at("10:30"), capacityUnits: 2, status: "booked" },
    ],
    startsAt: at("10:00"),
    endsAt: at("10:30"),
    capacityUnits: 1,
    expected: "appointment_closed",
  },
  {
    ...BASE,
    name: "full only: capacity exceeded",
    appointments: [
      { startsAt: at("10:00"), endsAt: at("10:30"), capacityUnits: 2, status: "booked" },
    ],
    startsAt: at("10:00"),
    endsAt: at("10:30"),
    capacityUnits: 1,
    expected: "appointment_capacity_exceeded",
  },
  {
    ...BASE,
    name: "a 60-minute booking whose second window is full: capacity exceeded",
    appointments: [
      { startsAt: at("10:30"), endsAt: at("11:00"), capacityUnits: 2, status: "confirmed" },
    ],
    startsAt: at("10:00"),
    endsAt: at("11:00"),
    capacityUnits: 1,
    expected: "appointment_capacity_exceeded",
  },
  {
    ...BASE,
    name: "two units where only one is free: capacity exceeded",
    appointments: [
      { startsAt: at("10:00"), endsAt: at("10:30"), capacityUnits: 1, status: "arrived" },
    ],
    startsAt: at("10:00"),
    endsAt: at("10:30"),
    capacityUnits: 2,
    expected: "appointment_capacity_exceeded",
  },
  {
    ...BASE,
    name: "checked-in and completed appointments still hold their units",
    appointments: [
      { startsAt: at("10:00"), endsAt: at("10:30"), capacityUnits: 1, status: "checked_in" },
      { startsAt: at("10:00"), endsAt: at("10:30"), capacityUnits: 1, status: "completed" },
    ],
    startsAt: at("10:00"),
    endsAt: at("10:30"),
    capacityUnits: 1,
    expected: "appointment_capacity_exceeded",
  },
  {
    ...BASE,
    name: "a full window next door does not count: bookable",
    appointments: [
      { startsAt: at("10:30"), endsAt: at("11:00"), capacityUnits: 2, status: "booked" },
    ],
    startsAt: at("10:00"),
    endsAt: at("10:30"),
    capacityUnits: 1,
    expected: null,
  },
  {
    ...BASE,
    name: "cancelled and no-show appointments free their units: bookable",
    appointments: [
      { startsAt: at("10:00"), endsAt: at("10:30"), capacityUnits: 2, status: "cancelled" },
      { startsAt: at("10:00"), endsAt: at("10:30"), capacityUnits: 2, status: "no_show" },
    ],
    startsAt: at("10:00"),
    endsAt: at("10:30"),
    capacityUnits: 2,
    expected: null,
  },
];
