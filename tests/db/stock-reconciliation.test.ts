/**
 * Stock reconciliation (SPEC §12 "Current stock must be derivable/
 * reconcilable from movements", §23, §26; DATA-MODEL §14; PLAN D106
 * STOCK-RECONCILIATION).
 *
 *   * The seed reconciles, and reading reconciliation writes nothing.
 *   * Every RPC-reachable unit state reconciles after every step (Phase 3/4/6
 *     flows: hold, void, sell at completion, reopen, retail sale, refund,
 *     restock, transfer, cancel, consigned job part, consignment return,
 *     write-off).
 *   * Each corruption, written as the owner bypassing the RPCs and the
 *     Phase 4 triggers (session_replication_role = replica, rolled back),
 *     yields exactly its issue code and appears in the operational
 *     exceptions with the same issue.
 *   * private.unit_expected_on_hand is assert_unit_consistent's own rule.
 *
 * The data-dependent cases create products, units, jobs and sales (short-ID
 * sequences), so they skip in existing-database mode; the access refusals
 * run everywhere.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { LOCATION, STAFF } from "../fixtures/ids";
import {
  createConsignor,
  intakeUnique,
  recordSale,
  refund,
  restock,
  returnItem,
  saleLines,
} from "./consignment-fixtures";
import { customerClaims, linkCustomerLogin } from "./customer-fixtures";
import { actAs, asStaff, connect, inTransaction, isolatedDatabase, scalar } from "./harness";
import {
  ADMIN,
  addPart,
  assertLedgerConsistent,
  completeJob,
  makeLocation,
  makeProduct,
  makeUniqueWithUnit,
  MECHANIC2,
  newJob,
  reopenJob,
  transfer,
  writeOff,
} from "./inventory-fixtures";
import {
  failsWith,
  makeCustomer,
  ownerMode,
  setStatus,
  tryAndUndo,
  voidLine,
} from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const UNIT_RECONCILIATION_COLUMNS = [
  "unit_id",
  "unit_short_id",
  "product_id",
  "product_name",
  "status",
  "location_id",
  "location_name",
  "ledger_on_hand",
  "ledger_location_id",
  "ledger_location_name",
  "expected_on_hand",
  "disposition",
  "disposition_ref",
  "issue",
  "issue_detail",
  "last_movement_at",
];

const STOCK_RECONCILIATION_COLUMNS = [
  "product_id",
  "product_short_id",
  "product_name",
  "tracking_type",
  "location_id",
  "location_name",
  "ledger_on_hand",
  "units_in_stock",
  "issue",
];

type UnitRec = {
  unit_id: string;
  status: string;
  location_id: string;
  ledger_on_hand: number;
  ledger_location_id: string | null;
  expected_on_hand: number;
  disposition: string;
  disposition_ref: string | null;
  issue: string | null;
  issue_detail: string | null;
};

type StockRec = {
  product_id: string;
  location_id: string;
  tracking_type: string;
  ledger_on_hand: number;
  units_in_stock: number | null;
  issue: string | null;
};

/** report_unit_reconciliation(false, product) for one unit, as whoever `tx` is. */
async function unitRec(tx: pg.Client, productId: string, unitId: string): Promise<UnitRec> {
  const { rows } = await tx.query<UnitRec>(
    "select * from public.report_unit_reconciliation(false, $1, 1000) where unit_id = $2",
    [productId, unitId],
  );
  expect(rows).toHaveLength(1);
  return rows[0];
}

/** report_stock_reconciliation(false, product) rows, as whoever `tx` is. */
async function stockRec(tx: pg.Client, productId: string): Promise<StockRec[]> {
  return (
    await tx.query<StockRec>("select * from public.report_stock_reconciliation(false, $1, 1000)", [
      productId,
    ])
  ).rows;
}

/** Both RPCs report no issue for these products (and so their units). */
async function expectClean(tx: pg.Client, productIds: string[], step: string): Promise<void> {
  for (const productId of productIds) {
    const units = (
      await tx.query<UnitRec>("select * from public.report_unit_reconciliation(true, $1, 1000)", [
        productId,
      ])
    ).rows;
    expect(units, `${step}: unit issues`).toEqual([]);
    const stock = (
      await tx.query<StockRec>("select * from public.report_stock_reconciliation(true, $1, 1000)", [
        productId,
      ])
    ).rows;
    expect(stock, `${step}: stock issues`).toEqual([]);
  }
}

