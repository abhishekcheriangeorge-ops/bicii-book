/**
 * The seeded shop history reconciles (SPEC §10, §19.2, §23; DATA-MODEL §18
 * "Phase 5 part"; PLAN D1, D20, D31-D34; TESTING.md "Seed data").
 *
 * Every expected figure is in tests/fixtures/reporting.ts, written by hand
 * from supabase/seed.sql. Days are counted back from the seed's anchor
 * (seedToday(): the shop day `db:reset` ran), never from shop_today() or
 * open bounds, so the file holds on an old seed too. Assertions that need
 * the anchor to be today (today_dashboard(null), the *_now snapshot, the
 * exceptions) compare the two first and skip with a message when they
 * differ. Reporting views are read directly only as the owner; staff read
 * through the RPCs.
 *
 * Reads only (every test rolls back), so it also runs against an existing
 * seeded database.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { INVENTORY_JOB, REPORT_JOB, REPORT_PRODUCT, STAFF, WORK_ORDER } from "../fixtures/ids";
import {
  DAY_MONEY_COLUMNS,
  ROUNDING_JOB,
  SEED_ADJUSTMENTS,
  SEED_DAYS,
  SEED_DAY_NUMBERS,
  SEED_EXCEPTIONS,
  SEED_SNAPSHOT,
  SPEC_EXAMPLE_JOBS,
  type JobExpectation,
} from "../fixtures/reporting";
import { asStaff, connect, inTransaction, isolatedDatabase } from "./harness";
import { readAsOwner } from "./inventory-fixtures";
import {
  DAILY_SUMMARY_COLUMNS,
  SNAPSHOT_COLUMNS,
  addDays,
  dailySummary,
  money,
  seedToday,
  shopToday,
  type DailyRow,
} from "./reporting-fixtures";

let conn: pg.Client;
let anchor: string;
let anchorIsToday: boolean;

beforeAll(async () => {
  conn = await connect();
  anchor = await seedToday(conn);
  anchorIsToday = anchor === (await shopToday(conn));
});

const SKIP_NOT_TODAY = () =>
  `the seed's anchor (${anchor}) is not the shop's today: run \`npm run db:reset\` to re-anchor it`;

/** Every seeded job: Phase 3's nine, Phase 4's inventory job, Phase 5's eleven. */
const SEEDED_JOBS = [
  ...Object.values(WORK_ORDER),
  INVENTORY_JOB.id,
  ...Object.values(REPORT_JOB),
] as string[];

const P5_JOBS = Object.values(REPORT_JOB) as string[];
const P5_PRODUCTS = Object.values(REPORT_PRODUCT) as string[];

const day = (n: number) => addDays(anchor, -n);

type Entry = {
  document_id: string;
  recognized_day: string;
  source_line_id: string;
  sale_total: string;
  cost_total: string;
  yield_total: string;
  cult_commons_share: string;
  bicii_yield_after_cc: string;
  is_loss: boolean;
};

/** public.financial_lines(from, to) as `tx` (admin: every column). */
async function entries(tx: pg.Client, from: string, to: string): Promise<Entry[]> {
  const { rows } = await tx.query<Entry>(
    `select document_id, to_char(recognized_day, 'YYYY-MM-DD') as recognized_day, source_line_id,
            sale_total, cost_total, yield_total, cult_commons_share, bicii_yield_after_cc, is_loss
       from public.financial_lines($1::date, $2::date)`,
    [from, to],
  );
  return rows;
}

/** Sums of entries as fixed-2 strings, with the loss count and total. */
function totals(list: Entry[]) {
  const sum = (k: keyof Entry) => list.reduce((acc, e) => acc + Math.round(Number(e[k]) * 100), 0);
  const losses = list.filter((e) => e.is_loss);
  return {
    line_count: list.length,
    sale_total: (sum("sale_total") / 100).toFixed(2),
    cost_total: (sum("cost_total") / 100).toFixed(2),
    yield_total: (sum("yield_total") / 100).toFixed(2),
    cult_commons_share: (sum("cult_commons_share") / 100).toFixed(2),
    bicii_yield_after_cc: (sum("bicii_yield_after_cc") / 100).toFixed(2),
    loss_line_count: losses.length,
    loss_total: (
      losses.reduce((a, e) => a + Math.round(Number(e.yield_total) * 100), 0) / 100
    ).toFixed(2),
  };
}

