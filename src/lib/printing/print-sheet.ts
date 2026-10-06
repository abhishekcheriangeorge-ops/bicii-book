import { Decimal, formatMoney } from "@/lib/money";
import { isUuid } from "@/lib/uuid";

import { maxLabelQuantity } from "./job";
import type { LabelKind } from "./types";

/**
 * The record page's print flow (SPEC §16: open the record → Print label →
 * how many → printer → print; PLAN D56, D58, D59). Pure helpers for
 * PrintLabelSheet and the record pages, unit-tested; the database decides
 * everything that is printed.
 */

/** Quick choices for a product's label count (44 px toggle buttons). */
export const QUICK_QUANTITIES = [1, 5, 10, 20, 50] as const;

/** localStorage key of the printer this device used last (a convenience, never data). */
export const LABEL_PRINTER_KEY = "bicii.label-printer.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The printer id this device used last, or null (missing, malformed or blocked storage). */
export function readRememberedPrinter(
  storage: StorageLike | null = defaultStorage(),
): string | null {
  try {
    const raw = storage?.getItem(LABEL_PRINTER_KEY) ?? null;
    return isUuid(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Remembers the printer on this device; full or blocked storage just forgets. */
export function rememberPrinter(id: string, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(LABEL_PRINTER_KEY, id);
  } catch {
    // Not remembered: the default printer is preselected next time.
  }
}

/**
 * Which printer the sheet preselects: the reprinted job's (when still
 * active), else this device's last one (when still active), else the
 * default, else the first. Null only when there is no active printer.
 */
export function choosePrinter(
  activeIds: readonly string[],
  {
    presetId,
    rememberedId,
    defaultId,
  }: { presetId?: string | null; rememberedId?: string | null; defaultId?: string | null },
): string | null {
  for (const id of [presetId, rememberedId, defaultId]) {
    if (id && activeIds.includes(id)) return id;
  }
  return activeIds[0] ?? null;
}

/** The template the sheet preselects: the reprinted job's when still active, else the default. */
export function chooseTemplate(
  activeIds: readonly string[],
  { presetId, defaultId }: { presetId?: string | null; defaultId?: string | null },
): string | null {
  for (const id of [presetId, defaultId]) {
    if (id && activeIds.includes(id)) return id;
  }
  return activeIds[0] ?? null;
}

/**
 * D58: whether two label prices differ. Decimal comparison ("39.9" equals
 * "39.90"); null is "no price", which differs from any price, 0 included
 * (D24 amended: 0 is a known price).
 */
export function priceChanged(before: string | null, now: string | null): boolean {
  if (before === null || now === null) return before !== now;
  return !new Decimal(before).eq(new Decimal(now));
}

/**
 * A label price as the price-changed notes say it (D58): "no price" for
 * NULL, otherwise the money, so 0 reads "$0.00" (D24 amended).
 */
export function describeLabelPrice(price: string | null, currency: string): string {
  return price === null ? "no price" : formatMoney(price, currency);
}

/**
 * The quantity the sheet starts with (D56: a per-job cap): the requested
 * count within 1..max, and how many of the request remain for another job.
 */
export function initialQuantity(
  kind: LabelKind,
  requested: number | null | undefined,
): { quantity: number; remaining: number } {
  const max = maxLabelQuantity(kind);
  const want = requested && Number.isInteger(requested) && requested >= 1 ? requested : 1;
  return { quantity: Math.min(want, max), remaining: Math.max(want - max, 0) };
}

/** "Print 1 label", "Print 10 labels"; "Print labels" until the count is a valid number. */
export function printButtonLabel(quantity: string): string {
  const n = /^\d+$/.test(quantity.trim()) ? Number(quantity.trim()) : null;
  if (n === null || n < 1) return "Print labels";
  return `Print ${n} ${n === 1 ? "label" : "labels"}`;
}

/**
 * The record page's deep link (`?print=1&qty=N&reprint={jobId}`, from
 * "Print again", reprintPath): whether to open the print sheet, the count
 * asked for and the job it reprints. Anything malformed is ignored.
 */
export function parsePrintParams(params: {
  print?: string | string[];
  qty?: string | string[];
  reprint?: string | string[];
}): { open: boolean; requestedQuantity: number | null; reprintOfId: string | null } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const open = one(params.print) === "1";
  const qty = one(params.qty);
  const n = qty && /^\d{1,6}$/.test(qty) ? Number(qty) : null;
  const reprint = one(params.reprint) ?? null;
  return {
    open,
    requestedQuantity: open && n !== null && n >= 1 ? n : null,
    reprintOfId: open && isUuid(reprint) ? reprint.toLowerCase() : null,
  };
}
