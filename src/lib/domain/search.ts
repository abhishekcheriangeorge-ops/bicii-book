import "server-only";

import { unwrap } from "@/lib/db-errors";
import { isSearchKind, type SearchHit, type SearchKind } from "@/lib/search";
import type { ServerSupabase } from "@/lib/supabase/server";

import type { ListPage } from "./list";

/**
 * Global staff search (SPEC §20) over the staff_search RPC: customers and
 * bikes (Phase 1) and jobs by J- number (Phase 3), more kinds as later
 * phases add them. Exact short IDs
 * and serial numbers rank first; archived records are left out. At most
 * `limit` hits over every kind together; `more` says there were more.
 */
export async function staffSearch(
  supabase: ServerSupabase,
  q: string,
  { kinds, limit = 30 }: { kinds?: SearchKind[]; limit?: number } = {},
): Promise<ListPage<SearchHit>> {
  if (!q.trim()) return { items: [], more: false };
  const rows =
    unwrap(await supabase.rpc("staff_search", { q, kinds, max_results: limit + 1 })) ?? [];
  return {
    items: rows
      .slice(0, limit)
      .filter((r) => isSearchKind(r.kind))
      .map((r) => ({
        kind: r.kind as SearchKind,
        id: r.id,
        title: r.title,
        subtitle: r.subtitle,
        shortId: r.short_id,
        rank: r.rank,
      })),
    more: rows.length > limit,
  };
}