const jobFigures = (j: JobExpectation) => ({
  line_count: j.line_count,
  sale_total: j.sale_total,
  cost_total: j.cost_total,
  yield_total: j.yield_total,
  cult_commons_share: j.cult_commons_share,
  bicii_yield_after_cc: j.bicii_yield_after_cc,
  loss_line_count: j.loss_line_count,
  loss_total: j.loss_total,
});

/** public.work_order_yield as `tx`, money as fixed-2 strings. */
async function yieldOf(tx: pg.Client, id: string) {
  const { rows } = await tx.query(
    `select line_count, sale_total, cost_total, yield_total, cult_commons_share, bicii_yield_after_cc,
            loss_line_count, loss_total, to_char(recognized_day, 'YYYY-MM-DD') as recognized_day,
            cult_commons_rates::text[] as rates
       from public.work_order_yield($1)`,
    [id],
  );
  const r = rows[0];
  return {
    figures: {
      line_count: r.line_count,
      sale_total: money(r.sale_total),
      cost_total: money(r.cost_total),
      yield_total: money(r.yield_total),
      cult_commons_share: money(r.cult_commons_share),
      bicii_yield_after_cc: money(r.bicii_yield_after_cc),
      loss_line_count: r.loss_line_count,
      loss_total: money(r.loss_total),
    },
    recognized_day: r.recognized_day as string | null,
    rates: r.rates as string[] | null,
  };
}

/** A daily_summary row reduced to the DayExpectation shape (money fixed-2). */
function asExpectation(row: DailyRow) {
  const out: Record<string, unknown> = {};
  for (const col of DAILY_SUMMARY_COLUMNS.slice(1)) {
    const v = row[col];
    out[col] = (DAY_MONEY_COLUMNS as readonly string[]).includes(col) ? money(v) : v;
  }
  return out;
}

describe("Cult Commons is 30% of positive yield after direct costs, per line (SPEC §10, §31; D1) — seeded examples", () => {
  it("H1-H4 total as SPEC §10 works them out, by work_order_yield and by their recognised entries", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      const all = await entries(tx, day(6), anchor);
      for (const [key, want] of Object.entries({ ...SPEC_EXAMPLE_JOBS, rounding: ROUNDING_JOB })) {
        const y = await yieldOf(tx, want.id);
        expect({ key, ...y.figures }).toEqual({ key, ...jobFigures(want) });
        expect({ key, day: y.recognized_day }).toEqual({ key, day: day(want.recognizedDaysAgo) });
        expect(y.rates).toEqual(["0.3000"]);

        const mine = all.filter((e) => e.document_id === want.id);
        expect({ key, ...totals(mine) }).toEqual({ key, ...jobFigures(want) });
        for (const e of mine) expect(e.recognized_day).toBe(day(want.recognizedDaysAgo));
      }
    });
  });

  it("H4's loss line keeps the job's Cult Commons at 12.00, not 30% of the net 25.00 (7.50)", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      const y = await yieldOf(tx, REPORT_JOB.lossLine);
      expect(y.figures.cult_commons_share).toBe("12.00");
      expect(y.figures.cult_commons_share).not.toBe("7.50");
    });
  });
});

