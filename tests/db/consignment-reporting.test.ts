/**
 * Sales and consignment in the reports, the Phase 6 read RPCs and the
 * seeded consignor ledgers (SPEC §10, §13, §19, §20, §23, §31; DATA-MODEL
 * §9, §14, §16, §18 "Phase 6 part"; PLAN D1, D30 FIN-ACCESS, D32, D35, D44,
 * D45, D46, D47, D48 SALES-ACCESS, D49 RETAIL-REFUND).
 *
 * Reads the seed (expected figures in tests/fixtures/ids.ts
 * EXPECTED_SALE / EXPECTED_CONSIGNOR_LEDGER, written by hand from
 * supabase/seed.sql). Days are counted back from the seed's anchor
 * (seedToday()), never from shop_today(). Every test rolls back; the one
 * block that creates items and a job (short-ID sequences) runs only on a
 * per-file clone.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import {
  CONSIGNMENT_ITEM,
  CONSIGNMENT_ITEM_SHORT_ID,
  CONSIGNMENT_PRODUCT,
  CONSIGNMENT_UNIT,
  CONSIGNOR,
  CUSTOMER,
  CUSTOMER_LOGIN,
  EXPECTED_CONSIGNOR_LEDGER,
  EXPECTED_JERSEYS_POSITION,
  EXPECTED_SALE,
  LOCATION,
  SALE,
  type SeedConsignor,
  type SeedSale,
} from "../fixtures/ids";
import {
  consignorLedger,
  createConsignor,
  intakeUnique,
  itemLedger,
  sellingPrice,
  staffWith,
  updateTerms,
} from "./consignment-fixtures";
import { customerClaims } from "./customer-fixtures";
import { actAs, connect, inTransaction, isolatedDatabase, scalar, type Claims } from "./harness";
import {
  ADMIN,
  MECHANIC1,
  MECHANIC2,
  addPart,
  completeJob,
  newJob,
  readAsOwner,
} from "./inventory-fixtures";
import { addDays, dayRow, money, seedToday } from "./reporting-fixtures";
import { failsWith, ownerMode } from "./workshop-fixtures";

let conn: pg.Client;
let anchor: string;

beforeAll(async () => {
  conn = await connect();
  anchor = await seedToday(conn);
});

const day = (n: number) => addDays(anchor, -n);

/** A rolled-back transaction with the five reading roles of D30/D48. */
const withRoles = <T>(
  fn: (
    tx: pg.Client,
    roles: {
      admin: Claims;
      mechanic1: Claims;
      mechanic2: Claims;
      reports: Claims;
      manager: Claims;
    },
  ) => Promise<T>,
) =>
  inTransaction(conn, async (tx) => {
    await ownerMode(tx);
    const reports = (await staffWith(tx, ["view_financial_reports"])).claims;
    const manager = (await staffWith(tx, ["manage_consignments"])).claims;
    await actAs(tx, ADMIN);
    return fn(tx, { admin: ADMIN, mechanic1: MECHANIC1, mechanic2: MECHANIC2, reports, manager });
  });

type FinRow = Record<string, string | boolean | Date | null>;

/** public.financial_lines(from, to) as whoever `tx` is, numerics fixed-2. */
async function finLines(tx: pg.Client, from: string, to: string): Promise<FinRow[]> {
  const { rows } = await tx.query<FinRow>(
    `select entry_key, source, entry_kind, source_line_id, document_id, document_number, channel,
            recognized_at, to_char(recognized_day, 'YYYY-MM-DD') as recognized_day, line_type, service_id,
            product_id, inventory_unit_id, ownership_type, consignment_item_id, customer_id, bike_id,
            lead_mechanic_id, description, quantity, unit_sale_price, unit_direct_cost, cult_commons_rate,
            sale_total, cost_total, yield_total, cult_commons_share, bicii_yield_after_cc, is_loss, currency,
            cost_pending
       from public.financial_lines($1::date, $2::date)`,
    [from, to],
  );
  return rows.map((r) => {
    const out: FinRow = { ...r };
    for (const k of [
      "quantity",
      "unit_sale_price",
      "unit_direct_cost",
      "sale_total",
      "cost_total",
      "yield_total",
      "cult_commons_share",
      "bicii_yield_after_cc",
    ])
      out[k] = money(r[k]);
    return out;
  });
}

const SALE_KEYS = Object.keys(SALE) as SeedSale[];

