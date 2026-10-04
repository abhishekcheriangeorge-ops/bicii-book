import "server-only";

import { bikeTitle } from "@/lib/bikes";
import { BUSINESS_ERRORS, unwrap } from "@/lib/db-errors";
import { customerLabel } from "@/lib/people";
import type { ServerSupabase } from "@/lib/supabase/server";
import {
  allowedTransitions,
  transitionRule,
  type Transition,
  type WorkOrderStatus,
} from "@/lib/workshop";
import {
  describeEvent,
  type EventDescription,
  type WorkOrderEventType,
} from "@/lib/workshop-timeline";

import { DomainError } from "./errors";
import { getTotals, listLines, rethrowOnField, type Line, type Totals } from "./lines";
import type { ListPage } from "./list";

/**
 * Workshop jobs (SPEC §7, §21; DATA-MODEL §4; PLAN D15–D22). Jobs are
 * written only through RPCs, which check authorization, the status machine
 * and the ownership rule again and write the timeline themselves; staff
 * read the tables under RLS. Cost figures reach a DTO only for a view_costs
 * holder (src/lib/domain/lines.ts).
 */

export type AssignmentRole = "lead" | "additional";

/** One row of the open-jobs list (until the board in step 4). */
export type OpenJobItem = {
  id: string;
  jobNumber: string;
  status: WorkOrderStatus;
  checkedInAt: string;
  customerLabel: string;
  bikeTitle: string;
  bikeShortId: string;
  leadName: string | null;
};

export type TimelineEntry = EventDescription & {
  id: number;
  type: WorkOrderEventType;
  at: string;
  /** Null when the change was made outside the app (seed, SQL editor). */
  actorName: string | null;
};

export type WorkOrderDetail = {
  id: string;
  jobNumber: string;
  status: WorkOrderStatus;
  currency: string;
  customer: {
    id: string;
    label: string;
    phone: string | null;
    email: string | null;
    archived: boolean;
  };
  bike: { id: string; shortId: string; title: string; colour: string | null; archived: boolean };
  requestedWork: string;
  intakeNotes: string | null;
  internalNotes: string | null;
  completionNotes: string | null;
  approval: { flagged: boolean; note: string | null };
  stamps: {
    checkedInAt: string;
    statusChangedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    readyForCollectionAt: string | null;
    collectedAt: string | null;
    cancelledAt: string | null;
    cancellationReason: string | null;
  };
  /** Active assignments: the lead first, then additional staff by when they joined. */
  assignments: { staffId: string; name: string; role: AssignmentRole; assignedAt: string }[];
  lines: Line[];
  totals: Totals;
  /** Newest first. */
  timeline: TimelineEntry[];
  allowedTransitions: Transition[];
};

const NOT_FOUND = "That job no longer exists. Refresh and try again.";

type NameColumns = {
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
};

const labelOf = (c: NameColumns) =>
  customerLabel({
    firstName: c.first_name,
    lastName: c.last_name,
    displayName: c.display_name,
    email: c.email,
    phone: c.phone,
  });

/** Staff id -> display name, for everyone who ever worked here (staff_directory). */
async function staffNames(supabase: ServerSupabase): Promise<Map<string, string>> {
  const rows = unwrap(await supabase.rpc("staff_directory")) ?? [];
  return new Map(rows.map((s) => [s.id, s.display_name]));
}

const CLOSED = "(collected,cancelled)";

/**
 * Jobs that are not collected or cancelled, newest check-in first. A
 * temporary list for /jobs until the board (Phase 3 step 4).
 */
