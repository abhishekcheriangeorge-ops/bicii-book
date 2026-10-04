/**
 * Workshop concurrency (SPEC §2 "Idempotent ... mutations", §25; PLAN D18,
 * D22): real connections, committed transactions. Every workshop RPC locks
 * the job (`for update`) before touching it or its lines, so racing calls
 * serialise; check-in holds the bike `for share`, so a concurrent transfer
 * cannot slip between the ownership check and the insert.
 *
 * Commits, so the whole file runs only on a per-file clone.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, STAFF } from "../fixtures/ids";
import {
  actAs,
  connect,
  inTransaction,
  isolatedDatabase,
  openConnections,
  scalar,
  staffClaims,
} from "./harness";
import { makeBike, makeCustomer, makeService } from "./workshop-fixtures";

let setup: pg.Client;

const ADMIN = staffClaims(AUTH_USER.admin);

/** Runs `fn` as the admin on `c` in a committed transaction; resolves to its result or error. */
function asAdmin<T>(c: pg.Client, fn: (tx: pg.Client) => Promise<T>) {
  return inTransaction(
    c,
    async (tx) => {
      await actAs(tx, ADMIN);
      return fn(tx);
    },
    { commit: true },
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: { code?: string; message?: string }) => ({ ok: false as const, error }),
  );
}

const pause = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

const createJob = (tx: pg.Client, id: string, customerId: string, bikeId: string) =>
  tx
    .query(
      "select (w).id, (w).job_number from (select public.create_work_order($1, $2, $3, 'Service') w) s",
      [id, customerId, bikeId],
    )
    .then((r) => r.rows[0] as { id: string; job_number: string });

/** A committed customer + bike + job (as the admin); returns their ids. */
async function committedJob(status: "received" | "in_progress" | "completed" = "received") {
  const customerId = await makeCustomer(setup);
  const bikeId = await makeBike(setup, customerId);
  const id = randomUUID();
  const res = await asAdmin(setup, async (tx) => {
    await createJob(tx, id, customerId, bikeId);
    if (status !== "received")
      await tx.query("select public.set_work_order_status($1, 'in_progress')", [id]);
    if (status === "completed")
      await tx.query("select public.set_work_order_status($1, 'completed')", [id]);
  });
  if (!res.ok) throw res.error;
  return { id, customerId, bikeId };
}

const eventCount = (workOrderId: string, type: string) =>
  scalar<number>(
    setup,
    "select count(*)::int from public.work_order_events where work_order_id = $1 and event_type = $2",
    [workOrderId, type],
  );

