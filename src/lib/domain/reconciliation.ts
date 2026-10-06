import "server-only";

import { cache } from "react";

import { unwrap } from "@/lib/db-errors";
import { DomainError } from "@/lib/domain/errors";
import { hrefForRecord } from "@/lib/ids";
import {
  RECONCILIATION_MAX_ROWS,
  type ExceptionCount,
  type StockReconciliationRow,
  type UnitReconciliationRow,
} from "@/lib/reconciliation";
import type { ServerSupabase } from "@/lib/supabase/server";

/**
 * Reads for stock reconciliation and the exceptions screen, and the one
 * write of Phase 9 (Phase 9 step 4; SPEC §12, §19.1, §26; PLAN D106–D108;
 * ADR-022). Each read calls ONE step 3 RPC with the RLS-scoped client and
 * throws DbError on failure (map it with mapDbError). Every read is open to
 * any active staff member and carries no cost column; the database decides
 * which exceptions a caller sees (private.exception_visible, D108).
 *
 * Reconciliation is read-only (D106): nothing here changes stock, status or
 * money. The fix is always an existing guarded flow the screens link to.
 * The only write is the admin's alert threshold (D107), through
 * public.set_consignment_settlement_alert_days.
 */

type Nullable<T> = { [K in keyof T]: T[K] | null };
type Fn = import("@/lib/database.types").Database["public"]["Functions"];

export type ReconciliationQuery = {
  /** Only rows with an issue (the default) or every row. */
  onlyIssues: boolean;
  /** One product, or every product. */
  productId: string | null;
};

/** report_stock_reconciliation: products by location, issues first. */
export async function getStockReconciliation(
  supabase: ServerSupabase,
  { onlyIssues, productId }: ReconciliationQuery,
): Promise<StockReconciliationRow[]> {
  const rows = (unwrap(
    await supabase.rpc("report_stock_reconciliation", {
      p_only_issues: onlyIssues,
      p_product_id: productId ?? undefined,
      p_max_rows: RECONCILIATION_MAX_ROWS,
    }),
  ) ?? []) as Nullable<Fn["report_stock_reconciliation"]["Returns"][number]>[];
  return rows.map((r) => ({
    productId: r.product_id!,
    productShortId: r.product_short_id ?? "",
    productName: r.product_name ?? "",
    trackingType: r.tracking_type ?? "",
    locationId: r.location_id!,
    locationName: r.location_name ?? "",
    ledgerOnHand: r.ledger_on_hand ?? 0,
    unitsInStock: r.units_in_stock,
    issue: r.issue,
    href: hrefForRecord("product", r.product_id!)!,
  }));
}

/** report_unit_reconciliation: every unique item against its ledger, issues first. */
export async function getUnitReconciliation(
  supabase: ServerSupabase,
  { onlyIssues, productId }: ReconciliationQuery,
): Promise<UnitReconciliationRow[]> {
  const rows = (unwrap(
    await supabase.rpc("report_unit_reconciliation", {
      p_only_issues: onlyIssues,
      p_product_id: productId ?? undefined,
      p_max_rows: RECONCILIATION_MAX_ROWS,
    }),
  ) ?? []) as Nullable<Fn["report_unit_reconciliation"]["Returns"][number]>[];
  return rows.map((r) => ({
    unitId: r.unit_id!,
    unitShortId: r.unit_short_id ?? "",
    productId: r.product_id!,
    productName: r.product_name ?? "",
    status: r.status!,
    locationId: r.location_id!,
    locationName: r.location_name ?? "",
    ledgerOnHand: r.ledger_on_hand ?? 0,
    ledgerLocationId: r.ledger_location_id,
    ledgerLocationName: r.ledger_location_name,
    expectedOnHand: r.expected_on_hand,
    disposition: r.disposition ?? "none",
    dispositionRef: r.disposition_ref,
    issue: r.issue,
    issueDetail: r.issue_detail,
    lastMovementAt: r.last_movement_at,
    href: hrefForRecord("inventory_unit", r.unit_id!)!,
    productHref: hrefForRecord("product", r.product_id!)!,
  }));
}

/** report_exception_counts: how many exceptions of each kind the caller may see (D108). Cached per request. */
export const getExceptionCounts = cache(
  async (supabase: ServerSupabase): Promise<ExceptionCount[]> => {
    const rows = (unwrap(await supabase.rpc("report_exception_counts")) ?? []) as Nullable<
      Fn["report_exception_counts"]["Returns"][number]
    >[];
    return rows.map((r) => ({
      kind: r.kind ?? "",
      severity: r.severity ?? "",
      count: r.count ?? 0,
    }));
  },
);

/** The unsettled-consignment threshold N in shop days (D107), through the staff RLS read. */
export async function getConsignmentAlertDays(supabase: ServerSupabase): Promise<number> {
  const s = unwrap(
    await supabase
      .from("shop_settings")
      .select("consignment_settlement_alert_days")
      .eq("id", 1)
      .maybeSingle(),
  );
  if (!s) throw new DomainError("The shop's settings are missing. Ask an admin to check Settings.");
  return s.consignment_settlement_alert_days;
}

/**
 * Admin: alert unsettled consignments after `days` shop days (1–365, D107).
 * Replay-safe: the current value again changes nothing. Returns the value
 * now in force.
 */
export async function setConsignmentSettlementAlertDays(
  supabase: ServerSupabase,
  days: number,
): Promise<number> {
  return unwrap(await supabase.rpc("set_consignment_settlement_alert_days", { p_days: days }))!;
}

/**
 * The product of each unit in `unitIds` (the staff RLS read of
 * inventory_units), so an exception about a unit can link to stock
 * reconciliation filtered to its product.
 */
export async function getUnitProductIds(
  supabase: ServerSupabase,
  unitIds: readonly string[],
): Promise<Map<string, string>> {
  if (unitIds.length === 0) return new Map();
  const rows =
    unwrap(
      await supabase
        .from("inventory_units")
        .select("id, product_id")
        .in("id", [...new Set(unitIds)]),
    ) ?? [];
  return new Map(rows.map((r) => [r.id, r.product_id]));
}

/** A product's short ID and name for the reconciliation filter chip; null when it does not exist. */
export async function getProductLabel(
  supabase: ServerSupabase,
  productId: string,
): Promise<{ shortId: string; name: string } | null> {
  const p = unwrap(
    await supabase.from("products").select("short_id, name").eq("id", productId).maybeSingle(),
  );
  return p ? { shortId: p.short_id, name: p.name } : null;
}