export async function listOpenWorkOrders(
  supabase: ServerSupabase,
  { limit = 50 }: { limit?: number } = {},
): Promise<ListPage<OpenJobItem>> {
  const [result, names] = await Promise.all([
    supabase
      .from("work_orders")
      .select(
        "id, job_number, status, checked_in_at, lead_mechanic_id, customer:customers(first_name, last_name, display_name, email, phone), bike:bikes(short_id, brand, model, variant)",
      )
      .not("status", "in", CLOSED)
      .order("checked_in_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
    staffNames(supabase),
  ]);
  const rows = unwrap(result) ?? [];
  return {
    items: rows.slice(0, limit).map((r) => ({
      id: r.id,
      jobNumber: r.job_number,
      status: r.status,
      checkedInAt: r.checked_in_at,
      customerLabel: r.customer ? labelOf(r.customer) : "Customer",
      bikeTitle: r.bike ? bikeTitle(r.bike) : "Bike",
      bikeShortId: r.bike?.short_id ?? "",
      leadName: r.lead_mechanic_id ? (names.get(r.lead_mechanic_id) ?? "A former colleague") : null,
    })),
    more: rows.length > limit,
  };
}

/**
 * Everything the job page shows except photos (listPhotos with target
 * work_order), or null when there is no such job. With `viewCosts` false
 * the lines and totals carry no cost, yield or Cult Commons figure.
 */
export async function getWorkOrder(
  supabase: ServerSupabase,
  id: string,
  { viewCosts }: { viewCosts: boolean },
): Promise<WorkOrderDetail | null> {
  const [jobResult, assignmentsResult, timelineResult, names] = await Promise.all([
    supabase
      .from("work_orders")
      .select(
        "id, job_number, status, currency, requested_work, intake_notes, internal_notes, completion_notes, approval_flag, approval_note, checked_in_at, status_changed_at, started_at, completed_at, ready_for_collection_at, collected_at, cancelled_at, cancellation_reason, customer:customers(id, first_name, last_name, display_name, email, phone, archived_at), bike:bikes(id, short_id, brand, model, variant, colour, archived_at)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("work_order_assignments")
      .select("staff_id, role, assigned_at")
      .eq("work_order_id", id)
      .is("unassigned_at", null)
      .order("assigned_at", { ascending: true }),
    supabase.rpc("work_order_timeline", { work_order_id: id, max_rows: 200 }),
    staffNames(supabase),
  ]);
  const row = unwrap(jobResult);
  if (!row || !row.customer || !row.bike) return null;
  const [lines, totals] = await Promise.all([
    listLines(supabase, id, { viewCosts, names }),
    getTotals(supabase, id, { viewCosts, currency: row.currency }),
  ]);
  const assignments = (unwrap(assignmentsResult) ?? [])
    .map((a) => ({
      staffId: a.staff_id,
      name: names.get(a.staff_id) ?? "A former colleague",
      role: a.role,
      assignedAt: a.assigned_at,
    }))
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "lead" ? -1 : 1));
  const timeline = (unwrap(timelineResult) ?? []).map((e) => ({
    id: e.id,
    type: e.event_type,
    at: e.created_at,
    actorName: e.actor_staff_id ? (e.actor_display_name ?? "A former colleague") : null,
    ...describeEvent(
      { type: e.event_type, payload: e.payload, subjectName: e.subject_display_name },
      { currency: row.currency },
    ),
  }));

  return {
    id: row.id,
    jobNumber: row.job_number,
    status: row.status,
    currency: row.currency,
    customer: {
      id: row.customer.id,
      label: labelOf(row.customer),
      phone: row.customer.phone,
      email: row.customer.email,
      archived: row.customer.archived_at !== null,
    },
    bike: {
      id: row.bike.id,
      shortId: row.bike.short_id,
      title: bikeTitle(row.bike),
      colour: row.bike.colour,
      archived: row.bike.archived_at !== null,
    },
    requestedWork: row.requested_work,
    intakeNotes: row.intake_notes,
    internalNotes: row.internal_notes,
    completionNotes: row.completion_notes,
    approval: { flagged: row.approval_flag, note: row.approval_note },
    stamps: {
      checkedInAt: row.checked_in_at,
      statusChangedAt: row.status_changed_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      readyForCollectionAt: row.ready_for_collection_at,
      collectedAt: row.collected_at,
      cancelledAt: row.cancelled_at,
      cancellationReason: row.cancellation_reason,
    },
    assignments,
    lines,
    totals,
    timeline,
    allowedTransitions: allowedTransitions(row.status),
  };
}

export type CreateWorkOrderInput = {
  /** The intake's idempotency key. */
  id: string;
  customerId: string;
  bikeId: string;
  requestedWork: string;
  intakeNotes: string | null;
  leadId: string | null;
  additionalIds: string[];
  /** Known services; quantities as fixed-point strings. */
  services: { lineId: string; serviceId: string; quantity: string }[];
};

const CREATE_FIELDS = {
  requested_work_required: "requestedWork",
  work_order_customer_archived: "customerId",
  work_order_bike_archived: "bikeId",
  bike_owner_mismatch: "bikeId",
  staff_inactive: "leadId",
  service_unavailable: "services",
};