describe("Reports are derived from source records, never a second truth (SPEC §19.2) — seeded history", () => {
  it("daily_summary reproduces SEED_DAYS for each of the seven days, exactly", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      for (const n of SEED_DAY_NUMBERS) {
        const rows = await dailySummary(tx, day(n), day(n));
        expect(rows).toHaveLength(1);
        expect(rows[0].day).toBe(day(n));
        expect({ n, ...asExpectation(rows[0]) }).toEqual({ n, ...SEED_DAYS[n] });
      }
    });
  });

  it("the recognised entries of each day add up to that day's money columns", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      const all = await entries(tx, day(6), anchor);
      for (const n of SEED_DAY_NUMBERS) {
        const t = totals(all.filter((e) => e.recognized_day === day(n)));
        const want = SEED_DAYS[n];
        expect({ n, ...t }).toEqual({
          n,
          line_count: want.lines_recognised,
          sale_total: want.gross_sales,
          cost_total: want.cogs,
          yield_total: want.yield_total,
          cult_commons_share: want.cult_commons_share,
          bicii_yield_after_cc: want.bicii_yield_after_cc,
          loss_line_count: want.loss_lines,
          loss_total: want.loss_total,
        });
      }
    });
  });

  it("every completed seeded job's entries equal work_order_totals_staff and work_order_yield; open and cancelled jobs have none", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      const all = await entries(tx, day(30), anchor);
      const { rows: jobs } = await tx.query<{
        id: string;
        job_number: string;
        status: string;
        completed_day: string | null;
      }>(
        `select id, job_number, status::text,
                to_char((completed_at at time zone 'Asia/Singapore')::date, 'YYYY-MM-DD') as completed_day
           from public.work_orders where id = any ($1::uuid[])`,
        [SEEDED_JOBS],
      );
      expect(jobs).toHaveLength(SEEDED_JOBS.length);
      let completed = 0;
      for (const job of jobs) {
        const mine = all.filter((e) => e.document_id === job.id);
        if (job.completed_day === null) {
          expect({ job: job.job_number, entries: mine.length }).toEqual({
            job: job.job_number,
            entries: 0,
          });
          continue;
        }
        completed++;
        for (const e of mine) expect(e.recognized_day).toBe(job.completed_day);
        const t = totals(mine);
        const { rows } = await tx.query(
          `select line_count, sale_total, cost_total, yield_total, cult_commons_share, bicii_yield_after_cc
             from public.work_order_totals_staff where work_order_id = $1`,
          [job.id],
        );
        expect({
          job: job.job_number,
          line_count: t.line_count,
          sale_total: t.sale_total,
          cost_total: t.cost_total,
          yield_total: t.yield_total,
          cult_commons_share: t.cult_commons_share,
          bicii_yield_after_cc: t.bicii_yield_after_cc,
        }).toEqual({
          job: job.job_number,
          line_count: rows[0].line_count,
          sale_total: money(rows[0].sale_total),
          cost_total: money(rows[0].cost_total),
          yield_total: money(rows[0].yield_total),
          cult_commons_share: money(rows[0].cult_commons_share),
          bicii_yield_after_cc: money(rows[0].bicii_yield_after_cc),
        });
        const y = await yieldOf(tx, job.id);
        expect({ job: job.job_number, ...t }).toEqual({ job: job.job_number, ...y.figures });
        expect(y.recognized_day).toBe(job.completed_day);
      }
      // J-000001, -02, -03; H1-H6; T2.
      expect(completed).toBe(10);
    });
  });

  it("parts consumed and returned per day equal the ledger's own sums", async () => {
    const ledger = await inTransaction(conn, (tx) =>
      readAsOwner(tx, async () => {
        const { rows } = await tx.query<{
          d: string;
          consumed: number;
          lines: number;
          returned: number;
          adjustments: number;
        }>(
          `select to_char((m.created_at at time zone 'Asia/Singapore')::date, 'YYYY-MM-DD') as d,
                  (-coalesce(sum(m.quantity_delta) filter (where m.movement_type = 'job_consumption'), 0))::int as consumed,
                  (count(distinct m.work_order_line_item_id) filter (where m.movement_type = 'job_consumption'))::int as lines,
                  coalesce(sum(m.quantity_delta) filter (where m.movement_type = 'reversal' and o.movement_type = 'job_consumption'), 0)::int as returned,
                  (count(*) filter (where m.movement_type in ('stock_adjustment', 'damaged')))::int as adjustments
             from public.inventory_movements m
             left join public.inventory_movements o on o.id = m.reversal_of_id
            group by 1`,
        );
        return new Map(rows.map((r) => [r.d, r]));
      }),
    );
    for (const n of SEED_DAY_NUMBERS) {
      const l = ledger.get(day(n));
      const want = SEED_DAYS[n];
      expect({
        n,
        consumed: l?.consumed ?? 0,
        lines: l?.lines ?? 0,
        returned: l?.returned ?? 0,
        adjustments: l?.adjustments ?? 0,
      }).toEqual({
        n,
        consumed: want.parts_consumed_qty,
        lines: want.parts_consumed_lines,
        returned: want.parts_returned_qty,
        adjustments: want.stock_adjustments,
      });
    }
  });
});

