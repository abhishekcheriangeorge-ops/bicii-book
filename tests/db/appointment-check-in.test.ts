/**
 * Check-in creates or links exactly one work order (SPEC §6 "Check-in",
 * §7.1, §23, §27.2; DATA-MODEL §3, §4, §16; PLAN D8, D18, D36, D40).
 *
 *   * check_in_appointment needs a bike the appointment's customer owns
 *     (shop bikes and other people's refused) and either creates the job
 *     through Phase 3's private.create_work_order (job number, checked_in
 *     event, lead) or links one open, unlinked job of the same customer and
 *     bike; it is replay-safe and leaves the appointment untouched when it
 *     fails (D40);
 *   * work_orders.appointment_id goes null -> value once (P3's
 *     work_order_immutable afterwards), only to a checked_in appointment of
 *     the same customer and bike, and at most one job per appointment;
 *   * the link is in both histories; customers never see it (D8);
 *   * the appointment completes with its job's first completion; a reopen
 *     or a cancelled job does not move it (D36);
 *   * walk-ins are unaffected.
 *
 * Inserting jobs and bikes consumes the short-ID sequences, so the file
 * only runs on a per-file clone.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, STAFF } from "../fixtures/ids";
import { appointment, appointmentEvents, makeType } from "./appointment-fixtures";
import { customerClaims, linkCustomerLogin } from "./customer-fixtures";
import {
  actAs,
  connect,
  inTransaction,
  isolatedDatabase,
  scalar,
  staffClaims,
  type Claims,
} from "./harness";
import {
  createWorkOrder,
  events,
  eventTypes,
  failsWith,
  makeBike,
  makeCustomerWithBike,
  ownerMode,
  setStatus,
  workOrder,
} from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const MECHANIC2 = staffClaims(AUTH_USER.mechanic2);
const ADMIN = staffClaims(AUTH_USER.admin);
const p0001 = (message: string) => ({ code: "P0001", message });

type CheckIn = {
  appointment_id: string;
  appointment_status: string;
  work_order_id: string;
  job_number: string;
  created: boolean;
};

type CheckInArgs = {
  appointmentId: string;
  bikeId: string;
  workOrderId?: string;
  linkExisting?: boolean;
  requestedWork?: string | null;
  intakeNotes?: string | null;
  leadId?: string | null;
};

/** public.check_in_appointment as whoever `tx` is. */
async function checkIn(tx: pg.Client, a: CheckInArgs): Promise<CheckIn> {
  const { rows } = await tx.query<CheckIn>(
    `select (c).* from (
       select public.check_in_appointment($1, $2, $3, $4, $5, $6, $7) c
     ) s`,
    [
      a.appointmentId,
      a.bikeId,
      a.workOrderId ?? randomUUID(),
      a.linkExisting ?? false,
      a.requestedWork === undefined ? "Service as booked" : a.requestedWork,
      a.intakeNotes ?? null,
      a.leadId ?? null,
    ],
  );
  return rows[0];
}

type Setup = { customerId: string; bikeId: string; typeId: string; appointmentId: string };

/**
 * Owner inserts: a customer with a bike, a fresh type and one appointment
 * (booked by default) starting in an hour, with the bike and an optional
 * customer note. Returns as `claims`.
 */
async function setup(
  tx: pg.Client,
  claims: Claims,
  opts: { status?: string; note?: string | null; withBike?: boolean } = {},
): Promise<Setup> {
  await ownerMode(tx);
  const { customerId, bikeId } = await makeCustomerWithBike(tx);
  const typeId = await makeType(tx);
  const appointmentId = await addAppointment(tx, customerId, typeId, {
    bikeId: opts.withBike === false ? null : bikeId,
    status: opts.status,
    note: opts.note,
  });
  await actAs(tx, claims);
  return { customerId, bikeId, typeId, appointmentId };
}

