/**
 * Who sees the financial reports (SPEC §4.2, §23 "Customers cannot read
 * internal notes, costs, yield, consignor or Cult Commons data", §27.2;
 * PLAN D30 FIN-ACCESS).
 *
 *   * Financial rows need view_financial_reports; every cost-derived figure
 *     also needs view_costs and is NULL otherwise.
 *   * The job yield panel (work_order_yield) needs view_costs only.
 *   * Operational counts are visible to all active staff.
 *   * Customers, anonymous visitors and inactive staff reach none of it,
 *     and no API role can select the Phase 5 reporting views (or Phase 2's
 *     reporting.appointment_daily) directly.
 *
 * The data-dependent cases build a job (J-/B- sequences), so they skip in
 * existing-database mode; the refusals run everywhere.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { STAFF } from "../fixtures/ids";
import { linkCustomerLogin, customerClaims } from "./customer-fixtures";
import { actAs, connect, inTransaction, isolatedDatabase, type Claims } from "./harness";
import { ADMIN, MECHANIC1, MECHANIC2 } from "./inventory-fixtures";
import {
  COST_COLUMNS,
  FIN_COLUMNS,
  FINANCIAL_LINES_COLUMNS,
  FINANCIAL_LINES_COST_COLUMNS,
  TEST_DAY,
  completedPath,
  dayRow,
  insertJob,
  money,
  sgt,
} from "./reporting-fixtures";
import { failsWith, makeCustomer, ownerMode } from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const DAY = TEST_DAY(200);

const RPC_CALLS: ReadonlyArray<[string, string, unknown[]]> = [
  ["daily_summary", "select * from public.daily_summary(null, null)", []],
  ["today_dashboard", "select * from public.today_dashboard(null)", []],
  ["work_order_activity_on", "select * from public.work_order_activity_on(null)", []],
  ["stock_adjustments_on", "select * from public.stock_adjustments_on(null)", []],
  ["operational_exceptions", "select * from public.operational_exceptions(50)", []],
  ["financial_lines", "select * from public.financial_lines($1, $1)", [DAY]],
  ["work_order_yield", "select * from public.work_order_yield(gen_random_uuid())", []],
  // Phase 2 (D41): operational, but staff only.
  ["appointment_daily", "select * from public.appointment_daily(null, null)", []],
];

const VIEWS = [
  "reporting.financial_lines",
  "reporting.work_order_activity",
  "reporting.daily_summary",
  "reporting.operational_exceptions",
  "reporting.appointment_daily",
];

/** A completed job on DAY with a profitable line and a loss line, plus a manual adjustment. */
async function buildDay(tx: pg.Client): Promise<string> {
  const { job } = await insertJob(tx, {
    checkedInAt: sgt(DAY, "08:00"),
    path: completedPath(sgt(DAY, "08:30"), sgt(DAY, "15:00")),
    lines: [
      { type: "manual", unitSale: "40.00", unitCost: "0.00", createdAt: sgt(DAY, "09:00") },
      { type: "manual", unitSale: "20.00", unitCost: "35.00", createdAt: sgt(DAY, "09:10") },
    ],
  });
  await ownerMode(tx);
  const product = (
    await tx.query<{ id: string }>(
      `insert into public.products (name, tracking_type, default_sale_price, default_direct_cost)
       values ('Access test part', 'quantity', 10, 7.5) returning id`,
    )
  ).rows[0].id;
  const location = (
    await tx.query<{ id: string }>(
      "insert into public.locations (name, kind) values ('Access test shelf', 'storage') returning id",
    )
  ).rows[0].id;
  await tx.query(
    `insert into public.inventory_movements (product_id, location_id, quantity_delta, movement_type, reason, created_by, created_at)
     values ($1, $2, 6, 'stock_adjustment', 'Count', $3, $4)`,
    [product, location, STAFF.admin, sgt(DAY, "10:00")],
  );
  return job.id;
}

describe("Customers cannot read internal data (SPEC §23; D30)", () => {
  it("a signed-in customer gets 42501 from every reporting RPC", async () => {
    await inTransaction(conn, async (tx) => {
      const customerId = await makeCustomer(tx);
      const authUserId = await linkCustomerLogin(tx, customerId);
      await actAs(tx, customerClaims(authUserId));
      for (const [, sql, params] of RPC_CALLS)
        await failsWith(tx, () => tx.query(sql, params), { code: "42501" });
    });
  });

  it("anon has no EXECUTE on any reporting RPC (42501)", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, { role: "anon" });
      for (const [, sql, params] of RPC_CALLS)
        await failsWith(tx, () => tx.query(sql, params), { code: "42501" });
    });
  });

  it("no API role can select the Phase 5 reporting views, although reporting is exposed", async () => {
    await inTransaction(conn, async (tx) => {
      for (const claims of [{ role: "anon" } as Claims, ADMIN, MECHANIC1]) {
        await ownerMode(tx);
        await actAs(tx, claims);
        for (const view of VIEWS)
          await failsWith(tx, () => tx.query(`select * from ${view} limit 1`), { code: "42501" });
      }
    });
  });
});