describe("Negative yield never creates a negative Cult Commons payment (SPEC §10)", () => {
  it("every seeded entry's share is >= 0 and is its own line's share; H4's tyre is a loss with share 0", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      const all = (await entries(tx, day(30), anchor)).filter((e) =>
        SEEDED_JOBS.includes(e.document_id),
      );
      expect(all.length).toBeGreaterThan(0);
      const { rows: lines } = await tx.query<{ id: string; cult_commons_share: string }>(
        "select id, cult_commons_share from public.work_order_line_items_staff where work_order_id = any ($1::uuid[])",
        [SEEDED_JOBS],
      );
      const share = new Map(lines.map((l) => [l.id, money(l.cult_commons_share)]));
      for (const e of all) {
        expect(Number(e.cult_commons_share)).toBeGreaterThanOrEqual(0);
        expect(money(e.cult_commons_share)).toBe(share.get(e.source_line_id));
        expect(e.is_loss).toBe(Number(e.yield_total) < 0);
      }
      const tyre = all.filter((e) => e.document_id === REPORT_JOB.lossLine && e.is_loss);
      expect(tyre).toHaveLength(1);
      expect(tyre[0]).toMatchObject({ yield_total: "-15.00" });
      expect(money(tyre[0].cult_commons_share)).toBe("0.00");
    });
  });
});

