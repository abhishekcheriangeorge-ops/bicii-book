import { describe, expect, it } from "vitest";

import { effectivePermissions, type PermissionKey } from "@/lib/auth/permissions";
import { toCsv } from "@/lib/csv";
import type { PeriodSummary } from "@/lib/period-reports";
import {
  EXPORT_KINDS,
  EXPORT_KIND_VALUES,
  SNAPSHOT_KINDS,
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
    expect(exportKindSchema.safeParse("exceptions").success).toBe(true);
    expect(exportKindSchema.safeParse("everything").success).toBe(false);
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

describe("the snapshot exports (Phase 9 step 4; D106–D108)", () => {
  it("lets any active staff member export exceptions, stock and units", () => {
    for (const kind of ["exceptions", "stock", "units"] as const) {
      expect(EXPORT_KINDS[kind].permission, kind).toBeNull();
      expect(mayExport(kind, canAs("mechanic")), kind).toBe(true);
      expect(mayExport(kind, canAs("manager")), kind).toBe(true);
      // No cost column, so nothing differs without view_costs.
      expect(headers(kind, false), kind).toEqual(headers(kind, true));
    }
    expect(SNAPSHOT_KINDS).toEqual(new Set(["exceptions", "stock", "units"]));
  });

  it("writes the brief's exception columns", () => {
    expect(headers("exceptions", false)).toEqual([
      "kind",
      "severity",
      "issue",
      "short_id",
      "title",
      "detail",
      "amount",
      "currency",
      "since",
    ]);
    expect(headers("stock", false)).toEqual([
      "product_short_id",
      "product",
      "tracking",
      "location",
      "ledger_on_hand",
      "units_in_stock",
      "issue",
    ]);
    expect(headers("units", false)).toContain("disposition_ref");
  });

  it("writes an exception row as received, a formula-like title as text and no amount as empty", () => {
    const csv = toCsv(exportColumns("exceptions", false), [
      {
        kind: "unsettled_consignment",
        severity: "warning",
        entityType: "consignment_item",
        entityId: "c4000000-0000-4000-8000-000000000001",
        entityLabel: "C-000007",
        subjectLabel: "=cmd · Brompton",
        days: 45,
        quantity: null,
        since: "2026-08-22T04:00:00Z",
        issue: "unsettled_consignment",
        shortId: "C-000007",
        title: "C-000007 · =cmd",
        detail: "=HYPERLINK()",
        amount: "300.00",
        currency: "SGD",
      },
      {
        kind: "overdue_job",
        severity: "warning",
        entityType: "work_order",
        entityId: "d5000000-0000-4000-8000-000000000007",
        entityLabel: "J-000017",
        subjectLabel: null,
        days: 11,
        quantity: null,
        since: null,
        issue: "overdue_job",
        shortId: "J-000017",
        title: "J-000017",
        detail: null,
        amount: null,
        currency: null,
      },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(
      "unsettled_consignment,warning,unsettled_consignment,C-000007,C-000007 · =cmd,'=HYPERLINK(),300.00,SGD,2026-08-22 12:00",
    );
    expect(lines[2]).toBe("overdue_job,warning,overdue_job,J-000017,J-000017,,,,");
  });

  it("names a snapshot by the day it was taken", () => {
    const params = { basis: "sale", from: "2026-10-05", to: "2026-10-11" } as const;
    expect(exportFilename("units", params, "2026-10-06")).toBe("bicii-units-2026-10-06.csv");
    expect(exportFilename("breakdown", params, "2026-10-06")).toBe(
      "bicii-breakdown-sale-2026-10-05_2026-10-11.csv",
    );
    expect(exportHref("stock", { all: "1" })).toBe("/reports/export?kind=stock&all=1");
  });
});
