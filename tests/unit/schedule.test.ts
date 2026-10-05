import { describe, expect, it } from "vitest";

import {
  WEEKDAYS,
  appointmentTypeSchema,
  cancelCutoffSentence,
  capacitySentence,
  closureDays,
  closureLabel,
  closureSchema,
  deleteClosureSchema,
  formatDuration,
  formatIntervals,
  shopHoursSchema,
  shopSettingsSchema,
} from "@/lib/schedule";

const ID = "e4000000-0000-4000-8000-0000000000aa";
const errorsOf = (r: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (r.error?.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`);

describe("schedule wording", () => {
  it("lists the week Monday first, Sunday last (weekday 0 as stored)", () => {
    expect(WEEKDAYS.map((w) => w.name)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(WEEKDAYS.at(-1)!.weekday).toBe(0);
  });

  it("reads a day's hours, a split day and a closed day", () => {
    expect(formatIntervals([{ opens: "10:00", closes: "19:00" }], true)).toBe("10:00–19:00");
    expect(
      formatIntervals(
        [
          { opens: "09:00", closes: "12:30" },
          { opens: "13:30", closes: "18:00" },
        ],
        true,
      ),
    ).toBe("09:00–12:30, 13:30–18:00");
    expect(formatIntervals([{ opens: "10:00", closes: "19:00" }], false)).toBe("Closed");
    expect(formatIntervals([], true)).toBe("Closed");
  });

  it("says D2's pool and D37's cutoff in one line each", () => {
    expect(capacitySentence(30, 2)).toBe("Up to 2 bikes can be booked in for each 30-minute slot.");
    expect(capacitySentence(15, 1)).toBe("Up to 1 bike can be booked in for each 15-minute slot.");
    expect(cancelCutoffSentence(120)).toBe("Customers can cancel online until 2 hours before.");
    expect(cancelCutoffSentence(0)).toBe(
      "Customers can cancel online until the appointment starts.",
    );
    expect(formatDuration(90)).toBe("1 hour 30 minutes");
    expect(formatDuration(45)).toBe("45 minutes");
    expect(formatDuration(10_080)).toBe("7 days");
  });

  it("names closures by kind and times, and their days", () => {
    expect(closureLabel({ kind: "closed", fromTime: null, toTime: null })).toBe("Closed all day");
    expect(closureLabel({ kind: "closed", fromTime: "14:00", toTime: "16:00" })).toBe(
      "Closed 14:00–16:00",
    );
    expect(closureLabel({ kind: "custom_hours", fromTime: "12:00", toTime: "16:00" })).toBe(
      "Open 12:00–16:00",
    );
    expect(closureDays("2026-11-11", "2026-11-11")).toBe("Wed, 11 Nov");
    expect(closureDays("2026-11-11", "2026-11-13")).toBe("Wed, 11 Nov – Fri, 13 Nov");
  });
});

describe("shopSettingsSchema (mirrors the shop_settings checks; no time zone, D35)", () => {
  const ok = {
    slotMinutes: "30",
    capacityUnits: "2",
    minNoticeMinutes: "120",
    horizonDays: "60",
    maxActiveBookings: "3",
    cancelCutoffMinutes: "120",
  };

  it("accepts the seeded values typed as text", () => {
    expect(shopSettingsSchema.parse(ok)).toEqual({
      slotMinutes: 30,
      capacityUnits: 2,
      minNoticeMinutes: 120,
      horizonDays: 60,
      maxActiveBookings: 3,
      cancelCutoffMinutes: 120,
    });
    expect(Object.keys(shopSettingsSchema.shape)).not.toContain("timezone");
  });

  it("D38: refuses a slot length that does not divide the day, or outside 5-240", () => {
    expect(shopSettingsSchema.safeParse({ ...ok, slotMinutes: "36" }).success).toBe(true);
    expect(errorsOf(shopSettingsSchema.safeParse({ ...ok, slotMinutes: "35" }))).toEqual([
      "slotMinutes: Pick a length that divides the day evenly, like 15, 20, 30 or 60 minutes.",
    ]);
    expect(shopSettingsSchema.safeParse({ ...ok, slotMinutes: "4" }).success).toBe(false);
    expect(shopSettingsSchema.safeParse({ ...ok, slotMinutes: "480" }).success).toBe(false);
  });

  it("keeps every number inside the database's bounds", () => {
    for (const [key, bad] of [
      ["capacityUnits", "0"],
      ["capacityUnits", "51"],
      ["minNoticeMinutes", "10081"],
      ["horizonDays", "0"],
      ["horizonDays", "366"],
      ["maxActiveBookings", "21"],
      ["cancelCutoffMinutes", "-1"],
      ["capacityUnits", "1.5"],
      ["capacityUnits", ""],
    ] as const) {
      expect(shopSettingsSchema.safeParse({ ...ok, [key]: bad }).success, `${key}=${bad}`).toBe(
        false,
      );
    }
  });
});

describe("shopHoursSchema (set_shop_hours)", () => {
  const day = (intervals: { opens: string; closes: string }[], active = true) =>
    shopHoursSchema.safeParse({ weekday: 0, active, intervals });

  it("accepts up to four ordered intervals, closing at 24:00 at the latest", () => {
    expect(day([{ opens: "09:00", closes: "13:00" }]).success).toBe(true);
    expect(
      day([
        { opens: "09:00", closes: "12:30" },
        { opens: "12:30", closes: "18:00" },
      ]).success,
    ).toBe(true);
    expect(day([{ opens: "18:00", closes: "24:00" }]).success).toBe(true);
    expect(day([{ opens: "24:00", closes: "24:00" }]).success).toBe(false);
  });

  it("refuses a closing time before the opening time, overlaps and a fifth interval", () => {
    expect(errorsOf(day([{ opens: "13:00", closes: "09:00" }]))).toEqual([
      "intervals: Interval 1: the closing time must be after the opening time.",
    ]);
    expect(
      errorsOf(
        day([
          { opens: "14:00", closes: "18:00" },
          { opens: "09:00", closes: "15:00" },
        ]),
      ),
    ).toEqual(["intervals: 09:00–15:00 and 14:00–18:00 overlap."]);
    const five = ["08", "10", "12", "14", "16"].map((h) => ({
      opens: `${h}:00`,
      closes: `${h}:30`,
    }));
    expect(day(five).success).toBe(false);
    expect(day([{ opens: "9:00", closes: "13:00" }]).success).toBe(false);
  });

  it("needs hours on an open day; a closed day may keep its intervals or have none", () => {
    expect(errorsOf(day([]))).toEqual(["intervals: Add the opening hours, or switch the day off."]);
    expect(day([], false).success).toBe(true);
    expect(day([{ opens: "10:00", closes: "19:00" }], false).success).toBe(true);
  });
});

describe("closureSchema (save_closure_override, D38)", () => {
  const base = {
    id: ID,
    isNew: true,
    kind: "closed" as const,
    firstDay: "2026-11-11",
    lastDay: "2026-11-11",
    reason: "Public holiday",
  };

  it("closes whole days without times, even when times were typed", () => {
    expect(closureSchema.parse({ ...base, lastDay: "2026-11-13", fromTime: "10:00" })).toEqual({
      ...base,
      lastDay: "2026-11-13",
      fromTime: null,
      toTime: null,
    });
  });

  it("closes part of ONE day with a start before the end", () => {
    expect(
      closureSchema.parse({ ...base, partDay: true, fromTime: "14:00", toTime: "16:00" }),
    ).toMatchObject({ fromTime: "14:00", toTime: "16:00" });
    expect(
      errorsOf(
        closureSchema.safeParse({
          ...base,
          lastDay: "2026-11-12",
          partDay: true,
          fromTime: "14:00",
          toTime: "16:00",
        }),
      ),
    ).toEqual(["lastDay: Part of a day closes one day only."]);
    expect(
      errorsOf(closureSchema.safeParse({ ...base, partDay: true, fromTime: "14:00" })),
    ).toEqual(["toTime: Enter the end time."]);
  });

  it("a short day needs its opening and closing times, in order", () => {
    const short = { ...base, kind: "custom_hours" as const };
    expect(closureSchema.parse({ ...short, fromTime: "12:00", toTime: "16:00" })).toMatchObject({
      kind: "custom_hours",
      fromTime: "12:00",
      toTime: "16:00",
    });
    expect(errorsOf(closureSchema.safeParse(short))).toEqual([
      "fromTime: Enter the opening time.",
      "toTime: Enter the closing time.",
    ]);
    expect(
      errorsOf(closureSchema.safeParse({ ...short, fromTime: "16:00", toTime: "12:00" })),
    ).toEqual(["toTime: The closing time must be after the opening time."]);
  });

  it("refuses a last day before the first, a missing reason and one over 200 characters", () => {
    expect(errorsOf(closureSchema.safeParse({ ...base, lastDay: "2026-11-10" }))).toEqual([
      "lastDay: The last day can't be before the first day.",
    ]);
    expect(closureSchema.safeParse({ ...base, reason: "  " }).success).toBe(false);
    expect(closureSchema.safeParse({ ...base, reason: "x".repeat(201) }).success).toBe(false);
    expect(closureSchema.safeParse({ ...base, firstDay: "2026-02-30" }).success).toBe(false);
  });

  it("deleting needs a reason of 1-500 characters", () => {
    expect(deleteClosureSchema.safeParse({ id: ID, reason: "Plans changed" }).success).toBe(true);
    expect(deleteClosureSchema.safeParse({ id: ID, reason: " " }).success).toBe(false);
    expect(deleteClosureSchema.safeParse({ id: ID, reason: "x".repeat(501) }).success).toBe(false);
  });
});

describe("appointmentTypeSchema (save_appointment_type)", () => {
  const base = {
    id: ID,
    isNew: true,
    name: "Bike fit",
    description: "",
    durationMinutes: "45",
    capacityUnits: "1",
    public: false,
    active: true,
    sortOrder: "100",
  };

  it("accepts a staff-only 45-minute type; a blank description is null", () => {
    expect(appointmentTypeSchema.parse(base)).toMatchObject({
      name: "Bike fit",
      description: null,
      durationMinutes: 45,
      capacityUnits: 1,
      sortOrder: 100,
    });
  });

  it("durations are 5-480 minutes in steps of 5; units 1-50; names 1-80", () => {
    expect(appointmentTypeSchema.safeParse({ ...base, durationMinutes: "47" }).success).toBe(false);
    expect(appointmentTypeSchema.safeParse({ ...base, durationMinutes: "485" }).success).toBe(
      false,
    );
    expect(appointmentTypeSchema.safeParse({ ...base, capacityUnits: "0" }).success).toBe(false);
    expect(appointmentTypeSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(appointmentTypeSchema.safeParse({ ...base, name: "x".repeat(81) }).success).toBe(false);
  });
});
