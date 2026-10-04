/**
 * The work order status machine and the overdue rule, mirrored from the
 * database (PLAN D15, D16, D20; DATA-MODEL §4). The database is
 * authoritative: private.work_order_transition_rule decides in
 * set_work_order_status, and tests/db/work-orders.test.ts compares this
 * table with it for all 121 (from, to) pairs. The app uses this copy to
 * offer only the moves the database will accept. Pure.
 */
import { Constants, type Database } from "@/lib/database.types";

export type WorkOrderStatus = Database["public"]["Enums"]["work_order_status"];

export const WORK_ORDER_STATUSES: readonly WorkOrderStatus[] =
  Constants.public.Enums.work_order_status;

/** "allowed", "reason_required" (cancel, reopen) or null (not allowed). */
export type TransitionRule = "allowed" | "reason_required" | null;

const BEFORE_WORK: readonly WorkOrderStatus[] = [
  "received",
  "diagnosing",
  "awaiting_customer",
  "awaiting_parts",
  "ready_to_start",
];

const ALLOWED: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>> = {
  received: ["diagnosing", "awaiting_customer", "awaiting_parts", "ready_to_start", "in_progress"],
  diagnosing: ["awaiting_customer", "awaiting_parts", "ready_to_start", "in_progress"],
  awaiting_customer: ["diagnosing", "awaiting_parts", "ready_to_start", "in_progress"],
  awaiting_parts: ["diagnosing", "awaiting_customer", "ready_to_start", "in_progress"],
  ready_to_start: ["diagnosing", "awaiting_customer", "awaiting_parts", "in_progress"],
  in_progress: ["diagnosing", "awaiting_customer", "awaiting_parts", "paused", "completed"],
  paused: ["diagnosing", "awaiting_customer", "awaiting_parts", "in_progress", "completed"],
  completed: ["ready_for_collection", "collected"],
  ready_for_collection: ["collected"],
  collected: [],
  cancelled: [],
};

/**
 * Whether a job may move from `from` to `to`. Same status → null (a replay,
 * not a move). Cancelling (from any open status) and reopening (completed or
 * ready for collection → in progress) need a reason. Nothing returns to
 * received; collected and cancelled are final.
 */
export function transitionRule(from: WorkOrderStatus, to: WorkOrderStatus): TransitionRule {
  if (from === to) return null;
  if (ALLOWED[from].includes(to)) return "allowed";
  if (to === "cancelled" && isOpenStatus(from)) return "reason_required";
  if (to === "in_progress" && (from === "completed" || from === "ready_for_collection")) {
    return "reason_required";
  }
  return null;
}

/** Statuses reachable from `from`, in enum order. */
export function nextStatuses(from: WorkOrderStatus): WorkOrderStatus[] {
  return WORK_ORDER_STATUSES.filter((to) => transitionRule(from, to) !== null);
}

/** Open: before completion, so lines may still be added or voided (D15). */
export function isOpenStatus(status: WorkOrderStatus): boolean {
  return (
    status !== "completed" &&
    status !== "ready_for_collection" &&
    status !== "collected" &&
    status !== "cancelled"
  );
}

/** Closed: collected or cancelled, final. */
export function isClosedStatus(status: WorkOrderStatus): boolean {
  return status === "collected" || status === "cancelled";
}

/** Not yet started: waiting on diagnosis, the customer, parts or a bench. */
export function isBeforeWork(status: WorkOrderStatus): boolean {
  return BEFORE_WORK.includes(status);
}

/** D20: a job still open this many days after check-in is overdue. */
export const OVERDUE_AFTER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * D20: open (before completion) and checked in more than
 * OVERDUE_AFTER_DAYS × 24 hours before `now`.
 */
export function isOverdue(
  job: { status: WorkOrderStatus; checkedInAt: string | Date },
  now: Date = new Date(),
): boolean {
  if (!isOpenStatus(job.status)) return false;
  const checkedIn =
    job.checkedInAt instanceof Date ? job.checkedInAt.getTime() : Date.parse(job.checkedInAt);
  if (Number.isNaN(checkedIn)) return false;
  return now.getTime() - checkedIn > OVERDUE_AFTER_DAYS * DAY_MS;
}

