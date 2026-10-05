/**
 * Global staff search results (SPEC §20; RPC staff_search, DATA-MODEL §16).
 * Pure: the grouping and links are shared by the /search page and tests.
 */
import { hrefForRecord, parseShortId } from "@/lib/ids";

/**
 * Kinds staff_search knows: customers and bikes (Phase 1), jobs (Phase 3),
 * products and unique units (Phase 4), consignors, consignment items and
 * sales (Phase 6). Later phases add theirs here and in the RPC; the order
 * is the tie-break order of the /search groups.
 */
export const SEARCH_KINDS = [
  "customer",
  "bike",
  "work_order",
  "product",
  "inventory_unit",
  "consignor",
  "consignment_item",
  "sale",
] as const;
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
  product: "Products",
  inventory_unit: "Units",
  consignor: "Consignors",
  consignment_item: "Consignment items",
  sale: "Sales",
};

/**
 * Where a hit opens in the staff app: a customer's page, or for records
 * with a short ID the same page the /q resolver opens (hrefForRecord).
 */
export function hrefForHit(hit: Pick<SearchHit, "kind" | "id">): string {
  if (hit.kind === "customer") return `/customers/${hit.id}`;
  if (hit.kind === "consignor") return `/consignment/consignors/${hit.id}`;
  // Every other search kind has an Admin page (hrefForRecord is null only
  // for kinds staff_search does not return yet).
  return hrefForRecord(hit.kind, hit.id) ?? "/search";
}

/**
 * The header search's shortcut: a query that is exactly a short ID (any
 * case, PLAN D9) opens the record through the /q resolver instead of the
 * results page. Null for anything else.
 */
export function shortIdJump(q: string): string | null {
  const parsed = parseShortId(q);
  return parsed ? `/q/${parsed.shortId}` : null;
}

export type SearchGroup = { kind: SearchKind; label: string; hits: SearchHit[] };

/**
 * Hits grouped by kind, keeping the database's order inside each group.
 * The group holding the best hit comes first (an exact short ID or serial
 * number puts Bikes above Customers, an exact J- number puts Jobs first,
 * an exact P- number or SKU puts Products first);
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
