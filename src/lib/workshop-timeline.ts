/**
 * How a job's timeline reads (SPEC §7.3; DATA-MODEL §4 "Timeline"): one
 * sentence per work_order_events row, from its type and payload. Pure, so
 * the job page and tests share it. Payloads never carry costs, yield or
 * Cult Commons (the database guarantees it), so nothing here can show one.
 */
import type { Database } from "@/lib/database.types";
import { DEFAULT_CURRENCY, formatMoney, formatQuantity } from "@/lib/money";
import {
  STATUS_LABELS,
  WORK_ORDER_STATUSES,
  statusTone,
  type StatusTone,
  type WorkOrderStatus,
} from "@/lib/workshop";

export type WorkOrderEventType = Database["public"]["Enums"]["work_order_event_type"];

export type TimelineEvent = {
  type: WorkOrderEventType;
  payload: unknown;
  /** The staff member an assignment event is about (work_order_timeline's subject name). */
  subjectName?: string | null;
};

export type EventDescription = {
  title: string;
  /** A note, reason or the text that changed; shown quoted under the title. */
  detail: string | null;
  tone: StatusTone;
};

type Payload = Record<string, unknown>;

const asPayload = (value: unknown): Payload =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Payload) : {};

const text = (p: Payload, key: string): string | null => {
  const v = p[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
};

const amount = (p: Payload, key: string): string | number | null => {
  const v = p[key];
  return typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()))
    ? v
    : null;
};

const status = (p: Payload, key: string): WorkOrderStatus | null => {
  const v = p[key];
  return typeof v === "string" && (WORK_ORDER_STATUSES as readonly string[]).includes(v)
    ? (v as WorkOrderStatus)
    : null;
};

const DETAIL_FIELDS: Record<string, string> = {
  requested_work: "Requested work",
  intake_notes: "Condition on arrival",
  internal_notes: "Internal notes",
  completion_notes: "Completion notes",
};

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** "Full Service × 2 · $70.00" (the quantity only when it is not 1). */
function lineSummary(p: Payload, currency: string): string {
  const description = text(p, "description") ?? "A line";
  const quantity = amount(p, "quantity");
  const total = amount(p, "sale_total");
  const lineCurrency = text(p, "currency") ?? currency;
  const qty =
    quantity !== null && formatQuantity(quantity) !== "1" ? ` × ${formatQuantity(quantity)}` : "";
  const money = total !== null ? ` · ${formatMoney(total, lineCurrency)}` : "";
  return `${description}${qty}${money}`;
}

/**
 * The title, detail and tone for one timeline event. `currency` is the
 * job's, for amounts whose payload does not name one (a void).
 */
export function describeEvent(
  event: TimelineEvent,
  { currency = DEFAULT_CURRENCY }: { currency?: string } = {},
): EventDescription {
  const p = asPayload(event.payload);
  const note = text(p, "note");
  switch (event.type) {
    case "checked_in":
      return {
        title: `Checked in as ${text(p, "job_number") ?? "a new job"}`,
        detail: text(p, "requested_work"),
        tone: "info",
      };
    case "status_changed": {
      if (p.started === true) return { title: "Work started", detail: note, tone: "progress" };
      const from = status(p, "from");
      const to = status(p, "to");
      return {
        title:
          from && to
            ? `Status: ${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}`
            : to
              ? `Status: ${STATUS_LABELS[to]}`
              : "Status changed",
        detail: note,
        tone: to ? statusTone(to) : "neutral",
      };
    }
    case "completed":
      return { title: "Completed", detail: note, tone: "done" };
    case "ready_for_collection":
      return { title: "Ready for collection", detail: note, tone: "done" };
    case "collected":
      return { title: "Collected", detail: note, tone: "neutral" };
    case "cancelled":
      return { title: "Cancelled", detail: note, tone: "danger" };
    case "reopened":
      return { title: "Reopened", detail: note, tone: "waiting" };
    case "assignment_changed": {
      const name = event.subjectName ?? "A former colleague";
      const title =
        p.action === "unassigned"
          ? `${name} removed from the job`
          : p.role === "lead"
            ? `${name} assigned as lead`
            : `${name} added to the job`;
      return { title, detail: null, tone: "neutral" };
    }
    case "note_added":
      return { title: "Note", detail: text(p, "body"), tone: "neutral" };
    case "diagnosis_added":
      return { title: "Diagnosis", detail: text(p, "body"), tone: "info" };
    case "details_changed": {
      const fields = Object.keys(p).filter((k) => k in DETAIL_FIELDS);
      if (fields.length === 0) return { title: "Details updated", detail: null, tone: "neutral" };
      const words = fields.map((f, i) =>
        i === 0 ? DETAIL_FIELDS[f] : DETAIL_FIELDS[f].toLowerCase(),
      );
      const only = fields.length === 1 ? asPayload(p[fields[0]]) : null;
      return {
        title: `${joinWords(words)} updated`,
        detail: only ? text(only, "to") : null,
        tone: "neutral",
      };
    }
    case "approval_flagged":
      return {
        title: p.flagged === true ? "Marked customer-approved" : "Approval flag cleared",
        detail: note,
        tone: p.flagged === true ? "done" : "neutral",
      };
    case "photo_added":
      return {
        title: "Photo added",
        detail: p.visibility === "customer" ? "Visible to the customer" : null,
        tone: "neutral",
      };
    case "photo_removed":
      return { title: "Photo deleted", detail: text(p, "reason"), tone: "neutral" };
    case "line_added":
      return { title: `Added ${lineSummary(p, currency)}`, detail: null, tone: "neutral" };
    case "line_voided":
      return {
        title: `Voided ${lineSummary(p, currency)}`,
        detail: text(p, "reason"),
        tone: "danger",
      };
    case "stock_consumed":
      return { title: "Stock used", detail: text(p, "description"), tone: "neutral" };
    case "stock_reversed":
      return { title: "Stock returned", detail: text(p, "reason"), tone: "neutral" };
    default: {
      const unknown: never = event.type;
      return { title: String(unknown), detail: null, tone: "neutral" };
    }
  }
}
