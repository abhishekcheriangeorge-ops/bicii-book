import "server-only";

import { unwrap } from "@/lib/db-errors";
import { isSearchKind, SEARCH_KINDS, type SearchHit, type SearchKind } from "@/lib/search";
import type { ServerSupabase } from "@/lib/supabase/server";

import type { ListPage } from "./list";

/**
 * Global staff search (SPEC §20) over the staff_search RPC: customers and
 * bikes (Phase 1), jobs by J- number (Phase 3), products and unique units
 * (Phase 4), more kinds as later phases add them. Exact short IDs, SKUs
 * and serial numbers rank first; archived records are left out unless
 * `archived` asks for them instead (the Archived lists). At most `limit`
 * hits over every kind together; `more` says there were more. Without
 * `kinds` it asks for SEARCH_KINDS only, so a kind the database already
 * knows but the app cannot open yet never takes a result slot.
 */
export async function staffSearch(
  supabase: ServerSupabase,
  q: string,
  {
    kinds,
    limit = 30,
    archived = false,
  }: { kinds?: SearchKind[]; limit?: number; archived?: boolean } = {},
): Promise<ListPage<SearchHit>> {
  if (!q.trim()) return { items: [], more: false };
  const rows =
    unwrap(
      await supabase.rpc("staff_search", {
        q,
        kinds: kinds ?? [...SEARCH_KINDS],
        max_results: limit + 1,
        archived,
      }),
    ) ?? [];
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
