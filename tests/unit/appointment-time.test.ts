/**
 * Zone helpers for the appointment grid (src/lib/appointments/time.ts; PLAN
 * D35, D38): Singapore wall times, a zone with daylight saving, "24:00".
 */
import { describe, expect, it } from "vitest";

import {
  addDays,
  daysFrom,
  formatHHMM,
  localDay,
  localMinutes,
  localParts,
  parseHHMM,
  weekStart,
  weekdayOf,
  zonedInstant,
} from "@/lib/appointments/time";

describe("zonedInstant", () => {
  it("reads a Singapore wall time (UTC+8, no daylight saving)", () => {
    expect(zonedInstant("2026-10-06", 10 * 60).toISOString()).toBe("2026-10-06T02:00:00.000Z");
    expect(zonedInstant("2026-10-06", 0).toISOString()).toBe("2026-10-05T16:00:00.000Z");
  });

  it("treats 1440 minutes ('24:00') as the next midnight", () => {
    expect(zonedInstant("2026-12-31", 1440).toISOString()).toBe(
      zonedInstant("2027-01-01", 0).toISOString(),
    );
  });

  it("follows daylight saving in a zone that has it", () => {
    // London: GMT in winter, BST (UTC+1) in summer.
    expect(zonedInstant("2031-01-15", 9 * 60, "Europe/London").toISOString()).toBe(
      "2031-01-15T09:00:00.000Z",
    );
    expect(zonedInstant("2031-07-15", 9 * 60, "Europe/London").toISOString()).toBe(
      "2031-07-15T08:00:00.000Z",
    );
    // The day the clocks go forward (30 March 2031): 03:00 BST is 02:00 UTC.
    expect(zonedInstant("2031-03-30", 3 * 60, "Europe/London").toISOString()).toBe(
      "2031-03-30T02:00:00.000Z",
    );
    // New York, the day the clocks go back (2 November 2031): 12:00 EST is 17:00 UTC.
    expect(zonedInstant("2031-11-02", 12 * 60, "America/New_York").toISOString()).toBe(
      "2031-11-02T17:00:00.000Z",
    );
  });

  it("refuses a day that is not YYYY-MM-DD", () => {
    expect(() => zonedInstant("2026-02-30", 0)).toThrow(RangeError);
  });
});

describe("localParts", () => {
  it("gives the shop-local date and minutes of an instant", () => {
    const late = new Date("2026-10-04T16:30:00Z"); // 00:30 on the 5th in Singapore
    expect(localDay(late)).toBe("2026-10-05");
    expect(localMinutes(late)).toBe(30);
    expect(localParts(new Date("2026-10-05T02:00:30.250Z"))).toEqual({
      dateKey: "2026-10-05",
      minutes: 600,
      seconds: 30,
      ms: 250,
    });
  });

  it("reads other zones too", () => {
    expect(localMinutes(new Date("2031-07-15T08:00:00Z"), "Europe/London")).toBe(9 * 60);
  });
});

describe("calendar days", () => {
  it("counts weekdays from Sunday = 0", () => {
    expect(weekdayOf("2031-03-02")).toBe(0);
    expect(weekdayOf("2031-03-03")).toBe(1);
    expect(weekdayOf("2031-03-08")).toBe(6);
  });

  it("starts the week strip on Monday", () => {
    expect(weekStart("2031-03-03")).toBe("2031-03-03");
    expect(weekStart("2031-03-05")).toBe("2031-03-03");
    expect(weekStart("2031-03-09")).toBe("2031-03-03"); // Sunday
    expect(weekStart("2031-03-10")).toBe("2031-03-10");
  });

  it("shifts and lists days across month ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysFrom("2026-02-27", 3)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });
});

describe("HH:MM", () => {
  it("parses wall times, Postgres's seconds and '24:00'", () => {
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("09:30")).toBe(570);
    expect(parseHHMM("19:00:00")).toBe(1140);
    expect(parseHHMM("24:00")).toBe(1440);
    expect(parseHHMM("24:00:00")).toBe(1440);
  });

  it("refuses anything else", () => {
    for (const bad of ["24:30", "9:00", "12:60", "ab:cd", ""]) {
      expect(() => parseHHMM(bad)).toThrow(RangeError);
    }
  });

  it("formats minutes, 1440 as '24:00'", () => {
    expect(formatHHMM(0)).toBe("00:00");
    expect(formatHHMM(570)).toBe("09:30");
    expect(formatHHMM(1440)).toBe("24:00");
    expect(() => formatHHMM(1441)).toThrow(RangeError);
  });
});