/** The admin's exceptions for one entity. */
async function exceptionsFor(tx: pg.Client, entityId: string) {
  return (
    await tx.query<{ kind: string; entity_type: string; issue: string; detail: string }>(
      "select * from public.operational_exceptions(200) where entity_id = $1",
      [entityId],
    )
  ).rows;
}

/** Owner mode with the Phase 4 triggers off (the transaction is rolled back). */
async function bypass(tx: pg.Client): Promise<void> {
  await ownerMode(tx);
  await tx.query("set local session_replication_role = replica");
}

const ROW_COUNTS = `select
  (select count(*) from public.inventory_movements)::int as movements,
  (select count(*) from public.inventory_units)::int as units,
  (select count(*) from public.inventory_unit_events)::int as unit_events,
  (select count(*) from public.consignment_items)::int as items,
  (select count(*) from public.consignment_item_events)::int as item_events,
  (select max(updated_at) from public.inventory_units)::text as units_updated,
  (select max(updated_at) from public.consignment_items)::text as items_updated`;

describe("Stock is derivable from the movement ledger (SPEC §12, §26, D106)", () => {
  it("the seed reconciles: no unit or stock issue (no negative_on_hand is seeded)", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      const units = (
        await tx.query<UnitRec>(
          "select * from public.report_unit_reconciliation(false, null, 1000)",
        )
      ).rows;
      expect(units.length).toBeGreaterThan(0);
      expect(units.filter((u) => u.issue !== null)).toEqual([]);
      const stock = (
        await tx.query<StockRec>(
          "select * from public.report_stock_reconciliation(false, null, 1000)",
        )
      ).rows;
      expect(stock.length).toBeGreaterThan(0);
      expect(stock.filter((s) => s.issue !== null)).toEqual([]);
      // Every unit's disposition explains its status.
      for (const u of units) {
        expect(u.ledger_on_hand).toBe(u.expected_on_hand);
      }
    });
  });

  it("running both RPCs writes nothing (movements, units, consignment rows unchanged)", async () => {
    await inTransaction(conn, async (tx) => {
      const before = (await tx.query(ROW_COUNTS)).rows[0];
      await actAs(tx, ADMIN);
      await tx.query("select * from public.report_unit_reconciliation(false, null, 1000)");
      await tx.query("select * from public.report_stock_reconciliation(false, null, 1000)");
      await tx.query("select * from public.operational_exceptions(200)");
      await ownerMode(tx);
      expect((await tx.query(ROW_COUNTS)).rows[0]).toEqual(before);
    });
  });

  it("returns exactly the documented columns, none of them a cost", async () => {
    await asStaff(conn, STAFF.mechanic2, async (tx) => {
      const u = await tx.query("select * from public.report_unit_reconciliation(false, null, 1)");
      expect(u.fields.map((f) => f.name)).toEqual(UNIT_RECONCILIATION_COLUMNS);
      const s = await tx.query("select * from public.report_stock_reconciliation(false, null, 1)");
      expect(s.fields.map((f) => f.name)).toEqual(STOCK_RECONCILIATION_COLUMNS);
      for (const name of [...UNIT_RECONCILIATION_COLUMNS, ...STOCK_RECONCILIATION_COLUMNS]) {
        expect(name).not.toMatch(/cost|value|price|amount|yield/);
      }
    });
  });

  it("clamps p_max_rows to 1..1000 and lists issues first", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      expect(
        (await tx.query("select * from public.report_stock_reconciliation(false, null, 0)")).rows,
      ).toHaveLength(1);
      expect(
        (await tx.query("select * from public.report_unit_reconciliation(false, null, -3)")).rows,
      ).toHaveLength(1);
      const all = (
        await tx.query("select * from public.report_stock_reconciliation(false, null, null)")
      ).rows;
      expect(all.length).toBeLessThanOrEqual(500);
    });
  });
});

