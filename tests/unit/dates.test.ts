import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDayShort,
  formatTime,
  SHOP_TIME_ZONE,
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
