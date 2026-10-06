/**
 * Shopify screens' words and tones (Phase 10 step 4; SPEC §17, §26; PLAN
 * D80–D89; DATA-MODEL §13). Pure and client-safe: every status, outcome
 * and rejection reason the database stores has a sentence here, so the
 * screens never show a raw code, and the unit tests prove each one has
 * text. The database decides everything; this only says it in words.
 */
import type { Database } from "@/lib/database.types";
import { formatTime } from "@/lib/dates";
import { formatMoney, toDecimal } from "@/lib/money";
import type { StatusTone } from "@/lib/workshop";

export type SyncStatus = Database["public"]["Enums"]["shopify_sync_status"];
export type JobStatus = Database["public"]["Enums"]["integration_job_status"];
export type JobKind = Database["public"]["Enums"]["integration_job_kind"];
export type EventStatus = Database["public"]["Enums"]["integration_event_status"];
export type RejectionReason = Database["public"]["Enums"]["integration_rejection_reason"];
export type ShopifyOrigin = "bicii" | "external";

// ---------------------------------------------------------------------------
// Product sync status (OnlineCard, /shopify/products)
// ---------------------------------------------------------------------------

export const SYNC_STATUSES: readonly SyncStatus[] = [
  "not_synced",
  "pending",
  "synced",
  "error",
  "unpublished",
];

const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  not_synced: "Not synced",
  pending: "Syncing",
  synced: "Synced",
  error: "Sync failed",
  unpublished: "Offline",
};

const SYNC_STATUS_TONES: Record<SyncStatus, StatusTone> = {
  not_synced: "neutral",
  pending: "progress",
  synced: "done",
  error: "danger",
  unpublished: "neutral",
};

export function syncStatusLabel(status: SyncStatus): string {
  return SYNC_STATUS_LABELS[status] ?? "Unknown";
}

export function syncStatusTone(status: SyncStatus): StatusTone {
  return SYNC_STATUS_TONES[status] ?? "neutral";
}

// ---------------------------------------------------------------------------
// Queue jobs (/shopify/queue, the event inspector)
// ---------------------------------------------------------------------------

export const JOB_STATUSES: readonly JobStatus[] = [
  "queued",
  "running",
  "done",
  "needs_attention",
  "dismissed",
];

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Waiting to retry",
  running: "Running",
  done: "Done",
  needs_attention: "Needs attention",
  dismissed: "Dismissed",
};

const JOB_STATUS_TONES: Record<JobStatus, StatusTone> = {
  queued: "waiting",
  running: "progress",
  done: "done",
  needs_attention: "danger",
  dismissed: "neutral",
};

export function jobStatusLabel(status: JobStatus): string {
  return JOB_STATUS_LABELS[status] ?? "Unknown";
}

export function jobStatusTone(status: JobStatus): StatusTone {
  return JOB_STATUS_TONES[status] ?? "neutral";
}

/** "Order", "Refund", "Product sync"; another topic's job says "Shopify event". */
export function jobKindLabel(kind: JobKind, topic: string | null | undefined): string {
  if (kind === "product_sync") return "Product sync";
  if (topic === "orders/paid") return "Order";
  if (topic === "refunds/create") return "Refund";
  return "Shopify event";
}

/**
 * A queue item's title: its kind and subject ("Order #1042", "Product sync
 * P-000027 …"), without repeating the kind when the subject already starts
 * with it (a refund's subject is "Refund 7300000001 of #1001").
 */
export function jobTitle(kind: JobKind, topic: string | null | undefined, subject: string): string {
  const label = jobKindLabel(kind, topic);
  return subject.toLowerCase().startsWith(`${label.toLowerCase()} `)
    ? subject
    : `${label} ${subject}`;
}

/** A job that is finished: nothing can be done with it any more. */
export const jobClosed = (status: JobStatus) => status === "done" || status === "dismissed";

/**
 * "Attempt 3 of 8 · next try 2:05 pm" (Singapore time) while a job waits;
 * "Attempt 3 of 8" otherwise; "Not tried yet" before the first claim.
 */
export function attemptText({
  attempts,
  maxAttempts,
  nextAttemptAt,
  status,
}: {
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  status: JobStatus;
}): string {
  const base = attempts > 0 ? `Attempt ${attempts} of ${maxAttempts}` : "Not tried yet";
  if (status === "queued" && nextAttemptAt)
    return `${base} · next try ${formatTime(nextAttemptAt)}`;
  return base;
}

// ---------------------------------------------------------------------------
// Events (/shopify/events, /shopify/events/[id])
// ---------------------------------------------------------------------------

export const EVENT_STATUSES: readonly EventStatus[] = [
  "pending",
  "processed",
  "skipped",
  "failed",
  "rejected",
];

