import "server-only";

import { unwrap } from "@/lib/db-errors";
import { hrefForRecord, parseShortId } from "@/lib/ids";
import type { ServerSupabase } from "@/lib/supabase/server";

/**
 * Short-ID resolution for staff (PLAN D9; DATA-MODEL §11): what the
 * Admin's /q/{shortId} route opens. The prefix decides the table, the
 * read goes through RLS as the signed-in staff member, and archived
 * records still resolve (a label outlives its record's active life).
 *
 *   B  bikes.short_id             -> /bikes/[id]
 *   J  work_orders.job_number     -> /jobs/[id]
 *   P  products.short_id          -> /products/[id]
 *   U  inventory_units.short_id   -> /units/[id]
 *   C  consignment_items.short_id -> /consignment/items/[id] (Phase 6)
 *   S  sales.sale_number          -> /sales/[id] (Phase 6)
 *   PO purchase_orders.po_number  -> /purchasing/orders/[id] (Phase 7)
 *
 * This is the only Admin resolver and /q/[shortId] the only Admin /q
 * route: later phases extend this function rather than adding routes, and
 * Phase 11 verifies that every prefix resolves (adding any that is still
 * missing). The public site's /q page lives in the other repository.
 */
export async function resolveShortId(
  supabase: ServerSupabase,
  input: string,
): Promise<{ href: string } | null> {
  const parsed = parseShortId(input);
  if (!parsed) return null;
  const { kind, shortId } = parsed;
  let id: string | null = null;
  switch (kind) {
    case "bike":
      id =
        unwrap(await supabase.from("bikes").select("id").eq("short_id", shortId).maybeSingle())
          ?.id ?? null;
      break;
    case "work_order":
      id =
        unwrap(
          await supabase.from("work_orders").select("id").eq("job_number", shortId).maybeSingle(),
        )?.id ?? null;
      break;
    case "product":
      id =
        unwrap(await supabase.from("products").select("id").eq("short_id", shortId).maybeSingle())
          ?.id ?? null;
      break;
    case "inventory_unit":
      id =
        unwrap(
          await supabase.from("inventory_units").select("id").eq("short_id", shortId).maybeSingle(),
        )?.id ?? null;
      break;
    case "consignment_item":
      id =
        unwrap(
          await supabase
            .from("consignment_items")
            .select("id")
            .eq("short_id", shortId)
            .maybeSingle(),
        )?.id ?? null;
      break;
    case "sale":
      id =
        unwrap(await supabase.from("sales").select("id").eq("sale_number", shortId).maybeSingle())
          ?.id ?? null;
      break;
    case "purchase_order": // Phase 7
      id =
        unwrap(
          await supabase
            .from("purchase_orders")
            .select("id")
            .eq("po_number", shortId)
            .maybeSingle(),
        )?.id ?? null;
      break;
  }
  if (!id) return null;
  const href = hrefForRecord(kind, id);
  return href ? { href } : null;
}