describe("Cult Commons is 30% of positive yield after the consignor payout (SPEC §10, D1, D46)", () => {
  it("each seeded sale's recognised entry equals EXPECTED_SALE, on its shop day", async () => {
    await withRoles(async (tx) => {
      const rows = (await finLines(tx, day(6), anchor)).filter((r) => r.source === "sale");
      for (const key of SALE_KEYS) {
        const want = EXPECTED_SALE[key];
        const mine = rows.filter((r) => r.document_id === want.id);
        expect({ key, n: mine.length }).toEqual({ key, n: 1 });
        expect({ key, ...mine[0] }).toMatchObject({
          key,
          source: "sale",
          entry_kind: "line",
          channel: "retail",
          document_number: want.sale_number,
          recognized_day: day(want.daysAgo),
          line_type: "inventory",
          service_id: null,
          bike_id: null,
          lead_mechanic_id: null,
          ownership_type: want.ownership_type,
          consignment_item_id: want.consignment_item_id,
          customer_id: want.customer_id,
          quantity: money(want.quantity),
          unit_sale_price: want.unit_sale_price,
          unit_direct_cost: want.unit_direct_cost,
          cult_commons_rate: "0.3000",
          sale_total: want.sale_total,
          cost_total: want.cost_total,
          yield_total: want.yield_total,
          cult_commons_share: want.cult_commons_share,
          bicii_yield_after_cc: want.bicii_yield_after_cc,
          is_loss: false,
          currency: "SGD",
          cost_pending: false,
        });
        expect(mine[0].entry_key).toBe(`sl:${mine[0].source_line_id}`);
      }
    });
  });

  it("S-000003 (SPEC §10's consignment example) is recognised at the sale's recognized_at, on its own sale line; refunds are not netted (D49)", async () => {
    await withRoles(async (tx) => {
      const rows = await finLines(tx, day(6), anchor);
      const s3 = rows.find((r) => r.document_id === SALE.cervelo)!;
      const { rows: sale } = await tx.query<{ recognized_at: Date; line_id: string }>(
        `select s.recognized_at, l.id as line_id
           from public.sales s join public.sale_lines l on l.sale_id = s.id where s.id = $1`,
        [SALE.cervelo],
      );
      expect(s3.recognized_at).toEqual(sale[0].recognized_at);
      expect(s3.source_line_id).toBe(sale[0].line_id);
      expect(s3).toMatchObject({
        inventory_unit_id: CONSIGNMENT_UNIT.cervelo,
        product_id: CONSIGNMENT_PRODUCT.cervelo,
        sale_total: "1000.00",
        cult_commons_share: "150.00",
      });
      // S-000002 had a 14.00 refund; its entry is still the full line.
      expect(rows.find((r) => r.document_id === SALE.tubes)).toMatchObject({ sale_total: "28.00" });
    });
  });

  it("entry_key is unique across the view; work-order entries carry their line's consignment item (none in the seed)", async () => {
    await inTransaction(conn, async (tx) => {
      const check = await readAsOwner(tx, async () => {
        const { rows } = await tx.query<{
          n: number;
          keys: number;
          wo_mismatch: number;
          wo_consigned: number;
        }>(
          `select count(*)::int as n, count(distinct entry_key)::int as keys,
                  (count(*) filter (
                     where fl.source = 'work_order'
                       and fl.consignment_item_id is distinct from (
                         select l.consignment_item_id from public.work_order_line_items l where l.id = fl.source_line_id)
                   ))::int as wo_mismatch,
                  (count(*) filter (where fl.source = 'work_order' and fl.consignment_item_id is not null))::int
                    as wo_consigned
             from reporting.financial_lines fl`,
        );
        return rows[0];
      });
      expect(check.n).toBe(check.keys);
      expect(check.wo_mismatch).toBe(0);
      expect(check.wo_consigned).toBe(0);
    });
  });
});

