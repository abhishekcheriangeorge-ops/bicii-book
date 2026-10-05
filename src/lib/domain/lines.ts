import "server-only";

import type { Database } from "@/lib/database.types";
import { DbError, mapDbError, unwrap } from "@/lib/db-errors";
import { toMoneyString } from "@/lib/money";
import type { ServerSupabase } from "@/lib/supabase/server";

import { DomainError } from "./errors";

/**
 * A job's lines and totals (SPEC §9, §10, §22; DATA-MODEL §5; PLAN D1, D14,
 * D15). Lines are immutable except voiding; their economics are the
 * database's generated columns, snapshotted when the line is added.
 *
 * Cost visibility: a staff member without view_costs reads lines from the
 * base table with an explicit cost-free column list (their column grant
 * refuses `select *`) and totals from `work_order_totals`; a view_costs
 * holder reads `work_order_line_items_staff` and `work_order_totals_staff`.
 * A DTO for someone without view_costs never has a `costs` key at all.
 *
 * Money arrives from PostgREST as JSON numbers and leaves here as
 * fixed-point strings ("70.00"); amounts go to the RPCs as strings too.
 */

export type LineType = Database["public"]["Enums"]["line_type"];

export type LineCosts = {
  unitDirectCost: string;
  costTotal: string;
  yieldTotal: string;
  /** The Cult Commons rate snapshotted on the line, as a fraction ("0.3000"). */
  ccRate: string;
  ccShare: string;
};

export type Line = {
  id: string;
  type: LineType;
  description: string;
  /** "2.00" */
  quantity: string;
  unitSalePrice: string;
  saleTotal: string;
  currency: string;
  createdAt: string;
  /** Null when added outside the app. */
  createdByName: string | null;
  voided: { at: string; byName: string | null; reason: string | null } | null;
  /**
   * A manual line added without a unit cost (D14): its cost 0 is a
   * placeholder, so its yield and Cult Commons count the whole sale until a
   * view_costs holder voids it and adds it again with the cost. Not a cost
   * figure: every staff member sees it.
   */
  costPending: boolean;
  /** Only for view_costs holders. */
  costs?: LineCosts;
};

export type Totals = {
  currency: string;
  /** Live (not voided) lines. */
  lineCount: number;
  saleTotal: string;
  /** Only for view_costs holders. */
  costs?: {
    costTotal: string;
    yieldTotal: string;
    /** Sum of the lines' Cult Commons shares (D1). */
    ccShare: string;
    /** BICII yield after Cult Commons. */
    yieldAfterCc: string;
    /** Live lines with no cost entered (D14): while > 0 the figures above are provisional. */
    costPendingCount: number;
  };
};

/** The sale-side columns every staff member may read (the table's column grant). */
const SALE_COLUMNS =
  "id, line_type, description_snapshot, quantity, unit_sale_price_snapshot, cost_pending, currency, sale_total, created_by, created_at, voided_at, voided_by, void_reason";
const COST_COLUMNS =
  "id, line_type, description_snapshot, quantity, unit_sale_price_snapshot, cost_pending, currency, sale_total, created_by, created_at, voided_at, voided_by, void_reason, unit_direct_cost_snapshot, cost_total, yield_total, cult_commons_rate_snapshot, cult_commons_share";

type SaleRow = {
  id: string | null;
  line_type: LineType | null;
  description_snapshot: string | null;
  quantity: number | null;
  unit_sale_price_snapshot: number | null;
  cost_pending: boolean | null;
  currency: string | null;
  sale_total: number | null;
  created_by: string | null;
  created_at: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};

type CostRow = SaleRow & {
  unit_direct_cost_snapshot: number | null;
  cost_total: number | null;
  yield_total: number | null;
  cult_commons_rate_snapshot: number | null;
  cult_commons_share: number | null;
};

const money = (v: number | string | null | undefined) => toMoneyString(v ?? 0);

/**
 * A job's lines, voided ones included, oldest first. `names` maps staff ids
 * to display names (staff_directory).
 */
export async function listLines(
  supabase: ServerSupabase,
  workOrderId: string,
  { viewCosts, names }: { viewCosts: boolean; names: ReadonlyMap<string, string> },
): Promise<Line[]> {
  const rows: (SaleRow | CostRow)[] = viewCosts
    ? (unwrap(
        await supabase
          .from("work_order_line_items_staff")
          .select(COST_COLUMNS)
          .eq("work_order_id", workOrderId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
      ) ?? [])
    : (unwrap(
        await supabase
          .from("work_order_line_items")
          .select(SALE_COLUMNS)
          .eq("work_order_id", workOrderId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
      ) ?? []);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "A former colleague") : null);

  return rows.map((r) => {
    const line: Line = {
      id: r.id ?? "",
      type: r.line_type ?? "manual",
      description: r.description_snapshot ?? "",
      quantity: money(r.quantity),
      unitSalePrice: money(r.unit_sale_price_snapshot),
      saleTotal: money(r.sale_total),
      currency: r.currency ?? "SGD",
      createdAt: r.created_at ?? "",
      createdByName: nameOf(r.created_by),
      voided: r.voided_at
        ? { at: r.voided_at, byName: nameOf(r.voided_by), reason: r.void_reason }
        : null,
      costPending: r.cost_pending === true,
    };
    if (viewCosts && "cost_total" in r) {
      line.costs = {
        unitDirectCost: money(r.unit_direct_cost_snapshot),
        costTotal: money(r.cost_total),
        yieldTotal: money(r.yield_total),
        ccRate: String(r.cult_commons_rate_snapshot ?? 0),
        ccShare: money(r.cult_commons_share),
      };
    }
    return line;
  });
}

