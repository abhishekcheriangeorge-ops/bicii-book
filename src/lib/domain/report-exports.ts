import "server-only";

import {
  getActivityByMechanic,
  getAllBreakdownForExport,
  getAllLineItemsForExport,
  getPeriodSeries,
  getPeriodSummary,
  getStockValue,
} from "@/lib/domain/period-reports";
import { autoGrain, type ReportParams } from "@/lib/period-reports";
import { breakdownTotalRow, type ExportKind, type ExportRows } from "@/lib/report-exports";
import type { ServerSupabase } from "@/lib/supabase/server";

/** What an export reads: the report's parameters and, for `lines`, an optional group. */
export type ExportQuery = ReportParams & { key: string | null };

/**
 * The rows of each export kind (src/lib/report-exports.ts EXPORT_KINDS).
 * Typed per kind, so a kind added there fails typecheck until it has a
 * fetcher here. Every money figure and total comes from the step 1 RPCs;
 * the breakdown's TOTAL row is report_period_summary's row.
 */
export const EXPORT_FETCHERS: {
  readonly [K in ExportKind]: (
    supabase: ServerSupabase,
    q: ExportQuery,
  ) => Promise<ExportRows[K][]>;
} = {
  async series(supabase, q) {
    // One day has no buckets on the screen; the export still writes one row.
    const grain = autoGrain(q.from, q.to) ?? "day";
    const summary = await getPeriodSummary(supabase, q.from, q.to, q.basis);
    return getPeriodSeries(supabase, { ...q, grain }, summary.currency);
  },
  async breakdown(supabase, q) {
    const { rows, summary } = await getAllBreakdownForExport(supabase, {
      ...q,
      dimension: q.by,
    });
    return [...rows, breakdownTotalRow(summary)];
  },
  async lines(supabase, q) {
    return getAllLineItemsForExport(supabase, {
      from: q.from,
      to: q.to,
      basis: q.basis,
      dimension: q.key ? q.by : null,
      key: q.key,
    });
  },
  async stock_value(supabase) {
    return getStockValue(supabase);
  },
  async mechanics(supabase, q) {
    return getActivityByMechanic(supabase, { from: q.from, to: q.to });
  },
};