describe("the reading path (D30, D48)", () => {
  it("admin sees the sale entries with costs; a view_financial_reports-only member sees them with every cost-derived column NULL; mechanics are refused as in Phase 5", async () => {
    await withRoles(async (tx, r) => {
      const admin = (await finLines(tx, day(5), anchor)).filter((e) => e.source === "sale");
      expect(admin).toHaveLength(4);
      expect(admin.every((e) => e.unit_direct_cost !== null && e.cult_commons_share !== null)).toBe(
        true,
      );

      await actAs(tx, r.reports);
      const reports = (await finLines(tx, day(5), anchor)).filter((e) => e.source === "sale");
      expect(reports).toHaveLength(4);
      for (const e of reports) {
        expect(e).toMatchObject({
          unit_direct_cost: null,
          cult_commons_rate: null,
          cost_total: null,
          yield_total: null,
          cult_commons_share: null,
          bicii_yield_after_cc: null,
          is_loss: null,
        });
        expect(e.sale_total).not.toBeNull();
      }
      const d3 = await dayRow(tx, day(3));
      expect({
        sales: d3.consignment_sales,
        total: money(d3.consignment_sales_total),
        liability: d3.new_consignor_liability,
        cogs: d3.cogs,
      }).toEqual({ sales: 1, total: "1000.00", liability: null, cogs: null });

      for (const claims of [r.mechanic1, r.mechanic2]) {
        await actAs(tx, claims);
        await failsWith(tx, () => finLines(tx, day(5), anchor), { code: "42501" });
        const row = await dayRow(tx, day(3));
        expect({
          sales: row.consignment_sales,
          total: row.consignment_sales_total,
          liability: row.new_consignor_liability,
          gross: row.gross_sales,
        }).toEqual({ sales: null, total: null, liability: null, gross: null });
      }
    });
  });
});

describe("daily_summary's consignment columns (D44, D46; DATA-MODEL §14)", () => {
  it("S-000004's day and S-000003's day count one consigned sale each; the columns equal the consigned entries of each day", async () => {
    await withRoles(async (tx) => {
      // The sales' shop days, by Phase 5's bucket (Asia/Singapore, D35).
      const days = await readAsOwner(tx, async () => {
        const { rows } = await tx.query<{ id: string; d: string }>(
          "select id, to_char(private.shop_day(recognized_at), 'YYYY-MM-DD') as d from public.sales where id = any ($1::uuid[])",
          [[SALE.cervelo, SALE.jerseyToday]],
        );
        return Object.fromEntries(rows.map((x) => [x.id, x.d]));
      });
      expect(days[SALE.cervelo]).toBe(day(3));
      expect(days[SALE.jerseyToday]).toBe(day(0));

      const pick = (row: Record<string, unknown>) => ({
        sales: row.consignment_sales,
        total: money(row.consignment_sales_total),
        liability: money(row.new_consignor_liability),
      });
      expect(pick(await dayRow(tx, day(0)))).toEqual({
        sales: 1,
        total: "70.00",
        liability: "35.00",
      });
      expect(pick(await dayRow(tx, day(3)))).toEqual({
        sales: 1,
        total: "1000.00",
        liability: "500.00",
      });
      expect(pick(await dayRow(tx, day(5)))).toEqual({
        sales: 1,
        total: "140.00",
        liability: "70.00",
      });
      expect(pick(await dayRow(tx, day(4)))).toEqual({
        sales: 0,
        total: "0.00",
        liability: "0.00",
      });

      // today_dashboard gives the admin the same figures for that day.
      const { rows: dash } = await tx.query(
        "select consignment_sales, consignment_sales_total, new_consignor_liability from public.today_dashboard($1::date)",
        [day(0)],
      );
      expect(pick(dash[0])).toEqual({ sales: 1, total: "70.00", liability: "35.00" });

      // Reconcile: every day's columns are the consigned entries' own sums.
      const ledger = await readAsOwner(tx, async () => {
        const { rows } = await tx.query<{
          d: string;
          docs: number;
          total: string;
          liability: string;
        }>(
          `select to_char(fl.recognized_day, 'YYYY-MM-DD') as d, count(distinct fl.document_id)::int as docs,
                  sum(fl.sale_total)::text as total,
                  sum(round(fl.quantity * coalesce(sl.consignor_payout_snapshot, li.consignor_payout_snapshot), 2))::text
                    as liability
             from reporting.financial_lines fl
             left join public.sale_lines sl on sl.id = fl.source_line_id
             left join public.work_order_line_items li on li.id = fl.source_line_id
            where fl.consignment_item_id is not null
            group by 1`,
        );
        return new Map(rows.map((x) => [x.d, x]));
      });
      for (const n of [0, 1, 2, 3, 4, 5, 6]) {
        const l = ledger.get(day(n));
        expect({ n, ...pick(await dayRow(tx, day(n))) }).toEqual({
          n,
          sales: l?.docs ?? 0,
          total: money(l?.total ?? 0),
          liability: money(l?.liability ?? 0),
        });
      }
    });
  });
});

