/**
 * The Phase 3 seed (DATA-MODEL §18 "Phase 3 part"; TESTING.md "Seed data"):
 *
 *   * nine jobs J-000001 .. J-000009 with the documented statuses, stamps,
 *     leads and totals (the E2E tests assert J-000002's money as seeded);
 *   * exactly one job is overdue under D20;
 *   * every seeded timeline reads true: events in id order have strictly
 *     increasing times; each job has exactly the events it should, nothing
 *     stamped at seed time (except J-000007, checked in then on purpose),
 *     every trigger-written actor equals the row's own actor column, every
 *     status change is by the job's lead, no line changes after completion,
 *     and J-000007 is checked in after the Bianchi changed hands.
 *
 * Reads only: runs against an existing seeded database too.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { isOverdue } from "@/lib/workshop";
import type { WorkOrderStatus } from "@/lib/workshop";

import {
  BIKE,
  CUSTOMER,
  JOB_NUMBER,
  LINE,
  STAFF,
  WORK_ORDER,
  type SeedWorkOrder,
} from "../fixtures/ids";
import { asStaff, connect } from "./harness";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const SEEDED_IDS = Object.values(WORK_ORDER);

type Expected = {
  status: WorkOrderStatus;
  customer: string;
  bike: string;
  lead: string | null;
  /** Hours after check-in of each stamp (null: not stamped). */
  started: number | null;
  completed: number | null;
  ready: number | null;
  collected: number | null;
  /** Exact event counts by type. */
  events: Record<string, number>;
};

const H = 1;
const D = 24;

const EXPECTED: Record<SeedWorkOrder, Expected> = {
  tanTarmacCollected: {
    status: "collected",
    customer: CUSTOMER.tan,
    bike: BIKE.tanTarmac,
    lead: STAFF.mechanic1,
    started: 1 * D,
    completed: 2 * D,
    ready: 2 * D + 1 * H,
    collected: 3 * D,
    events: {
      checked_in: 1,
      assignment_changed: 1,
      line_added: 2,
      status_changed: 1,
      completed: 1,
      ready_for_collection: 1,
      collected: 1,
    },
  },
  priyaDomaneReady: {
    status: "ready_for_collection",
    customer: CUSTOMER.priya,
    bike: BIKE.priyaDomane,
    lead: STAFF.mechanic2,
    started: 1 * D,
    completed: 4 * D,
    ready: 4 * D + 0.5 * H,
    collected: null,
    events: {
      checked_in: 1,
      assignment_changed: 1,
      line_added: 3,
      approval_flagged: 1,
      status_changed: 1,
      completed: 1,
      ready_for_collection: 1,
    },
  },
  hafizBromptonCompleted: {
    status: "completed",
    customer: CUSTOMER.hafiz,
    bike: BIKE.hafizBrompton,
    lead: STAFF.mechanic1,
    started: 1 * D,
    completed: 2 * D - 2 * H,
    ready: null,
    collected: null,
    events: {
      checked_in: 1,
      assignment_changed: 2,
      line_added: 1,
      status_changed: 1,
      completed: 1,
    },
  },
  chloeGiantInProgress: {
    status: "in_progress",
    customer: CUSTOMER.chloe,
    bike: BIKE.chloeGiant,
    lead: STAFF.mechanic1,
    started: 2 * D,
    completed: null,
    ready: null,
    collected: null,
    events: { checked_in: 1, assignment_changed: 1, line_added: 1, status_changed: 2 },
  },
  chloeSurlyAwaitingParts: {
    status: "awaiting_parts",
    customer: CUSTOMER.chloe,
    bike: BIKE.chloeSurly,
    lead: STAFF.mechanic2,
    started: null,
    completed: null,
    ready: null,
    collected: null,
    events: {
      checked_in: 1,
      assignment_changed: 1,
      line_added: 1,
      note_added: 1,
      status_changed: 1,
    },
  },
  danielCannondaleAwaitingCustomer: {
    status: "awaiting_customer",
    customer: CUSTOMER.daniel,
    bike: BIKE.danielCannondale,
    lead: STAFF.mechanic1,
    started: null,
    completed: null,
    ready: null,
    collected: null,
    events: { checked_in: 1, assignment_changed: 1, diagnosis_added: 1, status_changed: 1 },
  },
  nurulBianchiReceived: {
    status: "received",
    customer: CUSTOMER.nurul,
    bike: BIKE.nurulBianchi,
    lead: null,
    started: null,
    completed: null,
    ready: null,
    collected: null,
    events: { checked_in: 1 },
  },
  tanBromptonCancelled: {
    status: "cancelled",
    customer: CUSTOMER.tan,
    bike: BIKE.tanBrompton,
    lead: STAFF.mechanic2,
    started: null,
    completed: null,
    ready: null,
    collected: null,
    events: { checked_in: 1, assignment_changed: 1, cancelled: 1 },
  },
  priyaTernDiagnosing: {
    status: "diagnosing",
    customer: CUSTOMER.priya,
    bike: BIKE.priyaTern,
    lead: STAFF.mechanic2,
    started: null,
    completed: null,
    ready: null,
    collected: null,
    events: {
      checked_in: 1,
      assignment_changed: 1,
      line_added: 2,
      status_changed: 1,
      line_voided: 1,
    },
  },
};