describe("The seeded ledger is consistent", () => {
  it("every seeded inventory line has exactly one job_consumption movement, at its time, at its cost", async () => {
    await inTransaction(conn, (tx) =>
      readAsOwner(tx, async () => {
        const { rows } = await tx.query<{
          id: string;
          work_order_id: string;
          created_at: Date;
          unit_direct_cost_snapshot: string;
          movements: Array<{
            created_at: string;
            unit_cost_snapshot: string;
            quantity_delta: number;
          }>;
          quantity: string;
        }>(
          `select li.id, li.work_order_id, li.created_at, li.unit_direct_cost_snapshot, li.quantity,
                  coalesce(jsonb_agg(jsonb_build_object(
                    'created_at', m.created_at, 'unit_cost_snapshot', m.unit_cost_snapshot,
                    'quantity_delta', m.quantity_delta)) filter (where m.id is not null), '[]') as movements
             from public.work_order_line_items li
             left join public.inventory_movements m
               on m.work_order_line_item_id = li.id and m.movement_type = 'job_consumption'
            where li.line_type = 'inventory' and li.work_order_id = any ($1::uuid[])
            group by li.id`,
          [SEEDED_JOBS],
        );
        // H2's and H3's wheelsets, H4's tyre, T2's chain and J-000010's two.
        expect(rows).toHaveLength(6);
        for (const line of rows) {
          expect({ line: line.id, n: line.movements.length }).toEqual({ line: line.id, n: 1 });
          const m = line.movements[0];
          expect(money(m.unit_cost_snapshot)).toBe(money(line.unit_direct_cost_snapshot));
          expect(m.quantity_delta).toBe(-Number(line.quantity));
          const movedAt = new Date(m.created_at).getTime();
          if (P5_JOBS.includes(line.work_order_id)) {
            // Owner-written by the seed: exactly at the line's time.
            expect(movedAt).toBe(line.created_at.getTime());
          } else {
            // add_inventory_line (J-000010): the movement right after the line.
            expect(movedAt).toBeGreaterThanOrEqual(line.created_at.getTime());
            expect(movedAt - line.created_at.getTime()).toBeLessThan(60_000);
          }
        }
      }),
    );
  });

  it("every line was added before its job's completion and no stock level is below zero", async () => {
    await inTransaction(conn, (tx) =>
      readAsOwner(tx, async () => {
        const { rows: late } = await tx.query(
          `select w.job_number, li.id
             from public.work_order_line_items li
             join public.work_orders w on w.id = li.work_order_id
            where w.id = any ($1::uuid[]) and w.completed_at is not null
              and li.created_at >= w.completed_at`,
          [SEEDED_JOBS],
        );
        expect(late).toEqual([]);
        const { rows: negative } = await tx.query(
          "select product_id, location_id, on_hand from reporting.stock_levels where on_hand < 0",
        );
        expect(negative).toEqual([]);
        const { rows: p5 } = await tx.query<{ id: string; on_hand: number }>(
          `select p.id, coalesce(sum(m.quantity_delta), 0)::int as on_hand
             from public.products p left join public.inventory_movements m on m.product_id = p.id
            where p.id = any ($1::uuid[]) group by p.id`,
          [P5_PRODUCTS],
        );
        expect(Object.fromEntries(p5.map((r) => [r.id, r.on_hand]))).toEqual({
          [REPORT_PRODUCT.wheelset]: 2,
          [REPORT_PRODUCT.tyre]: 5,
          [REPORT_PRODUCT.chain]: 9,
          [REPORT_PRODUCT.brakePads]: 19,
          [REPORT_PRODUCT.innerTube]: 24,
          [REPORT_PRODUCT.co2]: 12,
        });
      }),
    );
  });

  it("nothing seeded is in the future, and no Phase 5 row is later than J-000007's seed-time check-in", async () => {
    await inTransaction(conn, (tx) =>
      readAsOwner(tx, async () => {
        const { rows } = await tx.query<{
          what: string;
          latest: Date | null;
          p5_latest: Date | null;
        }>(
          `with stamps (what, work_order_id, product_id, at) as (
             select 'work order', w.id, null::uuid,
                    greatest(w.checked_in_at, w.created_at, w.status_changed_at, w.started_at,
                             w.completed_at, w.ready_for_collection_at, w.collected_at, w.cancelled_at)
               from public.work_orders w
             union all
             select 'line', li.work_order_id, null, greatest(li.created_at, li.voided_at)
               from public.work_order_line_items li
             union all
             select 'event', e.work_order_id, null, e.created_at from public.work_order_events e
             union all
             select 'assignment', a.work_order_id, null, a.assigned_at from public.work_order_assignments a
             union all
             select 'movement', m.work_order_id, m.product_id, m.created_at from public.inventory_movements m
           )
           select what, max(at) as latest,
                  max(at) filter (where work_order_id = any ($1::uuid[]) or product_id = any ($2::uuid[]))
                    as p5_latest
             from stamps group by what order by what`,
          [P5_JOBS, P5_PRODUCTS],
        );
        const now = await tx.query<{ now: Date }>("select now()");
        const seededAt = await tx.query<{ at: Date }>(
          "select checked_in_at as at from public.work_orders where id = $1",
          [WORK_ORDER.nurulBianchiReceived],
        );
        expect(rows.map((r) => r.what)).toEqual([
          "assignment",
          "event",
          "line",
          "movement",
          "work order",
        ]);
        for (const r of rows) {
          expect(r.latest!.getTime(), r.what).toBeLessThanOrEqual(now.rows[0].now.getTime());
          expect(r.p5_latest, r.what).not.toBeNull();
          expect(r.p5_latest!.getTime(), r.what).toBeLessThanOrEqual(seededAt.rows[0].at.getTime());
        }
      }),
    );
  });
});

/**
 * Seed realism, not a domain rule: the system lets a bike have two jobs
 * (nothing in SPEC or the RPCs forbids it), but the demo board, bike pages
 * and Today should not show one physical bike being worked on in two
 * lanes, or handed back while still in the workshop. A job is open
 * (private.work_order_status_is_open) from check-in to completion or
 * cancellation. A bike that is completed and awaiting collection may
 * still take a new job (Phase 3/4's J-000003 and J-000010, Phase 3's
 * J-000009 after H6), as when a customer asks for more work before
 * collecting it.
 */