describe.skipIf(!isolatedDatabase())("a consigned job part in the reports (D44)", () => {
  it("counts on its job's completion day with its consignment item and payout", async () => {
    await withRoles(async (tx) => {
      const consignorId = await createConsignor(tx);
      const item = await intakeUnique(tx, { consignorId, agreed: "300.00", asking: "600.00" });
      const job = await newJob(tx);
      const part = await addPart(tx, {
        workOrderId: job.id,
        productId: item.product_id,
        unitId: item.inventory_unit_id,
      });
      const completed = await completeJob(tx, job.id);
      const completedDay = await readAsOwner(tx, () =>
        scalar<string>(tx, "select to_char(private.shop_day($1::timestamptz), 'YYYY-MM-DD')", [
          completed.completed_at,
        ]),
      );
      const entries = (await finLines(tx, completedDay, completedDay)).filter(
        (e) => e.source_line_id === part.line_id,
      );
      expect(entries).toEqual([
        expect.objectContaining({
          source: "work_order",
          channel: "workshop",
          consignment_item_id: item.item_id,
          ownership_type: "consignment",
          sale_total: "600.00",
          cost_total: "300.00",
          recognized_day: completedDay,
        }),
      ]);
      const row = await dayRow(tx, completedDay);
      const owner = await readAsOwner(tx, async () => {
        const { rows } = await tx.query<{ docs: number; total: string; liability: string }>(
          `select count(distinct fl.document_id)::int as docs, coalesce(sum(fl.sale_total), 0)::text as total,
                  coalesce(sum(round(fl.quantity * coalesce(sl.consignor_payout_snapshot, li.consignor_payout_snapshot), 2)), 0)::text as liability
             from reporting.financial_lines fl
             left join public.sale_lines sl on sl.id = fl.source_line_id
             left join public.work_order_line_items li on li.id = fl.source_line_id
            where fl.consignment_item_id is not null and fl.recognized_day = $1::date`,
          [completedDay],
        );
        return rows[0];
      });
      expect(owner.docs).toBeGreaterThanOrEqual(1);
      expect({
        sales: row.consignment_sales,
        total: money(row.consignment_sales_total),
        liability: money(row.new_consignor_liability),
      }).toEqual({
        sales: owner.docs,
        total: money(owner.total),
        liability: money(owner.liability),
      });
    });
  });
});

describe("the seeded consignor ledgers (D46, D47)", () => {
  it("equal EXPECTED_CONSIGNOR_LEDGER (the reversed settlement excluded) and the sum of their items", async () => {
    await inTransaction(conn, async (tx) => {
      for (const key of Object.keys(CONSIGNOR) as SeedConsignor[]) {
        const ledger = await consignorLedger(tx, CONSIGNOR[key]);
        expect({ key, ...ledger }).toEqual({ key, ...EXPECTED_CONSIGNOR_LEDGER[key] });
        const items = await readAsOwner(tx, async () => {
          const { rows } = await tx.query<{ id: string }>(
            "select id from public.consignment_items where consignor_id = $1",
            [CONSIGNOR[key]],
          );
          return rows;
        });
        const rows = await Promise.all(items.map((i) => itemLedger(tx, i.id)));
        for (const k of [
          "liability",
          "consignor_charges",
          "owed",
          "paid",
          "outstanding",
        ] as const) {
          expect({ key, k, v: rows.reduce((s, x) => s + Number(x[k]), 0).toFixed(2) }).toEqual({
            key,
            k,
            v: ledger[k],
          });
        }
      }
      expect(await itemLedger(tx, CONSIGNMENT_ITEM.jerseys)).toMatchObject(
        EXPECTED_JERSEYS_POSITION,
      );
    });
  });
});