type JobRow = {
  id: string;
  job_number: string;
  status: WorkOrderStatus;
  customer_id: string;
  bike_id: string;
  lead_mechanic_id: string | null;
  checked_in_at: Date;
  completed_at: Date | null;
  cancellation_reason: string | null;
  started_h: number | null;
  completed_h: number | null;
  ready_h: number | null;
  collected_h: number | null;
};

const jobs = async (): Promise<Map<string, JobRow>> => {
  const { rows } = await conn.query<JobRow>(
    `select w.id, w.job_number, w.status::text, w.customer_id, w.bike_id, w.lead_mechanic_id,
            w.checked_in_at, w.completed_at, w.cancellation_reason,
            (extract(epoch from w.started_at - w.checked_in_at) / 3600)::float8 as started_h,
            (extract(epoch from w.completed_at - w.checked_in_at) / 3600)::float8 as completed_h,
            (extract(epoch from w.ready_for_collection_at - w.checked_in_at) / 3600)::float8 as ready_h,
            (extract(epoch from w.collected_at - w.checked_in_at) / 3600)::float8 as collected_h
       from public.work_orders w
      where w.id = any ($1::uuid[])`,
    [SEEDED_IDS],
  );
  return new Map(rows.map((r) => [r.id, r]));
};

type EventRow = {
  id: number;
  work_order_id: string;
  event_type: string;
  actor_staff_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
};

const eventsOf = async (workOrderId: string): Promise<EventRow[]> =>
  (
    await conn.query<EventRow>(
      `select e.id::int, e.work_order_id, e.event_type::text, e.actor_staff_id, e.payload, e.created_at
         from public.work_order_events e
        where e.work_order_id = $1
        order by e.id`,
      [workOrderId],
    )
  ).rows;

const keys = Object.keys(WORK_ORDER) as SeedWorkOrder[];

