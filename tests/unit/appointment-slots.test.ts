/**
 * The SQL/TypeScript parity proof SPEC §27.1 asks for ("Appointment capacity
 * calculation"; PLAN D2, D37, D38): every case in
 * tests/fixtures/appointment-slot-cases.ts, which tests/db/appointment-slots.test.ts
 * runs through private.available_slots_at and private.appointment_slot_problem,
 * runs here through the TypeScript mirror (src/lib/appointments/slots.ts)
 * and must give exactly the same slots, remaining units and first refusal
 * code, in the same order.
 */
import { describe, expect, it } from "vitest";

import {
  SLOT_PROBLEM_ORDER,
  availableSlots,
  openStretches,
  scheduleWarning,
  slotProblem,
  windowUsage,
  type ScheduleContext,
} from "@/lib/appointments/slots";
import { formatHHMM, localParts } from "@/lib/appointments/time";

import {
  SETTINGS,
  WEEK,
  at,
  problemCases,
  slotCases,
  type ExpectedSlot,
  type SlotContext,
} from "../fixtures/appointment-slot-cases";

function contextOf(c: SlotContext): ScheduleContext {
  return {
    settings: c.settings,
    hours: c.hours,
    closures: c.closures,
    appointments: c.appointments,
  };
}

/** A slot as the database test prints it: local "HH:MM", "24:00" for the next midnight. */
function asWall(day: string, start: Date, end: Date, remaining: number | null): ExpectedSlot {
  const s = localParts(start, SETTINGS.timezone);
  const e = localParts(end, SETTINGS.timezone);
  return {
    start: formatHHMM(s.minutes),
    end: e.dateKey > day && e.minutes === 0 ? "24:00" : formatHHMM(e.minutes),
    remaining,
  };
}

describe("availableSlots mirrors private.available_slots_at (D38)", () => {
  for (const c of slotCases) {
    it(c.name, () => {
      const slots = availableSlots(
        { day: c.day, type: c.type, asOf: new Date(c.asOf), forStaff: c.forStaff },
        contextOf(c),
      );
      expect(slots.map((s) => asWall(c.day, s.start, s.end, s.remaining))).toEqual(c.expected);
    });
  }
});

describe("slotProblem mirrors private.appointment_slot_problem, codes in order (D38)", () => {
  it("checks the rules in the database's order", () => {
    expect(SLOT_PROBLEM_ORDER).toEqual([
      "appointment_slot_misaligned",
      "appointment_outside_hours",
      "appointment_closed",
      "appointment_capacity_exceeded",
    ]);
  });

  for (const c of problemCases) {
    it(c.name, () => {
      expect(
        slotProblem(
          { startsAt: c.startsAt, endsAt: c.endsAt, capacityUnits: c.capacityUnits },
          contextOf(c),
        ),
      ).toBe(c.expected);
    });
  }

  it("ignoreCapacity stops after the closure check (the day view's warnings)", () => {
    const full = problemCases.find((c) => c.expected === "appointment_capacity_exceeded")!;
    expect(
      slotProblem(
        { startsAt: full.startsAt, endsAt: full.endsAt, capacityUnits: full.capacityUnits },
        contextOf(full),
        { ignoreCapacity: true },
      ),
    ).toBeNull();
  });

  it("leaves one appointment out of the count (a reinstated no-show re-checking its place, D39)", () => {
    const ctx: ScheduleContext = {
      settings: SETTINGS,
      hours: WEEK,
      closures: [],
      appointments: [
        { id: "a", startsAt: at("10:00"), endsAt: at("10:30"), capacityUnits: 1, status: "booked" },
        { id: "b", startsAt: at("10:00"), endsAt: at("10:30"), capacityUnits: 1, status: "booked" },
      ],
    };
    const input = { startsAt: at("10:00"), endsAt: at("10:30"), capacityUnits: 1 };
    expect(slotProblem(input, ctx)).toBe("appointment_capacity_exceeded");
    expect(slotProblem({ ...input, excludeId: "a" }, ctx)).toBeNull();
  });

  it("takes capacity from capacityForWindow, the D2 extension point", () => {
    const ctx: ScheduleContext = {
      settings: SETTINGS,
      hours: WEEK,
      closures: [],
      appointments: [],
      capacityForWindow: (start) => (localParts(start).minutes === 10 * 60 ? 0 : 2),
    };
    expect(slotProblem({ startsAt: at("10:00"), endsAt: at("10:30"), capacityUnits: 1 }, ctx)).toBe(
      "appointment_capacity_exceeded",
    );
    expect(
      slotProblem({ startsAt: at("11:00"), endsAt: at("11:30"), capacityUnits: 1 }, ctx),
    ).toBeNull();
  });
});

