/**
 * Human short IDs (DATA-MODEL.md §17, PLAN.md D9).
 *
 * The UUID is the primary key everywhere; short IDs are for people and QR
 * codes. Format: prefix + "-" + six digits, zero padded, never reused.
 * The QR payload is exactly `{public_site_url}/q/{short_id}` (DATA-MODEL §11).
 */

export const SHORT_ID_KINDS = {
  B: "bike",
  J: "work_order",
  P: "product",
  U: "inventory_unit",
  C: "consignment_item",
  PO: "purchase_order",
  S: "sale",
} as const;

export type ShortIdPrefix = keyof typeof SHORT_ID_KINDS;
export type ShortIdKind = (typeof SHORT_ID_KINDS)[ShortIdPrefix];

export const SHORT_ID_DIGITS = 6;

// PO before P so the alternation never stops at "P" for "PO-…".
const SHORT_ID_RE = /^(PO|B|J|P|U|C|S)-(\d{6})$/;

export type ScanResult = { kind: ShortIdKind; shortId: string };

/** formatShortId("J", 456) → "J-000456". */
export function formatShortId(prefix: ShortIdPrefix, n: number): string {
  if (!Number.isSafeInteger(n) || n < 1 || n >= 10 ** SHORT_ID_DIGITS) {
    throw new RangeError(`Short ID sequence value out of range: ${n}`);
  }
  if (!(prefix in SHORT_ID_KINDS)) throw new RangeError(`Unknown short ID prefix: ${prefix}`);
  return `${prefix}-${String(n).padStart(SHORT_ID_DIGITS, "0")}`;
}

/** Returns the kind for a well-formed short ID (case-insensitive), else null. */
export function parseShortId(input: string): ScanResult | null {
  const m = SHORT_ID_RE.exec(input.trim().toUpperCase());
  if (!m) return null;
  const prefix = m[1] as ShortIdPrefix;
  return { kind: SHORT_ID_KINDS[prefix], shortId: `${prefix}-${m[2]}` };
}

export function isShortId(input: string): boolean {
  return parseShortId(input) !== null;
}

/** The QR payload for a short ID: `{base}/q/{shortId}`. */
export function qrPayload(base: string, shortId: string): string {
  const parsed = parseShortId(shortId);
  if (!parsed) throw new RangeError(`Not a short ID: "${shortId}"`);
  return `${base.replace(/\/+$/, "")}/q/${parsed.shortId}`;
}

export type ParseScanOptions = {
  /** When set, a URL is accepted only if it starts with this base. */
  base?: string;
};

/**
 * Interprets what the scanner (or a person typing into the search box)
 * produced: either a full QR URL `{base}/q/{shortId}` or a bare short ID.
 * Returns null for anything else, including URLs on other paths.
 */
export function parseScan(input: string, options: ParseScanOptions = {}): ScanResult | null {
  const raw = input.trim();
  if (raw === "") return null;

  const bare = parseShortId(raw);
  if (bare) return bare;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  if (options.base) {
    let base: URL;
    try {
      base = new URL(options.base);
    } catch {
      return null;
    }
    const basePath = base.pathname.replace(/\/+$/, "");
    if (url.origin !== base.origin || !url.pathname.startsWith(`${basePath}/q/`)) return null;
  }

  const m = /\/q\/([^/]+)\/?$/.exec(url.pathname);
  if (!m) return null;
  let segment: string;
  try {
    segment = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return parseShortId(segment);
}

/**
 * Where a record of `kind` opens in the staff app, or null for kinds the
 * Admin has no page for yet (sales arrive with Phase 6's sale page,
 * purchase orders in Phase 7; each adds its case here). Shared by
 * resolveShortId (src/lib/domain/scan.ts, the /q resolver) and the search
 * results, so a short ID and a search hit always open the same page.
 */
export function hrefForRecord(kind: ShortIdKind, id: string): string | null {
  switch (kind) {
    case "bike":
      return `/bikes/${id}`;
    case "work_order":
      return `/jobs/${id}`;
    case "product":
      return `/products/${id}`;
    case "inventory_unit":
      return `/units/${id}`;
    case "consignment_item":
      return `/consignment/items/${id}`;
    case "purchase_order":
    case "sale":
      return null;
  }
}
