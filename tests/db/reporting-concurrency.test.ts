/**
 * Completion is recognised once under concurrency (SPEC §2, §25; PLAN D32).
 * Nothing in Phase 5 adds a lock: set_work_order_status locks the job FOR
 * UPDATE (private.lock_work_order) before its same-status check, so two
 * completions serialise and the second is a no-op; financial_lines has one
 * entry per live line of a job with a completed_at.
 *
 * Commits, so the whole file runs only on a per-file clone (no cleanup).
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import {
  actAs,
  connect,
  inTransaction,
  isolatedDatabase,
  openConnections,
  scalar,
} from "./harness";
import { ADMIN } from "./inventory-fixtures";
import { money } from "./reporting-fixtures";
import { makeBike, makeCustomer } from "./workshop-fixtures";

let setup: pg.Client;

const pause = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

/** Today's gross sales and completions as the admin sees them (a committed read). */
async function today(c: pg.Client) {
  return inTransaction(c, async (tx) => {
    await actAs(tx, ADMIN);
    const r = (
      await tx.query(
        "select jobs_completed, lines_recognised, gross_sales from public.daily_summary(null, null)",
      )
    ).rows[0];
    return {
      completed: r.jobs_completed as number,
      lines: r.lines_recognised as number,
      gross: money(r.gross_sales),
    };
  });
}

describe.skipIf(!isolatedDatabase())("Completion recognised once (concurrency)", () => {
  beforeAll(async () => {
    setup = await connect();
  });

  it("two concurrent completions: one completed_at, one event, one entry per line, today's sales rise once", async () => {
    const customerId = await makeCustomer(setup);
    const bikeId = await makeBike(setup, customerId);
    const jobId = randomUUID();
    await inTransaction(
      setup,
      async (tx) => {
        await actAs(tx, ADMIN);
        await tx.query("select public.create_work_order($1, $2, $3, 'Service')", [
          jobId,
          customerId,
          bikeId,
        ]);
        await tx.query("select public.add_manual_line($1, $2, 'Labour', 40.00, 1, 0)", [
          randomUUID(),
          jobId,
        ]);
        await tx.query("select public.add_manual_line($1, $2, 'Tyre', 20.00, 1, 35.00)", [
          randomUUID(),
          jobId,
        ]);
        await tx.query("select public.set_work_order_status($1, 'in_progress')", [jobId]);
      },
      { commit: true },
    );
    const baseline = await today(setup);

    const [a, b, c] = await openConnections(3);
    await a.query("begin");
    await actAs(a, ADMIN);
    const first = (
      await a.query(
        "select (w).completed_at, (w).status::text from (select public.set_work_order_status($1, 'completed') w) s",
        [jobId],
      )
    ).rows[0];
    expect(first.status).toBe("completed");

    await b.query("begin");
    await actAs(b, ADMIN);
    const second = b.query(
      "select (w).completed_at, (w).status::text from (select public.set_work_order_status($1, 'completed') w) s",
      [jobId],
    );
    await pause();
    // b waits on a's row lock.
    expect(
      await scalar<number>(
        setup,
        "select count(*)::int from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()",
      ),
    ).toBeGreaterThanOrEqual(1);
    // A third reader sees the old totals: no partial job.
    expect(await today(c)).toEqual(baseline);

    await a.query("commit");
    const replay = (await second).rows[0];
    await b.query("commit");
    expect(replay.status).toBe("completed");
    expect(replay.completed_at).toEqual(first.completed_at);

    expect(
      await scalar<number>(
        setup,
        "select count(*)::int from public.work_order_events where work_order_id = $1 and event_type = 'completed'",
        [jobId],
      ),
    ).toBe(1);
    expect(
      await scalar<number>(
        setup,
        "select count(*)::int from reporting.financial_lines where document_id = $1",
        [jobId],
      ),
    ).toBe(2);
    expect(
      await scalar<number>(
        setup,
        "select count(distinct completed_at)::int from public.work_orders where id = $1",
        [jobId],
      ),
    ).toBe(1);
    const after = await today(setup);
    expect({
      completed: after.completed - baseline.completed,
      lines: after.lines - baseline.lines,
      gross: money(Number(after.gross) - Number(baseline.gross)),
    }).toEqual({ completed: 1, lines: 2, gross: "60.00" });
  });
});