describe("list_consignors (D48)", () => {
  type Row = {
    id: string;
    display_name: string;
    customer_label: string | null;
    archived_at: Date | null;
    active_items: number;
    sold_items: number;
    awaiting_settlement_items: number | null;
    returned_items: number;
    owed: string | null;
    paid: string | null;
    outstanding: string | null;
  };
  const list = async (tx: pg.Client, q: string | null = null, archived = false) => {
    const { rows } = await tx.query<Row>(
      `select id, display_name, customer_label, archived_at, active_items, sold_items,
              awaiting_settlement_items, returned_items, owed::text, paid::text, outstanding::text
         from public.list_consignors($1, $2)`,
      [q, archived],
    );
    return rows;
  };
  const seeded = (rows: Row[]) =>
    rows.filter((r) => (Object.values(CONSIGNOR) as string[]).includes(r.id));

  it("item counts for every staff member; who is awaiting payment, owed, paid and outstanding only with manage_consignments or view_costs", async () => {
    await withRoles(async (tx, r) => {
      for (const [who, claims, money_] of [
        ["admin", r.admin, true],
        ["mechanic1", r.mechanic1, true],
        ["manager", r.manager, true],
        ["mechanic2", r.mechanic2, false],
        ["reports", r.reports, false],
      ] as const) {
        await actAs(tx, claims);
        const rows = seeded(await list(tx));
        expect({ who, names: rows.map((x) => x.display_name) }).toEqual({
          who,
          names: ["Chloe Lim", "Daniel Ong", "Kelvin Yeo"],
        });
        for (const row of rows) {
          const key = (Object.keys(CONSIGNOR) as SeedConsignor[]).find(
            (k) => CONSIGNOR[k] === row.id,
          )!;
          const want = EXPECTED_CONSIGNOR_LEDGER[key];
          expect({
            who,
            key,
            ...row,
            archived_at: undefined,
            display_name: undefined,
            customer_label: undefined,
            id: undefined,
          }).toEqual({
            who,
            key,
            active_items: want.active_items,
            sold_items: want.sold_items,
            // Who still has money owed is consignment money (D48).
            awaiting_settlement_items: money_ ? want.awaiting_settlement_items : null,
            returned_items: want.returned_items,
            owed: money_ ? want.owed : null,
            paid: money_ ? want.paid : null,
            outstanding: money_ ? want.outstanding : null,
          });
        }
      }
      const rows = seeded(await list(tx));
      expect(rows.map((x) => x.customer_label)).toEqual(["Chloe Lim", "Daniel Ong", null]);
    });
  });

  it("q matches name words and phone digits with or without +65; archived consignors are listed only on request", async () => {
    await withRoles(async (tx) => {
      for (const q of ["kelvin", "YEO kel", "98765432", "+65 9876 5432", "9876 5432"]) {
        expect({ q, names: seeded(await list(tx, q)).map((x) => x.display_name) }).toEqual({
          q,
          names: ["Kelvin Yeo"],
        });
      }
      expect(seeded(await list(tx, "chloe.lim@example"))).toHaveLength(1);
      const gone = await createConsignor(tx, { displayName: "Retired consignor" });
      await tx.query("update public.consignors set archived_at = now() where id = $1", [gone]);
      expect((await list(tx)).map((x) => x.id)).not.toContain(gone);
      const archived = await list(tx, null, true);
      expect(archived.map((x) => x.id)).toContain(gone);
      expect(archived.every((x) => x.archived_at !== null)).toBe(true);
    });
  });
});

describe("consignor_statement (D48)", () => {
  const statement = async (
    tx: pg.Client,
    consignorId: string | null,
    itemId: string | null = null,
  ) => {
    const { rows } = await tx.query(
      `select item_id, short_id, consignor_name, status::text, quantity, sold_qty, restocked_qty, returned_qty,
              remaining_qty, unit_short_id, unit_status::text, bike_id, product_name, asking_price::text,
              agreed_amount_owed::text, liability::text, consignor_charges::text, shop_charges::text,
              owed::text, paid::text, outstanding::text
         from public.consignor_statement(target_consignor_id => $1, target_item_id => $2)`,
      [consignorId, itemId],
    );
    return rows;
  };

  it("needs exactly one argument (22023)", async () => {
    await withRoles(async (tx) => {
      await failsWith(tx, () => statement(tx, null, null), { code: "22023" });
      await failsWith(tx, () => statement(tx, CONSIGNOR.kelvin, CONSIGNMENT_ITEM.colnago), {
        code: "22023",
      });
    });
  });

  it("one row per item, active first, matching the ledger; money only with manage_consignments or view_costs", async () => {
    await withRoles(async (tx, r) => {
      const kelvin = await statement(tx, CONSIGNOR.kelvin);
      expect(kelvin.map((x) => [x.short_id, x.status])).toEqual([
        [CONSIGNMENT_ITEM_SHORT_ID.colnago, "active"],
        [CONSIGNMENT_ITEM_SHORT_ID.crankset, "returned"],
      ]);
      expect(kelvin[0]).toMatchObject({
        consignor_name: "Kelvin Yeo",
        asking_price: "4200.00",
        agreed_amount_owed: "2400.00",
        shop_charges: "120.00",
        liability: "0.00",
        outstanding: "0.00",
        unit_status: "available",
      });
      expect(kelvin[1]).toMatchObject({
        returned_qty: 1,
        remaining_qty: 0,
        unit_status: "returned_to_consignor",
      });

      const [jerseys] = await statement(tx, null, CONSIGNMENT_ITEM.jerseys);
      expect(jerseys).toMatchObject({
        short_id: CONSIGNMENT_ITEM_SHORT_ID.jerseys,
        quantity: 6,
        sold_qty: 3,
        remaining_qty: 3,
        unit_short_id: null,
        liability: "105.00",
        paid: "40.00",
        outstanding: "65.00",
      });
      const [cervelo] = await statement(tx, CONSIGNOR.daniel);
      expect(cervelo).toMatchObject({ status: "sold", owed: "455.00", consignor_charges: "45.00" });

      for (const claims of [r.mechanic2, r.reports]) {
        await actAs(tx, claims);
        const [row] = await statement(tx, CONSIGNOR.daniel);
        expect(row).toMatchObject({
          sold_qty: 1,
          agreed_amount_owed: null,
          liability: null,
          consignor_charges: null,
          shop_charges: null,
          owed: null,
          paid: null,
          outstanding: null,
        });
      }
      for (const claims of [r.mechanic1, r.manager]) {
        await actAs(tx, claims);
        const [row] = await statement(tx, CONSIGNOR.daniel);
        expect(row).toMatchObject({ owed: "455.00", agreed_amount_owed: "500.00" });
      }
    });
  });
});

