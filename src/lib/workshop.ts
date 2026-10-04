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