describe("Mechanic permission boundaries (SPEC §23, §27.2; D30)", () => {
  it("mechanic2 (no permissions): financial_lines and work_order_yield 42501", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, MECHANIC2);
      await failsWith(tx, () => tx.query("select * from public.financial_lines($1, $1)", [DAY]), {
        code: "42501",
      });
      await failsWith(
        tx,
        () => tx.query("select * from public.work_order_yield(gen_random_uuid())"),
        {
          code: "42501",
        },
      );
    });
  });

  it("mechanic1 (view_costs only): financial_lines 42501", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, MECHANIC1);
      await failsWith(tx, () => tx.query("select * from public.financial_lines($1, $1)", [DAY]), {
        code: "42501",
      });
    });
  });

  it("inactive staff get 42501 from every reporting RPC", async () => {
    await inTransaction(conn, async (tx) => {
      await tx.query("update public.staff set active = false where id = $1", [STAFF.mechanic1]);
      await actAs(tx, MECHANIC1);
      for (const [, sql, params] of RPC_CALLS)
        await failsWith(tx, () => tx.query(sql, params), { code: "42501" });
    });
  });

  describe.skipIf(!isolatedDatabase())("on a day the test builds", () => {
    it("mechanic2 sees counts with every money column NULL; value_at_cost NULL", async () => {
      await inTransaction(conn, async (tx) => {
        await buildDay(tx);
        await actAs(tx, MECHANIC2);
        const row = await dayRow(tx, DAY);
        expect(row).toMatchObject({
          jobs_completed: 1,
          jobs_checked_in: 1,
          stock_adjustments: 1,
          significant_stock_adjustments: 1,
        });
        for (const c of [...FIN_COLUMNS, ...COST_COLUMNS]) expect(row[c]).toBeNull();
        const dash = (await tx.query("select * from public.today_dashboard($1)", [DAY])).rows[0];
        expect(dash).toMatchObject({
          can_see_financials: false,
          can_see_costs: false,
          jobs_completed: 1,
          cost_pending_lines: null,
        });
        for (const c of [...FIN_COLUMNS, ...COST_COLUMNS]) expect(dash[c]).toBeNull();
        const adj = (await tx.query("select * from public.stock_adjustments_on($1)", [DAY])).rows;
        expect(adj).toMatchObject([{ significant: true, value_at_cost: null, reason: "Count" }]);
        const activity = (await tx.query("select * from public.work_order_activity_on($1)", [DAY]))
          .rows;
        expect(activity.map((r) => money(r.sale_total))).toEqual(["60.00"]);
      });
    });

    it("mechanic1 (view_costs only): work_order_yield works, daily_summary money is NULL", async () => {
      await inTransaction(conn, async (tx) => {
        const jobId = await buildDay(tx);
        await actAs(tx, MECHANIC1);
        const y = (await tx.query("select * from public.work_order_yield($1)", [jobId])).rows[0];
        expect([money(y.sale_total), money(y.cult_commons_share), y.loss_line_count]).toEqual([
          "60.00",
          "12.00",
          1,
        ]);
        const row = await dayRow(tx, DAY);
        for (const c of [...FIN_COLUMNS, ...COST_COLUMNS]) expect(row[c]).toBeNull();
        const adj = (
          await tx.query("select value_at_cost from public.stock_adjustments_on($1)", [DAY])
        ).rows;
        expect(adj.map((r) => money(r.value_at_cost))).toEqual(["45.00"]);
      });
    });

    it("view_financial_reports without view_costs: rows and gross sales, every cost column NULL", async () => {
      await inTransaction(conn, async (tx) => {
        await buildDay(tx);
        await tx.query(
          "insert into public.staff_permissions (staff_id, permission) values ($1, 'view_financial_reports')",
          [STAFF.mechanic2],
        );
        await actAs(tx, MECHANIC2);
        const lines = await tx.query("select * from public.financial_lines($1, $1)", [DAY]);
        expect(lines.fields.map((f) => f.name)).toEqual([...FINANCIAL_LINES_COLUMNS]);
        expect(lines.rows).toHaveLength(2);
        for (const r of lines.rows) {
          for (const c of FINANCIAL_LINES_COST_COLUMNS) expect(r[c]).toBeNull();
          expect(r.sale_total).not.toBeNull();
        }
        const row = await dayRow(tx, DAY);
        expect([row.currency, row.lines_recognised, money(row.gross_sales)]).toEqual([
          "SGD",
          2,
          "60.00",
        ]);
        for (const c of COST_COLUMNS) expect(row[c]).toBeNull();
        const dash = (await tx.query("select * from public.today_dashboard($1)", [DAY])).rows[0];
        expect(dash).toMatchObject({
          can_see_financials: true,
          can_see_costs: false,
          cost_pending_lines: 0,
        });
        await failsWith(
          tx,
          () => tx.query("select * from public.work_order_yield(gen_random_uuid())"),
          {
            code: "42501",
          },
        );
      });
    });

    it("admin: everything populated", async () => {
      await inTransaction(conn, async (tx) => {
        const jobId = await buildDay(tx);
        await actAs(tx, ADMIN);
        const row = await dayRow(tx, DAY);
        expect({
          gross: money(row.gross_sales),
          cogs: money(row.cogs),
          yield: money(row.yield_total),
          cc: money(row.cult_commons_share),
          after: money(row.bicii_yield_after_cc),
          lossLines: row.loss_lines,
          loss: money(row.loss_total),
        }).toEqual({
          gross: "60.00",
          cogs: "35.00",
          yield: "25.00",
          cc: "12.00",
          after: "13.00",
          lossLines: 1,
          loss: "-15.00",
        });
        const lines = (await tx.query("select * from public.financial_lines($1, $1)", [DAY])).rows;
        for (const r of lines)
          for (const c of FINANCIAL_LINES_COST_COLUMNS) expect(r[c]).not.toBeNull();
        const dash = (await tx.query("select * from public.today_dashboard($1)", [DAY])).rows[0];
        expect(dash).toMatchObject({ can_see_financials: true, can_see_costs: true });
        expect(
          (await tx.query("select * from public.work_order_yield($1)", [jobId])).rows,
        ).toHaveLength(1);
      });
    });
  });
});