describe("windowUsage (the day view's capacity bars)", () => {
  it("lists every window of the open hours with units used and capacity", () => {
    const ctx: ScheduleContext = {
      settings: SETTINGS,
      hours: WEEK,
      closures: [{ kind: "closed", startsAt: at("14:00"), endsAt: at("15:00") }],
      appointments: [
        { startsAt: at("10:00"), endsAt: at("11:00"), capacityUnits: 1, status: "confirmed" },
        { startsAt: at("10:30"), endsAt: at("11:00"), capacityUnits: 1, status: "booked" },
        { startsAt: at("10:30"), endsAt: at("11:00"), capacityUnits: 2, status: "cancelled" },
      ],
    };
    const windows = windowUsage("2031-03-04", ctx);
    expect(windows).toHaveLength(18);
    const row = (time: string) =>
      windows.find((w) => formatHHMM(localParts(w.start).minutes) === time)!;
    expect(row("09:00")).toMatchObject({ used: 0, capacity: 2, open: true, closed: false });
    expect(row("10:00")).toMatchObject({ used: 1, capacity: 2 });
    expect(row("10:30")).toMatchObject({ used: 2, capacity: 2 });
    expect(row("14:00")).toMatchObject({ closed: true });
  });

  it("keeps a window outside the hours that still holds units, over capacity after a settings change (D38)", () => {
    const ctx: ScheduleContext = {
      settings: { ...SETTINGS, capacityUnits: 1 },
      hours: WEEK,
      closures: [],
      appointments: [
        { startsAt: at("08:00"), endsAt: at("08:30"), capacityUnits: 1, status: "booked" },
        { startsAt: at("09:00"), endsAt: at("09:30"), capacityUnits: 2, status: "booked" },
      ],
    };
    const windows = windowUsage("2031-03-04", ctx);
    expect(windows[0]).toMatchObject({ used: 1, capacity: 1, open: false });
    expect(windows[1]).toMatchObject({ used: 2, capacity: 1, open: true });
  });
});

describe("openStretches", () => {
  it("is empty on a weekly closed day and when a closure covers every open hour", () => {
    const base = { settings: SETTINGS, hours: WEEK, closures: [] };
    expect(openStretches("2031-03-03", base)).toEqual([]);
    expect(
      openStretches("2031-03-04", {
        ...base,
        closures: [{ kind: "closed", startsAt: at("00:00"), endsAt: at("24:00") }],
      }),
    ).toEqual([]);
  });

  it("splits the open hours around a partial closure", () => {
    const stretches = openStretches("2031-03-04", {
      settings: SETTINGS,
      hours: WEEK,
      closures: [{ kind: "closed", startsAt: at("12:00"), endsAt: at("13:00") }],
    });
    expect(
      stretches.map((s) => [new Date(s.start).toISOString(), new Date(s.end).toISOString()]),
    ).toEqual([
      [new Date(at("09:00")).toISOString(), new Date(at("12:00")).toISOString()],
      [new Date(at("13:00")).toISOString(), new Date(at("18:00")).toISOString()],
    ]);
  });
});

describe("scheduleWarning (bookings a settings change left behind, D38)", () => {
  const base = { settings: SETTINGS, hours: WEEK, closures: [] };

  it("is null for a booking inside the hours, whatever the grid", () => {
    expect(scheduleWarning({ startsAt: at("10:00"), endsAt: at("10:30") }, base)).toBeNull();
    expect(scheduleWarning({ startsAt: at("10:15"), endsAt: at("10:45") }, base)).toBeNull();
  });

  it("flags a booking outside the hours", () => {
    expect(scheduleWarning({ startsAt: at("08:00"), endsAt: at("08:30") }, base)).toBe(
      "outside_hours",
    );
    expect(
      scheduleWarning(
        { startsAt: at("10:00", "2031-03-03"), endsAt: at("10:30", "2031-03-03") },
        base,
      ),
    ).toBe("outside_hours");
  });

  it("flags a closure first, even outside the hours", () => {
    const closures = [{ kind: "closed" as const, startsAt: at("00:00"), endsAt: at("24:00") }];
    expect(
      scheduleWarning({ startsAt: at("10:00"), endsAt: at("10:30") }, { ...base, closures }),
    ).toBe("closed");
    expect(
      scheduleWarning({ startsAt: at("08:00"), endsAt: at("08:30") }, { ...base, closures }),
    ).toBe("closed");
  });
});
