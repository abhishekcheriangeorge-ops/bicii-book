import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDayShort,
  formatShopDay,
  formatShopDayLong,
  formatShopDayShort,
  formatTime,
  fromShopLocal,
  EARLIEST_SHOP_DAY,
  parseShopDay,
  SHOP_TIME_ZONE,
  shiftShopDay,
  shopToday,
  shopDayStart,
  shopDayToDate,
  toShopLocal,
  shopDateKey,
  shopDaysBetween,
} from "@/lib/dates";

// Intl may use a narrow no-break space before am/pm; compare on plain spaces.
const plain = (s: string) => s.replace(/\s/g, " ");

describe("dates (Asia/Singapore by default)", () => {
  // 16:30 UTC on 4 Oct is 00:30 on 5 Oct in Singapore (UTC+8)
  const lateUtc = "2026-10-04T16:30:00Z";

  it("defaults to the shop time zone", () => {
    expect(SHOP_TIME_ZONE).toBe("Asia/Singapore");
  });

  it("formats the Singapore calendar day, not the UTC one", () => {
    expect(formatDate(lateUtc)).toBe("5 Oct 2026");
    expect(shopDateKey(lateUtc)).toBe("2026-10-05");
    expect(formatDayShort(lateUtc)).toBe("Mon, 5 Oct");
  });

  it("formats times in Singapore local time", () => {
    expect(plain(formatTime(lateUtc))).toBe("12:30 am");
    expect(plain(formatDateTime(lateUtc))).toBe("5 Oct 2026, 12:30 am");
    expect(plain(formatTime("2026-10-04T06:05:00Z"))).toBe("2:05 pm");
  });

  it("can format in another zone when asked", () => {
    expect(formatDate(lateUtc, { timeZone: "UTC" })).toBe("4 Oct 2026");
    expect(shopDateKey(lateUtc, { timeZone: "UTC" })).toBe("2026-10-04");
  });

  it("accepts Date, ISO string and epoch ms", () => {
    const ms = Date.parse(lateUtc);
    expect(formatDate(new Date(ms))).toBe("5 Oct 2026");
    expect(formatDate(ms)).toBe("5 Oct 2026");
  });

  it("rejects invalid dates", () => {
    expect(() => formatDate("not a date")).toThrow(RangeError);
  });

  it("counts shop-local calendar days", () => {
    // 23:00 SGT on 4 Oct → 01:00 SGT on 5 Oct is one calendar day apart
    expect(shopDaysBetween("2026-10-04T15:00:00Z", "2026-10-04T17:00:00Z")).toBe(1);
    expect(shopDaysBetween("2026-10-01T02:00:00Z", "2026-10-04T02:00:00Z")).toBe(3);
    expect(shopDaysBetween("2026-10-04T02:00:00Z", "2026-10-04T09:00:00Z")).toBe(0);
  });
});

describe("shop-local wall-clock times (Singapore, UTC+8, no daylight saving)", () => {
  it("starts a shop day at Singapore midnight", () => {
    // 4 Oct 2026, 1 am in Singapore is still 3 Oct in UTC.
    const now = new Date("2026-10-03T17:00:00Z");
    expect(shopDayStart(now).toISOString()).toBe("2026-10-03T16:00:00.000Z");
    expect(shopDayStart(now, 6).toISOString()).toBe("2026-09-27T16:00:00.000Z");
  });

  it("reads and writes datetime-local values in shop time", () => {
    expect(fromShopLocal("2026-10-05T09:30")?.toISOString()).toBe("2026-10-05T01:30:00.000Z");
    expect(toShopLocal("2026-10-05T01:30:00Z")).toBe("2026-10-05T09:30");
    expect(toShopLocal("2026-10-04T16:05:00Z")).toBe("2026-10-05T00:05");
  });

  it("refuses malformed or impossible times", () => {
    for (const bad of ["", "2026-10-05", "2026-02-31T10:00", "2026-10-05T25:00", "yesterday"]) {
      expect(fromShopLocal(bad), bad).toBeNull();
    }
  });
});

