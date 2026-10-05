/**
 * The financial engine and the Today dashboard (SPEC §10, §19, §23, §24;
 * DATA-MODEL §14, §16; PLAN D1, D3, D14, D15, D20, D30-D35).
 *
 * Every assertion runs on rows the test builds itself (insertJob and owner
 * inserts) on isolated past shop days (TEST_DAY) or, for today, as deltas
 * inside one transaction; nothing depends on the seed. Reporting views are
 * read directly only as the owner; staff read through the RPCs.
 *
 * Building a job takes J-/B- sequence values, so those tests skip in
 * existing-database mode; the compile, pure-function and range tests run
 * everywhere.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { isOverdue, OVERDUE_AFTER_DAYS, type WorkOrderStatus } from "@/lib/workshop";

import { JOB_FIXTURES, LINE_FIXTURES } from "../fixtures/cult-commons";
import { CUSTOMER, STAFF } from "../fixtures/ids";
import { insertAppointment, makeType } from "./appointment-fixtures";
import { actAs, connect, inTransaction, isolatedDatabase, scalar } from "./harness";
import {
  ADMIN,
  MECHANIC2,
  addPart,
  makeLocation,
  makeProduct,
  makeUniqueWithUnit,
  newJob,
  readAsOwner,
} from "./inventory-fixtures";
import {
  DAILY_SUMMARY_COLUMNS,
  FINANCIAL_LINES_COLUMNS,
  OPERATIONAL_EXCEPTIONS_COLUMNS,
  STOCK_ADJUSTMENTS_ON_COLUMNS,
  TODAY_DASHBOARD_COLUMNS,
  WORK_ORDER_ACTIVITY_ON_COLUMNS,
  WORK_ORDER_YIELD_COLUMNS,
  TEST_DAY,
  addDays,
  completedPath,
  dailySummary,
  dayRow,
  dbNow,
  insertJob,
  insertManualLineAt,
  money,
  moveJob,
  sgt,
  shopToday,
  voidLineAt,
  type DailyRow,
  type LineSpec,
} from "./reporting-fixtures";
import {
  addManualLine,
  eventTypes,
  failsWith,
  ownerMode,
  setStatus,
  voidLine,
} from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const isolated = isolatedDatabase();

/** Column names of a query's result, in order. */
async function columns(tx: pg.Client, sql: string, params: unknown[] = []): Promise<string[]> {
  const res = await tx.query(sql, params);
  return res.fields.map((f) => f.name);
}

/** A manual line spec on `day` at 09:00 SGT. */
const manual = (
  day: string,
  unitSale: string,
  unitCost: string,
  extra: Partial<LineSpec> = {},
): LineSpec => ({
  type: "manual",
  unitSale,
  unitCost,
  createdAt: sgt(day, "09:00"),
  ...extra,
});

/** A job checked in, started and completed on `day` (08:00, 08:30, `at`). */
const completedOn = (day: string, at = "15:00") => ({
  checkedInAt: sgt(day, "08:00"),
  path: completedPath(sgt(day, "08:30"), sgt(day, at)),
});

/** Owner: the financial_lines entries of one job. */
async function entriesOf(tx: pg.Client, jobId: string) {
  const { rows } = await readAsOwner(tx, () =>
    tx.query(
      `select fl.*, to_char(fl.recognized_day, 'YYYY-MM-DD') as day_key
         from reporting.financial_lines fl where fl.document_id = $1 order by fl.source_line_id`,
      [jobId],
    ),
  );
  return rows;
}

const moneyOf = (r: DailyRow) => ({
  lines: r.lines_recognised,
  gross: money(r.gross_sales),
  cogs: money(r.cogs),
  yield: money(r.yield_total),
  cc: money(r.cult_commons_share),
  after: money(r.bicii_yield_after_cc),
  lossLines: r.loss_lines,
  loss: money(r.loss_total),
});

describe("Every reporting RPC compiles and answers (DATA-MODEL §16)", () => {
  it("each of the seven RPCs answers the admin with exactly the documented columns, in order", async () => {
    await inTransaction(conn, async (tx) => {
      let jobId: string | null = null;
      if (isolated) {
        jobId = (
          await insertJob(tx, {
            ...completedOn(TEST_DAY(1)),
            lines: [manual(TEST_DAY(1), "10.00", "1.00")],
          })
        ).job.id;
      }
      await actAs(tx, ADMIN);
      expect(await columns(tx, "select * from public.daily_summary(null, null)")).toEqual([
        ...DAILY_SUMMARY_COLUMNS,
      ]);
      expect(await columns(tx, "select * from public.today_dashboard(null)")).toEqual([
        ...TODAY_DASHBOARD_COLUMNS,
      ]);
      expect(await columns(tx, "select * from public.work_order_activity_on(null)")).toEqual([
        ...WORK_ORDER_ACTIVITY_ON_COLUMNS,
      ]);
      expect(await columns(tx, "select * from public.stock_adjustments_on(null)")).toEqual([
        ...STOCK_ADJUSTMENTS_ON_COLUMNS,
      ]);
      expect(await columns(tx, "select * from public.operational_exceptions(50)")).toEqual([
        ...OPERATIONAL_EXCEPTIONS_COLUMNS,
      ]);
      expect(
        await columns(tx, "select * from public.financial_lines($1, $2)", [
          "2025-06-01",
          "2025-06-30",
        ]),
      ).toEqual([...FINANCIAL_LINES_COLUMNS]);
      if (jobId) {
        expect(await columns(tx, "select * from public.work_order_yield($1)", [jobId])).toEqual([
          ...WORK_ORDER_YIELD_COLUMNS,
        ]);
        await failsWith(
          tx,
          () => tx.query("select * from public.work_order_yield(gen_random_uuid())"),
          { code: "P0002" },
        );
      }
    });
  });
});

describe("Significant stock adjustments (D33): the rule", () => {
  const cases: Array<[string, string, number, boolean, string, boolean]> = [
    ["-6 units", "stock_adjustment", -6, false, "0", true],
    ["+5 units", "stock_adjustment", 5, false, "0", true],
    ["-1 unit", "stock_adjustment", -1, false, "0", false],
    ["-4 units costing 24.99 (99.96)", "damaged", -4, false, "24.99", false],
    ["-4 units costing 25.00 (100.00)", "damaged", -4, false, "25.00", true],
    ["a unique unit", "damaged", -1, true, "0", true],
    ["-2 x 60.00", "stock_adjustment", -2, false, "60.00", true],
    ["a job consumption of 10 is not an adjustment", "job_consumption", -10, true, "1000", false],
    ["a transfer is not an adjustment", "transfer", -50, false, "100", false],
    ["a reversal is not an adjustment", "reversal", 10, false, "100", false],
  ];
  it.each(cases)("%s", async (_name, type, delta, isUnit, cost, expected) => {
    expect(
      await scalar(conn, "select private.is_significant_adjustment($1, $2, $3, $4)", [
        type,
        delta,
        isUnit,
        cost,
      ]),
    ).toBe(expected);
  });
});