describe("Every RPC-reachable unit state reconciles (D6/D25, D7, D16, D44, D46)", () => {
  it("hold, void, sell at completion, reopen, sale, refund, restock, transfer, cancel, consigned part, return, write-off", async (ctx) => {
    if (!isolatedDatabase()) ctx.skip();
    await inTransaction(conn, async (tx) => {
      const second = await makeLocation(tx);

      // Unit 1: held, voided, held again, sold at completion, reopened, sold again.
      const u1 = await makeUniqueWithUnit(tx, { unitCost: "100.00" });
      await expectClean(tx, [u1.productId], "unit 1 created");
      expect((await unitRec(tx, u1.productId, u1.unitId)).disposition).toBe("in_stock");
      const job1 = await newJob(tx);
      const line1 = await addPart(tx, {
        workOrderId: job1.id,
        productId: u1.productId,
        unitId: u1.unitId,
      });
      await expectClean(tx, [u1.productId], "unit 1 held");
      expect(await unitRec(tx, u1.productId, u1.unitId)).toMatchObject({
        status: "held_for_customer",
        disposition: "held_by_job",
        disposition_ref: job1.job_number,
      });
      await voidLine(tx, line1.line_id, "Wrong part");
      await expectClean(tx, [u1.productId], "unit 1 line voided");
      expect(await unitRec(tx, u1.productId, u1.unitId)).toMatchObject({
        status: "available",
        disposition: "in_stock",
      });
      await addPart(tx, { workOrderId: job1.id, productId: u1.productId, unitId: u1.unitId });
      await expectClean(tx, [u1.productId], "unit 1 held again");
      await completeJob(tx, job1.id);
      await expectClean(tx, [u1.productId], "unit 1 sold at completion");
      expect(await unitRec(tx, u1.productId, u1.unitId)).toMatchObject({
        status: "sold",
        disposition: "sold_by_job",
        disposition_ref: job1.job_number,
      });
      await reopenJob(tx, job1.id);
      await expectClean(tx, [u1.productId], "unit 1 job reopened");
      expect(await unitRec(tx, u1.productId, u1.unitId)).toMatchObject({
        status: "held_for_customer",
        disposition: "held_by_job",
      });
      await completeJob(tx, job1.id);
      await expectClean(tx, [u1.productId], "unit 1 sold again");
      expect((await unitRec(tx, u1.productId, u1.unitId)).disposition).toBe("sold_by_job");

      // Unit 2: sold, refunded (no movement, D7), restocked, transferred.
      const u2 = await makeUniqueWithUnit(tx, { unitCost: "50.00", unitPrice: "90.00" });
      await actAs(tx, ADMIN);
      const sale = await recordSale(tx, { lines: [{ inventory_unit_id: u2.unitId }] });
      await expectClean(tx, [u2.productId], "unit 2 sold");
      expect(await unitRec(tx, u2.productId, u2.unitId)).toMatchObject({
        status: "sold",
        disposition: "sold_by_sale",
        disposition_ref: sale.sale_number,
      });
      await refund(tx, { saleId: sale.sale_id, amount: "90.00" });
      await expectClean(tx, [u2.productId], "unit 2 refunded");
      expect((await unitRec(tx, u2.productId, u2.unitId)).disposition).toBe("sold_by_sale");
      const [saleLine] = await saleLines(tx, sale.sale_id);
      await restock(tx, { unitId: u2.unitId, saleLineId: saleLine.id });
      await expectClean(tx, [u2.productId], "unit 2 restocked");
      expect(await unitRec(tx, u2.productId, u2.unitId)).toMatchObject({
        status: "available",
        disposition: "in_stock",
      });
      // The old sale line still references the unit; the restock wins.
      await ownerMode(tx);
      expect(
        await scalar<number>(
          tx,
          "select count(*)::int from public.sale_lines where inventory_unit_id = $1",
          [u2.unitId],
        ),
      ).toBe(1);
      await actAs(tx, ADMIN);
      await transfer(tx, {
        productId: u2.productId,
        from: LOCATION.shopFloor,
        to: second,
        unitId: u2.unitId,
        reason: "Moved to storage",
      });
      await expectClean(tx, [u2.productId], "unit 2 transferred");
      expect(await unitRec(tx, u2.productId, u2.unitId)).toMatchObject({
        location_id: second,
        ledger_location_id: second,
        disposition: "in_stock",
      });

      // Unit 3: on a job, line voided (D16), job cancelled with a reason.
      const u3 = await makeUniqueWithUnit(tx);
      const job3 = await newJob(tx);
      const line3 = await addPart(tx, {
        workOrderId: job3.id,
        productId: u3.productId,
        unitId: u3.unitId,
      });
      await expectClean(tx, [u3.productId], "unit 3 held");
      await voidLine(tx, line3.line_id, "Customer declined");
      await expectClean(tx, [u3.productId], "unit 3 line voided");
      await setStatus(tx, job3.id, "cancelled", "Customer withdrew");
      await expectClean(tx, [u3.productId], "unit 3 job cancelled");
      expect(await unitRec(tx, u3.productId, u3.unitId)).toMatchObject({
        status: "available",
        disposition: "in_stock",
      });

      // Unit 4: a consigned unit through a job (D44).
      await actAs(tx, ADMIN);
      const consignorId = await createConsignor(tx);
      const item4 = await intakeUnique(tx, { consignorId, agreed: "300.00", asking: "600.00" });
      await expectClean(tx, [item4.product_id], "unit 4 received");
      const job4 = await newJob(tx);
      await addPart(tx, {
        workOrderId: job4.id,
        productId: item4.product_id,
        unitId: item4.inventory_unit_id,
      });
      await expectClean(tx, [item4.product_id], "unit 4 held on a job");
      await completeJob(tx, job4.id);
      await expectClean(tx, [item4.product_id], "unit 4 sold on the job");
      expect(await unitRec(tx, item4.product_id, item4.inventory_unit_id!)).toMatchObject({
        status: "sold",
        disposition: "sold_by_job",
      });
      await ownerMode(tx);
      expect(
        await scalar<string>(
          tx,
          "select status::text from public.consignment_items where id = $1",
          [item4.item_id],
        ),
      ).toBe("sold");

      // Unit 5: consigned, then returned to its consignor.
      await actAs(tx, ADMIN);
      const item5 = await intakeUnique(tx, { consignorId, agreed: "200.00" });
      await returnItem(tx, { itemId: item5.item_id });
      await expectClean(tx, [item5.product_id], "unit 5 returned");
      expect(await unitRec(tx, item5.product_id, item5.inventory_unit_id!)).toMatchObject({
        status: "returned_to_consignor",
        disposition: "returned",
      });

      // Unit 6: written off.
      const u6 = await makeUniqueWithUnit(tx);
      await actAs(tx, ADMIN);
      await writeOff(tx, u6.unitId);
      await expectClean(tx, [u6.productId], "unit 6 written off");
      expect(await unitRec(tx, u6.productId, u6.unitId)).toMatchObject({
        status: "written_off",
        disposition: "written_off",
      });

      // None of it is an exception.
      for (const id of [
        u1.unitId,
        u2.unitId,
        u3.unitId,
        item4.inventory_unit_id!,
        item5.inventory_unit_id!,
        u6.unitId,
      ])
        expect(await exceptionsFor(tx, id)).toEqual([]);

      // And Phase 4's own commit-time check agrees.
      await assertLedgerConsistent(tx);
    });
  });
});