describe("shop days as YYYY-MM-DD (D35)", () => {
  it("parses exactly a real calendar date", () => {
    expect(parseShopDay("2026-10-05")).toBe("2026-10-05");
    expect(parseShopDay("2024-02-29")).toBe("2024-02-29");
    for (const bad of [
      "2026-02-29",
      "2026-02-31",
      "2026-13-01",
      "2026-00-10",
      "2026-10-5",
      "26-10-05",
      " 2026-10-05",
      "2026-10-05T00:00",
      "2026/10/05",
      "0000-01-01",
      "",
      "today",
    ]) {
      expect(parseShopDay(bad), bad).toBeNull();
    }
    for (const bad of [null, undefined, 20261005, new Date("2026-10-05"), ["2026-10-05"]]) {
      expect(parseShopDay(bad)).toBeNull();
    }
  });

  it("shifts by calendar days across month and year ends", () => {
    expect(shiftShopDay("2026-10-05", 0)).toBe("2026-10-05");
    expect(shiftShopDay("2026-10-05", -6)).toBe("2026-09-29");
    expect(shiftShopDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftShopDay("2024-03-01", -1)).toBe("2024-02-29");
    expect(shiftShopDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftShopDay("2027-01-03", -7)).toBe("2026-12-27");
    expect(shiftShopDay("2026-01-31", 30)).toBe("2026-03-02");
  });

  it("reads years before 100 as themselves, not as 1900-1999", () => {
    // Date.UTC maps years 0-99 to 1900-1999; the check must not.
    expect(parseShopDay("0099-12-28")).toBe("0099-12-28");
    expect(parseShopDay("0100-01-03")).toBe("0100-01-03");
    expect(parseShopDay("0001-01-01")).toBe("0001-01-01");
    expect(parseShopDay("0099-02-29")).toBeNull();
    expect(parseShopDay("0096-02-29")).toBe("0096-02-29");
  });

  it("returns only days that parse back, across the 0100/0099 boundary too", () => {
    expect(shiftShopDay("0100-01-03", -6)).toBe("0099-12-28");
    expect(shiftShopDay("0099-12-31", 1)).toBe("0100-01-01");
    for (let i = -7; i <= 0; i++) {
      expect(parseShopDay(shiftShopDay("0100-01-03", i))).not.toBeNull();
    }
    expect(() => shiftShopDay("0001-01-01", -1)).toThrow(RangeError);
    expect(() => shiftShopDay("9999-12-31", 1)).toThrow(RangeError);
  });

  it("names the earliest day Today can be asked for", () => {
    expect(parseShopDay(EARLIEST_SHOP_DAY)).toBe(EARLIEST_SHOP_DAY);
    // The week before it, which Today derives, is still a plain date.
    expect(shiftShopDay(EARLIEST_SHOP_DAY, -7)).toBe("1999-12-25");
  });

  it("refuses a malformed day or offset", () => {
    expect(() => shiftShopDay("2026-02-30", 1)).toThrow(RangeError);
    expect(() => shiftShopDay("yesterday", 1)).toThrow(RangeError);
    expect(() => shiftShopDay("2026-10-05", 1.5)).toThrow(RangeError);
  });

  it("today is the Singapore calendar day, not the UTC one", () => {
    // 16:30 UTC on 4 Oct is 00:30 on 5 Oct in Singapore.
    expect(shopToday(new Date("2026-10-04T16:30:00Z"))).toBe("2026-10-05");
    expect(shopToday(new Date("2026-10-04T15:59:59Z"))).toBe("2026-10-04");
    expect(parseShopDay(shopToday())).not.toBeNull();
  });
});

describe("shop days for people", () => {
  it("today flips at Singapore midnight, 16:00 UTC", () => {
    expect(shopToday(new Date("2026-10-03T15:59:59Z"))).toBe("2026-10-03");
    expect(shopToday(new Date("2026-10-03T16:00:00Z"))).toBe("2026-10-04");
  });

  it("puts a shop day at noon Singapore time, so it formats as that day anywhere", () => {
    expect(shopDayToDate("2026-10-03").toISOString()).toBe("2026-10-03T04:00:00.000Z");
    expect(shopDateKey(shopDayToDate("2026-10-03"))).toBe("2026-10-03");
    expect(shopDateKey(shopDayToDate("2024-02-29"))).toBe("2024-02-29");
    expect(shopDateKey(shopDayToDate("2026-12-31"), { timeZone: "UTC" })).toBe("2026-12-31");
    expect(() => shopDayToDate("2026-02-30")).toThrow(RangeError);
    expect(() => shopDayToDate("3 Oct")).toThrow(RangeError);
  });

  it("formats a shop day in full, as a heading and compactly", () => {
    expect(formatShopDay("2026-10-03")).toBe("Sat, 3 Oct 2026");
    expect(formatShopDay("2027-01-01")).toBe("Fri, 1 Jan 2027");
    expect(formatShopDayLong("2026-10-03")).toBe("Saturday, 3 Oct");
    expect(formatShopDayShort("2026-10-05")).toBe("Mon, 5 Oct");
    expect(formatShopDayShort("2026-10-05")).toBe(formatDayShort("2026-10-05T12:00:00+08:00"));
  });
});