describe("list_sales and sale_lines_detail (D48, D49)", () => {
  const listSales = async (
    tx: pg.Client,
    a: { from?: Date | null; to?: Date | null; q?: string | null } = {},
  ) => {
    const { rows } = await tx.query(
      `select id, sale_number, source::text, status::text, recognized_at, customer_id, customer_label, line_count,
              first_description, has_consignment, restocked_lines, sale_total::text, refunded_total::text,
              cost_total::text, yield_total::text, cult_commons_share::text
         from public.list_sales($1, $2, $3, 200)`,
      [a.from ?? null, a.to ?? null, a.q ?? null],
    );
    return rows.filter((x) => (Object.values(SALE) as string[]).includes(x.id));
  };

  it("lists the seeded sales newest first with their refunds; range [from, to); q by number, customer or line", async () => {
    await withRoles(async (tx) => {
      const all = await listSales(tx);
      expect(all.map((x) => x.sale_number)).toEqual([
        "S-000004",
        "S-000003",
        "S-000002",
        "S-000001",
      ]);
      expect(all.find((x) => x.id === SALE.tubes)).toMatchObject({
        status: "partially_refunded",
        sale_total: "28.00",
        refunded_total: "14.00",
        has_consignment: false,
        customer_label: null,
        line_count: 1,
      });
      expect(all.find((x) => x.id === SALE.cervelo)).toMatchObject({
        source: "retail",
        customer_id: CUSTOMER.hafiz,
        customer_label: "Hafiz Rahman",
        has_consignment: true,
        restocked_lines: 0,
        sale_total: "1000.00",
        refunded_total: "0.00",
        cost_total: "500.00",
        yield_total: "500.00",
        cult_commons_share: "150.00",
      });
      const at = (id: string) => all.find((x) => x.id === id)!.recognized_at as Date;
      expect(
        (await listSales(tx, { from: at(SALE.tubes), to: at(SALE.cervelo) })).map(
          (x) => x.sale_number,
        ),
      ).toEqual(["S-000002"]);
      for (const q of ["S-000003", "s000003", "hafiz", "Cervélo R3"]) {
        expect({ q, n: (await listSales(tx, { q })).map((x) => x.sale_number) }).toEqual({
          q,
          n: ["S-000003"],
        });
      }
      expect((await listSales(tx, { q: "jersey" })).map((x) => x.sale_number)).toEqual([
        "S-000004",
        "S-000001",
      ]);
    });
  });

  it("cost, yield and Cult Commons need view_costs: NULL for mechanic2, a manage_consignments-only and a view_financial_reports-only member", async () => {
    await withRoles(async (tx, r) => {
      for (const [who, claims, costs] of [
        ["admin", r.admin, true],
        ["mechanic1", r.mechanic1, true],
        ["mechanic2", r.mechanic2, false],
        ["manager", r.manager, false],
        ["reports", r.reports, false],
      ] as const) {
        await actAs(tx, claims);
        const row = (await listSales(tx)).find((x) => x.id === SALE.cervelo);
        expect({ who, ...row }).toMatchObject({
          who,
          sale_total: "1000.00",
          cost_total: costs ? "500.00" : null,
          yield_total: costs ? "500.00" : null,
          cult_commons_share: costs ? "150.00" : null,
        });
      }
    });
  });

  it("sale_lines_detail: costs with view_costs, the payout with consignment money access, neither for a view_financial_reports-only member", async () => {
    await withRoles(async (tx, r) => {
      const detail = async (saleId: string) => {
        const { rows } = await tx.query(
          `select line_number, description_snapshot, quantity::text, unit_sale_price_snapshot::text, sale_total::text,
                  unit_short_id, unit_status::text, unit_sold_sale_line_id, unit_ownership_type::text, consignment_item_id,
                  consignment_short_id, consignor_name, unit_direct_cost_snapshot::text, cost_total::text,
                  yield_total::text, cult_commons_rate_snapshot::text, cult_commons_share::text,
                  consignor_payout_snapshot::text, id
             from public.sale_lines_detail($1)`,
          [saleId],
        );
        return rows;
      };
      const [line] = await detail(SALE.cervelo);
      expect(line).toMatchObject({
        line_number: 1,
        quantity: "1.00",
        unit_sale_price_snapshot: "1000.00",
        unit_short_id: expect.stringMatching(/^U-\d{6}$/),
        unit_status: "sold",
        unit_ownership_type: "consignment",
        consignment_item_id: CONSIGNMENT_ITEM.cervelo,
        consignment_short_id: CONSIGNMENT_ITEM_SHORT_ID.cervelo,
        consignor_name: "Daniel Ong",
        unit_direct_cost_snapshot: "500.00",
        cult_commons_rate_snapshot: "0.3000",
        cult_commons_share: "150.00",
        consignor_payout_snapshot: "500.00",
      });
      expect(line.unit_sold_sale_line_id).toBe(line.id);
      expect(await detail(randomUUID())).toEqual([]);

      for (const [who, claims, costs, payout] of [
        ["mechanic1", r.mechanic1, true, true],
        ["manager", r.manager, false, true],
        ["reports", r.reports, false, false],
        ["mechanic2", r.mechanic2, false, false],
      ] as const) {
        await actAs(tx, claims);
        const [row] = await detail(SALE.cervelo);
        expect({ who, ...row }).toMatchObject({
          who,
          sale_total: "1000.00",
          unit_direct_cost_snapshot: costs ? "500.00" : null,
          cost_total: costs ? "500.00" : null,
          yield_total: costs ? "500.00" : null,
          cult_commons_rate_snapshot: costs ? "0.3000" : null,
          cult_commons_share: costs ? "150.00" : null,
          consignor_payout_snapshot: payout ? "500.00" : null,
        });
      }
    });
  });
});