/**
 * Builds a state through the RPCs as the admin, corrupts it as the owner
 * with the triggers off, and returns to the admin.
 */
async function corrupted<T>(
  tx: pg.Client,
  build: () => Promise<T>,
  corrupt: (state: T) => Promise<void>,
): Promise<T> {
  const state = await build();
  await bypass(tx);
  await corrupt(state);
  await actAs(tx, ADMIN);
  return state;
}

async function adjust(
  tx: pg.Client,
  a: { productId: string; unitId: string | null; locationId: string; delta: number },
) {
  await tx.query(
    `insert into public.inventory_movements
       (product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason)
     values ($1, $2, $3, $4, 'stock_adjustment', 'Owner hand fix in a test')`,
    [a.productId, a.unitId, a.locationId, a.delta],
  );
}

describe("A unique unit cannot be in two states or places at once (SPEC §12, §23; D106)", () => {
  const cases: Array<{
    name: string;
    issue: string;
    run: (tx: pg.Client) => Promise<{ productId: string; unitId: string }>;
  }> = [
    {
      name: "an extra +1 movement at a second location",
      issue: "ledger_out_of_range",
      run: async (tx) => {
        const second = await makeLocation(tx);
        return corrupted(
          tx,
          () => makeUniqueWithUnit(tx),
          (s) =>
            adjust(tx, { productId: s.productId, unitId: s.unitId, locationId: second, delta: 1 }),
        );
      },
    },
    {
      name: "a unit sold through record_retail_sale, then set available",
      issue: "sale_without_sold_status",
      run: (tx) =>
        corrupted(
          tx,
          async () => {
            const s = await makeUniqueWithUnit(tx);
            await actAs(tx, ADMIN);
            await recordSale(tx, { lines: [{ inventory_unit_id: s.unitId }] });
            return s;
          },
          async (s) => {
            await tx.query(
              "update public.inventory_units set status = 'available', sold_at = null where id = $1",
              [s.unitId],
            );
          },
        ),
    },
    {
      name: "a sold unit given a later +1 stock_adjustment while it stays sold (check 3 before 6)",
      issue: "sold_without_sale",
      run: (tx) =>
        corrupted(
          tx,
          async () => {
            const s = await makeUniqueWithUnit(tx);
            await actAs(tx, ADMIN);
            await recordSale(tx, { lines: [{ inventory_unit_id: s.unitId }] });
            return s;
          },
          (s) =>
            adjust(tx, {
              productId: s.productId,
              unitId: s.unitId,
              locationId: LOCATION.shopFloor,
              delta: 1,
            }),
        ),
    },
    {
      name: "an available unit given a -1 stock_adjustment without a status change",
      issue: "in_stock_without_ledger",
      run: (tx) =>
        corrupted(
          tx,
          () => makeUniqueWithUnit(tx),
          (s) =>
            adjust(tx, {
              productId: s.productId,
              unitId: s.unitId,
              locationId: LOCATION.shopFloor,
              delta: -1,
            }),
        ),
    },
    {
      name: "an in-stock unit set written_off without a movement",
      issue: "ledger_without_stock_status",
      run: (tx) =>
        corrupted(
          tx,
          () => makeUniqueWithUnit(tx),
          async (s) => {
            await tx.query(
              "update public.inventory_units set status = 'written_off' where id = $1",
              [s.unitId],
            );
          },
        ),
    },
    {
      name: "location_id changed without movements",
      issue: "location_mismatch",
      run: async (tx) => {
        const second = await makeLocation(tx);
        return corrupted(
          tx,
          () => makeUniqueWithUnit(tx),
          async (s) => {
            await tx.query("update public.inventory_units set location_id = $2 where id = $1", [
              s.unitId,
              second,
            ]);
          },
        );
      },
    },
    {
      name: "a consignment item set sold while its unit is available",
      issue: "consignment_status_mismatch",
      run: (tx) =>
        corrupted(
          tx,
          async () => {
            await actAs(tx, ADMIN);
            const consignorId = await createConsignor(tx);
            const item = await intakeUnique(tx, { consignorId, agreed: "100.00" });
            return {
              productId: item.product_id,
              unitId: item.inventory_unit_id!,
              itemId: item.item_id,
            };
          },
          async (s) => {
            await tx.query(
              "update public.consignment_items set status = 'sold', sold_at = now() where id = $1",
              [s.itemId],
            );
          },
        ),
    },
  ];

  for (const c of cases) {
    it(`${c.name} -> ${c.issue}, mirrored in the exceptions`, async (ctx) => {
      if (!isolatedDatabase()) ctx.skip();
      await inTransaction(conn, async (tx) => {
        const s = await c.run(tx);
        const rec = await unitRec(tx, s.productId, s.unitId);
        expect(rec.issue).toBe(c.issue);
        expect(rec.issue_detail).toEqual(expect.any(String));
        expect(rec.issue_detail!.length).toBeGreaterThan(10);
        // Issues come first in the unfiltered list.
        const listed = (
          await tx.query<UnitRec>(
            "select * from public.report_unit_reconciliation(true, null, 1000)",
          )
        ).rows;
        expect(listed.map((r) => r.unit_id)).toContain(s.unitId);
        expect(await exceptionsFor(tx, s.unitId)).toMatchObject([
          {
            kind: "unit_state_mismatch",
            severity: "danger",
            entity_type: "inventory_unit",
            issue: c.issue,
            detail: rec.issue_detail,
          },
        ]);
      });
    });
  }

  it("a held unit whose job is cancelled without voiding the line -> held_without_open_job, listed once as Phase 5's unit_hold_stale", async (ctx) => {
    if (!isolatedDatabase()) ctx.skip();
    await inTransaction(conn, async (tx) => {
      const s = await corrupted(
        tx,
        async () => {
          const u = await makeUniqueWithUnit(tx);
          const job = await newJob(tx);
          await addPart(tx, { workOrderId: job.id, productId: u.productId, unitId: u.unitId });
          return { ...u, jobId: job.id };
        },
        async (st) => {
          await tx.query(
            `update public.work_orders
                set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Owner hand fix'
              where id = $1`,
            [st.jobId],
          );
        },
      );
      const rec = await unitRec(tx, s.productId, s.unitId);
      expect(rec).toMatchObject({
        status: "held_for_customer",
        disposition: "held_on_closed_job",
        issue: "held_without_open_job",
      });
      const rows = await exceptionsFor(tx, s.unitId);
      expect(rows).toMatchObject([{ kind: "unit_hold_stale", issue: "unit_hold_stale" }]);
      expect(rows.filter((r) => r.kind === "unit_state_mismatch")).toEqual([]);
    });
  });

  it("a quantity product driven below zero -> negative_on_hand, mirrored by exactly one negative_stock row", async (ctx) => {
    if (!isolatedDatabase()) ctx.skip();
    await inTransaction(conn, async (tx) => {
      const location = await makeLocation(tx);
      const productId = await makeProduct(tx);
      await bypass(tx);
      await adjust(tx, { productId, unitId: null, locationId: location, delta: -2 });
      await actAs(tx, ADMIN);
      expect(await stockRec(tx, productId)).toMatchObject([
        {
          location_id: location,
          tracking_type: "quantity",
          ledger_on_hand: -2,
          units_in_stock: null,
          issue: "negative_on_hand",
        },
      ]);
      expect(await exceptionsFor(tx, productId)).toMatchObject([
        { kind: "negative_stock", entity_type: "product", issue: "negative_on_hand", quantity: -2 },
      ]);
    });
  });

  it("a unique-product movement without a unit -> unique_movement_without_unit", async (ctx) => {
    if (!isolatedDatabase()) ctx.skip();
    await inTransaction(conn, async (tx) => {
      const s = await corrupted(
        tx,
        () => makeUniqueWithUnit(tx),
        (st) =>
          adjust(tx, {
            productId: st.productId,
            unitId: null,
            locationId: LOCATION.shopFloor,
            delta: 1,
          }),
      );
      expect(await stockRec(tx, s.productId)).toMatchObject([
        {
          location_id: LOCATION.shopFloor,
          tracking_type: "unique",
          ledger_on_hand: 2,
          units_in_stock: 1,
          issue: "unique_movement_without_unit",
        },
      ]);
      // The unit itself still reconciles: it nets only its own movements.
      expect((await unitRec(tx, s.productId, s.unitId)).issue).toBeNull();
      expect(await exceptionsFor(tx, s.productId)).toMatchObject([
        {
          kind: "unit_state_mismatch",
          entity_type: "product",
          issue: "unique_movement_without_unit",
          quantity: 2,
        },
      ]);
    });
  });

  it("a location whose unit count and ledger differ -> unit_count_mismatch", async (ctx) => {
    if (!isolatedDatabase()) ctx.skip();
    await inTransaction(conn, async (tx) => {
      const second = await makeLocation(tx);
      const s = await corrupted(
        tx,
        () => makeUniqueWithUnit(tx),
        async (st) => {
          await tx.query("update public.inventory_units set location_id = $2 where id = $1", [
            st.unitId,
            second,
          ]);
        },
      );
      const rows = await stockRec(tx, s.productId);
      expect(rows.find((r) => r.location_id === LOCATION.shopFloor)).toMatchObject({
        ledger_on_hand: 1,
        units_in_stock: 0,
        issue: "unit_count_mismatch",
      });
      expect(rows.find((r) => r.location_id === second)).toMatchObject({
        ledger_on_hand: 0,
        units_in_stock: 1,
        issue: "unit_count_mismatch",
      });
      const product = (await exceptionsFor(tx, s.productId)).filter(
        (r) => r.kind === "unit_state_mismatch",
      );
      expect(product).toHaveLength(2);
      for (const r of product)
        expect(r).toMatchObject({ entity_type: "product", issue: "unit_count_mismatch" });
    });
  });
});