/**
 * Checks a bike in as a new job (RPC create_work_order: J- number, lead
 * and additional staff, known services, the timeline's first events). The
 * id is the idempotency key: a replay (a double tap, a retry after a lost
 * response) returns the job it already made.
 */
export async function createWorkOrder(
  supabase: ServerSupabase,
  input: CreateWorkOrderInput,
): Promise<{ id: string; jobNumber: string }> {
  try {
    const row = unwrap(
      await supabase.rpc("create_work_order", {
        work_order_id: input.id,
        customer_id: input.customerId,
        bike_id: input.bikeId,
        requested_work: input.requestedWork,
        intake_notes: input.intakeNotes ?? undefined,
        lead_mechanic_id: input.leadId ?? undefined,
        additional_staff_ids: input.additionalIds,
        // A JSON number: the RPC checks the type. Quantities have at most
        // two decimals, which a number carries exactly as decimal text.
        services: input.services.map((s) => ({
          line_id: s.lineId,
          service_id: s.serviceId,
          quantity: Number(s.quantity),
        })),
      }),
    );
    if (!row) throw new DomainError(NOT_FOUND);
    return { id: row.id, jobNumber: row.job_number };
  } catch (err) {
    rethrowOnField(err, CREATE_FIELDS);
  }
}

/**
 * Moves a job along the status machine (RPC set_work_order_status, D15,
 * D16). Checks the move first for a precise message; the RPC checks again
 * under a lock. The same status is a replay and changes nothing.
 */
export async function setWorkOrderStatus(
  supabase: ServerSupabase,
  input: { workOrderId: string; status: WorkOrderStatus; note: string | null },
): Promise<{ status: WorkOrderStatus }> {
  const current = unwrap(
    await supabase.from("work_orders").select("status").eq("id", input.workOrderId).maybeSingle(),
  );
  if (!current) throw new DomainError(NOT_FOUND);
  if (current.status === input.status) return { status: current.status };
  const rule = transitionRule(current.status, input.status);
  if (rule === null) throw new DomainError(BUSINESS_ERRORS.work_order_transition_invalid);
  const note = input.note?.trim() || null;
  if (rule === "reason_required" && !note) {
    const message =
      input.status === "cancelled"
        ? "Say why the job is being cancelled."
        : "Say why the job is being reopened.";
    throw new DomainError(message, { note: [message] });
  }
  try {
    const row = unwrap(
      await supabase.rpc("set_work_order_status", {
        work_order_id: input.workOrderId,
        status: input.status,
        note: note ?? undefined,
      }),
    );
    if (!row) throw new DomainError(NOT_FOUND);
    return { status: row.status };
  } catch (err) {
    rethrowOnField(err, { reason_required: "note", reason_too_long: "note" });
  }
}

/** A bike as intake shows it. */
export type IntakeBikeRef = { id: string; shortId: string; title: string };

export type IntakeBike = IntakeBikeRef & {
  colour: string | null;
  /** A job for this bike that is not collected or cancelled yet. */
  openJob: { id: string; jobNumber: string } | null;
};

/** One result of intake's first step: a customer, or a bike (with its owner). */
export type IntakeOption = {
  id: string;
  kind: "customer" | "bike";
  label: string;
  description?: string;
  meta?: string;
  /** The customer this choice selects; null for a bike nobody owns (a shop bike). */
  customer: { id: string; label: string } | null;
  bike: IntakeBikeRef | null;
};

/**
 * Customers and bikes matching `q` (staff_search; archived ones left out).
 * Choosing a bike selects its owner too, so each bike hit carries it.
 */
export async function searchIntakeOptions(
  supabase: ServerSupabase,
  q: string,
): Promise<IntakeOption[]> {
  const hits =
    unwrap(
      await supabase.rpc("staff_search", { q, kinds: ["customer", "bike"], max_results: 10 }),
    ) ?? [];
  const bikeIds = hits.filter((h) => h.kind === "bike").map((h) => h.id);
  const bikes = new Map<
    string,
    {
      short_id: string;
      brand: string;
      model: string;
      variant: string | null;
      owner: { id: string; label: string } | null;
    }
  >();
  if (bikeIds.length > 0) {
    const rows =
      unwrap(
        await supabase
          .from("bikes")
          .select(
            "id, short_id, brand, model, variant, customer:customers(id, first_name, last_name, display_name, email, phone, archived_at)",
          )
          .in("id", bikeIds),
      ) ?? [];
    for (const r of rows) {
      bikes.set(r.id, {
        ...r,
        owner:
          r.customer && r.customer.archived_at === null
            ? { id: r.customer.id, label: labelOf(r.customer) }
            : null,
      });
    }
  }
  return hits.flatMap((h): IntakeOption[] => {
    if (h.kind === "customer") {
      return [
        {
          id: h.id,
          kind: "customer",
          label: h.title,
          description: h.subtitle ?? undefined,
          meta: "Customer",
          customer: { id: h.id, label: h.title },
          bike: null,
        },
      ];
    }
    const bike = bikes.get(h.id);
    if (h.kind !== "bike" || !bike) return [];
    return [
      {
        id: h.id,
        kind: "bike",
        label: h.title,
        description: bike.owner ? `Owned by ${bike.owner.label}` : "Shop bike · no customer",
        meta: bike.short_id,
        customer: bike.owner,
        bike: { id: h.id, shortId: bike.short_id, title: bikeTitle(bike) },
      },
    ];
  });
}