describe("saleable_stock (D45)", () => {
  const stock = async (tx: pg.Client, q: string) => {
    const { rows } = await tx.query(
      `select kind, product_id, inventory_unit_id, unit_short_id, title, location_id, on_hand, unit_price::text,
              ownership_type::text, consignment_item_id, consignment_short_id, consignor_name, rank
         from public.saleable_stock($1, 50)`,
      [q],
    );
    return rows;
  };

  it("offers the consigned Colnago at its selling price, exact U- first; the sold Cervélo and the returned crankset are not offered", async () => {
    await withRoles(async (tx) => {
      const colnago = (await stock(tx, "colnago")).find(
        (x) => x.inventory_unit_id === CONSIGNMENT_UNIT.colnago,
      );
      expect(colnago).toMatchObject({
        kind: "unit",
        ownership_type: "consignment",
        consignment_item_id: CONSIGNMENT_ITEM.colnago,
        consignor_name: "Kelvin Yeo",
        unit_price: "4200.00",
        on_hand: 1,
      });
      expect(colnago!.unit_price).toBe(
        await sellingPrice(tx, CONSIGNMENT_PRODUCT.colnago, CONSIGNMENT_UNIT.colnago),
      );
      const exact = await stock(tx, colnago!.unit_short_id);
      expect(exact[0]).toMatchObject({ inventory_unit_id: CONSIGNMENT_UNIT.colnago, rank: 1 });
      expect((await stock(tx, "kelvin")).map((x) => x.inventory_unit_id)).toContain(
        CONSIGNMENT_UNIT.colnago,
      );

      const ids = (rows: { product_id: string }[]) => rows.map((x) => x.product_id);
      expect(ids(await stock(tx, "cervelo r3"))).not.toContain(CONSIGNMENT_PRODUCT.cervelo);
      expect(ids(await stock(tx, "Cervélo"))).not.toContain(CONSIGNMENT_PRODUCT.cervelo);
      expect(ids(await stock(tx, "dura-ace crankset"))).not.toContain(CONSIGNMENT_PRODUCT.crankset);
      expect((await stock(tx, "a")).every((x) => x.ownership_type !== "customer_owned")).toBe(true);
      expect(await stock(tx, "   ")).toEqual([]);
    });
  });

  it("the jerseys are one row for C-000003 at the Shop floor: on hand 3 at 70.00, Chloe's", async () => {
    await withRoles(async (tx) => {
      const rows = (await stock(tx, "rapha jersey")).filter(
        (x) => x.product_id === CONSIGNMENT_PRODUCT.jersey,
      );
      expect(rows).toEqual([
        expect.objectContaining({
          kind: "product",
          inventory_unit_id: null,
          location_id: LOCATION.shopFloor,
          on_hand: 3,
          unit_price: "70.00",
          consignment_item_id: CONSIGNMENT_ITEM.jerseys,
          consignment_short_id: CONSIGNMENT_ITEM_SHORT_ID.jerseys,
          consignor_name: "Chloe Lim",
        }),
      ]);
      expect(rows[0].unit_price).toBe(await sellingPrice(tx, CONSIGNMENT_PRODUCT.jersey));
    });
  });
});