describe("Report ranges are validated", () => {
  it("daily_summary: from > to and more than 366 days raise report_range_invalid; null bounds mean today", async () => {
    await inTransaction(conn, async (tx) => {
      const today = await shopToday(tx);
      await actAs(tx, ADMIN);
      await failsWith(tx, () => dailySummary(tx, "2025-06-10", "2025-06-01"), {
        code: "P0001",
        message: "report_range_invalid",
      });
      expect(await dailySummary(tx, "2025-01-01", "2026-01-01")).toHaveLength(366);
      await failsWith(tx, () => dailySummary(tx, "2025-01-01", "2026-01-02"), {
        code: "P0001",
        message: "report_range_invalid",
      });
      expect((await dailySummary(tx, null, null)).map((r) => r.day)).toEqual([today]);
      expect((await dailySummary(tx, "2025-06-03", null)).map((r) => r.day)).toEqual([
        "2025-06-03",
      ]);
      expect((await dailySummary(tx, null, "2025-06-04")).map((r) => r.day)).toEqual([
        "2025-06-04",
      ]);
    });
  });

  it("financial_lines: 31 days pass, 32 and from > to raise; null bounds mean today", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, ADMIN);
      await tx.query("select * from public.financial_lines('2025-06-01', '2025-07-01')");
      await failsWith(
        tx,
        () => tx.query("select * from public.financial_lines('2025-06-01', '2025-07-02')"),
        {
          code: "P0001",
          message: "report_range_invalid",
        },
      );
      await failsWith(
        tx,
        () => tx.query("select * from public.financial_lines('2025-06-02', '2025-06-01')"),
        {
          code: "P0001",
          message: "report_range_invalid",
        },
      );
      await tx.query("select * from public.financial_lines(null, null)");
    });
  });

  it("today_dashboard refuses a future day", async () => {
    await inTransaction(conn, async (tx) => {
      const today = await shopToday(tx);
      await actAs(tx, ADMIN);
      await failsWith(
        tx,
        () => tx.query("select * from public.today_dashboard($1)", [addDays(today, 1)]),
        {
          code: "P0001",
          message: "report_range_invalid",
        },
      );
    });
  });
});