/** One more appointment (owner insert); returns to whoever `tx` was via the caller. */
async function addAppointment(
  tx: pg.Client,
  customerId: string,
  typeId: string,
  opts: { bikeId?: string | null; status?: string; note?: string | null } = {},
): Promise<string> {
  const start = new Date(Date.now() + 60 * 60_000);
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.appointments
       (customer_id, bike_id, appointment_type_id, starts_at, ends_at, capacity_units, status, source,
        customer_note, cancellation_reason)
     values ($1, $2, $3, $4, $5, 1, $6, 'staff', $7, $8) returning id`,
    [
      customerId,
      opts.bikeId ?? null,
      typeId,
      start.toISOString(),
      new Date(start.getTime() + 30 * 60_000).toISOString(),
      opts.status ?? "booked",
      opts.note ?? null,
      opts.status === "cancelled" ? "Test cancellation" : null,
    ],
  );
  return rows[0].id;
}

/** The appointment and its history as the owner (the caller's identity is restored). */
async function snapshot(tx: pg.Client, id: string) {
  return { row: await appointment(tx, id), events: await appointmentEvents(tx, id) };
}

/** The whole work_orders row bar updated_at (set_updated_at moves it on every write). */
async function jobRow(tx: pg.Client, id: string): Promise<Record<string, unknown>> {
  const { rows } = await tx.query("select * from public.work_orders where id = $1", [id]);
  delete rows[0].updated_at;
  return rows[0];
}

const jobsOfCustomer = (tx: pg.Client, customerId: string) =>
  scalar<number>(tx, "select count(*)::int from public.work_orders where customer_id = $1", [
    customerId,
  ]);

describe.skipIf(!isolatedDatabase())(
  "Check-in creates or links exactly one work order (D40)",
  () => {
    it("creates the job as a walk-in would, linked once, with both histories (mechanic2, no permissions)", async () => {
      await inTransaction(conn, async (tx) => {
        const s = await setup(tx, MECHANIC2);
        const workOrderId = randomUUID();
        const result = await checkIn(tx, {
          appointmentId: s.appointmentId,
          bikeId: s.bikeId,
          workOrderId,
          requestedWork: "Brakes squeal",
          intakeNotes: "Scuff on the top tube",
          leadId: STAFF.mechanic1,
        });
        expect(result).toEqual({
          appointment_id: s.appointmentId,
          appointment_status: "checked_in",
          work_order_id: workOrderId,
          job_number: expect.stringMatching(/^J-\d{6}$/),
          created: true,
        });

        const job = await workOrder(tx, workOrderId);
        expect(job).toMatchObject({
          appointment_id: s.appointmentId,
          customer_id: s.customerId,
          bike_id: s.bikeId,
          job_number: result.job_number,
          status: "received",
          requested_work: "Brakes squeal",
          intake_notes: "Scuff on the top tube",
          lead_mechanic_id: STAFF.mechanic1,
          created_by: STAFF.mechanic2,
        });
        // P3's checked_in first, then the link (created true), then the lead.
        const timeline = await events(tx, workOrderId);
        expect(timeline.map((e) => e.event_type)).toEqual([
          "checked_in",
          "appointment_linked",
          "assignment_changed",
        ]);
        expect(timeline[1].payload).toEqual({
          appointment_id: s.appointmentId,
          starts_at: expect.any(String),
          appointment_type_name: expect.stringMatching(/^Test type /),
          created: true,
        });
        for (const e of timeline) expect(e.actor_staff_id).toBe(STAFF.mechanic2);

        const { row, events: history } = await snapshot(tx, s.appointmentId);
        expect(row.status).toBe("checked_in");
        expect(row.checked_in_at).not.toBeNull();
        expect(row.arrived_at).not.toBeNull();
        expect(row.bike_id).toBe(s.bikeId);
        expect(history.map((e) => e.event_type)).toEqual([
          "booked",
          "checked_in",
          "work_order_linked",
        ]);
        expect(history[2].payload).toEqual({
          work_order_id: workOrderId,
          job_number: result.job_number,
          created: true,
        });
        expect(history[2].actor_staff_id).toBe(STAFF.mechanic2);
      });
    });

    it("requested work defaults to the customer's note; blank both is requested_work_required and changes nothing", async () => {
      await inTransaction(conn, async (tx) => {
        const s = await setup(tx, ADMIN, { note: "Gears skip on the climbs" });
        const result = await checkIn(tx, {
          appointmentId: s.appointmentId,
          bikeId: s.bikeId,
          requestedWork: "   ",
        });
        expect((await workOrder(tx, result.work_order_id)).requested_work).toBe(
          "Gears skip on the climbs",
        );

        const t = await setup(tx, ADMIN);
        const before = await snapshot(tx, t.appointmentId);
        for (const requestedWork of [null, "  "])
          await failsWith(
            tx,
            () => checkIn(tx, { appointmentId: t.appointmentId, bikeId: t.bikeId, requestedWork }),
            p0001("requested_work_required"),
          );
        expect(await snapshot(tx, t.appointmentId)).toEqual(before);
        expect(await jobsOfCustomer(tx, t.customerId)).toBe(0);
      });
    });

    it("a replay with the same or another work_order_id returns the same link and creates nothing", async () => {
      await inTransaction(conn, async (tx) => {
        const s = await setup(tx, ADMIN);
        const workOrderId = randomUUID();
        const first = await checkIn(tx, {
          appointmentId: s.appointmentId,
          bikeId: s.bikeId,
          workOrderId,
        });
        const history = await snapshot(tx, s.appointmentId);
        const timeline = await events(tx, workOrderId);
        for (const replayId of [workOrderId, randomUUID()]) {
          const again = await checkIn(tx, {
            appointmentId: s.appointmentId,
            bikeId: s.bikeId,
            workOrderId: replayId,
          });
          expect(again).toEqual({ ...first, created: false });
        }
        expect(await jobsOfCustomer(tx, s.customerId)).toBe(1);
        expect(await snapshot(tx, s.appointmentId)).toEqual(history);
        expect(await events(tx, workOrderId)).toEqual(timeline);
      });
    });

    it("a work_order_id of an existing job of the same customer and bike is work_order_conflict, and the appointment is unchanged", async () => {
      await inTransaction(conn, async (tx) => {
        const s = await setup(tx, ADMIN);
        const existing = await createWorkOrder(tx, { customerId: s.customerId, bikeId: s.bikeId });
        const before = await snapshot(tx, s.appointmentId);
        await failsWith(
          tx,
          () =>
            checkIn(tx, {
              appointmentId: s.appointmentId,
              bikeId: s.bikeId,
              workOrderId: existing.id,
            }),
          p0001("work_order_conflict"),
        );
        expect(await snapshot(tx, s.appointmentId)).toEqual(before);
        expect((await workOrder(tx, existing.id)).appointment_id).toBeNull();
      });
    });

    it("links an open, unlinked job of the same customer and bike (null -> value once, created false)", async () => {
      await inTransaction(conn, async (tx) => {
        const s = await setup(tx, ADMIN);
        const job = await createWorkOrder(tx, { customerId: s.customerId, bikeId: s.bikeId });
        await setStatus(tx, job.id, "awaiting_parts");
        const before = await jobRow(tx, job.id);
        const result = await checkIn(tx, {
          appointmentId: s.appointmentId,
          bikeId: s.bikeId,
          workOrderId: job.id,
          linkExisting: true,
        });
        expect(result).toEqual({
          appointment_id: s.appointmentId,
          appointment_status: "checked_in",
          work_order_id: job.id,
          job_number: job.job_number,
          created: false,
        });
        const after = await jobRow(tx, job.id);
        expect(after).toEqual({ ...before, appointment_id: s.appointmentId });
        const linked = (await events(tx, job.id)).filter(
          (e) => e.event_type === "appointment_linked",
        );
        expect(linked.map((e) => e.payload.created)).toEqual([false]);
        const history = (await snapshot(tx, s.appointmentId)).events;
        expect(history.map((e) => e.event_type)).toEqual([
          "booked",
          "checked_in",
          "work_order_linked",
        ]);
        expect(history[2].payload).toMatchObject({ work_order_id: job.id, created: false });
        expect(await jobsOfCustomer(tx, s.customerId)).toBe(1);

        // Once set, the owner can neither change nor clear it (P3's rule).
        await ownerMode(tx);
        const other = await addAppointment(tx, s.customerId, s.typeId, {
          bikeId: s.bikeId,
          status: "checked_in",
        });
        for (const value of [other, null])
          await failsWith(
            tx,
            () =>
              tx.query("update public.work_orders set appointment_id = $2 where id = $1", [
                job.id,
                value,
              ]),
            {
              code: "P0001",
              message: "work_order_immutable",
              detail:
                "A job keeps its number, customer, bike and check-in time, and its appointment once linked.",
            },
          );
      });
    });

    it("refuses to link another customer's job, another bike's, a completed, ready, collected or cancelled job, or one already linked (appointment_work_order_mismatch)", async () => {
      await inTransaction(conn, async (tx) => {
        const s = await setup(tx, ADMIN);
        await ownerMode(tx);
        const stranger = await makeCustomerWithBike(tx);
        const secondBike = await makeBike(tx, s.customerId);
        const linkedAppointment = await addAppointment(tx, s.customerId, s.typeId, {
          bikeId: s.bikeId,
        });
        await actAs(tx, ADMIN);

        const jobs: string[] = [];
        jobs.push((await createWorkOrder(tx, stranger)).id);
        jobs.push((await createWorkOrder(tx, { customerId: s.customerId, bikeId: secondBike })).id);
        for (const path of [
          ["in_progress", "completed"],
          ["in_progress", "completed", "ready_for_collection"],
          ["in_progress", "completed", "collected"],
          ["cancelled"],
        ] as const) {
          const job = await createWorkOrder(tx, { customerId: s.customerId, bikeId: s.bikeId });
          for (const status of path) await setStatus(tx, job.id, status, "Test reason");
          jobs.push(job.id);
        }
        const linked = await checkIn(tx, { appointmentId: linkedAppointment, bikeId: s.bikeId });
        jobs.push(linked.work_order_id);

        const before = await snapshot(tx, s.appointmentId);
        for (const workOrderId of jobs)
          await failsWith(
            tx,
            () =>
              checkIn(tx, {
                appointmentId: s.appointmentId,
                bikeId: s.bikeId,
                workOrderId,
                linkExisting: true,
              }),
            p0001("appointment_work_order_mismatch"),
          );
        await failsWith(
          tx,
          () =>
            checkIn(tx, {
              appointmentId: s.appointmentId,
              bikeId: s.bikeId,
              workOrderId: randomUUID(),
              linkExisting: true,
            }),
          { code: "P0002" },
        );
        expect(await snapshot(tx, s.appointmentId)).toEqual(before);
      });
    });

    it("from cancelled or no_show is appointment_transition_invalid; from checked_in or completed it returns the existing link", async () => {
      await inTransaction(conn, async (tx) => {
        for (const status of ["cancelled", "no_show"]) {
          const s = await setup(tx, ADMIN, { status });
          await failsWith(
            tx,
            () => checkIn(tx, { appointmentId: s.appointmentId, bikeId: s.bikeId }),
            p0001("appointment_transition_invalid"),
          );
        }
        const s = await setup(tx, ADMIN);
        const first = await checkIn(tx, { appointmentId: s.appointmentId, bikeId: s.bikeId });
        await setStatus(tx, first.work_order_id, "in_progress");
        await setStatus(tx, first.work_order_id, "completed");
        expect((await appointment(tx, s.appointmentId)).status).toBe("completed");
        expect(await checkIn(tx, { appointmentId: s.appointmentId, bikeId: s.bikeId })).toEqual({
          ...first,
          appointment_status: "completed",
          created: false,
        });
      });
    });

    it("needs the customer's own, unarchived bike: someone else's or a shop bike is appointment_bike_not_owned", async () => {
      await inTransaction(conn, async (tx) => {
        const s = await setup(tx, ADMIN, { withBike: false });
        await ownerMode(tx);
        const stranger = await makeCustomerWithBike(tx);
        const shopBike = await makeBike(tx, null);
        const archived = await makeBike(tx, s.customerId);
        await tx.query("update public.bikes set archived_at = now() where id = $1", [archived]);
        await actAs(tx, ADMIN);
        const before = await snapshot(tx, s.appointmentId);
        for (const bikeId of [stranger.bikeId, shopBike])
          await failsWith(
            tx,
            () => checkIn(tx, { appointmentId: s.appointmentId, bikeId }),
            p0001("appointment_bike_not_owned"),
          );
        await failsWith(
          tx,
          () => checkIn(tx, { appointmentId: s.appointmentId, bikeId: archived }),
          p0001("appointment_bike_archived"),
        );
        await failsWith(
          tx,
          () => checkIn(tx, { appointmentId: s.appointmentId, bikeId: randomUUID() }),
          {
            code: "P0002",
          },
        );
        expect(await snapshot(tx, s.appointmentId)).toEqual(before);

        // The appointment had no bike: check-in sets it.
        const result = await checkIn(tx, { appointmentId: s.appointmentId, bikeId: s.bikeId });
        expect((await appointment(tx, s.appointmentId)).bike_id).toBe(s.bikeId);
        expect((await workOrder(tx, result.work_order_id)).bike_id).toBe(s.bikeId);
      });
    });

    it("refuses nulls (22004) and an unknown appointment (P0002)", async () => {
      await inTransaction(conn, async (tx) => {
        await actAs(tx, ADMIN);
        for (const params of [
          [null, randomUUID(), randomUUID()],
          [randomUUID(), null, randomUUID()],
          [randomUUID(), randomUUID(), null],
        ])
          await failsWith(
            tx,
            () => tx.query("select public.check_in_appointment($1, $2, $3)", params),
            { code: "22004" },
          );
        await failsWith(
          tx,
          () =>
            tx.query("select public.check_in_appointment($1, $2, $3)", [
              randomUUID(),
              randomUUID(),
              randomUUID(),
            ]),
          { code: "P0002" },
        );
      });
    });
  },
);

describe.skipIf(!isolatedDatabase())(
  "Every writer links only a checked-in appointment of the job's customer and bike (D40)",
  () => {
    it("an owner insert or private.create_work_order with an appointment that is not checked_in, or of another customer or bike, is refused", async () => {
      await inTransaction(conn, async (tx) => {
        await ownerMode(tx);
        const { customerId, bikeId } = await makeCustomerWithBike(tx);
        const otherBike = await makeBike(tx, customerId);
        const stranger = await makeCustomerWithBike(tx);
        const typeId = await makeType(tx);
        const insertJob = (appointmentId: string, c = customerId, b = bikeId) =>
          tx.query(
            `insert into public.work_orders (customer_id, bike_id, requested_work, appointment_id)
           values ($1, $2, 'Booked', $3)`,
            [c, b, appointmentId],
          );
        const viaCreate = (appointmentId: string, c = customerId, b = bikeId) =>
          tx.query(
            `select private.create_work_order($1, $2, $3, $4, 'Booked', null, null, '{}'::uuid[], '[]'::jsonb, $5)`,
            [STAFF.admin, randomUUID(), c, b, appointmentId],
          );
        for (const status of ["booked", "confirmed", "arrived", "no_show", "cancelled"]) {
          const id = await addAppointment(tx, customerId, typeId, { bikeId, status });
          for (const write of [insertJob, viaCreate])
            await failsWith(tx, () => write(id), p0001("appointment_not_checked_in"));
        }
        const checkedIn = await addAppointment(tx, customerId, typeId, {
          bikeId,
          status: "checked_in",
        });
        for (const write of [insertJob, viaCreate]) {
          await failsWith(
            tx,
            () => write(checkedIn, customerId, otherBike),
            p0001("appointment_work_order_mismatch"),
          );
          await failsWith(
            tx,
            () => write(checkedIn, stranger.customerId, stranger.bikeId),
            p0001("appointment_work_order_mismatch"),
          );
        }
        await failsWith(tx, () => insertJob(randomUUID()), { code: "P0002" });

        // The update path: an open job's null -> a booked appointment.
        const job = await insertJob(checkedIn).then(() =>
          scalar<string>(tx, "select id from public.work_orders where appointment_id = $1", [
            checkedIn,
          ]),
        );
        expect(job).toBeTruthy();
        const openJob = await scalar<string>(
          tx,
          `insert into public.work_orders (customer_id, bike_id, requested_work) values ($1, $2, 'Walk-in') returning id`,
          [customerId, bikeId],
        );
        const booked = await addAppointment(tx, customerId, typeId, { bikeId });
        await failsWith(
          tx,
          () =>
            tx.query("update public.work_orders set appointment_id = $2 where id = $1", [
              openJob,
              booked,
            ]),
          p0001("appointment_not_checked_in"),
        );
      });
    });

    it("a second work order for the same appointment is 23505 work_orders_appointment_id_key", async () => {
      await inTransaction(conn, async (tx) => {
        const s = await setup(tx, ADMIN);
        await checkIn(tx, { appointmentId: s.appointmentId, bikeId: s.bikeId });
        await ownerMode(tx);
        await failsWith(
          tx,
          () =>
            tx.query(
              `insert into public.work_orders (customer_id, bike_id, requested_work, appointment_id)
             values ($1, $2, 'Again', $3)`,
              [s.customerId, s.bikeId, s.appointmentId],
            ),
          { code: "23505", constraint: "work_orders_appointment_id_key" },
        );
        expect(
          await scalar<number>(
            tx,
            "select count(*)::int from public.work_orders where appointment_id = $1",
            [s.appointmentId],
          ),
        ).toBe(1);
      });
    });

    it("Walk-ins are unaffected: public.create_work_order without an appointment works and touches no appointment", async () => {
      await inTransaction(conn, async (tx) => {
        const s = await setup(tx, MECHANIC2, { status: "confirmed" });
        const before = await snapshot(tx, s.appointmentId);
        const job = await createWorkOrder(tx, { customerId: s.customerId, bikeId: s.bikeId });
        expect(job.appointment_id).toBeNull();
        expect(await eventTypes(tx, job.id)).toEqual(["checked_in"]);
        expect(await snapshot(tx, s.appointmentId)).toEqual(before);
      });
    });
  },
);

describe.skipIf(!isolatedDatabase())("The appointment completes with its job (D36)", () => {
  it("completes once at the job's completed_at with the actor; ready and collected add nothing", async () => {
    await inTransaction(conn, async (tx) => {
      const s = await setup(tx, ADMIN);
      const { work_order_id: jobId } = await checkIn(tx, {
        appointmentId: s.appointmentId,
        bikeId: s.bikeId,
      });
      await actAs(tx, MECHANIC2);
      await setStatus(tx, jobId, "in_progress");
      expect((await appointment(tx, s.appointmentId)).status).toBe("checked_in");
      const done = await setStatus(tx, jobId, "completed");
      const row = await appointment(tx, s.appointmentId);
      expect(row.status).toBe("completed");
      expect(row.completed_at).toEqual(done.completed_at);
      const history = (await snapshot(tx, s.appointmentId)).events;
      expect(history.map((e) => e.event_type)).toEqual([
        "booked",
        "checked_in",
        "work_order_linked",
        "completed",
      ]);
      expect(history[3]).toMatchObject({
        from_status: "checked_in",
        to_status: "completed",
        actor_staff_id: STAFF.mechanic2,
        created_at: done.completed_at,
      });
      await setStatus(tx, jobId, "ready_for_collection");
      await setStatus(tx, jobId, "collected");
      expect(await snapshot(tx, s.appointmentId)).toEqual({ row, events: history });
    });
  });

  it("a reopen does not reopen the appointment, and re-completion adds nothing", async () => {
    await inTransaction(conn, async (tx) => {
      const s = await setup(tx, ADMIN);
      const { work_order_id: jobId } = await checkIn(tx, {
        appointmentId: s.appointmentId,
        bikeId: s.bikeId,
      });
      await setStatus(tx, jobId, "in_progress");
      await setStatus(tx, jobId, "completed");
      const completed = await snapshot(tx, s.appointmentId);
      await setStatus(tx, jobId, "in_progress", "Customer reports a rub");
      expect(await snapshot(tx, s.appointmentId)).toEqual(completed);
      await setStatus(tx, jobId, "completed");
      expect(await snapshot(tx, s.appointmentId)).toEqual(completed);
    });
  });

  it("a cancelled job leaves the appointment checked_in", async () => {
    await inTransaction(conn, async (tx) => {
      const s = await setup(tx, ADMIN);
      const { work_order_id: jobId } = await checkIn(tx, {
        appointmentId: s.appointmentId,
        bikeId: s.bikeId,
      });
      const before = await snapshot(tx, s.appointmentId);
      await setStatus(tx, jobId, "cancelled", "Customer took the bike home");
      expect(await snapshot(tx, s.appointmentId)).toEqual(before);
      expect(before.row.status).toBe("checked_in");
    });
  });
});

describe.skipIf(!isolatedDatabase())(
  "Who may check in, and what customers see (SPEC §27.2; D8)",
  () => {
    it("customers never see appointment_linked in my_work_order_timeline", async () => {
      await inTransaction(conn, async (tx) => {
        const s = await setup(tx, ADMIN);
        const { work_order_id: jobId } = await checkIn(tx, {
          appointmentId: s.appointmentId,
          bikeId: s.bikeId,
        });
        const linkedEvent = (await events(tx, jobId)).find(
          (e) => e.event_type === "appointment_linked",
        );
        expect(linkedEvent).toBeDefined();
        await ownerMode(tx);
        const auth = await linkCustomerLogin(tx, s.customerId);
        await actAs(tx, customerClaims(auth));
        const { rows } = await tx.query<{ id: string; kind: string }>(
          "select id::text, kind from public.my_work_order_timeline($1)",
          [jobId],
        );
        expect(rows.map((r) => r.kind)).toEqual(["checked_in"]);
        expect(rows.map((r) => r.id)).not.toContain(linkedEvent!.id);
      });
    });

    it("customers and anonymous visitors get 42501", async () => {
      await inTransaction(conn, async (tx) => {
        const s = await setup(tx, ADMIN);
        await ownerMode(tx);
        const auth = await linkCustomerLogin(tx, s.customerId);
        for (const claims of [customerClaims(auth), { role: "anon" } as Claims]) {
          await ownerMode(tx);
          await actAs(tx, claims);
          await failsWith(
            tx,
            () => checkIn(tx, { appointmentId: s.appointmentId, bikeId: s.bikeId }),
            { code: "42501" },
          );
        }
        expect((await appointment(tx, s.appointmentId)).status).toBe("booked");
      });
    });
  },
);
