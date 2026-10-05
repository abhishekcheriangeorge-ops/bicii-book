/**
 * An appointment's history in plain language (appointment_events, written
 * by triggers; PLAN D36, D37, D39, D40, D42). Pure: the detail page passes
 * the actor's name; the time is shown beside the sentence.
 */
import type { Database } from "@/lib/database.types";

import type { AppointmentStatus } from "./status";

export type AppointmentEventType = Database["public"]["Enums"]["appointment_event_type"];

export type AppointmentEventInput = {
  type: AppointmentEventType;
  fromStatus: AppointmentStatus | null;
  payload: unknown;
  /** The staff member who acted; null for the customer (online) or a change outside the app. */
  actorName: string | null;
};

export type AppointmentEventDescription = {
  title: string;
  /** A reason or note to quote under the title. */
  detail: string | null;
  tone: "neutral" | "info" | "done" | "danger" | "waiting";
};

const field = (payload: unknown, key: string): unknown =>
  typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)[key]
    : undefined;

const by = (actor: string | null) => (actor ? ` by ${actor}` : "");

const CHANGE_NAMES: Record<string, string> = {
  bike_id: "bike",
  customer_note: "customer's note",
  internal_note: "internal note",
};

/** "bike and internal note", from a details_changed payload's keys. */
function changedList(payload: unknown): string {
  const keys =
    typeof payload === "object" && payload !== null
      ? Object.keys(payload).filter((k) => k in CHANGE_NAMES)
      : [];
  const names = keys.map((k) => CHANGE_NAMES[k]);
  if (names.length === 0) return "details";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * One history line: "Marked as arrived by Marcus Tan", "Reinstated as
 * arrived by Asha Admin", "Cancelled online by the customer" (a 'cancelled'
 * event whose payload says via customer and that has no staff actor), "Job
 * J-000123 opened", "Linked to job J-000123". Reasons come back as `detail`.
 */
export function describeAppointmentEvent(
  e: AppointmentEventInput,
  reason: string | null = null,
): AppointmentEventDescription {
  const actor = e.actorName;
  switch (e.type) {
    case "booked":
      return field(e.payload, "source") === "customer"
        ? { title: "Booked online by the customer", detail: null, tone: "info" }
        : { title: `Booked${by(actor)}`, detail: null, tone: "info" };
    case "confirmed":
      return { title: `Confirmed${by(actor)}`, detail: reason, tone: "info" };
    case "arrived":
      return e.fromStatus === "no_show"
        ? { title: `Reinstated as arrived${by(actor)}`, detail: reason, tone: "waiting" }
        : { title: `Marked as arrived${by(actor)}`, detail: reason, tone: "waiting" };
    case "checked_in":
      return { title: `Checked in${by(actor)}`, detail: reason, tone: "done" };
    case "completed":
      return { title: "Completed with its job", detail: null, tone: "done" };
    case "no_show":
      return { title: `Marked as a no-show${by(actor)}`, detail: reason, tone: "danger" };
    case "cancelled":
      return field(e.payload, "via") === "customer" && !actor
        ? { title: "Cancelled online by the customer", detail: reason, tone: "neutral" }
        : { title: `Cancelled${by(actor)}`, detail: reason, tone: "neutral" };
    case "details_changed":
      return {
        title: `${capitalise(changedList(e.payload))} changed${by(actor)}`,
        detail: null,
        tone: "neutral",
      };
    case "work_order_linked": {
      const job = field(e.payload, "job_number");
      const number = typeof job === "string" ? job : "a job";
      return field(e.payload, "created") === true
        ? { title: `Job ${number} opened`, detail: null, tone: "done" }
        : { title: `Linked to job ${number}`, detail: null, tone: "done" };
    }
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
