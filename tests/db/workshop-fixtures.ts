/**
 * Helpers for the Phase 3 workshop database tests. Tests of the rules
 * create their own customers, bikes, services and jobs inside their
 * transaction; the seeded workshop data (WORK_ORDER, SERVICE, ... in
 * tests/fixtures/ids.ts) is for the seed, customer-access and search tests.
 * A service a test creates needs a name the seed does not use (active
 * service names are unique), and a count must be scoped to the test's own
 * job or customer.
 *
 *   * The `make*` helpers insert as the connection's owner (superuser): call
 *     them before actAs(), or after ownerMode().
 *   * The RPC helpers call the public RPCs as whoever `tx` currently is.
 *   * failsWith() runs a call that must fail inside a savepoint, so the
 *     surrounding transaction (and identity) carries on.
 *
 * Inserting a bike or a job consumes a short-ID sequence, so tests that use
 * these skip in existing-database mode (isolatedDatabase()).
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { expect } from "vitest";

import type { WorkOrderStatus } from "@/lib/workshop";

/** Back to the connection's own (superuser) role inside an open transaction. */
export async function ownerMode(tx: pg.Client): Promise<void> {
  await tx.query("reset role");
}

let savepoints = 0;

/** Runs `fn` in a savepoint and expects it to fail with `expected` (code, message...). */
export async function failsWith(
  tx: pg.Client,
  fn: () => Promise<unknown>,
  expected: Record<string, unknown>,
): Promise<void> {
  const name = `expect_error_${++savepoints}`;
  await tx.query(`savepoint ${name}`);
  let failure: unknown = null;
  try {
    await fn();
  } catch (err) {
    failure = err;
  }
  if (failure) {
    await tx.query(`rollback to savepoint ${name}`);
    expect(failure).toMatchObject(expected);
    return;
  }
  await tx.query(`release savepoint ${name}`);
  throw new Error(`expected a failure matching ${JSON.stringify(expected)}, but it succeeded`);
}

/** Runs `fn` in a savepoint that is always rolled back (to try something and undo it). */
export async function tryAndUndo<T>(tx: pg.Client, fn: () => Promise<T>): Promise<T> {
  const name = `undo_${++savepoints}`;
  await tx.query(`savepoint ${name}`);
  try {
    return await fn();
  } finally {
    await tx.query(`rollback to savepoint ${name}`);
  }
}

/** A new customer (owner insert). */
export async function makeCustomer(
  tx: pg.Client,
  name = `Test ${randomUUID().slice(0, 8)}`,
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    "insert into public.customers (display_name) values ($1) returning id",
    [name],
  );
  return rows[0].id;
}

/** A new bike owned by `customerId` (null: a shop bike) (owner insert). */
export async function makeBike(tx: pg.Client, customerId: string | null): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    "insert into public.bikes (customer_id, brand, model) values ($1, 'Test', 'Bike') returning id",
    [customerId],
  );
  return rows[0].id;
}

/** A customer with a bike they own (owner inserts). */
export async function makeCustomerWithBike(
  tx: pg.Client,
): Promise<{ customerId: string; bikeId: string }> {
  const customerId = await makeCustomer(tx);
  return { customerId, bikeId: await makeBike(tx, customerId) };
}