/** A job's running totals over its live lines (the database's views). */
export async function getTotals(
  supabase: ServerSupabase,
  workOrderId: string,
  { viewCosts, currency }: { viewCosts: boolean; currency: string },
): Promise<Totals> {
  if (viewCosts) {
    const row = unwrap(
      await supabase
        .from("work_order_totals_staff")
        .select(
          "currency, line_count, sale_total, cost_total, yield_total, cult_commons_share, bicii_yield_after_cc, cost_pending_count",
        )
        .eq("work_order_id", workOrderId)
        .maybeSingle(),
    );
    return {
      currency: row?.currency ?? currency,
      lineCount: row?.line_count ?? 0,
      saleTotal: money(row?.sale_total),
      costs: {
        costTotal: money(row?.cost_total),
        yieldTotal: money(row?.yield_total),
        ccShare: money(row?.cult_commons_share),
        yieldAfterCc: money(row?.bicii_yield_after_cc),
        costPendingCount: row?.cost_pending_count ?? 0,
      },
    };
  }
  const row = unwrap(
    await supabase
      .from("work_order_totals")
      .select("currency, line_count, sale_total")
      .eq("work_order_id", workOrderId)
      .maybeSingle(),
  );
  return {
    currency: row?.currency ?? currency,
    lineCount: row?.line_count ?? 0,
    saleTotal: money(row?.sale_total),
  };
}

/**
 * Business refusals that belong to one field of a form: rethrown as a
 * DomainError on that field (the message is the mapped, safe one).
 */
export function rethrowOnField(err: unknown, fields: Record<string, string>): never {
  if (err instanceof DbError) {
    const mapped = mapDbError(err);
    const field = mapped.reason ? fields[mapped.reason] : undefined;
    if (mapped.kind === "business" && field) {
      throw new DomainError(mapped.message, { [field]: [mapped.message] });
    }
  }
  throw err;
}

const LINE_FIELDS = {
  service_unavailable: "serviceId",
  reason_required: "reason",
  reason_too_long: "reason",
};

export type ServiceLineInput = {
  lineId: string;
  workOrderId: string;
  serviceId: string;
  /** Fixed-point strings. */
  quantity: string;
  /** Null: the service's default. */
  unitSalePrice: string | null;
  /** Null: the service's default. Requires view_costs (the RPC refuses otherwise). */
  unitDirectCost: string | null;
  /** Null: the service's name. */
  description: string | null;
};

/**
 * Adds a service to an open job (RPC add_service_line: snapshots price,
 * cost and rate). The line id is the idempotency key: a replay returns
 * the line it already added.
 */
export async function addServiceLine(
  supabase: ServerSupabase,
  input: ServiceLineInput,
): Promise<{ id: string }> {
  try {
    const id = unwrap(
      await supabase.rpc("add_service_line", {
        line_id: input.lineId,
        work_order_id: input.workOrderId,
        service_id: input.serviceId,
        quantity: input.quantity,
        unit_sale_price: input.unitSalePrice ?? undefined,
        unit_direct_cost: input.unitDirectCost ?? undefined,
        description: input.description ?? undefined,
      }),
    );
    return { id: id ?? input.lineId };
  } catch (err) {
    rethrowOnField(err, LINE_FIELDS);
  }
}

export type ManualLineInput = {
  lineId: string;
  workOrderId: string;
  description: string;
  quantity: string;
  unitSalePrice: string;
  /** Null: no direct cost. Requires view_costs. */
  unitDirectCost: string | null;
};

/** Adds a free-text line (labour, a sundry) to an open job; replay-safe by line id. */
export async function addManualLine(
  supabase: ServerSupabase,
  input: ManualLineInput,
): Promise<{ id: string }> {
  try {
    const id = unwrap(
      await supabase.rpc("add_manual_line", {
        line_id: input.lineId,
        work_order_id: input.workOrderId,
        description: input.description,
        unit_sale_price: input.unitSalePrice,
        quantity: input.quantity,
        unit_direct_cost: input.unitDirectCost ?? undefined,
      }),
    );
    return { id: id ?? input.lineId };
  } catch (err) {
    rethrowOnField(err, LINE_FIELDS);
  }
}

/**
 * Voids a line with a reason (RPC void_line; only while the job is open,
 * D15). The line stays, struck through, with who, when and why; voiding
 * again changes nothing.
 */
export async function voidLine(
  supabase: ServerSupabase,
  input: { lineId: string; reason: string },
): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) {
    throw new DomainError("Say why the line is being voided.", {
      reason: ["Say why the line is being voided."],
    });
  }
  try {
    unwrap(await supabase.rpc("void_line", { line_id: input.lineId, reason }));
  } catch (err) {
    rethrowOnField(err, LINE_FIELDS);
  }
}
