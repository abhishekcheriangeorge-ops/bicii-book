/**
 * Global staff search results (SPEC §20; RPC staff_search, DATA-MODEL §16).
 * Pure: the grouping and links are shared by the /search page and tests.
 */

/** Kinds staff_search knows (Phase 1 customers and bikes, Phase 3 jobs). Later phases add theirs here and in the RPC. */
export const SEARCH_KINDS = ["customer", "bike", "work_order"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export function isSearchKind(value: unknown): value is SearchKind {
  return typeof value === "string" && (SEARCH_KINDS as readonly string[]).includes(value);
}

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  shortId: string | null;
  /** 1.0 = exact short ID or serial number; fuzzy matches rank lower. */
  rank: number;
};

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  customer: "Customers",
  bike: "Bikes",
  work_order: "Jobs",
};

/** Where a hit opens in the staff app. */
export function hrefForHit(hit: Pick<SearchHit, "kind" | "id">): string {
  switch (hit.kind) {
    case "customer":
      return `/customers/${hit.id}`;
    case "bike":
      return `/bikes/${hit.id}`;
    case "work_order":
      return `/jobs/${hit.id}`;
  }
}

export type SearchGroup = { kind: SearchKind; label: string; hits: SearchHit[] };

/**
 * Hits grouped by kind, keeping the database's order inside each group.
 * The group holding the best hit comes first (an exact short ID or serial
 * number puts Bikes above Customers, an exact J- number puts Jobs first);
 * ties keep SEARCH_KINDS order.
 */
export function groupHits(hits: readonly SearchHit[]): SearchGroup[] {
  const groups = SEARCH_KINDS.map((kind) => ({
    kind,
    label: SEARCH_KIND_LABELS[kind],
    hits: hits.filter((h) => h.kind === kind),
  })).filter((g) => g.hits.length > 0);
  const best = (g: SearchGroup) => Math.max(...g.hits.map((h) => h.rank));
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => best(b.g) - best(a.g) || a.i - b.i)
    .map(({ g }) => g);
}