describe("the seeded jobs", () => {
  it("are J-000001 .. J-000009 with the documented customer, bike, status, lead and stamps", async () => {
    const byId = await jobs();
    expect(byId.size).toBe(9);
    for (const key of keys) {
      const job = byId.get(WORK_ORDER[key])!;
      const want = EXPECTED[key];
      expect({ key, number: job.job_number }).toEqual({ key, number: JOB_NUMBER[key] });
      expect(job).toMatchObject({
        status: want.status,
        customer_id: want.customer,
        bike_id: want.bike,
        lead_mechanic_id: want.lead,
        started_h: want.started,
        completed_h: want.completed,
        ready_h: want.ready,
        collected_h: want.collected,
      });
    }
    expect(byId.get(WORK_ORDER.tanBromptonCancelled)?.cancellation_reason).toBe(
      "Customer will bring it back next month.",
    );
  });

  it("each lead_mechanic_id is the job's active lead assignment", async () => {
    const { rows } = await conn.query(
      `select w.id, w.lead_mechanic_id, a.staff_id as active_lead
         from public.work_orders w
         left join public.work_order_assignments a
           on a.work_order_id = w.id and a.role = 'lead' and a.unassigned_at is null
        where w.id = any ($1::uuid[])`,
      [SEEDED_IDS],
    );
    for (const row of rows) expect(row.lead_mechanic_id).toBe(row.active_lead);
  });

  it("J-000001 and J-000002 total exactly as documented (work_order_totals_staff)", async () => {
    const rows = await asStaff(
      conn,
      STAFF.mechanic1,
      async (tx) =>
        (
          await tx.query(
            `select work_order_id, line_count, sale_total, cost_total, yield_total, cult_commons_share,
                  bicii_yield_after_cc
             from public.work_order_totals_staff
            where work_order_id = any ($1::uuid[])
            order by work_order_id`,
            [[WORK_ORDER.tanTarmacCollected, WORK_ORDER.priyaDomaneReady]],
          )
        ).rows,
    );
    expect(rows).toEqual([
      {
        work_order_id: WORK_ORDER.tanTarmacCollected,
        line_count: 2,
        sale_total: "290.00",
        cost_total: "16.00",
        yield_total: "274.00",
        cult_commons_share: "82.20",
        bicii_yield_after_cc: "191.80",
      },
      {
        work_order_id: WORK_ORDER.priyaDomaneReady,
        line_count: 3,
        sale_total: "300.00",
        cost_total: "124.00",
        yield_total: "176.00",
        cult_commons_share: "52.80",
        bicii_yield_after_cc: "123.20",
      },
    ]);
  });

  it("J-000009's bottom bracket line is voided by Nur and left out of its total", async () => {
    const { rows } = await conn.query(
      "select voided_by, void_reason from public.work_order_line_items where id = $1",
      [LINE.priyaTernBottomBracket],
    );
    expect(rows).toEqual([
      {
        voided_by: STAFF.mechanic2,
        void_reason: "Wrong part quoted; the frame takes a press-fit bracket.",
      },
    ]);
    const total = await conn.query(
      "select line_count, sale_total from public.work_order_totals where work_order_id = $1",
      [WORK_ORDER.priyaTernDiagnosing],
    );
    expect(total.rows).toEqual([{ line_count: 1, sale_total: "80.00" }]);
  });

  it("exactly one job is overdue under D20: J-000006", async () => {
    const byId = await jobs();
    const overdue = [...byId.values()]
      .filter((j) => isOverdue({ status: j.status, checkedInAt: j.checked_in_at }))
      .map((j) => j.job_number);
    expect(overdue).toEqual([JOB_NUMBER.danielCannondaleAwaitingCustomer]);
  });
});

