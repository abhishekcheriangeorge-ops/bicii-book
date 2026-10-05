/**
 * Labels under concurrency (SPEC §2 "Idempotent ... mutations", §25; PLAN
 * D59 PRINT-CONFIRMED; the lock order in the header of
 * supabase/migrations/20261004003800_labels.sql): real connections,
 * committed transactions.
 *
 * Every case starts the first call in an open transaction, proves the
 * second call is waiting on a lock (pg_stat_activity wait_event_type
 * 'Lock', as consignment-concurrency.test.ts does), then commits the
 * first: so each case proves the serialisation, not only an outcome that
 * timing could also produce.
 *
 *   * Two devices submitting the same print job: the second waits on the
 *     first's uncommitted insert (on conflict (id) do nothing), then
 *     re-reads it and returns it (one job), or refuses another quantity
 *     (print_job_conflict).
 *   * Two admins moving a default: the second waits on the first's row
 *     locks (every row of the set FOR UPDATE in id order) and then moves
 *     the default again from the committed state: one default, no 23505.
 *   * Printed and failed at once: the second waits on the job's row lock
 *     and then finds a final status (print_job_transition_invalid).
 *
 * Commits, so the whole file runs only on a per-file clone (no cleanup).
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { LABEL_TEMPLATE, PRINTER_PROFILE, PRODUCT } from "../fixtures/ids";
import { DEFAULT_LAYOUTS } from "../fixtures/label-layouts";
import { actAs, connect, isolatedDatabase, openConnections, scalar, type Claims } from "./harness";
import { ADMIN, MECHANIC1, MECHANIC2, type Outcome, committed } from "./inventory-fixtures";
import {
  createPrintJob,
  setDefaultProfile,
  setDefaultTemplate,
  setJobStatus,
  type PrintJobRow,
} from "./label-fixtures";

let setup: pg.Client;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until `c`'s backend is blocked on a lock (row, transaction and
 * advisory locks all report wait_event_type 'Lock'). Fails if `settled()`
 * turns true first (the statement finished without waiting) or after
 * `timeoutMs`.
 */
async function untilBlocked(c: pg.Client, settled: () => boolean, timeoutMs = 10_000) {
  const pid = (c as unknown as { processID: number }).processID;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (settled()) throw new Error("the second transaction finished without waiting on a lock");
    const waiting = await scalar<number>(
      setup,
      `select count(*)::int from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'`,
      [pid],
    );
    if (waiting === 1) return;
    if (Date.now() > deadline) throw new Error("the second transaction never waited on a lock");
    await pause(20);
  }
}

/**
 * Runs `first` in an open transaction as `claimsA` (holding its locks),
 * starts `second` as `claimsB` in a committed transaction on another
 * connection, proves it waits on a lock, commits `first`, and returns both
 * outcomes.
 */
async function race<A, B>(
  first: (tx: pg.Client) => Promise<A>,
  second: (tx: pg.Client) => Promise<B>,
  claimsA: Claims = ADMIN,
  claimsB: Claims = claimsA,
): Promise<[Outcome<A>, Outcome<B>]> {
  const [a, b] = await openConnections(2);
  await a.query("begin");
  await actAs(a, claimsA);
  let firstResult: Outcome<A>;
  try {
    firstResult = { ok: true, value: await first(a) };
  } catch (error) {
    await a.query("rollback");
    throw error;
  }
  let settled = false;
  const secondResult = committed(b, second, claimsB).finally(() => {
    settled = true;
  });
  try {
    await untilBlocked(b, () => settled);
  } catch (error) {
    await a.query("rollback");
    await secondResult;
    throw error;
  }
  await a.query("commit");
  return [firstResult, await secondResult];
}

/** Unwraps a committed setup step. */
async function must<T>(outcome: Promise<Outcome<T>>): Promise<T> {
  const r = await outcome;
  if (!r.ok) throw r.error;
  return r.value;
}

const jobCount = (jobId: string) =>
  scalar<number>(setup, "select count(*)::int from public.print_jobs where id = $1", [jobId]);

/** A product job with an explicit printer and template (defaults move in this file). */
const productJob = (tx: pg.Client, jobId: string, quantity: number) =>
  createPrintJob(tx, {
    jobId,
    kind: "product",
    entityId: PRODUCT.barTape,
    quantity,
    profileId: PRINTER_PROFILE.browser,
    templateId: LABEL_TEMPLATE.product,
  });

