import { describe, expect, it } from "vitest";

import { effectivePermissions, type PermissionKey } from "@/lib/auth/permissions";
import { toCsv } from "@/lib/csv";
import type { PeriodSummary } from "@/lib/period-reports";
import {
  EXPORT_KINDS,
  EXPORT_KIND_VALUES,
  breakdownTotalRow,
  exportColumns,
  exportFilename,
  exportHref,
  exportKindSchema,
  mayExport,
  type ExportKind,
} from "@/lib/report-exports";

const headers = (kind: ExportKind, costs: boolean) =>
  exportColumns(kind, costs).map((c) => c.header);

const canAs = (role: "admin" | "manager" | "mechanic", granted: PermissionKey[] = []) => {
  const held = effectivePermissions(role, true, granted);
  return (p: PermissionKey) => held.includes(p);
};

describe("the export kind table", () => {
  it("lists every kind once and parses only those", () => {
    expect([...EXPORT_KIND_VALUES].sort()).toEqual(Object.keys(EXPORT_KINDS).sort());
    expect(exportKindSchema.safeParse("breakdown").success).toBe(true);
    expect(exportKindSchema.safeParse("exceptions").success).toBe(false);
    expect(exportKindSchema.safeParse(null).success).toBe(false);
  });

  it("needs view_financial_reports for every financial kind; mechanics is for any staff", () => {
    for (const kind of ["series", "breakdown", "lines", "stock_value"] as const) {
      expect(EXPORT_KINDS[kind].permission).toBe("view_financial_reports");
      expect(mayExport(kind, canAs("mechanic"))).toBe(false);
      expect(mayExport(kind, canAs("mechanic", ["view_financial_reports"]))).toBe(true);
      expect(mayExport(kind, canAs("manager"))).toBe(true);
      expect(mayExport(kind, canAs("admin"))).toBe(true);
    }
    expect(EXPORT_KINDS.mechanics.permission).toBeNull();
    expect(mayExport("mechanics", canAs("mechanic"))).toBe(true);
    // D60: manage_purchasing alone never opens a financial export.
    expect(mayExport("breakdown", canAs("mechanic", ["manage_purchasing"]))).toBe(false);
  });

  it("drops the cost-gated columns without view_costs (D30)", () => {
    expect(headers("breakdown", true)).toEqual([
      "dimension",
      "key",
      "name",
      "detail",
      "lines",
      "jobs",
      "sales",
      "quantity",
      "gross",
      "cost",
      "yield",
      "cult_commons",
      "after_cc",
      "currency",
    ]);
    expect(headers("breakdown", false)).toEqual([
      "dimension",
      "key",
      "name",
      "detail",
      "lines",
      "jobs",
      "sales",
      "quantity",
      "gross",
      "currency",
    ]);
    expect(headers("series", false)).not.toEqual(
      expect.arrayContaining(["cost", "yield", "new_consignor_liability", "settlements_paid"]),
    );
    expect(headers("series", false)).toEqual(
      expect.arrayContaining(["gross", "refunds", "consignment_sales_total"]),
    );
    expect(headers("series", true)).toEqual(
      expect.arrayContaining(["cost", "yield", "cult_commons", "after_cc", "settlements_paid"]),
    );
    expect(headers("lines", false)).toEqual([
      "date",
      "channel",
      "document_number",
      "type",
      "description",
      "quantity",
      "unit_price",
      "gross",
      "cost_pending",
      "ownership",
      "category",
      "mechanic",
      "currency",
    ]);
    expect(headers("stock_value", false)).not.toContain("value_at_cost");
    expect(headers("stock_value", true)).toContain("value_at_cost");
    expect(headers("mechanics", false)).toEqual(headers("mechanics", true));
  });

  it("writes the breakdown's TOTAL row from the summary as received", () => {
    const summary: PeriodSummary = {
      basis: "sale",
      from: "2026-10-01",
      to: "2026-10-07",
      currency: "SGD",
      lineCount: 9,
      jobCount: 4,
      saleCount: 1,
      saleTotal: "2359.99",
      costTotal: null,
      yieldTotal: null,
      cultCommons: null,
      afterCc: null,
      lossLineCount: null,
      costPendingLines: 0,
      refundsTotal: "0.00",
      refundCount: 0,
      consignmentSales: 0,
      consignmentSalesTotal: "0.00",
      newConsignorLiability: null,
      settlementsPaid: null,
      purchasesReceived: null,
      excludedForeignLineCount: 0,
    };
    const csv = toCsv(exportColumns("breakdown", false), [breakdownTotalRow(summary)]);
    expect(csv.split("\r\n")[1]).toBe("TOTAL,,TOTAL,,9,4,1,,2359.99,SGD");
  });

  it("names the file and builds the link", () => {
    expect(
      exportFilename("breakdown", { basis: "sale", from: "2026-10-05", to: "2026-10-11" }),
    ).toBe("bicii-breakdown-sale-2026-10-05_2026-10-11.csv");
    expect(exportHref("lines", { period: "day", date: "2026-10-03" }, { key: "none" })).toBe(
      "/reports/export?kind=lines&period=day&date=2026-10-03&key=none",
    );
  });
});