/** Open jobs (not collected or cancelled) for these bikes, by bike id. */
async function openJobsFor(
  supabase: ServerSupabase,
  bikeIds: string[],
): Promise<Map<string, { id: string; jobNumber: string }>> {
  const jobs = new Map<string, { id: string; jobNumber: string }>();
  if (bikeIds.length === 0) return jobs;
  const rows =
    unwrap(
      await supabase
        .from("work_orders")
        .select("id, job_number, bike_id, checked_in_at")
        .in("bike_id", bikeIds)
        .not("status", "in", CLOSED)
        .order("checked_in_at", { ascending: false }),
    ) ?? [];
  for (const r of rows) {
    if (!jobs.has(r.bike_id)) jobs.set(r.bike_id, { id: r.id, jobNumber: r.job_number });
  }
  return jobs;
}

/**
 * The customer's active bikes for intake's second step, oldest first, each
 * with the job it is already in the shop for, if any.
 */
export async function customerBikesForIntake(
  supabase: ServerSupabase,
  customerId: string,
): Promise<IntakeBike[]> {
  const rows =
    unwrap(
      await supabase
        .from("bikes")
        .select("id, short_id, brand, model, variant, colour")
        .eq("customer_id", customerId)
        .is("archived_at", null)
        .order("created_at", { ascending: true }),
    ) ?? [];
  const jobs = await openJobsFor(
    supabase,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    shortId: r.short_id,
    title: bikeTitle(r),
    colour: r.colour,
    openJob: jobs.get(r.id) ?? null,
  }));
}

/**
 * Intake presets from the URL (?customer=, ?bike=), resolved to what the
 * wizard shows. A bike's owner wins over a customer that does not own it;
 * archived records are ignored.
 */
export async function intakePreset(
  supabase: ServerSupabase,
  { customerId, bikeId }: { customerId: string | null; bikeId: string | null },
): Promise<{ customer: { id: string; label: string } | null; bike: IntakeBike | null }> {
  let customer: { id: string; label: string } | null = null;
  let bike: IntakeBike | null = null;
  if (bikeId) {
    const row = unwrap(
      await supabase
        .from("bikes")
        .select(
          "id, short_id, brand, model, variant, colour, archived_at, customer:customers(id, first_name, last_name, display_name, email, phone, archived_at)",
        )
        .eq("id", bikeId)
        .maybeSingle(),
    );
    if (row && row.archived_at === null) {
      const jobs = await openJobsFor(supabase, [row.id]);
      bike = {
        id: row.id,
        shortId: row.short_id,
        title: bikeTitle(row),
        colour: row.colour,
        openJob: jobs.get(row.id) ?? null,
      };
      if (row.customer && row.customer.archived_at === null) {
        customer = { id: row.customer.id, label: labelOf(row.customer) };
      }
    }
  }
  if (!customer && customerId) {
    const row = unwrap(
      await supabase
        .from("customers")
        .select("id, first_name, last_name, display_name, email, phone, archived_at")
        .eq("id", customerId)
        .maybeSingle(),
    );
    if (row && row.archived_at === null) customer = { id: row.id, label: labelOf(row) };
  }
  return { customer, bike };
}

/** Active staff, by name: who can be assigned to a job (D22). */
export async function listActiveStaff(
  supabase: ServerSupabase,
): Promise<{ id: string; name: string }[]> {
  const rows = unwrap(await supabase.rpc("staff_directory")) ?? [];
  return rows.filter((r) => r.active).map((r) => ({ id: r.id, name: r.display_name }));
}
