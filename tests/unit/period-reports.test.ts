import { describe, expect, it } from "vitest";

import { shopToday } from "@/lib/dates";
import { BUSINESS_ERRORS } from "@/lib/db-errors";
import {
  BASES,
  BASIS_VALUES,
  COST_GATED,
  DIMENSIONS,
  DIMENSION_VALUES,
  autoGrain,
  breakdownHref,
  customRangeError,
  emptyCopy,
  formatBucketLabel,
  formatDuration,
  formatRangeLabel,
  isReportKey,
  parseReportParams,
  periodRange,
  reportHref,
  shiftPeriod,
  shiftRange,
} from "@/lib/period-reports";

const TODAY = "2026-10-06"; // a Tuesday

describe("vocabulary", () => {
  it("labels every basis and dimension from the generated enums", () => {
    expect(BASIS_VALUES).toEqual(["sale", "check_in", "completion", "collection"]);
    expect(BASES.sale.label).toBe("Sale date");
    expect(BASES.check_in.description).toMatch(/including work not finished yet/);
    expect(Object.keys(BASES).sort()).toEqual([...BASIS_VALUES].sort());
    expect(DIMENSION_VALUES).toHaveLength(7);
    expect(DIMENSIONS.job.label).toBe("Job / sale");
    expect(Object.keys(DIMENSIONS).sort()).toEqual([...DIMENSION_VALUES].sort());
  });

  it("lists the cost-gated columns of each RPC (D30)", () => {
    expect(COST_GATED.summary).toContain("cost_total");
    expect(COST_GATED.summary).toContain("purchases_received_total");
    expect(COST_GATED.summary).not.toContain("sale_total");
    expect(COST_GATED.breakdown).toEqual([
      "cost_total",
      "yield_total",
      "cult_commons_share",
      "yield_after_cc",
    ]);
    expect(COST_GATED.stockValue).toEqual(["value_at_cost"]);
  });

  it("accepts a uuid or the dimension's pseudo keys, nothing else", () => {
    const id = "d5300000-0000-4000-8000-000000000001";
    expect(isReportKey("product", id)).toBe(true);
    expect(isReportKey("product", "none")).toBe(true);
    expect(isReportKey("mechanic", "unassigned")).toBe(true);
    expect(isReportKey("ownership", "consignment")).toBe(true);
    expect(isReportKey("ownership", id)).toBe(false);
    expect(isReportKey("channel", "retail")).toBe(true);
    expect(isReportKey("job", "none")).toBe(false);
    expect(isReportKey("product", id.toUpperCase())).toBe(false);
    expect(isReportKey("product", "x")).toBe(false);
  });
});