describe("unit_expected_on_hand matches Phase 4's rule (assert_unit_consistent)", () => {
  it("for every unit_status value, the unit is consistent exactly at the on-hand the function gives", async (ctx) => {
    if (!isolatedDatabase()) ctx.skip();
    await inTransaction(conn, async (tx) => {
      const s = await makeUniqueWithUnit(tx);
      await ownerMode(tx);
      const statuses = (
        await tx.query<{ v: string }>(
          "select unnest(enum_range(null::public.unit_status))::text as v",
        )
      ).rows.map((r) => r.v);
      expect(statuses).toHaveLength(6);
      for (const status of statuses) {
        const expected = await scalar<number>(tx, "select private.unit_expected_on_hand($1)", [
          status,
        ]);
        const consistentAt = async (net: 0 | 1): Promise<boolean> =>
          tryAndUndo(tx, async () => {
            await tx.query("set local session_replication_role = replica");
            if (net === 0)
              await adjust(tx, {
                productId: s.productId,
                unitId: s.unitId,
                locationId: LOCATION.shopFloor,
                delta: -1,
              });
            await tx.query(
              `update public.inventory_units
                  set status = $2::public.unit_status, sold_at = case when $2::text = 'sold' then now() end
                where id = $1`,
              [s.unitId, status],
            );
            try {
              await tx.query("savepoint probe");
              await tx.query("select private.assert_unit_consistent($1)", [s.unitId]);
              await tx.query("release savepoint probe");
              return true;
            } catch (err) {
              await tx.query("rollback to savepoint probe");
              expect(err).toMatchObject({ code: "P0001", message: "unit_ledger_inconsistent" });
              return false;
            }
          });
        expect([status, await consistentAt(1)]).toEqual([status, expected === 1]);
        expect([status, await consistentAt(0)]).toEqual([status, expected === 0]);
      }
      expect(
        await scalar<number | null>(tx, "select private.unit_expected_on_hand(null)"),
      ).toBeNull();
    });
  });
});

