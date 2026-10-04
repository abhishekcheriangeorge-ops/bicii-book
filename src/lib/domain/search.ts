import "server-only";

import { unwrap } from "@/lib/db-errors";
import { isSearchKind, type SearchHit, type SearchKind } from "@/lib/search";
import type { ServerSupabase } from "@/lib/supabase/server";

/**
 * Global staff search (SPEC §20) over the staff_search RPC: customers and
 * bikes in Phase 1, more kinds as later phases add them. Exact short IDs
 * and serial numbers rank first; archived records are left out.
 */
export async function staffSearch(
  supabase: ServerSupabase,
  q: string,
  { kinds, limit = 30 }: { kinds?: SearchKind[]; limit?: number } = {},
): Promise<SearchHit[]> {
  if (!q.trim()) return [];
  const rows = unwrap(await supabase.rpc("staff_search", { q, kinds, max_results: limit }));
  return (rows ?? [])
    .filter((r) => isSearchKind(r.kind))
    .map((r) => ({
      kind: r.kind as SearchKind,
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      shortId: r.short_id,
      rank: r.rank,
    }));
}