describe("who may read (D48)", () => {
  it("consignor_payout_details is manage_consignments only; P0002 for an unknown consignor", async () => {
    await withRoles(async (tx, r) => {
      const details = (id: string) =>
        scalar<string>(tx, "select public.consignor_payout_details($1)", [id]);
      expect(await details(CONSIGNOR.kelvin)).toBe("PayNow +65 9876 5432");
      await actAs(tx, r.manager);
      expect(await details(CONSIGNOR.chloe)).toBe("Bank transfer, details on the signed agreement");
      await failsWith(tx, () => details(randomUUID()), { code: "P0002" });
      for (const claims of [r.mechanic1, r.mechanic2, r.reports]) {
        await actAs(tx, claims);
        await failsWith(tx, () => details(CONSIGNOR.kelvin), { code: "42501" });
      }
    });
  });

  it("a signed-in customer gets 42501 from all six read RPCs, and anonymous visitors cannot execute them", async () => {
    const calls = [
      "select * from public.list_consignors()",
      `select * from public.consignor_statement(target_consignor_id => '${CONSIGNOR.chloe}')`,
      `select public.consignor_payout_details('${CONSIGNOR.chloe}')`,
      "select * from public.list_sales()",
      `select * from public.sale_lines_detail('${SALE.jerseys}')`,
      "select * from public.saleable_stock('jersey')",
    ];
    await inTransaction(conn, async (tx) => {
      for (const sql of calls) {
        await actAs(tx, customerClaims(CUSTOMER_LOGIN.chloe.authUserId));
        await failsWith(tx, () => tx.query(sql), { code: "42501" });
        await actAs(tx, { role: "anon" });
        await failsWith(tx, () => tx.query(sql), {
          code: "42501",
          message: expect.stringContaining("permission denied for function"),
        });
      }
    });
  });
});

describe("Historical line price/cost/yield snapshots do not change with catalog edits (seeded sales)", () => {
  it("new terms on C-000003 and a new product price leave S-000001's entry as it was", async () => {
    await withRoles(async (tx) => {
      const before = (await finLines(tx, day(6), anchor)).filter((e) => e.source === "sale");
      await updateTerms(tx, CONSIGNMENT_ITEM.jerseys, {
        agreed: "40.00",
        asking: "80.00",
        reason: "New season",
      });
      await ownerMode(tx);
      await tx.query("update public.products set default_sale_price = 99.00 where id = $1", [
        CONSIGNMENT_PRODUCT.jersey,
      ]);
      await actAs(tx, ADMIN);
      expect((await finLines(tx, day(6), anchor)).filter((e) => e.source === "sale")).toEqual(
        before,
      );
      // The liability keeps each line's own payout snapshot.
      expect((await itemLedger(tx, CONSIGNMENT_ITEM.jerseys)).liability).toBe("105.00");
    });
  });
});