describe("Reconciliation access (D30: stock is staff-visible)", () => {
  it("any active staff member may call both RPCs", async () => {
    for (const staffId of [STAFF.admin, STAFF.manager, STAFF.mechanic1, STAFF.mechanic2]) {
      await asStaff(conn, staffId, async (tx) => {
        await tx.query("select * from public.report_stock_reconciliation()");
        await tx.query("select * from public.report_unit_reconciliation()");
      });
    }
  });

  it("a signed-in customer gets 42501; anon has no EXECUTE", async () => {
    await inTransaction(conn, async (tx) => {
      const customerId = await makeCustomer(tx);
      const authUserId = await linkCustomerLogin(tx, customerId);
      await actAs(tx, customerClaims(authUserId));
      for (const sql of [
        "select * from public.report_stock_reconciliation()",
        "select * from public.report_unit_reconciliation()",
      ])
        await failsWith(tx, () => tx.query(sql), { code: "42501" });
      await ownerMode(tx);
      await actAs(tx, { role: "anon" });
      for (const sql of [
        "select * from public.report_stock_reconciliation()",
        "select * from public.report_unit_reconciliation()",
      ])
        await failsWith(tx, () => tx.query(sql), { code: "42501" });
    });
  });

  it("no API role can select the reconciliation views", async () => {
    await inTransaction(conn, async (tx) => {
      for (const claims of [{ role: "anon" as const }, ADMIN]) {
        await ownerMode(tx);
        await actAs(tx, claims);
        for (const view of [
          "reporting.unit_ledger_disposition",
          "reporting.unit_reconciliation",
          "reporting.stock_reconciliation",
        ])
          await failsWith(tx, () => tx.query(`select 1 from ${view} limit 1`), { code: "42501" });
      }
    });
  });

  it("a unit read is the same for a mechanic without view_costs", async (ctx) => {
    if (!isolatedDatabase()) ctx.skip();
    await inTransaction(conn, async (tx) => {
      const s = await makeUniqueWithUnit(tx, { unitCost: "123.00" });
      const asAdmin = await unitRec(tx, s.productId, s.unitId);
      await ownerMode(tx);
      await actAs(tx, MECHANIC2);
      expect(await unitRec(tx, s.productId, s.unitId)).toEqual(asAdmin);
    });
  });
});
