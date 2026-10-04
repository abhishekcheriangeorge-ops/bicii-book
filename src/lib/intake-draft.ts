/**
 * The intake draft (SPEC §22: autosave where losing work would hurt). One
 * draft per device in localStorage: the ids and labels picked and the text
 * typed, nothing else (no prices, no costs). Every access is wrapped, as in
 * src/lib/recent-searches.ts: storage can be missing, full, or throw
 * (Safari private mode, blocked site data). The draft keeps the job's and
 * the service lines' idempotency keys, so finishing a restored intake can
 * never make a second job. Pure apart from the storage it is handed.
 */
import { isUuid } from "@/lib/uuid";

export const INTAKE_DRAFT_KEY = "bicii.intake-draft.v1";

export type IntakeDraftService = { lineId: string; serviceId: string; quantity: string };

export type IntakeDraft = {
  v: 1;
  /** When the intake began (ISO), for "Continue the intake you started at 10:42?". */
  startedAt: string;
  /** The job's idempotency key. */
  workOrderId: string;
  /** 0 Customer · 1 Bike · 2 Work · 3 People · 4 Services · 5 Review */
  step: number;
  customer: { id: string; label: string } | null;
  bike: { id: string; shortId: string; title: string } | null;
  requestedWork: string;
  intakeNotes: string;
  leadId: string | null;
  additionalIds: string[];
  services: IntakeDraftService[];
};

export const LAST_STEP = 5;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Whether the draft holds anything worth offering back. */
export function draftHasContent(d: IntakeDraft): boolean {
  return (
    d.customer !== null ||
    d.bike !== null ||
    d.requestedWork.trim() !== "" ||
    d.intakeNotes.trim() !== "" ||
    d.services.length > 0
  );
}

export function serializeDraft(draft: IntakeDraft): string {
  return JSON.stringify(draft);
}

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length <= max ? v : null;

/** The draft from its stored JSON; null for anything missing, malformed or from another version. */
export function parseDraft(raw: string | null | undefined): IntakeDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const d = obj(parsed);
  if (!d || d.v !== 1) return null;
  const startedAt = str(d.startedAt, 40);
  if (!startedAt || Number.isNaN(Date.parse(startedAt))) return null;
  if (!isUuid(d.workOrderId)) return null;
  const step =
    typeof d.step === "number" && Number.isInteger(d.step) && d.step >= 0 && d.step <= LAST_STEP
      ? d.step
      : 0;

  const c = obj(d.customer);
  const customer =
    c && isUuid(c.id) && str(c.label, 400) !== null ? { id: c.id, label: c.label as string } : null;
  const b = obj(d.bike);
  const bike =
    b && isUuid(b.id) && str(b.shortId, 40) !== null && str(b.title, 400) !== null
      ? { id: b.id, shortId: b.shortId as string, title: b.title as string }
      : null;
  const services = Array.isArray(d.services)
    ? d.services.flatMap((s): IntakeDraftService[] => {
        const o = obj(s);
        return o &&
          isUuid(o.lineId) &&
          isUuid(o.serviceId) &&
          typeof o.quantity === "string" &&
          /^\d{1,4}(\.\d{1,2})?$/.test(o.quantity)
          ? [{ lineId: o.lineId, serviceId: o.serviceId, quantity: o.quantity }]
          : [];
      })
    : [];
  return {
    v: 1,
    startedAt,
    workOrderId: d.workOrderId,
    step,
    customer,
    bike,
    requestedWork: str(d.requestedWork, 5_000) ?? "",
    intakeNotes: str(d.intakeNotes, 10_000) ?? "",
    leadId: isUuid(d.leadId) ? d.leadId : null,
    additionalIds: Array.isArray(d.additionalIds) ? d.additionalIds.filter(isUuid) : [],
    services,
  };
}

export function readDraft(storage: StorageLike | null = defaultStorage()): IntakeDraft | null {
  try {
    return parseDraft(storage?.getItem(INTAKE_DRAFT_KEY));
  } catch {
    return null;
  }
}

/** Saves the draft, or removes it when there is nothing in it yet. */
export function saveDraft(
  draft: IntakeDraft,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    if (draftHasContent(draft)) storage?.setItem(INTAKE_DRAFT_KEY, serializeDraft(draft));
    else storage?.removeItem(INTAKE_DRAFT_KEY);
  } catch {
    // Full or blocked: the intake just isn't kept.
  }
}

export function clearDraft(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(INTAKE_DRAFT_KEY);
  } catch {
    // Nothing to do.
  }
}