/** What staff call each status on screen (board, pills, timeline). */
export const STATUS_LABELS: Readonly<Record<WorkOrderStatus, string>> = {
  received: "Received",
  diagnosing: "Diagnosing",
  awaiting_customer: "Waiting on customer",
  awaiting_parts: "Waiting on parts",
  ready_to_start: "Ready to start",
  in_progress: "In progress",
  paused: "Paused",
  completed: "Completed",
  ready_for_collection: "Ready for collection",
  collected: "Collected",
  cancelled: "Cancelled",
};

/** The StatusPill tone for a status (DESIGN.md "Status"); the label always goes with it. */
export type StatusTone = "info" | "waiting" | "progress" | "done" | "danger" | "neutral";

const TONES: Readonly<Record<WorkOrderStatus, StatusTone>> = {
  received: "info",
  diagnosing: "info",
  ready_to_start: "info",
  awaiting_customer: "waiting",
  awaiting_parts: "waiting",
  paused: "waiting",
  in_progress: "progress",
  completed: "done",
  ready_for_collection: "done",
  collected: "neutral",
  cancelled: "danger",
};

export function statusTone(status: WorkOrderStatus): StatusTone {
  return TONES[status];
}

/**
 * The workshop board's columns (SPEC §7.2: Received, Waiting, Ready, In
 * Progress, Completed, Ready for Collection), each a set of statuses, plus
 * Closed. Every status is in exactly one group.
 */
export type BoardGroup = {
  id:
    | "received"
    | "waiting"
    | "ready"
    | "in_progress"
    | "completed"
    | "ready_for_collection"
    | "closed";
  label: string;
  statuses: readonly WorkOrderStatus[];
};

export const BOARD_GROUPS: readonly BoardGroup[] = [
  { id: "received", label: "Received", statuses: ["received", "diagnosing"] },
  { id: "waiting", label: "Waiting", statuses: ["awaiting_customer", "awaiting_parts", "paused"] },
  { id: "ready", label: "Ready", statuses: ["ready_to_start"] },
  { id: "in_progress", label: "In progress", statuses: ["in_progress"] },
  { id: "completed", label: "Completed", statuses: ["completed"] },
  {
    id: "ready_for_collection",
    label: "Ready for collection",
    statuses: ["ready_for_collection"],
  },
  { id: "closed", label: "Closed", statuses: ["collected", "cancelled"] },
];

/**
 * A move the job can make now: `forward` along the workflow, `reopen`
 * (completed or ready for collection back to in progress) or `cancel`.
 * Reopen and cancel need a reason (D15, D16).
 */
export type Transition = {
  to: WorkOrderStatus;
  needsReason: boolean;
  kind: "forward" | "reopen" | "cancel";
};

/** Every move transitionRule allows from `status`, in enum order. */
export function allowedTransitions(status: WorkOrderStatus): Transition[] {
  return nextStatuses(status).map((to) => ({
    to,
    needsReason: transitionRule(status, to) === "reason_required",
    kind:
      to === "cancelled"
        ? "cancel"
        : to === "in_progress" && !isOpenStatus(status)
          ? "reopen"
          : "forward",
  }));
}

/** A one-tap button on the job page: the usual next step from a status. */
export type PrimaryAction = { to: WorkOrderStatus; label: string };

const PRIMARY: Readonly<Record<WorkOrderStatus, readonly PrimaryAction[]>> = {
  received: [
    { to: "in_progress", label: "Start work" },
    { to: "diagnosing", label: "Diagnose" },
  ],
  diagnosing: [
    { to: "in_progress", label: "Start work" },
    { to: "awaiting_parts", label: "Waiting on parts" },
  ],
  awaiting_customer: [{ to: "in_progress", label: "Start work" }],
  awaiting_parts: [{ to: "in_progress", label: "Start work" }],
  ready_to_start: [{ to: "in_progress", label: "Start work" }],
  in_progress: [
    { to: "completed", label: "Complete" },
    { to: "paused", label: "Pause" },
  ],
  paused: [
    { to: "in_progress", label: "Resume" },
    { to: "completed", label: "Complete" },
  ],
  completed: [
    { to: "ready_for_collection", label: "Ready for collection" },
    { to: "collected", label: "Collected" },
  ],
  ready_for_collection: [{ to: "collected", label: "Collected" }],
  collected: [],
  cancelled: [],
};

/**
 * The usual next steps from `status`, as large one-tap buttons. Each is an
 * allowed move that needs no reason; anything else is under "Change status".
 */
export function primaryActions(status: WorkOrderStatus): PrimaryAction[] {
  return PRIMARY[status].filter((a) => transitionRule(status, a.to) === "allowed");
}