beforeAll(async () => {
  setup = await connect();
});

describe.skipIf(!isolatedDatabase())("print jobs under concurrency", () => {
  it("two devices submitting the same print job at once create one job", async () => {
    const jobId = randomUUID();
    const [a, b] = await race(
      (tx) => productJob(tx, jobId, 3),
      (tx) => productJob(tx, jobId, 3),
      MECHANIC1,
      MECHANIC2,
    );
    expect(a.ok && b.ok).toBe(true);
    const first = (a as { value: PrintJobRow }).value;
    const second = (b as { value: PrintJobRow }).value;
    expect(second).toEqual(first);
    expect(await jobCount(jobId)).toBe(1);
  });

  it("a concurrent submit with a different quantity is print_job_conflict", async () => {
    const jobId = randomUUID();
    const [a, b] = await race(
      (tx) => productJob(tx, jobId, 3),
      (tx) => productJob(tx, jobId, 4),
      MECHANIC1,
      MECHANIC2,
    );
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, error: { code: "P0001", message: "print_job_conflict" } });
    expect(await jobCount(jobId)).toBe(1);
    expect(
      await scalar<number>(setup, "select quantity from public.print_jobs where id = $1", [jobId]),
    ).toBe(3);
  });

  it("marking a job printed and failed at once: one wins, the other is refused", async () => {
    const job = await must(committed(setup, (tx) => productJob(tx, randomUUID(), 2), MECHANIC1));
    const [a, b] = await race(
      (tx) => setJobStatus(tx, job.id, "printed"),
      (tx) => setJobStatus(tx, job.id, "failed", "Printer jammed"),
      MECHANIC1,
      MECHANIC2,
    );
    expect(a).toMatchObject({ ok: true, value: { status: "printed" } });
    expect(b).toMatchObject({
      ok: false,
      error: { code: "P0001", message: "print_job_transition_invalid" },
    });
    const { rows } = await setup.query(
      "select status::text, error, status_changed_by from public.print_jobs where id = $1",
      [job.id],
    );
    expect(rows[0]).toMatchObject({ status: "printed", error: null });
  });
});

describe.skipIf(!isolatedDatabase())("defaults under concurrency", () => {
  it("two admins making different templates default at once leave exactly one default", async () => {
    const [t1, t2] = [randomUUID(), randomUUID()];
    await must(
      committed(setup, async (tx) => {
        for (const [id, name] of [
          [t1, "Race product A"],
          [t2, "Race product B"],
        ]) {
          await tx.query(
            `insert into public.label_templates (id, name, kind, width_mm, height_mm, layout)
             values ($1, $2, 'product', 58, 40, $3::jsonb)`,
            [id, name, JSON.stringify(DEFAULT_LAYOUTS.product)],
          );
        }
      }),
    );
    const [a, b] = await race(
      (tx) => setDefaultTemplate(tx, t1),
      (tx) => setDefaultTemplate(tx, t2),
    );
    expect(a).toMatchObject({ ok: true, value: { id: t1, is_default: true } });
    expect(b).toMatchObject({ ok: true, value: { id: t2, is_default: true } });
    const { rows } = await setup.query(
      "select id from public.label_templates where kind = 'product' and is_default",
    );
    expect(rows).toEqual([{ id: t2 }]);
  });

  it("two admins making different printers default at once leave exactly one default", async () => {
    const other = randomUUID();
    await must(
      committed(setup, (tx) =>
        tx.query(
          "insert into public.printer_profiles (id, name, adapter) values ($1, 'Race browser', 'browser')",
          [other],
        ),
      ),
    );
    const [a, b] = await race(
      (tx) => setDefaultProfile(tx, PRINTER_PROFILE.pdf),
      (tx) => setDefaultProfile(tx, other),
    );
    expect(a).toMatchObject({ ok: true, value: { id: PRINTER_PROFILE.pdf, is_default: true } });
    expect(b).toMatchObject({ ok: true, value: { id: other, is_default: true } });
    const { rows } = await setup.query("select id from public.printer_profiles where is_default");
    expect(rows).toEqual([{ id: other }]);
  });
});