describe("Seed realism: one bike, one job in the workshop at a time", () => {
  it("no bike has two seeded jobs open at once, and none is collected while another job on it is open", async () => {
    await inTransaction(conn, (tx) =>
      readAsOwner(tx, async () => {
        const { rows } = await tx.query<{ problem: string; bike: string; a: string; b: string }>(
          `with j as (
             select w.id, w.job_number, w.bike_id, w.collected_at,
                    tstzrange(w.checked_in_at, coalesce(w.completed_at, w.cancelled_at, 'infinity'), '[)')
                      as open_span
               from public.work_orders w
              where w.id = any ($1::uuid[])
           )
           select 'two open jobs' as problem, b.short_id as bike, x.job_number as a, y.job_number as b
             from j x join j y on y.bike_id = x.bike_id and x.id < y.id and x.open_span && y.open_span
             join public.bikes b on b.id = x.bike_id
           union all
           select 'collected while another job is open', b.short_id, x.job_number, y.job_number
             from j x join j y on y.bike_id = x.bike_id and x.id <> y.id
                               and x.collected_at is not null and y.open_span @> x.collected_at
             join public.bikes b on b.id = x.bike_id
           order by 1, 2, 3`,
          [SEEDED_JOBS],
        );
        expect(rows).toEqual([]);
        // The shared bikes the Phase 5 jobs now use, in turn.
        const { rows: shared } = await tx.query<{ bike: string; jobs: string[] }>(
          `select b.short_id as bike, array_agg(w.job_number order by w.checked_in_at) as jobs
             from public.work_orders w join public.bikes b on b.id = w.bike_id
            where w.id = any ($1::uuid[])
            group by b.short_id having count(*) > 1 order by 1`,
          [SEEDED_JOBS],
        );
        expect(shared).toEqual([
          { bike: "B-000001", jobs: ["J-000001", "J-000014"] },
          { bike: "B-000002", jobs: ["J-000011", "J-000008", "J-000015"] },
          { bike: "B-000004", jobs: ["J-000016", "J-000009"] },
          { bike: "B-000005", jobs: ["J-000003", "J-000010"] },
          { bike: "B-000014", jobs: ["J-000012", "J-000020", "J-000021"] },
          { bike: "B-000015", jobs: ["J-000013", "J-000019"] },
        ]);
      }),
    );
  });
});

describe("Today shows flows for the day and the current snapshot (D31) — seeded", () => {
  it("today_dashboard(null) is the anchor day: SEED_DAYS[0] flows and the status snapshot", async (ctx) => {
    if (!anchorIsToday) ctx.skip(SKIP_NOT_TODAY());
    await asStaff(conn, STAFF.admin, async (tx) => {
      const { rows } = await tx.query(
        "select to_char(day, 'YYYY-MM-DD') as day_key, * from public.today_dashboard(null)",
      );
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.day_key).toBe(anchor);
      expect(row.is_today).toBe(true);
      expect(asExpectation(row as DailyRow)).toEqual(SEED_DAYS[0]);
      expect(row.cost_pending_lines).toBe(0);

      const direct = await readAsOwner(tx, async () => {
        const { rows: d } = await tx.query(
          `select
             (count(*) filter (where status in ('received', 'diagnosing')))::int as received_now,
             (count(*) filter (where status in ('awaiting_customer', 'awaiting_parts', 'paused')))::int as waiting_now,
             (count(*) filter (where status = 'ready_to_start'))::int as ready_to_start_now,
             (count(*) filter (where status = 'in_progress'))::int as in_progress_now,
             (count(*) filter (where status in ('completed', 'ready_for_collection')))::int as awaiting_collection_now,
             (count(*) filter (where status not in ('completed', 'ready_for_collection', 'collected', 'cancelled')))::int
               as open_jobs_now,
             (count(*) filter (where status not in ('completed', 'ready_for_collection', 'collected', 'cancelled')
                                and now() - checked_in_at > interval '7 days'))::int as overdue_now,
             (select count(*)::int from reporting.low_stock) as low_stock_now,
             (select count(*)::int from reporting.operational_exceptions) as exceptions_now
           from public.work_orders`,
        );
        return d[0];
      });
      const snapshot = Object.fromEntries(SNAPSHOT_COLUMNS.map((c) => [c, row[c]]));
      expect(snapshot).toEqual(direct);
      for (const [col, min] of Object.entries(SEED_SNAPSHOT)) {
        expect(snapshot[col], col).toBeGreaterThanOrEqual(min);
      }
      // A fresh per-file database: exactly the seeded snapshot.
      if (isolatedDatabase()) expect(snapshot).toEqual(SEED_SNAPSHOT);
    });
  });
});