/** A service (owner insert). Prices as strings, e.g. "80.00". */
export async function makeService(
  tx: pg.Client,
  {
    name = `Service ${randomUUID().slice(0, 8)}`,
    price = "80.00",
    cost = "0.00",
    active = true,
  }: { name?: string; price?: string; cost?: string; active?: boolean } = {},
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.services (name, default_sale_price, default_direct_cost, active)
     values ($1, $2, $3, $4) returning id`,
    [name, price, cost, active],
  );
  return rows[0].id;
}

export type WorkOrderRow = {
  id: string;
  job_number: string;
  customer_id: string;
  bike_id: string;
  appointment_id: string | null;
  lead_mechanic_id: string | null;
  status: WorkOrderStatus;
  requested_work: string;
  intake_notes: string | null;
  internal_notes: string | null;
  completion_notes: string | null;
  approval_flag: boolean;
  approval_note: string | null;
  checked_in_at: Date;
  status_changed_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  ready_for_collection_at: Date | null;
  collected_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  currency: string;
  created_by: string | null;
};

export type CreateWorkOrderArgs = {
  id?: string;
  customerId: string;
  bikeId: string;
  requestedWork?: string | null;
  intakeNotes?: string | null;
  leadId?: string | null;
  additional?: string[];
  services?: Array<{ line_id: string; service_id: string; quantity?: number | string }>;
};

/** public.create_work_order as whoever `tx` is; returns the row. */
export async function createWorkOrder(
  tx: pg.Client,
  a: CreateWorkOrderArgs,
): Promise<WorkOrderRow> {
  const { rows } = await tx.query<WorkOrderRow>(
    `select (w).* from (
       select public.create_work_order($1, $2, $3, $4, $5, $6, $7::uuid[], $8::jsonb) w
     ) s`,
    [
      a.id ?? randomUUID(),
      a.customerId,
      a.bikeId,
      a.requestedWork === undefined ? "Full service" : a.requestedWork,
      a.intakeNotes ?? null,
      a.leadId ?? null,
      a.additional ?? [],
      JSON.stringify(a.services ?? []),
    ],
  );
  return rows[0];
}

/** public.set_work_order_status as whoever `tx` is; returns the row. */
export async function setStatus(
  tx: pg.Client,
  workOrderId: string,
  status: WorkOrderStatus,
  note: string | null = null,
): Promise<WorkOrderRow> {
  const { rows } = await tx.query<WorkOrderRow>(
    "select (w).* from (select public.set_work_order_status($1, $2, $3) w) s",
    [workOrderId, status, note],
  );
  return rows[0];
}

/** An allowed path from received to each status (cancel and reopen need a reason). */
export const PATH_FROM_RECEIVED: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>> = {
  received: [],
  diagnosing: ["diagnosing"],
  awaiting_customer: ["awaiting_customer"],
  awaiting_parts: ["awaiting_parts"],
  ready_to_start: ["ready_to_start"],
  in_progress: ["in_progress"],
  paused: ["in_progress", "paused"],
  completed: ["in_progress", "completed"],
  ready_for_collection: ["in_progress", "completed", "ready_for_collection"],
  collected: ["in_progress", "completed", "collected"],
  cancelled: ["cancelled"],
};

/** Drives a received job to `status` through allowed moves. */
export async function walkTo(
  tx: pg.Client,
  workOrderId: string,
  status: WorkOrderStatus,
): Promise<WorkOrderRow> {
  let row: WorkOrderRow | null = null;
  for (const step of PATH_FROM_RECEIVED[status]) {
    row = await setStatus(tx, workOrderId, step, step === "cancelled" ? "Customer withdrew" : null);
  }
  return row ?? (await workOrder(tx, workOrderId));
}

/** The job as the owner sees it (reads through RLS as whoever `tx` is). */
export async function workOrder(tx: pg.Client, workOrderId: string): Promise<WorkOrderRow> {
  const { rows } = await tx.query<WorkOrderRow>("select * from public.work_orders where id = $1", [
    workOrderId,
  ]);
  return rows[0];
}

export type EventRow = {
  id: string;
  event_type: string;
  actor_staff_id: string | null;
  actor_user_id: string | null;
  payload: Record<string, unknown>;
  correlation_id: string | null;
  created_at: Date;
};

/** The job's events, oldest first. */
export async function events(tx: pg.Client, workOrderId: string): Promise<EventRow[]> {
  const { rows } = await tx.query<EventRow>(
    `select id::text, event_type::text, actor_staff_id, actor_user_id, payload, correlation_id, created_at
       from public.work_order_events where work_order_id = $1 order by created_at, id`,
    [workOrderId],
  );
  return rows;
}

export const eventTypes = async (tx: pg.Client, workOrderId: string) =>
  (await events(tx, workOrderId)).map((e) => e.event_type);

export async function addServiceLine(
  tx: pg.Client,
  a: {
    lineId?: string;
    workOrderId: string;
    serviceId: string;
    quantity?: string | number;
    price?: string | null;
    cost?: string | null;
    description?: string | null;
  },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    "select public.add_service_line($1, $2, $3, $4, $5, $6, $7) as id",
    [
      a.lineId ?? randomUUID(),
      a.workOrderId,
      a.serviceId,
      a.quantity ?? 1,
      a.price ?? null,
      a.cost ?? null,
      a.description ?? null,
    ],
  );
  return rows[0].id;
}

export async function addManualLine(
  tx: pg.Client,
  a: {
    lineId?: string;
    workOrderId: string;
    description?: string;
    price: string;
    quantity?: string | number;
    cost?: string | null;
  },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    "select public.add_manual_line($1, $2, $3, $4, $5, $6) as id",
    [
      a.lineId ?? randomUUID(),
      a.workOrderId,
      a.description ?? "Labour",
      a.price,
      a.quantity ?? 1,
      a.cost ?? null,
    ],
  );
  return rows[0].id;
}

export async function voidLine(tx: pg.Client, lineId: string, reason: string | null) {
  return (await tx.query<{ id: string }>("select public.void_line($1, $2) as id", [lineId, reason]))
    .rows[0].id;
}