describe.skipIf(!isolatedDatabase())("workshop under concurrency", () => {
  beforeAll(async () => {
    setup = await connect();
  });

  it("two check-ins with the same id create one job and one checked_in event; both get it", async () => {
    const customerId = await makeCustomer(setup);
    const bikeId = await makeBike(setup, customerId);
    const id = randomUUID();
    const [a, b] = await openConnections(2);
    const results = await Promise.all([
      asAdmin(a, (tx) => createJob(tx, id, customerId, bikeId)),
      asAdmin(b, (tx) => createJob(tx, id, customerId, bikeId)),
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    const jobs = results.map((r) => (r.ok ? r.value : null));
    expect(jobs[0]).toEqual(jobs[1]);
    expect(
      await scalar(setup, "select count(*)::int from public.work_orders where id = $1", [id]),
    ).toBe(1);
    expect(await eventCount(id, "checked_in")).toBe(1);
  });

  it("D18 holds against a concurrent transfer: a check-in waiting on the bike sees the new owner", async () => {
    const previous = await makeCustomer(setup);
    const next = await makeCustomer(setup);
    const bikeId = await makeBike(setup, previous);
    const [a, b] = await openConnections(2);

    await a.query("begin");
    await actAs(a, ADMIN);
    await a.query("select public.transfer_bike_ownership($1, $2, 'Sold')", [bikeId, next]);

    const checkIn = asAdmin(b, (tx) => createJob(tx, randomUUID(), previous, bikeId));
    await pause();
    await a.query("commit");
    const result = await checkIn;
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({
      code: "P0001",
      message: "bike_owner_mismatch",
    });
  });

  it("D18 holds the other way round: a transfer waits for the check-in that holds the bike", async () => {
    const previous = await makeCustomer(setup);
    const next = await makeCustomer(setup);
    const bikeId = await makeBike(setup, previous);
    const [a, b] = await openConnections(2);

    await a.query("begin");
    await actAs(a, ADMIN);
    await createJob(a, randomUUID(), previous, bikeId);

    const transfer = asAdmin(b, (tx) =>
      tx.query("select public.transfer_bike_ownership($1, $2, 'Sold')", [bikeId, next]),
    );
    await pause();
    await a.query("commit");
    expect((await transfer).ok).toBe(true);

    // No job was ever checked in for someone who did not own the bike then.
    const { rows } = await setup.query(
      `select w.job_number
         from public.work_orders w
         cross join lateral (
           select e.to_customer_id as owner
             from public.bike_ownership_events e
            where e.bike_id = w.bike_id and e.created_at <= w.checked_in_at
            order by e.created_at desc limit 1
         ) o
        where o.owner is not null and o.owner <> w.customer_id`,
    );
    expect(rows).toEqual([]);
  });

  it("two different leads assigned at once leave exactly one active lead, mirrored on the job", async () => {
    const job = await committedJob();
    const [a, b] = await openConnections(2);
    const results = await Promise.all([
      asAdmin(a, (tx) =>
        tx.query("select public.assign_staff($1, $2, 'lead')", [job.id, STAFF.mechanic1]),
      ),
      asAdmin(b, (tx) =>
        tx.query("select public.assign_staff($1, $2, 'lead')", [job.id, STAFF.mechanic2]),
      ),
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    const { rows } = await setup.query(
      `select w.lead_mechanic_id, array_agg(a.staff_id) as leads
         from public.work_orders w
         join public.work_order_assignments a
           on a.work_order_id = w.id and a.role = 'lead' and a.unassigned_at is null
        where w.id = $1 group by w.lead_mechanic_id`,
      [job.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].leads).toHaveLength(1);
    expect(rows[0].lead_mechanic_id).toBe(rows[0].leads[0]);
  });

  it("a line racing completion is either added before it or refused (work_order_locked)", async () => {
    const serviceId = await makeService(setup);
    for (const order of ["complete first", "add first", "free race"] as const) {
      const job = await committedJob("in_progress");
      const [a, b] = await openConnections(2);
      const complete = () =>
        asAdmin(a, (tx) =>
          tx.query("select public.set_work_order_status($1, 'completed')", [job.id]),
        );
      const add = () =>
        asAdmin(b, (tx) =>
          tx.query("select public.add_service_line($1, $2, $3)", [randomUUID(), job.id, serviceId]),
        );
      let results;
      if (order === "free race") {
        results = await Promise.all([complete(), add()]);
      } else {
        const [first, second] = order === "complete first" ? [a, b] : [b, a];
        await first.query("begin");
        await actAs(first, ADMIN);
        if (order === "complete first") {
          await first.query("select public.set_work_order_status($1, 'completed')", [job.id]);
        } else {
          await first.query("select public.add_service_line($1, $2, $3)", [
            randomUUID(),
            job.id,
            serviceId,
          ]);
        }
        const other =
          order === "complete first"
            ? asAdmin(second, (tx) =>
                tx.query("select public.add_service_line($1, $2, $3)", [
                  randomUUID(),
                  job.id,
                  serviceId,
                ]),
              )
            : asAdmin(second, (tx) =>
                tx.query("select public.set_work_order_status($1, 'completed')", [job.id]),
              );
        await pause();
        await first.query("commit");
        results = [await other];
      }
      for (const r of results) {
        if (!r.ok) expect(r.error).toMatchObject({ code: "P0001", message: "work_order_locked" });
      }
      expect(
        await scalar(
          setup,
          `select count(*)::int from public.work_order_line_items li
             join public.work_orders w on w.id = li.work_order_id
            where w.id = $1 and li.created_at >= w.completed_at`,
          [job.id],
        ),
      ).toBe(0);
      expect(
        await scalar(setup, "select status::text from public.work_orders where id = $1", [job.id]),
      ).toBe("completed");
    }
  });

  it("two adds of the same line id create one line and one event", async () => {
    const serviceId = await makeService(setup);
    const job = await committedJob();
    const lineId = randomUUID();
    const [a, b] = await openConnections(2);
    const add = (c: pg.Client) =>
      asAdmin(c, (tx) =>
        scalar(tx, "select public.add_service_line($1, $2, $3)", [lineId, job.id, serviceId]),
      );
    const results = await Promise.all([add(a), add(b)]);
    expect(results).toEqual([
      { ok: true, value: lineId },
      { ok: true, value: lineId },
    ]);
    expect(await eventCount(job.id, "line_added")).toBe(1);
  });

  it("two collections at once record one collected event", async () => {
    const job = await committedJob("completed");
    const [a, b] = await openConnections(2);
    const collect = (c: pg.Client) =>
      asAdmin(c, (tx) =>
        tx.query("select public.set_work_order_status($1, 'collected')", [job.id]),
      );
    const results = await Promise.all([collect(a), collect(b)]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(await eventCount(job.id, "collected")).toBe(1);
  });

  it("two voids of one line record one line_voided event", async () => {
    const job = await committedJob();
    const lineId = randomUUID();
    const added = await asAdmin(setup, (tx) =>
      tx.query("select public.add_manual_line($1, $2, 'Labour', 30)", [lineId, job.id]),
    );
    expect(added.ok).toBe(true);
    const [a, b] = await openConnections(2);
    const voidIt = (c: pg.Client) =>
      asAdmin(c, (tx) => scalar(tx, "select public.void_line($1, 'Not needed')", [lineId]));
    expect(await Promise.all([voidIt(a), voidIt(b)])).toEqual([
      { ok: true, value: lineId },
      { ok: true, value: lineId },
    ]);
    expect(await eventCount(job.id, "line_voided")).toBe(1);
  });
});