describe("periodRange", () => {
  it("is the day itself", () => {
    expect(periodRange("day", TODAY)).toEqual({ from: TODAY, to: TODAY });
  });

  it("is the ISO Monday–Sunday week, a Sunday anchor included", () => {
    expect(periodRange("week", "2026-10-06")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(periodRange("week", "2026-10-05")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    // Sunday belongs to the week that started the Monday before.
    expect(periodRange("week", "2026-10-11")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(periodRange("week", "2026-10-04")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("crosses a year boundary", () => {
    expect(periodRange("week", "2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(periodRange("month", "2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("is the calendar month, leap February included", () => {
    expect(periodRange("month", "2026-10-06")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("month", "2026-02-28")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("month", "2026-04-30")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });

  it("refuses an anchor that is not a shop day", () => {
    expect(() => periodRange("day", "2026-02-30")).toThrow(RangeError);
  });
});

describe("shiftPeriod and shiftRange", () => {
  it("steps a day, a week or a month", () => {
    expect(shiftPeriod("day", "2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftPeriod("day", "2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftPeriod("week", "2026-10-11", 1)).toBe("2026-10-18");
    expect(shiftPeriod("week", "2026-10-06", -1)).toBe("2026-09-29");
  });

  it("steps months by their first day, never skipping a short month", () => {
    expect(shiftPeriod("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftPeriod("month", "2026-03-31", -1)).toBe("2026-02-01");
    expect(shiftPeriod("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftPeriod("month", "2027-01-15", -1)).toBe("2026-12-01");
  });

  it("moves a custom range by its own length", () => {
    expect(shiftRange({ from: "2026-10-01", to: "2026-10-10" }, 1)).toEqual({
      from: "2026-10-11",
      to: "2026-10-20",
    });
    expect(shiftRange({ from: "2026-10-01", to: "2026-10-01" }, -1)).toEqual({
      from: "2026-09-30",
      to: "2026-09-30",
    });
  });
});

describe("autoGrain", () => {
  it("has no buckets for one day, then days, weeks and months", () => {
    expect(autoGrain(TODAY, TODAY)).toBeNull();
    expect(autoGrain("2026-10-01", "2026-10-02")).toBe("day");
    expect(autoGrain("2026-10-01", "2026-10-31")).toBe("day"); // 31 days
    expect(autoGrain("2026-10-01", "2026-11-01")).toBe("week"); // 32 days
    expect(autoGrain("2026-01-01", "2026-07-03")).toBe("week"); // 184 days
    expect(autoGrain("2026-01-01", "2026-07-04")).toBe("month"); // 185 days
  });
});

describe("labels", () => {
  it("formats a day, a range and a whole month", () => {
    expect(formatRangeLabel("2026-10-05", "2026-10-05")).toBe("Mon, 5 Oct 2026");
    expect(formatRangeLabel("2026-09-28", "2026-10-04")).toBe("28 Sep – 4 Oct 2026");
    expect(formatRangeLabel("2026-10-01", "2026-10-31")).toBe("October 2026");
    expect(formatRangeLabel("2026-12-28", "2027-01-03")).toBe("28 Dec 2026 – 3 Jan 2027");
  });

  it("labels series buckets", () => {
    expect(formatBucketLabel("day", "2026-10-05", "2026-10-05")).toBe("Mon, 5 Oct");
    expect(formatBucketLabel("week", "2026-10-05", "2026-10-11")).toBe("5 Oct – 11 Oct");
    expect(formatBucketLabel("month", "2026-10-01", "2026-10-31")).toBe("Oct 2026");
  });

  it("says durations in hours or days", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(5)).toBe("5 h");
    expect(formatDuration(30.25)).toBe("30.3 h");
    expect(formatDuration(60)).toBe("2.5 days");
    expect(formatDuration(72)).toBe("3 days");
  });

  it("words the empty state per basis", () => {
    expect(emptyCopy("sale")).toBe(
      "Nothing recorded for this period on the Sale date basis. Jobs not completed yet only show on the Check-in basis.",
    );
    expect(emptyCopy("completion")).toMatch(/Check-in basis\.$/);
    expect(emptyCopy("check_in")).toBe("Nothing recorded for this period on the Check-in basis.");
    expect(emptyCopy("collection")).not.toMatch(/Jobs not completed/);
  });
});

describe("parseReportParams", () => {
  it("defaults to this week on the sale basis by job", () => {
    expect(parseReportParams({}, TODAY)).toEqual({
      period: "week",
      anchor: TODAY,
      from: "2026-10-05",
      to: "2026-10-11",
      basis: "sale",
      by: "job",
    });
  });

  it("falls back to the default for every invalid value", () => {
    expect(
      parseReportParams(
        { period: "year", date: "2026-02-30", basis: "refund", by: "colour" },
        TODAY,
      ),
    ).toEqual(parseReportParams({}, TODAY));
    expect(parseReportParams({ date: "1999-12-31" }, TODAY).anchor).toBe(TODAY);
    expect(parseReportParams({ date: ["2026-09-01", "x"] }, TODAY).anchor).toBe("2026-09-01");
  });

  it("reads a day, a month, the basis and the dimension", () => {
    const p = parseReportParams(
      { period: "month", date: "2028-02-10", basis: "collection", by: "mechanic" },
      TODAY,
    );
    expect(p).toMatchObject({
      period: "month",
      anchor: "2028-02-10",
      from: "2028-02-01",
      to: "2028-02-29",
      basis: "collection",
      by: "mechanic",
    });
    expect(p.error).toBeUndefined();
  });

  it("needs both ends of a custom range", () => {
    expect(
      parseReportParams({ period: "custom", from: "2026-01-01", to: "2026-01-07" }, TODAY),
    ).toEqual({
      period: "custom",
      anchor: "2026-01-07",
      from: "2026-01-01",
      to: "2026-01-07",
      basis: "sale",
      by: "job",
    });
    const missing = parseReportParams({ period: "custom", from: "2026-01-01" }, TODAY);
    expect(missing.error).toBe(BUSINESS_ERRORS.report_range_invalid);
    expect(missing).toMatchObject({ from: "2026-10-05", to: "2026-10-11" });
  });

  it("refuses a reversed or over-long custom range with the database's messages", () => {
    expect(
      parseReportParams({ period: "custom", from: "2026-02-01", to: "2026-01-01" }, TODAY).error,
    ).toBe(BUSINESS_ERRORS.report_range_invalid);
    // 731 days is the limit; 732 is too long.
    expect(
      parseReportParams({ period: "custom", from: "2024-01-01", to: "2025-12-31" }, TODAY).error,
    ).toBeUndefined();
    expect(
      parseReportParams({ period: "custom", from: "2024-01-01", to: "2026-01-01" }, TODAY).error,
    ).toBe(BUSINESS_ERRORS.report_range_too_long);
    expect(customRangeError("2026-01-01", "2026-01-01")).toBeNull();
    expect(customRangeError("garbage", "2026-01-01")).toBe(BUSINESS_ERRORS.report_range_invalid);
  });

  it("takes today from the shop's zone: 23:30 UTC is already the next Singapore day", () => {
    const today = shopToday(new Date("2026-10-04T23:30:00Z"));
    expect(today).toBe("2026-10-05");
    expect(parseReportParams({ period: "day" }, today)).toMatchObject({
      from: "2026-10-05",
      to: "2026-10-05",
    });
  });
});

describe("reportHref", () => {
  const params = { period: "week", date: "2026-10-06", basis: "sale", by: "job" };

  it("keeps the other parameters and applies the overrides", () => {
    expect(reportHref("/reports", params, { basis: "completion" })).toBe(
      "/reports?period=week&date=2026-10-06&basis=completion&by=job",
    );
    expect(reportHref("/reports", params, { by: null })).toBe(
      "/reports?period=week&date=2026-10-06&basis=sale",
    );
  });

  it("drops the cursors unless they are set, and the other kind of period", () => {
    const withCursor = new URLSearchParams({ ...params, after_total: "1000", after_key: "k" });
    expect(reportHref("/reports", withCursor, { by: "product" })).toBe(
      "/reports?period=week&date=2026-10-06&basis=sale&by=product",
    );
    expect(
      reportHref("/reports", params, { period: "custom", from: "2026-01-01", to: "2026-01-07" }),
    ).toBe("/reports?period=custom&basis=sale&by=job&from=2026-01-01&to=2026-01-07");
    expect(
      reportHref(
        "/reports",
        { period: "custom", from: "2026-01-01", to: "2026-01-07" },
        { period: "day", date: "2026-01-07" },
      ),
    ).toBe("/reports?period=day&date=2026-01-07");
  });

  it("links a job or sale group to its page and other groups to their lines", () => {
    const state = {
      period: "day" as const,
      anchor: "2026-10-03",
      from: "2026-10-03",
      to: "2026-10-03",
      basis: "completion" as const,
    };
    const job = "d5000000-0000-4000-8000-000000000003";
    expect(breakdownHref(state, "job", { key: job, entityType: "work_order", entityId: job })).toBe(
      `/jobs/${job}`,
    );
    expect(
      breakdownHref(state, "product", {
        key: "d5300000-0000-4000-8000-000000000001",
        entityType: "product",
        entityId: "d5300000-0000-4000-8000-000000000001",
      }),
    ).toBe(
      "/reports/lines?period=day&date=2026-10-03&basis=completion&by=product&key=d5300000-0000-4000-8000-000000000001",
    );
  });
});