describe("Operational exceptions (D34; D20) — seeded", () => {
  it("lists J-000006 and H7 overdue and H6 uncollected; not H5, J-000002 or J-000003", async (ctx) => {
    if (!anchorIsToday) ctx.skip(SKIP_NOT_TODAY());
    await asStaff(conn, STAFF.mechanic2, async (tx) => {
      const { rows } = await tx.query<{ kind: string; entity_id: string }>(
        "select kind, entity_id from public.operational_exceptions(200)",
      );
      for (const want of SEED_EXCEPTIONS) expect(rows).toContainEqual(want);
      const ids = rows.map((r) => r.entity_id);
      for (const absent of [
        REPORT_JOB.rounding,
        WORK_ORDER.priyaDomaneReady,
        WORK_ORDER.hafizBromptonCompleted,
        WORK_ORDER.chloeSurlyAwaitingParts,
      ]) {
        expect(ids).not.toContain(absent);
      }
      if (isolatedDatabase()) {
        expect([...rows].sort((a, b) => a.entity_id.localeCompare(b.entity_id))).toEqual(
          [...SEED_EXCEPTIONS].sort((a, b) => a.entity_id.localeCompare(b.entity_id)),
        );
      }
    });
  });
});

describe("Significant stock adjustments (D33) — seeded", () => {
  type Adjustment = {
    product_id: string;
    movement_type: string;
    quantity_delta: number;
    reason: string;
    actor_name: string;
    significant: boolean;
    value_at_cost: string | null;
  };
  const adjustmentsOn = (tx: pg.Client, d: string) =>
    tx
      .query<Adjustment>(
        `select product_id, movement_type, quantity_delta, reason, actor_name, significant, value_at_cost
           from public.stock_adjustments_on($1::date)`,
        [d],
      )
      .then((r) => r.rows);

  it("A2 (six inner tubes damaged yesterday) is significant; A1 and A3 are not", async () => {
    for (const [name, a] of Object.entries(SEED_ADJUSTMENTS)) {
      const rows = await asStaff(conn, STAFF.admin, (tx) => adjustmentsOn(tx, day(a.daysAgo)));
      const mine = rows.filter((r) => r.product_id === a.product_id);
      expect({ name, n: mine.length }).toEqual({ name, n: 1 });
      expect({ name, ...mine[0], value_at_cost: money(mine[0].value_at_cost) }).toEqual({
        name,
        product_id: a.product_id,
        movement_type: a.movement_type,
        quantity_delta: a.quantity_delta,
        reason: a.reason,
        actor_name: "Asha Admin",
        significant: a.significant,
        value_at_cost: a.value_at_cost,
      });
    }
    // Yesterday's only adjustment is A2.
    const yesterday = await asStaff(conn, STAFF.admin, (tx) => adjustmentsOn(tx, day(1)));
    expect(yesterday.map((r) => r.product_id)).toEqual([SEED_ADJUSTMENTS.A2.product_id]);
  });

  it("the flag is shown to every active staff member; the value at cost only with view_costs (D30)", async () => {
    const a2 = SEED_ADJUSTMENTS.A2;
    const nur = await asStaff(conn, STAFF.mechanic2, (tx) => adjustmentsOn(tx, day(1)));
    expect(nur).toEqual([
      expect.objectContaining({
        product_id: a2.product_id,
        significant: true,
        value_at_cost: null,
      }),
    ]);
    const asha = await asStaff(conn, STAFF.admin, (tx) => adjustmentsOn(tx, day(1)));
    expect(money(asha[0].value_at_cost)).toBe("30.00");
  });
});