const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  pending: "Pending",
  processed: "Processed",
  skipped: "Skipped",
  failed: "Failed",
  rejected: "Rejected",
};

const EVENT_STATUS_TONES: Record<EventStatus, StatusTone> = {
  pending: "waiting",
  processed: "done",
  skipped: "neutral",
  failed: "danger",
  rejected: "danger",
};

export function eventStatusLabel(status: EventStatus): string {
  return EVENT_STATUS_LABELS[status] ?? "Unknown";
}

export function eventStatusTone(status: EventStatus): StatusTone {
  return EVENT_STATUS_TONES[status] ?? "neutral";
}

/** "Order paid", "Refund", or the raw topic for anything BICII does not use. */
export function topicLabel(topic: string): string {
  if (topic === "orders/paid") return "Order paid";
  if (topic === "refunds/create") return "Refund";
  return topic;
}

/** "Delivered 2×" when Shopify sent the same webhook more than once; null otherwise. */
export function deliveredText(count: number): string | null {
  return count > 1 ? `Delivered ${count}×` : null;
}

export const REJECTION_REASONS: readonly RejectionReason[] = [
  "hmac_invalid",
  "webhook_secret_missing",
  "shop_not_configured",
  "shop_domain_mismatch",
  "missing_headers",
  "body_not_json",
];

const REJECTION_TEXT: Record<RejectionReason, string> = {
  hmac_invalid: "Signature did not match",
  webhook_secret_missing: "Webhook secret not configured",
  shop_not_configured: "Shop domain not configured",
  shop_domain_mismatch: "Sent by a different shop",
  missing_headers: "Shopify headers missing",
  body_not_json: "Body was not JSON",
};

/** Why a delivery was rejected, in words (D88). */
export function rejectionText(reason: RejectionReason | null | undefined): string | null {
  if (!reason) return null;
  return REJECTION_TEXT[reason] ?? "Rejected";
}

/** Every outcome the processors store (DATA-MODEL §13). */
export const EVENT_OUTCOMES = [
  "sale_recorded",
  "duplicate_order",
  "refund_recorded",
  "duplicate_refund",
  "no_money_refunded",
  "refund_not_allocated",
  "test_order",
  "pos_order",
  "order_not_recorded",
  "earlier_delivery_skipped",
  "topic_not_handled",
  "dismissed",
] as const;

export type EventOutcome = (typeof EVENT_OUTCOMES)[number];

/** A refund event's amounts (D85), from its stored result; null when absent. */
export type RefundAmounts = {
  amount: string | null;
  shipping: string | null;
  /** Money refunded beyond the sale's allocation and the shipping (never negative). */
  excess: string | null;
};

const decimalOrNull = (v: unknown): string | null => {
  if (typeof v !== "number" && typeof v !== "string") return null;
  try {
    return toDecimal(v).toFixed(2);
  } catch {
    return null;
  }
};

export function refundAmounts(result: unknown): RefundAmounts {
  const r = isRecord(result) ? result : {};
  const amount = decimalOrNull(r.amount);
  const shipping = decimalOrNull(r.shipping_refunded);
  const unallocated = decimalOrNull(r.unallocated_refund);
  let excess: string | null = null;
  if (unallocated !== null) {
    const e = toDecimal(unallocated).minus(toDecimal(shipping ?? "0"));
    excess = (e.isNegative() ? toDecimal(0) : e).toFixed(2);
  }
  return { amount, shipping, excess };
}

/**
 * The event's outcome in words (the inspector's Summary). `saleNumber` is
 * the recorded sale's S- number; `currency` formats a refund's amounts.
 * Refunds are financial only: a refund never moves stock (D7, D85), and
 * reports net nothing yet (D49; netting is Phase 9's owner question).
 */