describe.skipIf(!isolated)("financial engine on test-built rows", () => {
  describe("Cult Commons is 30% of positive yield after direct costs, per line (SPEC §10, §31; D1)", () => {
    it.each(LINE_FIXTURES.map((f, i) => [i, f] as const))("line %i: %s", async (i, f) => {
      await inTransaction(conn, async (tx) => {
        const day = TEST_DAY(10 + i);
        const { job, lineIds } = await insertJob(tx, {
          ...completedOn(day),
          lines: [
            manual(day, f.unitSalePrice, f.unitDirectCost, { quantity: f.quantity, rate: f.rate }),
          ],
        });
        const line = (
          await tx.query(
            `select sale_total::text as sale, cost_total::text as cost, yield_total::text as yield,
                    cult_commons_share::text as cc, (yield_total - cult_commons_share)::text as after
               from public.work_order_line_items where id = $1`,
            [lineIds[0]],
          )
        ).rows[0];
        expect(line).toEqual({
          sale: f.sale,
          cost: f.cost,
          yield: f.yield,
          cc: f.cc,
          after: f.afterCc,
        });

        const [entry] = await entriesOf(tx, job.id);
        expect({
          sale: money(entry.sale_total),
          cost: money(entry.cost_total),
          yield: money(entry.yield_total),
          cc: money(entry.cult_commons_share),
          after: money(entry.bicii_yield_after_cc),
          isLoss: entry.is_loss,
          day: entry.day_key,
        }).toEqual({
          sale: f.sale,
          cost: f.cost,
          yield: f.yield,
          cc: f.cc,
          after: f.afterCc,
          isLoss: Number(f.yield) < 0,
          day,
        });

        await actAs(tx, ADMIN);
        expect(moneyOf(await dayRow(tx, day))).toEqual({
          lines: 1,
          gross: f.sale,
          cogs: f.cost,
          yield: f.yield,
          cc: f.cc,
          after: f.afterCc,
          lossLines: Number(f.yield) < 0 ? 1 : 0,
          loss: Number(f.yield) < 0 ? f.yield : "0.00",
        });
      });
    });

    it.each(JOB_FIXTURES.map((j, i) => [i, j] as const))("job %i: %s", async (i, j) => {
      await inTransaction(conn, async (tx) => {
        const day = TEST_DAY(40 + i);
        const { job } = await insertJob(tx, {
          ...completedOn(day),
          lines: j.lines.map((n) => {
            const f = LINE_FIXTURES[n];
            return manual(day, f.unitSalePrice, f.unitDirectCost, {
              quantity: f.quantity,
              rate: f.rate,
            });
          }),
        });
        await actAs(tx, ADMIN);
        const y = (await tx.query("select * from public.work_order_yield($1)", [job.id])).rows[0];
        expect({
          sale: money(y.sale_total),
          cost: money(y.cost_total),
          yield: money(y.yield_total),
          cc: money(y.cult_commons_share),
          after: money(y.bicii_yield_after_cc),
          lines: y.line_count,
        }).toEqual({
          sale: j.sale,
          cost: j.cost,
          yield: j.yield,
          cc: j.cc,
          after: j.afterCc,
          lines: j.lines.length,
        });
        const row = moneyOf(await dayRow(tx, day));
        expect([row.gross, row.cogs, row.yield, row.cc, row.after]).toEqual([
          j.sale,
          j.cost,
          j.yield,
          j.cc,
          j.afterCc,
        ]);
      });
    });

    it("the seeded loss-line job's Cult Commons is 12.00, not 7.50 (30% of the net 25.00)", async () => {
      const j = JOB_FIXTURES.find((x) => x.name.startsWith("D1 seeded loss-line job"))!;
      expect(j.cc).toBe("12.00");
      expect((Number(j.yield) * 0.3).toFixed(2)).toBe("7.50");
    });
  });

  it("Negative yield never creates a negative Cult Commons payment (SPEC §10; D32)", async () => {
    await inTransaction(conn, async (tx) => {
      const day = TEST_DAY(60);
      const { job } = await insertJob(tx, {
        ...completedOn(day),
        lines: [
          manual(day, "40.00", "0.00"),
          manual(day, "20.00", "35.00"),
          manual(day, "50.00", "80.00"),
        ],
      });
      await ownerMode(tx);
      const bad = await tx.query(
        `select fl.entry_key
           from reporting.financial_lines fl
           join public.work_order_line_items l on l.id = fl.source_line_id
          where fl.cult_commons_share < 0 or fl.cult_commons_share <> l.cult_commons_share
             or fl.is_loss <> (l.yield_total < 0)`,
      );
      expect(bad.rows).toEqual([]);
      expect(
        await scalar<number>(
          tx,
          "select count(*)::int from reporting.daily_summary where cult_commons_share < 0 or loss_total > 0",
        ),
      ).toBe(0);
      const entries = await entriesOf(tx, job.id);
      const losses = entries.filter((e) => e.is_loss);
      expect(losses).toHaveLength(2);
      for (const e of losses) expect(money(e.cult_commons_share)).toBe("0.00");
      await actAs(tx, ADMIN);
      expect(moneyOf(await dayRow(tx, day))).toMatchObject({
        cc: "12.00",
        yield: "-5.00",
        lossLines: 2,
        loss: "-45.00",
        after: "-17.00",
      });
    });
  });

  it("Reports are derived from source records, never a second truth (SPEC §19.2)", async () => {
    await inTransaction(conn, async (tx) => {
      const [d1, d2, d3, empty] = [TEST_DAY(70), TEST_DAY(71), TEST_DAY(72), TEST_DAY(74)];
      const location = await makeLocation(tx);
      const part = await makeProduct(tx, { price: "30.00", cost: "12.00" });
      const a = await insertJob(tx, {
        ...completedOn(d1),
        lines: [
          manual(d1, "120.00", "0.00"),
          {
            type: "inventory",
            productId: part,
            locationId: location,
            quantity: 2,
            unitSale: "30.00",
            unitCost: "12.00",
            createdAt: sgt(d1, "09:30"),
          },
          {
            type: "inventory",
            productId: part,
            locationId: location,
            quantity: 1,
            unitSale: "30.00",
            unitCost: "12.00",
            createdAt: sgt(d1, "10:00"),
            voidedAt: sgt(d1, "11:00"),
          },
        ],
      });
      // Checked in on d1, completed on d2, collected on d3.
      const b = await insertJob(tx, {
        checkedInAt: sgt(d1, "12:00"),
        path: [
          { status: "in_progress", at: sgt(d2, "09:00") },
          { status: "completed", at: sgt(d2, "16:00") },
          { status: "ready_for_collection", at: sgt(d2, "16:30") },
          { status: "collected", at: sgt(d3, "10:00") },
        ],
        lines: [
          { type: "service", unitSale: "80.00", unitCost: "10.00", createdAt: sgt(d2, "10:00") },
        ],
      });
      // Cancelled on d3 (no lines, D16); one open job checked in on d3.
      await insertJob(tx, {
        checkedInAt: sgt(d3, "08:00"),
        path: [{ status: "cancelled", at: sgt(d3, "09:00") }],
      });
      await insertJob(tx, {
        checkedInAt: sgt(d3, "11:00"),
        lines: [manual(d3, "55.00", "5.00", { createdAt: sgt(d3, "11:30") })],
      });

      await ownerMode(tx);
      // Appointments (D41): by scheduled day and current status. d1: one
      // booked, one no-show, one cancelled; d3: one arrived.
      const type = await makeType(tx);
      for (const [day, time, status] of [
        [d1, "10:00", "booked"],
        [d1, "11:00", "no_show"],
        [d1, "12:00", "cancelled"],
        [d3, "10:00", "arrived"],
      ] as const)
        await insertAppointment(tx, {
          customerId: CUSTOMER.daniel,
          typeId: type,
          startsAt: sgt(day, time),
          endsAt: new Date(new Date(sgt(day, time)).getTime() + 30 * 60_000).toISOString(),
          status,
        });
      expect(
        await scalar<number>(
          tx,
          "select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'reporting' and c.relkind <> 'v'",
        ),
      ).toBe(0);
      const ledger = async (day: string) =>
        (
          await tx.query<{ consumed: number; returned: number }>(
            `select coalesce(-sum(m.quantity_delta) filter (where m.movement_type = 'job_consumption'), 0)::int as consumed,
                    coalesce(sum(m.quantity_delta) filter (where m.movement_type = 'reversal' and o.movement_type = 'job_consumption'), 0)::int as returned
               from public.inventory_movements m
               left join public.inventory_movements o on o.id = m.reversal_of_id
              where (m.created_at at time zone 'Asia/Singapore')::date = $1::date`,
            [day],
          )
        ).rows[0];
      const ledgers = { [d1]: await ledger(d1), [d2]: await ledger(d2), [d3]: await ledger(d3) };
      expect(ledgers[d1]).toEqual({ consumed: 3, returned: 1 });

      await actAs(tx, ADMIN);
      const rows = await dailySummary(tx, d1, empty);
      const entries = (await tx.query("select * from public.financial_lines($1, $2)", [d1, empty]))
        .rows;
      for (const r of rows) {
        const mine = entries.filter((e) => dayKey(e.recognized_day) === r.day);
        const sum = (k: string) => money(mine.reduce((s, e) => s + Number(e[k]), 0));
        expect(moneyOf(r)).toEqual({
          lines: mine.length,
          gross: sum("sale_total"),
          cogs: sum("cost_total"),
          yield: sum("yield_total"),
          cc: sum("cult_commons_share"),
          after: sum("bicii_yield_after_cc"),
          lossLines: mine.filter((e) => e.is_loss).length,
          loss: money(mine.filter((e) => e.is_loss).reduce((s, e) => s + Number(e.yield_total), 0)),
        });
        const activity = (
          await tx.query("select * from public.work_order_activity_on($1)", [r.day])
        ).rows;
        const flag = (k: string) => activity.filter((x) => x[k]).length;
        expect({
          in: r.jobs_checked_in,
          started: r.jobs_started,
          completed: r.jobs_completed,
          ready: r.jobs_ready_for_collection,
          collected: r.jobs_collected,
          cancelled: r.jobs_cancelled,
        }).toEqual({
          in: flag("checked_in_on_day"),
          started: flag("started_on_day"),
          completed: flag("completed_on_day"),
          ready: flag("ready_on_day"),
          collected: flag("collected_on_day"),
          cancelled: flag("cancelled_on_day"),
        });
        if (ledgers[r.day]) {
          expect([r.parts_consumed_qty, r.parts_returned_qty]).toEqual([
            ledgers[r.day].consumed,
            ledgers[r.day].returned,
          ]);
        }
        // D41: the appointment columns are integers equal to
        // appointment_daily's booked / arrived / no_shows (0 on days without
        // appointments); Phase 6's columns are still NULL.
        const counts = (
          await tx.query<{ booked: number; arrived: number; no_shows: number }>(
            "select booked, arrived, no_shows from public.appointment_daily($1, $1)",
            [r.day],
          )
        ).rows[0];
        expect({
          day: r.day,
          scheduled: r.appointments_scheduled,
          arrived: r.appointments_arrived,
          noShow: r.appointments_no_show,
        }).toEqual({
          day: r.day,
          scheduled: counts.booked,
          arrived: counts.arrived,
          noShow: counts.no_shows,
        });
        for (const p of ["appointments_scheduled", "appointments_arrived", "appointments_no_show"])
          expect(Number.isInteger(r[p])).toBe(true);
        for (const p of ["consignment_sales", "consignment_sales_total", "new_consignor_liability"])
          expect(r[p]).toBeNull();
      }
      const byDay = Object.fromEntries(rows.map((r) => [r.day, r]));
      expect(byDay[d1]).toMatchObject({
        appointments_scheduled: 2,
        appointments_arrived: 0,
        appointments_no_show: 1,
      });
      expect(byDay[d3]).toMatchObject({
        appointments_scheduled: 1,
        appointments_arrived: 1,
        appointments_no_show: 0,
      });
      expect(byDay[empty]).toMatchObject({
        appointments_scheduled: 0,
        appointments_arrived: 0,
        appointments_no_show: 0,
      });
      expect(byDay[d1]).toMatchObject({
        jobs_checked_in: 2,
        jobs_completed: 1,
        parts_consumed_qty: 3,
        parts_consumed_lines: 2,
        parts_returned_qty: 1,
      });
      expect(byDay[d2]).toMatchObject({
        jobs_started: 1,
        jobs_completed: 1,
        jobs_ready_for_collection: 1,
      });
      expect(byDay[d3]).toMatchObject({
        jobs_checked_in: 2,
        jobs_collected: 1,
        jobs_cancelled: 1,
        lines_recognised: 0,
      });
      expect(byDay[empty]).toMatchObject({
        jobs_checked_in: 0,
        jobs_completed: 0,
        lines_recognised: 0,
        parts_consumed_qty: 0,
        stock_adjustments: 0,
      });
      expect(moneyOf(byDay[empty])).toMatchObject({ gross: "0.00", cogs: "0.00", cc: "0.00" });

      for (const job of [a.job, b.job]) {
        const sums = (
          await tx.query(
            `select count(*)::int as n, sum(sale_total) as sale, sum(cost_total) as cost, sum(yield_total) as yield,
                    sum(cult_commons_share) as cc, sum(bicii_yield_after_cc) as after
               from public.financial_lines($1, $2) where document_id = $3`,
            [d1, empty, job.id],
          )
        ).rows[0];
        const staffTotals = (
          await tx.query("select * from public.work_order_totals_staff where work_order_id = $1", [
            job.id,
          ])
        ).rows[0];
        const y = (await tx.query("select * from public.work_order_yield($1)", [job.id])).rows[0];
        for (const t of [staffTotals, y]) {
          expect([
            sums.n,
            money(sums.sale),
            money(sums.cost),
            money(sums.yield),
            money(sums.cc),
            money(sums.after),
          ]).toEqual([
            t.line_count,
            money(t.sale_total),
            money(t.cost_total),
            money(t.yield_total),
            money(t.cult_commons_share),
            money(t.bicii_yield_after_cc),
          ]);
        }
      }
    });
  });

  it("Historical snapshots do not change with catalog edits (SPEC §23)", async () => {
    await inTransaction(conn, async (tx) => {
      const day = TEST_DAY(80);
      const { job, lines } = await insertJob(tx, {
        ...completedOn(day),
        lines: [
          {
            type: "service",
            unitSale: "90.00",
            unitCost: "15.00",
            createdAt: sgt(day, "09:00"),
            description: "Full Service",
          },
          {
            type: "inventory",
            quantity: 2,
            unitSale: "25.00",
            unitCost: "11.00",
            createdAt: sgt(day, "09:10"),
          },
        ],
      });
      await actAs(tx, ADMIN);
      const before = await dayRow(tx, day);
      const entriesBefore = (await tx.query("select * from public.financial_lines($1, $1)", [day]))
        .rows;
      expect(entriesBefore).toHaveLength(2);

      await ownerMode(tx);
      await tx.query(
        "update public.services set default_sale_price = 500, default_direct_cost = 200, name = 'Renamed' where id = $1",
        [lines[0].serviceId],
      );
      await tx.query(
        "update public.products set default_sale_price = 999, default_direct_cost = 444 where id = $1",
        [lines[1].productId],
      );
      await tx.query(
        "update public.services set archived_at = now(), active = false where id = $1",
        [lines[0].serviceId],
      );

      await actAs(tx, ADMIN);
      expect(await dayRow(tx, day)).toEqual(before);
      const entriesAfter = (await tx.query("select * from public.financial_lines($1, $1)", [day]))
        .rows;
      expect(entriesAfter).toEqual(entriesBefore);
      const service = entriesAfter.find((e) => e.line_type === "service");
      expect(service).toMatchObject({
        description: "Full Service",
        service_id: lines[0].serviceId,
        document_id: job.id,
      });
    });
  });

  it("Only completed jobs are recognised, on their completion day (D3; D32)", async () => {
    await inTransaction(conn, async (tx) => {
      const [d1, d2, d3, d4] = [TEST_DAY(90), TEST_DAY(91), TEST_DAY(92), TEST_DAY(93)];
      const open = await insertJob(tx, {
        checkedInAt: sgt(d1, "08:00"),
        lines: [manual(d1, "70.00", "0.00")],
      });
      const cancelled = await insertJob(tx, {
        checkedInAt: sgt(d1, "08:00"),
        lines: [manual(d1, "30.00", "0.00", { voidedAt: sgt(d1, "09:30") })],
        path: [{ status: "cancelled", at: sgt(d1, "10:00") }],
      });
      const withVoid = await insertJob(tx, {
        ...completedOn(d1),
        lines: [
          manual(d1, "40.00", "0.00"),
          manual(d1, "99.00", "0.00", { voidedAt: sgt(d1, "10:00") }),
        ],
      });
      const late = await insertJob(tx, {
        checkedInAt: sgt(d2, "08:00"),
        lines: [manual(d2, "60.00", "10.00")],
        path: completedPath(sgt(d2, "09:00"), sgt(d3, "11:00")),
      });
      const before = await insertJob(tx, {
        checkedInAt: sgt(d3, "08:00"),
        lines: [manual(d3, "10.00", "0.00")],
        path: completedPath(sgt(d3, "09:00"), sgt(d3, "23:59")),
      });
      const after = await insertJob(tx, {
        checkedInAt: sgt(d3, "08:00"),
        lines: [manual(d3, "20.00", "0.00")],
        path: completedPath(sgt(d3, "09:00"), sgt(d4, "00:01")),
      });

      expect(await entriesOf(tx, open.job.id)).toEqual([]);
      expect(await entriesOf(tx, cancelled.job.id)).toEqual([]);
      const voided = await entriesOf(tx, withVoid.job.id);
      expect(voided.map((e) => e.source_line_id)).toEqual([withVoid.lineIds[0]]);
      expect((await entriesOf(tx, late.job.id)).map((e) => e.day_key)).toEqual([d3]);
      expect((await entriesOf(tx, before.job.id)).map((e) => e.day_key)).toEqual([d3]);
      expect((await entriesOf(tx, after.job.id)).map((e) => e.day_key)).toEqual([d4]);

      await actAs(tx, ADMIN);
      const rows = Object.fromEntries((await dailySummary(tx, d1, d4)).map((r) => [r.day, r]));
      expect(moneyOf(rows[d1])).toMatchObject({ lines: 1, gross: "40.00" });
      expect(moneyOf(rows[d2])).toMatchObject({ lines: 0, gross: "0.00" });
      expect(moneyOf(rows[d3])).toMatchObject({ lines: 2, gross: "70.00" });
      expect(moneyOf(rows[d4])).toMatchObject({ lines: 1, gross: "20.00" });
      expect(rows[d1]).toMatchObject({ jobs_cancelled: 1, jobs_completed: 1, jobs_checked_in: 3 });
    });
  });

  it("A completed job's lines are frozen (D15/D16, which D32 relies on): work_order_locked", async () => {
    await inTransaction(conn, async (tx) => {
      const day = TEST_DAY(95);
      const paths: Record<string, WorkOrderStatus[]> = {
        completed: ["completed"],
        ready_for_collection: ["completed", "ready_for_collection"],
        collected: ["completed", "collected"],
      };
      for (const [name, tail] of Object.entries(paths)) {
        const { job, lineIds } = await insertJob(tx, {
          checkedInAt: sgt(day, "08:00"),
          lines: [manual(day, "10.00", "0.00")],
          path: [
            { status: "in_progress", at: sgt(day, "08:30") },
            ...tail.map((status, i) => ({ status, at: sgt(day, `1${i}:00`) })),
          ],
        });
        expect(job.status).toBe(name);
        await actAs(tx, ADMIN);
        await failsWith(tx, () => addManualLine(tx, { workOrderId: job.id, price: "5.00" }), {
          code: "P0001",
          message: "work_order_locked",
        });
        await failsWith(tx, () => voidLine(tx, lineIds[0], "Mistake"), {
          code: "P0001",
          message: "work_order_locked",
        });
        await ownerMode(tx);
        await failsWith(
          tx,
          () =>
            insertManualLineAt(tx, job.id, {
              unitSale: "5.00",
              unitCost: "0.00",
              createdAt: sgt(day, "20:00"),
            }),
          { code: "P0001", message: "work_order_locked" },
        );
        await failsWith(tx, () => voidLineAt(tx, lineIds[0], sgt(day, "20:00")), {
          code: "P0001",
          message: "work_order_locked",
        });
      }
    });
  });

  it("A reopen restates the completion day (D32; D15)", async () => {
    await inTransaction(conn, async (tx) => {
      const [d3, d4, d5] = [TEST_DAY(103), TEST_DAY(104), TEST_DAY(105)];
      const { job, lineIds } = await insertJob(tx, {
        ...completedOn(d3, "12:00"),
        lines: [manual(d3, "100.00", "20.00"), manual(d3, "50.00", "0.00")],
      });
      await actAs(tx, ADMIN);
      const completedDay = await dayRow(tx, d3);
      expect(completedDay.jobs_completed).toBe(1);
      expect(moneyOf(completedDay)).toMatchObject({ lines: 2, gross: "150.00", cc: "39.00" });

      await moveJob(tx, job.id, "in_progress", sgt(d4, "09:00"), "Customer reported a creak");
      const restated = await dayRow(tx, d3);
      expect(restated.jobs_completed).toBe(0);
      expect(restated.jobs_checked_in).toBe(1);
      expect(moneyOf(restated)).toMatchObject({
        lines: 0,
        gross: "0.00",
        cogs: "0.00",
        cc: "0.00",
      });
      expect(await entriesOf(tx, job.id)).toEqual([]);

      await voidLineAt(tx, lineIds[1], sgt(d4, "10:00"));
      const added = await insertManualLineAt(tx, job.id, {
        unitSale: "30.00",
        unitCost: "5.00",
        createdAt: sgt(d4, "11:00"),
      });
      const done = await moveJob(tx, job.id, "completed", sgt(d5, "15:00"));
      expect(done.started_at).toEqual(job.started_at);

      const entries = await entriesOf(tx, job.id);
      expect(entries.map((e) => e.source_line_id).sort()).toEqual([lineIds[0], added].sort());
      expect(entries.every((e) => e.day_key === d5)).toBe(true);
      const final = await dayRow(tx, d5);
      expect(final.jobs_completed).toBe(1);
      expect(moneyOf(final)).toMatchObject({
        lines: 2,
        gross: "130.00",
        cogs: "25.00",
        cc: "31.50",
      });
      expect(moneyOf(await dayRow(tx, d3))).toMatchObject({ lines: 0 });
      const types = await eventTypes(tx, job.id);
      expect(types.filter((t) => t === "completed")).toHaveLength(2);
      expect(types.filter((t) => t === "reopened")).toHaveLength(1);
    });
  });

  it("Completion recognises once (replay): a repeated completion returns the row unchanged", async () => {
    await inTransaction(conn, async (tx) => {
      const day = TEST_DAY(110);
      const { job } = await insertJob(tx, {
        ...completedOn(day),
        lines: [manual(day, "40.00", "0.00"), manual(day, "20.00", "35.00")],
      });
      const eventsBefore = (await eventTypes(tx, job.id)).length;
      await actAs(tx, ADMIN);
      const again = await setStatus(tx, job.id, "completed");
      expect(again.completed_at).toEqual(job.completed_at);
      expect(again.status_changed_at).toEqual(job.status_changed_at);
      expect((await eventTypes(tx, job.id)).length).toBe(eventsBefore);
      expect(await entriesOf(tx, job.id)).toHaveLength(2);
      expect(moneyOf(await dayRow(tx, day))).toMatchObject({
        lines: 2,
        gross: "60.00",
        cc: "12.00",
      });
    });
  });

  it("Shop-day boundaries are Asia/Singapore (SPEC §24; D35)", async () => {
    await inTransaction(conn, async (tx) => {
      const early = await insertJob(tx, {
        checkedInAt: "2025-06-01T01:00:00Z",
        lines: [
          {
            type: "manual",
            unitSale: "10.00",
            unitCost: "0.00",
            createdAt: "2025-06-01T02:00:00Z",
          },
        ],
        path: completedPath("2025-06-01T03:00:00Z", "2025-06-01T15:59:59Z"),
      });
      const late = await insertJob(tx, {
        checkedInAt: "2025-06-01T01:00:00Z",
        lines: [
          {
            type: "manual",
            unitSale: "20.00",
            unitCost: "0.00",
            createdAt: "2025-06-01T02:00:00Z",
          },
        ],
        path: completedPath("2025-06-01T03:00:00Z", "2025-06-01T16:00:00Z"),
      });
      expect((await entriesOf(tx, early.job.id)).map((e) => e.day_key)).toEqual(["2025-06-01"]);
      expect((await entriesOf(tx, late.job.id)).map((e) => e.day_key)).toEqual(["2025-06-02"]);

      await ownerMode(tx);
      expect(
        await scalar<boolean>(
          tx,
          "select private.shop_today() = (now() at time zone 'Asia/Singapore')::date",
        ),
      ).toBe(true);
      expect(await scalar<string>(tx, "select private.shop_day_start('2025-06-02')::text")).toMatch(
        /^2025-06-01 16:00:00\+00|^2025-06-02 00:00:00\+08/,
      );
      // No Phase 5 definition uses current_date.
      const views = await tx.query(
        "select viewname from pg_views where schemaname = 'reporting' and definition ilike '%current_date%'",
      );
      expect(views.rows).toEqual([]);
      const fns = await tx.query(
        `select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'private')
            and p.proname in ('shop_timezone', 'shop_currency', 'shop_day', 'shop_today', 'shop_day_start',
                              'is_significant_adjustment', 'daily_summary', 'today_dashboard',
                              'work_order_activity_on', 'stock_adjustments_on', 'operational_exceptions',
                              'financial_lines', 'work_order_yield')
            and pg_get_functiondef(p.oid) ilike '%current_date%'`,
      );
      expect(fns.rows).toEqual([]);

      await actAs(tx, ADMIN);
      const results: unknown[] = [];
      for (const zone of [null, "UTC", "America/Los_Angeles"]) {
        if (zone) await tx.query(`set local timezone = '${zone}'`);
        const rows = await dailySummary(tx, "2025-06-01", "2025-06-02");
        const entries = (
          await tx.query(
            "select source_line_id, to_char(recognized_day, 'YYYY-MM-DD') as day from public.financial_lines('2025-06-01', '2025-06-02') order by 1",
          )
        ).rows;
        results.push({ days: rows.map((r) => [r.day, r.jobs_completed, moneyOf(r)]), entries });
      }
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
      const [first] = results as Array<{
        days: Array<[string, number, ReturnType<typeof moneyOf>]>;
      }>;
      expect(first.days.map(([d, n, m]) => [d, n, m.gross])).toEqual([
        ["2025-06-01", 1, "10.00"],
        ["2025-06-02", 1, "20.00"],
      ]);
    });
  });

  it("Cost-pending lines are recognised and flagged (D14; D32)", async () => {
    await inTransaction(conn, async (tx) => {
      const day = TEST_DAY(115);
      const { job, lineIds } = await insertJob(tx, {
        ...completedOn(day),
        lines: [manual(day, "45.00", "0.00", { costPending: true }), manual(day, "10.00", "4.00")],
      });
      const entries = await entriesOf(tx, job.id);
      const pending = entries.find((e) => e.source_line_id === lineIds[0]);
      expect(pending).toMatchObject({ cost_pending: true });
      expect(money(pending.cost_total)).toBe("0.00");
      expect(money(pending.cult_commons_share)).toBe("13.50");
      expect(entries.find((e) => e.source_line_id === lineIds[1]).cost_pending).toBe(false);
      await actAs(tx, ADMIN);
      expect(
        (await tx.query("select cost_pending_lines from public.today_dashboard($1)", [day]))
          .rows[0],
      ).toEqual({ cost_pending_lines: 1 });
      expect(
        (await tx.query("select cost_pending_count from public.work_order_yield($1)", [job.id]))
          .rows[0],
      ).toEqual({ cost_pending_count: 1 });
      expect(moneyOf(await dayRow(tx, day))).toMatchObject({
        lines: 2,
        gross: "55.00",
        cogs: "4.00",
      });
    });
  });

  it("Today shows flows for the day and the current snapshot (D31)", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, ADMIN);
      const before = (await tx.query("select * from public.today_dashboard(null)")).rows[0];
      expect(before.is_today).toBe(true);

      // Four instants inside today's shop day, before now().
      const { rows: t } = await readAsOwner(tx, () =>
        tx.query<{ a: string; b: string; c: string; d: string }>(
          `select to_char((s + (now() - s) * 0.2) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as a,
                  to_char((s + (now() - s) * 0.4) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as b,
                  to_char((s + (now() - s) * 0.6) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as c,
                  to_char((s + (now() - s) * 0.8) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as d
             from (select private.shop_day_start(private.shop_today()) as s) x`,
        ),
      );
      await insertJob(tx, {
        checkedInAt: t[0].a,
        lines: [{ type: "manual", unitSale: "70.00", unitCost: "7.00", createdAt: t[0].b }],
        path: completedPath(t[0].c, t[0].d),
      });
      const after = (await tx.query("select * from public.today_dashboard(null)")).rows[0];
      expect({
        in: after.jobs_checked_in - before.jobs_checked_in,
        started: after.jobs_started - before.jobs_started,
        completed: after.jobs_completed - before.jobs_completed,
        ready: after.jobs_ready_for_collection - before.jobs_ready_for_collection,
        collected: after.jobs_collected - before.jobs_collected,
        lines: after.lines_recognised - before.lines_recognised,
        gross: money(Number(after.gross_sales) - Number(before.gross_sales)),
        cc: money(Number(after.cult_commons_share) - Number(before.cult_commons_share)),
        awaiting: after.awaiting_collection_now - before.awaiting_collection_now,
      }).toEqual({
        in: 1,
        started: 1,
        completed: 1,
        ready: 0,
        collected: 0,
        lines: 1,
        gross: "70.00",
        cc: "18.90",
        awaiting: 1,
      });

      const direct = await readAsOwner(tx, async () => {
        const s = (
          await tx.query(
            `select count(*) filter (where status in ('received', 'diagnosing'))::int as received_now,
                    count(*) filter (where status in ('awaiting_customer', 'awaiting_parts', 'paused'))::int as waiting_now,
                    count(*) filter (where status = 'ready_to_start')::int as ready_to_start_now,
                    count(*) filter (where status = 'in_progress')::int as in_progress_now,
                    count(*) filter (where status in ('completed', 'ready_for_collection'))::int as awaiting_collection_now,
                    count(*) filter (where status not in ('completed', 'ready_for_collection', 'collected', 'cancelled'))::int as open_jobs_now
               from public.work_orders`,
          )
        ).rows[0];
        const now = (await tx.query<{ t: Date }>("select now() as t")).rows[0].t;
        const overdue = (
          await tx.query("select status::text, checked_in_at from public.work_orders")
        ).rows.filter((r) =>
          isOverdue({ status: r.status, checkedInAt: r.checked_in_at }, now),
        ).length;
        const low = await scalar<number>(tx, "select count(*)::int from reporting.low_stock");
        return { ...s, overdue_now: overdue, low_stock_now: low };
      });
      expect(after).toMatchObject(direct);

      const today = await shopToday(tx);
      const past = (
        await tx.query("select * from public.today_dashboard($1)", [addDays(today, -2)])
      ).rows[0];
      expect(past.is_today).toBe(false);
      for (const k of TODAY_DASHBOARD_COLUMNS.filter((c) => c.endsWith("_now")))
        expect(past[k]).toBeNull();
      await failsWith(
        tx,
        () => tx.query("select * from public.today_dashboard($1)", [addDays(today, 1)]),
        {
          code: "P0001",
          message: "report_range_invalid",
        },
      );
    });
  });

  it("Significant stock adjustments (D33): every manual stock adjustment records actor, timestamp and reason", async () => {
    await inTransaction(conn, async (tx) => {
      const day = TEST_DAY(120);
      const location = await makeLocation(tx);
      const product = await makeProduct(tx, { cost: "60.00" });
      const cheap = await makeProduct(tx, { cost: "8.00" });
      const unique = await makeProduct(tx, { tracking: "unique", cost: null });
      const unit = (
        await tx.query<{ id: string }>(
          "insert into public.inventory_units (product_id, location_id) values ($1, $2) returning id",
          [unique, location],
        )
      ).rows[0].id;
      const insert = (
        p: string,
        delta: number,
        type: string,
        at: string,
        unitCost: string | null,
        unitId: string | null = null,
      ) =>
        tx.query<{ id: string }>(
          `insert into public.inventory_movements
             (product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason, unit_cost_snapshot, created_by, created_at)
           values ($1, $2, $3, $4, $5, 'Counted on the shelf', $6, $7, $8) returning id::text`,
          [p, unitId, location, delta, type, unitCost, STAFF.admin, at],
        );
      const big = (await insert(product, 10, "stock_adjustment", sgt(day, "09:00"), "60.00"))
        .rows[0].id; // |10| >= 5
      const two = (await insert(product, -2, "damaged", sgt(day, "10:00"), null)).rows[0].id; // 2 x 60.00 = 120.00
      const one = (await insert(cheap, -1, "damaged", sgt(day, "11:00"), null)).rows[0].id; // 8.00
      const u = (await insert(unique, -1, "stock_adjustment", sgt(day, "12:00"), null, unit))
        .rows[0].id; // a unit
      await insert(cheap, 4, "stock_adjustment", sgt(day, "00:00"), "8.00"); // the day's first instant
      await insert(cheap, 3, "stock_adjustment", sgt(day, "23:59:59"), "8.00"); // its last second
      await insert(cheap, 2, "stock_adjustment", sgt(addDays(day, -1), "23:59:59"), "8.00"); // the day before
      await insert(cheap, 2, "stock_adjustment", sgt(addDays(day, 1), "00:00"), "8.00"); // the day after
      const admin = await scalar<string>(
        tx,
        "select display_name from public.staff where id = $1",
        [STAFF.admin],
      );

      await actAs(tx, MECHANIC2);
      const m2 = (await tx.query("select * from public.stock_adjustments_on($1)", [day])).rows;
      expect(m2.map((r) => r.movement_id)).toHaveLength(6);
      expect(m2.every((r) => r.value_at_cost === null)).toBe(true);
      const sig = Object.fromEntries(m2.map((r) => [r.movement_id, r.significant]));
      expect([sig[big], sig[two], sig[one], sig[u]]).toEqual([true, true, false, true]);
      expect(m2.every((r) => r.actor_name === admin && r.reason === "Counted on the shelf")).toBe(
        true,
      );
      expect(m2[0].created_at.getTime()).toBeGreaterThanOrEqual(m2[1].created_at.getTime());
      expect(
        (
          await tx.query(
            "select significant_stock_adjustments, stock_adjustments from public.daily_summary($1, $1)",
            [day],
          )
        ).rows[0],
      ).toEqual({ significant_stock_adjustments: 3, stock_adjustments: 6 });

      await actAs(tx, ADMIN);
      const a = Object.fromEntries(
        (
          await tx.query("select movement_id, value_at_cost from public.stock_adjustments_on($1)", [
            day,
          ])
        ).rows.map((r) => [r.movement_id, money(r.value_at_cost)]),
      );
      expect([a[big], a[two], a[one], a[u]]).toEqual(["600.00", "120.00", "8.00", "0.00"]);
    });
  });

  it("Operational exceptions (D34; D20): the 7-day overdue boundary, uncollected, negative stock, stale holds, currency", async () => {
    await inTransaction(conn, async (tx) => {
      const today = await shopToday(tx);
      const exact = await insertJob(tx, {
        checkedInAt: await dbNow(tx, `-${OVERDUE_AFTER_DAYS} days`),
      });
      const past = await insertJob(tx, {
        checkedInAt: await dbNow(tx, `-${OVERDUE_AFTER_DAYS} days -1 second`),
      });
      const doneLongAgo = await insertJob(tx, {
        checkedInAt: await dbNow(tx, "-30 days"),
        path: [
          ...completedPath(await dbNow(tx, "-29 days"), await dbNow(tx, "-28 days")),
          { status: "collected", at: await dbNow(tx, "-27 days") },
        ],
      });
      const uncollected = await insertJob(tx, {
        checkedInAt: sgt(addDays(today, -9), "09:00"),
        path: [
          ...completedPath(sgt(addDays(today, -8), "09:00"), sgt(addDays(today, -7), "12:00")),
          { status: "ready_for_collection", at: sgt(addDays(today, -7), "13:00") },
        ],
      });
      const recent = await insertJob(tx, {
        checkedInAt: sgt(addDays(today, -8), "09:00"),
        path: completedPath(sgt(addDays(today, -7), "09:00"), sgt(addDays(today, -6), "12:00")),
      });
      const location = await makeLocation(tx);
      const negative = await makeProduct(tx);
      await tx.query(
        `insert into public.inventory_movements (product_id, location_id, quantity_delta, movement_type, reason)
         values ($1, $2, -3, 'stock_adjustment', 'Forced below zero by the test')`,
        [negative, location],
      );
      const stale = await makeProduct(tx, { tracking: "unique" });
      const staleUnit = (
        await tx.query<{ id: string }>(
          "insert into public.inventory_units (product_id, location_id) values ($1, $2) returning id",
          [stale, location],
        )
      ).rows[0].id;
      await tx.query(
        "update public.inventory_units set status = 'held_for_customer' where id = $1",
        [staleUnit],
      );
      const held = await makeUniqueWithUnit(tx);
      const job = await newJob(tx);
      await addPart(tx, { workOrderId: job.id, productId: held.productId, unitId: held.unitId });
      await ownerMode(tx);
      const usd = await insertJob(tx, {
        currency: "USD",
        ...completedOn(TEST_DAY(130)),
        lines: [manual(TEST_DAY(130), "25.00", "0.00")],
      });

      // work_order_activity.is_overdue agrees with isOverdue (D20) for the same rows.
      const now = new Date((await tx.query<{ t: string }>("select now() as t")).rows[0].t);
      const activity = (
        await tx.query(
          "select work_order_id, status::text, checked_in_at, is_overdue from reporting.work_order_activity where work_order_id = any($1)",
          [[exact.job.id, past.job.id, doneLongAgo.job.id, uncollected.job.id, recent.job.id]],
        )
      ).rows;
      expect(activity).toHaveLength(5);
      for (const r of activity)
        expect(r.is_overdue).toBe(
          isOverdue({ status: r.status, checkedInAt: r.checked_in_at }, now),
        );
      const overdueIds = activity.filter((r) => r.is_overdue).map((r) => r.work_order_id);
      expect(overdueIds).toEqual([past.job.id]);

      await actAs(tx, ADMIN);
      const rows = (await tx.query("select * from public.operational_exceptions(200)")).rows;
      const of = (id: string) => rows.filter((r) => r.entity_id === id);
      expect(of(exact.job.id)).toEqual([]);
      expect(of(past.job.id)).toMatchObject([
        {
          kind: "overdue_job",
          severity: "warning",
          entity_type: "work_order",
          entity_label: past.job.job_number,
          days: OVERDUE_AFTER_DAYS,
        },
      ]);
      expect(of(doneLongAgo.job.id)).toEqual([]);
      expect(of(uncollected.job.id)).toMatchObject([
        { kind: "uncollected_job", severity: "warning", days: 7 },
      ]);
      expect(of(recent.job.id)).toEqual([]);
      expect(of(negative)).toMatchObject([
        { kind: "negative_stock", severity: "danger", entity_type: "product", quantity: -3 },
      ]);
      expect(of(negative)[0].subject_label).toContain(" · Loc ");
      expect(of(staleUnit)).toMatchObject([
        { kind: "unit_hold_stale", severity: "danger", entity_type: "inventory_unit" },
      ]);
      expect(of(held.unitId)).toEqual([]);
      expect(of(usd.lineIds[0])).toMatchObject([
        {
          kind: "currency_mismatch",
          severity: "danger",
          entity_type: "work_order_line",
          entity_label: usd.job.job_number,
        },
      ]);
      // Danger first, then oldest.
      const firstWarning = rows.findIndex((r) => r.severity === "warning");
      expect(rows.slice(firstWarning).every((r) => r.severity === "warning")).toBe(true);
      // The USD line is excluded from totals (D35).
      expect(moneyOf(await dayRow(tx, TEST_DAY(130)))).toMatchObject({ lines: 0, gross: "0.00" });
      const dash = (await tx.query("select exceptions_now from public.today_dashboard(null)"))
        .rows[0];
      expect(dash.exceptions_now).toBe(rows.length);

      // max_rows is clamped to 1..200.
      expect((await tx.query("select * from public.operational_exceptions(0)")).rows).toHaveLength(
        1,
      );
      expect((await tx.query("select * from public.operational_exceptions(-5)")).rows).toHaveLength(
        1,
      );
      await ownerMode(tx);
      await tx.query(
        `with p as (
           insert into public.products (name, tracking_type, default_sale_price, default_direct_cost)
           select 'Bulk negative ' || g, 'quantity', 1, 1 from generate_series(1, 205) g returning id
         )
         insert into public.inventory_movements (product_id, location_id, quantity_delta, movement_type, reason)
         select p.id, $1, -1, 'stock_adjustment', 'Forced below zero by the test' from p`,
        [location],
      );
      await actAs(tx, ADMIN);
      expect(
        (await tx.query("select * from public.operational_exceptions(1000)")).rows,
      ).toHaveLength(200);
      expect(
        (await tx.query("select * from public.operational_exceptions(null)")).rows,
      ).toHaveLength(50);
    });
  });
});

/** A pg date (parsed as a local Date) as 'YYYY-MM-DD'. */
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
