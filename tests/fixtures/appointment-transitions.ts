/**
 * The appointment status machine as data (SPEC §6 statuses; PLAN D36, D37,
 * D39, D40). The database tests drive every pair through the RPCs and the
 * trigger (tests/db/appointments.test.ts); step 3's TypeScript mirror and
 * step 2's check-in tests read the same table.
 *
 * Expected outcomes: "ok" (the move happens, one event), "replay" (the row
 * comes back unchanged, no event) or the P0001 code that refuses it.
 */

export const APPOINTMENT_STATUSES = [
  "booked",
  "confirmed",
  "arrived",
  "checked_in",
  "completed",
  "cancelled",
  "no_show",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export type TransitionOutcome =
  | "ok"
  | "replay"
  | "appointment_transition_invalid"
  | "appointment_use_check_in"
  | "appointment_use_cancel"
  | "appointment_not_started"
  | "appointment_capacity_exceeded";

/**
 * The trigger's table (every writer, the owner included; D39): the
 * statuses each status may move to. cancelled and completed are final
 * (rebook instead). Every other off-diagonal pair is
 * appointment_transition_invalid; entering cancelled also needs a reason.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  booked: ["confirmed", "arrived", "checked_in", "cancelled", "no_show"],
  confirmed: ["arrived", "checked_in", "cancelled", "no_show"],
  arrived: ["checked_in", "cancelled"],
  checked_in: ["completed"],
  completed: [],
  cancelled: [],
  no_show: ["arrived"],
};

/**
 * public.mark_appointment_status(from -> to), for an appointment that has
 * started (no_show needs it) and, for no_show -> arrived, on its own
 * shop-local date with its place still free. Order of checks: the target
 * (checked_in -> use check-in; cancelled -> use cancel; booked and
 * completed never by hand), then same status (replay), then the table.
 */
export const MARK_STATUS: Readonly<
  Record<AppointmentStatus, Readonly<Record<AppointmentStatus, TransitionOutcome>>>
> = {
  booked: {
    booked: "appointment_transition_invalid",
    confirmed: "ok",
    arrived: "ok",
    checked_in: "appointment_use_check_in",
    completed: "appointment_transition_invalid",
    cancelled: "appointment_use_cancel",
    no_show: "ok",
  },
  confirmed: {
    booked: "appointment_transition_invalid",
    confirmed: "replay",
    arrived: "ok",
    checked_in: "appointment_use_check_in",
    completed: "appointment_transition_invalid",
    cancelled: "appointment_use_cancel",
    no_show: "ok",
  },
  arrived: {
    booked: "appointment_transition_invalid",
    confirmed: "appointment_transition_invalid",
    arrived: "replay",
    checked_in: "appointment_use_check_in",
    completed: "appointment_transition_invalid",
    cancelled: "appointment_use_cancel",
    no_show: "appointment_transition_invalid",
  },
  checked_in: {
    booked: "appointment_transition_invalid",
    confirmed: "appointment_transition_invalid",
    arrived: "appointment_transition_invalid",
    checked_in: "appointment_use_check_in",
    completed: "appointment_transition_invalid",
    cancelled: "appointment_use_cancel",
    no_show: "appointment_transition_invalid",
  },
  completed: {
    booked: "appointment_transition_invalid",
    confirmed: "appointment_transition_invalid",
    arrived: "appointment_transition_invalid",
    checked_in: "appointment_use_check_in",
    completed: "appointment_transition_invalid",
    cancelled: "appointment_use_cancel",
    no_show: "appointment_transition_invalid",
  },
  cancelled: {
    booked: "appointment_transition_invalid",
    confirmed: "appointment_transition_invalid",
    arrived: "appointment_transition_invalid",
    checked_in: "appointment_use_check_in",
    completed: "appointment_transition_invalid",
    cancelled: "appointment_use_cancel",
    no_show: "appointment_transition_invalid",
  },
  no_show: {
    booked: "appointment_transition_invalid",
    confirmed: "appointment_transition_invalid",
    arrived: "ok",
    checked_in: "appointment_use_check_in",
    completed: "appointment_transition_invalid",
    cancelled: "appointment_use_cancel",
    no_show: "replay",
  },
};

/** public.cancel_appointment from each status (staff, with a reason, any time). */
export const CANCEL: Readonly<Record<AppointmentStatus, TransitionOutcome>> = {
  booked: "ok",
  confirmed: "ok",
  arrived: "ok",
  checked_in: "appointment_transition_invalid",
  completed: "appointment_transition_invalid",
  cancelled: "replay",
  no_show: "appointment_transition_invalid",
};

/**
 * The check-in path (step 2's check_in_appointment, D40) from each status,
 * as far as the status machine decides it: booked, confirmed and arrived
 * may be checked in; a no-show is marked arrived first (D39); checked_in is
 * step 2's replay; completed and cancelled are final.
 */
export const CHECK_IN: Readonly<Record<AppointmentStatus, TransitionOutcome>> = {
  booked: "ok",
  confirmed: "ok",
  arrived: "ok",
  checked_in: "replay",
  completed: "appointment_transition_invalid",
  cancelled: "appointment_transition_invalid",
  no_show: "appointment_transition_invalid",
};

/** The special cases of D39 that the tables above assume away. */
export const SPECIAL_CASES: ReadonlyArray<{
  name: string;
  from: AppointmentStatus;
  to: AppointmentStatus;
  expected: TransitionOutcome;
}> = [
  {
    name: "no_show before the appointment has started",
    from: "booked",
    to: "no_show",
    expected: "appointment_not_started",
  },
  {
    name: "no_show -> arrived on another shop-local date than the appointment's",
    from: "no_show",
    to: "arrived",
    expected: "appointment_transition_invalid",
  },
  {
    name: "no_show -> arrived on its own date when its place has been booked since",
    from: "no_show",
    to: "arrived",
    expected: "appointment_capacity_exceeded",
  },
  {
    name: "completed is never set by hand (it follows the work order, D36)",
    from: "checked_in",
    to: "completed",
    expected: "appointment_transition_invalid",
  },
];

/** The trigger's verdict for an owner UPDATE from -> to (same status: no change). */
export function triggerOutcome(from: AppointmentStatus, to: AppointmentStatus): TransitionOutcome {
  if (from === to) return "replay";
  return ALLOWED_TRANSITIONS[from].includes(to) ? "ok" : "appointment_transition_invalid";
}