export function outcomeText(
  outcome: string | null,
  {
    saleNumber = null,
    result = null,
    resolutionReason = null,
    currency,
  }: {
    saleNumber?: string | null;
    result?: unknown;
    resolutionReason?: string | null;
    currency?: string;
  } = {},
): { text: string; detail: string | null } | null {
  switch (outcome) {
    case null:
    case undefined:
    case "":
      return null;
    case "sale_recorded":
      return { text: `Recorded as sale ${saleNumber ?? ""}`.trim(), detail: null };
    case "duplicate_order":
      return {
        text: `Already recorded from another delivery${saleNumber ? ` (${saleNumber})` : ""}`,
        detail: null,
      };
    case "refund_recorded": {
      // D7, D85: the refund is money only; stock comes back only by a
      // restock from the sale. D49: reports do not net it yet.
      const { amount, shipping, excess } = refundAmounts(result);
      const money = (v: string) => formatMoney(v, currency);
      const kept =
        (shipping !== null && toDecimal(shipping).gt(0)) ||
        (excess !== null && toDecimal(excess).gt(0))
          ? `Shipping refunded ${money(shipping ?? "0")} and ${money(excess ?? "0")} not allocated to the sale are kept here only`
          : null;
      return {
        text: `Refund of ${money(amount ?? "0")} recorded; stock untouched — restock from the sale if the item came back`,
        detail: kept,
      };
    }
    case "duplicate_refund":
      return { text: "Refund already recorded", detail: null };
    case "no_money_refunded":
      return { text: "No money was refunded", detail: null };
    case "refund_not_allocated":
      return {
        text: "Refund is more than the sale's remaining total; nothing recorded",
        detail: null,
      };
    case "test_order":
      return { text: "Shopify test order — not recorded as a sale", detail: null };
    case "pos_order":
      return { text: "Shopify POS order — in-store sales are recorded in BICII", detail: null };
    case "order_not_recorded":
      return {
        text: "The order was not recorded in BICII, so neither is this refund",
        detail: null,
      };
    case "earlier_delivery_skipped":
      return {
        text: "Another delivery of this was already closed without recording (dismissed, a test or POS order); that is final, so this one is not recorded either",
        detail: null,
      };
    case "topic_not_handled":
      return { text: "Topic not used by BICII", detail: null };
    case "dismissed":
      return {
        text: resolutionReason ? `Dismissed: ${resolutionReason}` : "Dismissed",
        detail: null,
      };
    default:
      return { text: `Outcome: ${outcome}`, detail: null };
  }
}