describe("the seeded timelines read true", () => {
  it("events in id order have strictly increasing times, for every job", async () => {
    for (const id of SEEDED_IDS) {
      const events = await eventsOf(id);
      for (let i = 1; i < events.length; i++) {
        expect(
          events[i].created_at.getTime(),
          `${id}: event ${events[i].id} (${events[i].event_type})`,
        ).toBeGreaterThan(events[i - 1].created_at.getTime());
      }
    }
  });

  it("each job has exactly its expected events, by type", async () => {
    for (const key of keys) {
      const counts: Record<string, number> = {};
      for (const e of await eventsOf(WORK_ORDER[key])) {
        counts[e.event_type] = (counts[e.event_type] ?? 0) + 1;
      }
      expect({ key, counts }).toEqual({ key, counts: EXPECTED[key].events });
    }
  });

  it("nothing but J-000007 was stamped at seed time", async () => {
    const byId = await jobs();
    const seededAt = byId.get(WORK_ORDER.nurulBianchiReceived)!.checked_in_at.getTime();
    const cutoff = seededAt - 30 * 60 * 1000;
    for (const id of SEEDED_IDS) {
      if (id === WORK_ORDER.nurulBianchiReceived) continue;
      for (const e of await eventsOf(id)) {
        expect(e.created_at.getTime(), `${id}: ${e.event_type}`).toBeLessThan(cutoff);
      }
    }
  });

  it("every trigger-written actor is the row's own actor; every status change is by the lead", async () => {
    const byId = await jobs();
    const { rows: creators } = await conn.query<{ id: string; created_by: string }>(
      "select id, created_by from public.work_orders where id = any ($1::uuid[])",
      [SEEDED_IDS],
    );
    const createdBy = new Map(creators.map((r) => [r.id, r.created_by]));
    const { rows: lines } = await conn.query<{
      id: string;
      created_by: string;
      voided_by: string | null;
    }>(
      "select id, created_by, voided_by from public.work_order_line_items where work_order_id = any ($1::uuid[])",
      [SEEDED_IDS],
    );
    const line = new Map(lines.map((r) => [r.id, r]));
    const { rows: assignments } = await conn.query<{
      work_order_id: string;
      staff_id: string;
      assigned_by: string;
    }>(
      "select work_order_id, staff_id, assigned_by from public.work_order_assignments where work_order_id = any ($1::uuid[])",
      [SEEDED_IDS],
    );
    let checked = 0;
    for (const id of SEEDED_IDS) {
      for (const e of await eventsOf(id)) {
        const where = `${byId.get(id)?.job_number} ${e.event_type}`;
        switch (e.event_type) {
          case "checked_in":
            expect(e.actor_staff_id, where).toBe(createdBy.get(id));
            break;
          case "line_added":
            expect(e.actor_staff_id, where).toBe(line.get(e.payload.line_id as string)?.created_by);
            break;
          case "line_voided":
            expect(e.actor_staff_id, where).toBe(line.get(e.payload.line_id as string)?.voided_by);
            break;
          case "assignment_changed": {
            const a = assignments.find(
              (x) => x.work_order_id === id && x.staff_id === e.payload.staff_id,
            );
            expect(e.payload.action, where).toBe("assigned");
            expect(e.actor_staff_id, where).toBe(a?.assigned_by);
            break;
          }
          case "status_changed":
          case "completed":
          case "ready_for_collection":
          case "collected":
          case "cancelled":
            expect(e.actor_staff_id, where).toBe(byId.get(id)?.lead_mechanic_id);
            break;
          default:
            expect(e.actor_staff_id, where).not.toBeNull();
        }
        checked++;
      }
    }
    expect(checked).toBe(47);
  });

  it("lines that carry a cost were added by a view_costs holder (D14)", async () => {
    const { rows } = await conn.query(
      `select li.id, li.created_by,
              exists (select 1 from public.staff s where s.id = li.created_by and s.role = 'admin')
              or exists (select 1 from public.staff_permissions p
                          where p.staff_id = li.created_by and p.permission = 'view_costs') as may
         from public.work_order_line_items li
        where li.work_order_id = any ($1::uuid[])
          and li.unit_direct_cost_snapshot > 0
          and (li.line_type = 'manual' or li.unit_direct_cost_snapshot <> (
                select s.default_direct_cost from public.services s where s.id = li.source_service_id))`,
      [SEEDED_IDS],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.may).toBe(true);
  });

  it("no line is added or voided after its job's completion", async () => {
    const { rows } = await conn.query(
      `select w.job_number, e.event_type
         from public.work_order_events e
         join public.work_orders w on w.id = e.work_order_id
        where w.id = any ($1::uuid[])
          and e.event_type in ('line_added', 'line_voided')
          and w.completed_at is not null
          and e.created_at >= w.completed_at`,
      [SEEDED_IDS],
    );
    expect(rows).toEqual([]);
  });

  it("J-000007 is checked in after the Bianchi was transferred to Nurul", async () => {
    const { rows } = await conn.query(
      `select w.checked_in_at > (
                select max(o.created_at) from public.bike_ownership_events o
                 where o.bike_id = $2 and o.event_type = 'transferred'
              ) as after_transfer
         from public.work_orders w
        where w.id = $1`,
      [WORK_ORDER.nurulBianchiReceived, BIKE.nurulBianchi],
    );
    expect(rows).toEqual([{ after_transfer: true }]);
  });
});
