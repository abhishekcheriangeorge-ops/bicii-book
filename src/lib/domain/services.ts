import "server-only";

import { unwrap } from "@/lib/db-errors";
import { toMoneyString } from "@/lib/money";
import type { ServerSupabase } from "@/lib/supabase/server";

/**
 * The workshop's services (SPEC §9; DATA-MODEL §5), read side: what intake
 * and "Add service" offer. Every staff member reads the sale side from
 * `services` (its column grant leaves out default_direct_cost); the default
 * cost comes from `services_staff`, which returns rows only to view_costs
 * holders, and is asked for only when the caller holds it. Services change
 * only through the service RPCs (settings, step 4 of Phase 3).
 */

export type ServiceOption = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  /** "Other" when the service has no category. */
  categoryName: string;
  /** Default unit sale price, fixed-point ("200.00"). */
  salePrice: string;
  currency: string;
  /** Default unit direct cost: only for view_costs holders, never otherwise. */
  cost?: string;
};

const UNCATEGORISED = "Other";

/**
 * Active, unarchived services for pickers, by category (category order,
 * uncategorised last) then the service's own order and name. With
 * `viewCosts`, each carries its default cost.
 */
export async function listActiveServices(
  supabase: ServerSupabase,
  { viewCosts }: { viewCosts: boolean },
): Promise<ServiceOption[]> {
  const [servicesResult, costsResult] = await Promise.all([
    supabase
      .from("services")
      .select(
        "id, name, description, default_sale_price, currency, sort_order, category:categories(id, name, sort_order)",
      )
      .eq("active", true)
      .is("archived_at", null),
    viewCosts
      ? supabase
          .from("services_staff")
          .select("id, default_direct_cost")
          .eq("active", true)
          .is("archived_at", null)
      : Promise.resolve(null),
  ]);
  const rows = unwrap(servicesResult) ?? [];
  const costs = new Map<string, string>();
  if (costsResult) {
    for (const c of unwrap(costsResult) ?? []) {
      if (c.id && c.default_direct_cost !== null) {
        costs.set(c.id, toMoneyString(c.default_direct_cost));
      }
    }
  }
  const order = (r: (typeof rows)[number]) => r.category?.sort_order ?? Number.MAX_SAFE_INTEGER;
  return [...rows]
    .sort(
      (a, b) =>
        order(a) - order(b) ||
        (a.category?.name ?? "").localeCompare(b.category?.name ?? "") ||
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name),
    )
    .map((r) => {
      const option: ServiceOption = {
        id: r.id,
        name: r.name,
        description: r.description,
        categoryId: r.category?.id ?? null,
        categoryName: r.category?.name ?? UNCATEGORISED,
        salePrice: toMoneyString(r.default_sale_price),
        currency: r.currency,
      };
      if (viewCosts) option.cost = costs.get(r.id) ?? "0.00";
      return option;
    });
}

/**
 * Active services whose name or category contains every word of `q`
 * (case-insensitive), at most `limit`. The catalog is small, so it is
 * filtered here rather than with a pattern in the query.
 */
export async function searchServices(
  supabase: ServerSupabase,
  q: string,
  { viewCosts, limit = 12 }: { viewCosts: boolean; limit?: number },
): Promise<ServiceOption[]> {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const all = await listActiveServices(supabase, { viewCosts });
  return all
    .filter((s) => {
      const haystack = `${s.name} ${s.categoryName}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    })
    .slice(0, limit);
}

/**
 * The Cult Commons rate in force now (fraction, "0.3000"), for previews
 * only: each line snapshots the rate when the database adds it. Only
 * view_costs holders can read rates; null for anyone else or when none is set.
 */
export async function currentCultCommonsRate(supabase: ServerSupabase): Promise<string | null> {
  const row = unwrap(
    await supabase
      .from("cult_commons_rates")
      .select("rate")
      .is("cancelled_at", null)
      .lte("effective_from", new Date().toISOString())
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return row ? String(row.rate) : null;
}