/** The short note on an event's row in the list (the outcome in a few words). */
export function eventRowNote({
  status,
  outcome,
  saleNumber,
  rejectionReason,
}: {
  status: EventStatus;
  outcome: string | null;
  saleNumber: string | null;
  rejectionReason: RejectionReason | null;
}): string | null {
  if (status === "rejected") return rejectionText(rejectionReason);
  switch (outcome) {
    case "sale_recorded":
      return saleNumber ? `Recorded as ${saleNumber}` : "Recorded";
    case "duplicate_order":
      return `Already recorded${saleNumber ? ` (${saleNumber})` : ""}`;
    case "refund_recorded":
      return saleNumber ? `Refund on ${saleNumber}` : "Refund recorded";
    case "duplicate_refund":
      return "Refund already recorded";
    case "no_money_refunded":
      return "No money refunded";
    case "refund_not_allocated":
      return "Refund not recorded";
    case "test_order":
      return "Test order, not recorded";
    case "pos_order":
      return "POS order, not recorded";
    case "order_not_recorded":
      return "Order not recorded";
    case "earlier_delivery_skipped":
      return "Earlier delivery closed, not recorded";
    case "topic_not_handled":
      return "Not used by BICII";
    case "dismissed":
      return "Dismissed";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Unmapped lines (shopify_variant_unmapped, D84)
// ---------------------------------------------------------------------------

export type UnmappedLine = {
  lineItemId: string | null;
  title: string;
  variantTitle: string | null;
  /** null for a custom Shopify line (no product): it cannot be linked. */
  variantGid: string | null;
  productGid: string | null;
  quantity: number | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : null;

/** The `unmapped_lines` an event's result keeps for a failed order (never throws). */
export function parseUnmappedLines(result: unknown): UnmappedLine[] {
  if (!isRecord(result) || !Array.isArray(result.unmapped_lines)) return [];
  return result.unmapped_lines.filter(isRecord).map((l) => {
    const quantity = typeof l.quantity === "number" ? l.quantity : Number(text(l.quantity));
    return {
      lineItemId: text(l.line_item_id),
      title: text(l.title) ?? "Untitled line",
      variantTitle: text(l.variant_title),
      variantGid: text(l.variant_gid),
      productGid: text(l.product_gid),
      quantity: Number.isFinite(quantity) ? quantity : null,
    };
  });
}

/** "BICII cotton cap — Red" (the variant title when Shopify sent one). */
export function unmappedLineTitle(line: Pick<UnmappedLine, "title" | "variantTitle">): string {
  return line.variantTitle ? `${line.title} — ${line.variantTitle}` : line.title;
}

// ---------------------------------------------------------------------------
// Settings and the connection
// ---------------------------------------------------------------------------

export type ConnectionMode = "live" | "fake" | "off";

export function connectionLabel(mode: ConnectionMode): string {
  return mode === "live" ? "Live" : mode === "fake" ? "Test (fake)" : "Not connected";
}

export function connectionTone(mode: ConnectionMode): StatusTone {
  return mode === "live" ? "done" : mode === "fake" ? "waiting" : "danger";
}

/** After a customer link (D86): how many earlier online sales show them through the Shopify ID. */
export function earlierSalesText(n: number): string {
  if (n <= 0) return "No earlier online sale is waiting for this customer.";
  return `${n} earlier online ${n === 1 ? "sale shows" : "sales show"} this customer through their Shopify ID; recorded sales are not changed.`;
}

/** After a committed change whose immediate run could not happen (D87: the queue runs it). */
export const SYNC_QUEUED_MESSAGE = "Saved. The sync runs from the queue in a moment.";

export const TEST_ORDERS_WARNING = "Only for testing. Test orders would count as real sales.";

/**
 * Why Publish online cannot be switched on here, or null (D84, D86). The
 * database checks again (set_publish_online); this only explains a
 * disabled switch. Switching off is never blocked by the product's state.
 */
export function publishBlockedReason({
  canManage,
  publishOnline,
  publicationStatus,
  ownershipType,
  archived,
  hasPrice,
}: {
  canManage: boolean;
  publishOnline: boolean;
  publicationStatus: string;
  ownershipType: string;
  archived: boolean;
  hasPrice: boolean;
}): string | null {
  if (!canManage) return "Needs Manage inventory";
  if (publishOnline) return null;
  if (archived) return "Unarchive the product first.";
  if (ownershipType === "customer_owned") return "Customer-owned items cannot be sold online.";
  if (publicationStatus !== "public") return "Make the product public first.";
  if (!hasPrice) return "Set a sale price first.";
  return null;
}

/**
 * Why a product with Publish online on is not listed on the store, or null
 * when it is (private.shopify_effective_online, D84: active, not archived,
 * not customer-owned, and public, or a unique product that sold out). The
 * flag stays on, so the listing comes back when the product does.
 */
export function offlineReason({
  active,
  archived,
  ownershipType,
  publicationStatus,
  trackingType,
}: {
  active: boolean;
  archived: boolean;
  ownershipType: string;
  publicationStatus: string;
  trackingType: string;
}): string | null {
  if (archived)
    return "Not listed: the product is archived. It goes back online when you unarchive it.";
  if (!active)
    return "Not listed: the product is inactive. It goes back online when it is active again.";
  if (ownershipType === "customer_owned")
    return "Not listed: customer-owned items are never sold online.";
  if (
    publicationStatus !== "public" &&
    !(trackingType === "unique" && publicationStatus === "sold")
  )
    return "Not listed: the product is not public. It goes back online when you publish it again.";
  return null;
}

/** The list's note for a product whose Publish online is on but which is offline. */
export const OFFLINE_WHILE_PUBLISHED =
  "Publish online is on, but the product is not public, active or unarchived; it goes back online when it is.";

/** "just now", "3 min ago", "2 h ago", "4 days ago" (rounded down; never negative). */
export function relativeAgo(at: string | Date, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - new Date(at).getTime());
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

// ---------------------------------------------------------------------------
// List filters (URL parameters)
// ---------------------------------------------------------------------------

export const QUEUE_VIEWS = [
  { key: "attention", label: "Needs attention" },
  { key: "waiting", label: "Waiting" },
  { key: "recent", label: "Recent" },
] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number]["key"];

export const PRODUCT_FILTERS = [
  { key: "all", label: "All" },
  { key: "errors", label: "Errors" },
  { key: "pending", label: "Pending" },
] as const;
export type ProductFilter = (typeof PRODUCT_FILTERS)[number]["key"];

export const EVENT_FILTERS = [
  { key: "all", label: "All" },
  { key: "failed", label: "Failed" },
  { key: "rejected", label: "Rejected" },
  { key: "processed", label: "Processed" },
  { key: "skipped", label: "Skipped" },
] as const;
export type EventFilter = (typeof EVENT_FILTERS)[number]["key"];

function readKey<K extends string>(
  options: readonly { key: K }[],
  value: string | string[] | undefined,
  fallback: K,
): K {
  const v = Array.isArray(value) ? value[0] : value;
  return options.some((o) => o.key === v) ? (v as K) : fallback;
}

export const readQueueView = (v: string | string[] | undefined): QueueView =>
  readKey(QUEUE_VIEWS, v, "attention");
export const readProductFilter = (v: string | string[] | undefined): ProductFilter =>
  readKey(PRODUCT_FILTERS, v, "all");
export const readEventFilter = (v: string | string[] | undefined): EventFilter =>
  readKey(EVENT_FILTERS, v, "all");

export const QUEUE_EMPTY =
  "Nothing needs attention. Orders and product syncs that fail show up here with what to do.";
