/**
 * Consigned stock as a job part: the owner's D27 change (2026-10-05),
 * implemented by D44 CONS-JOB-PART (SPEC §2, §9, §10, §12, §13, §23;
 * DATA-MODEL §5, §7, §9, §16; PLAN D1, D4, D6/D25, D14, D23, D24 (amended),
 * D44, D45, D50). A consigned part snapshots cost = agreed amount (+ a
 * unique item's shop charges) and payout = agreed amount; quantity parts
 * draw FIFO from one item; the item is sold and the liability exists
 * exactly while the line is live on a completed job; customer-owned stock
 * is never a part.
 *
 * Tests create products, units, items and jobs (short-ID sequences), so the
 * file runs only on a per-file clone. Every test ends with
 * assertLedgerConsistent().
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { LOCATION } from "../fixtures/ids";
import {
  addCharge,
  createConsignor,
  intakeQuantity,
  intakeUnique,
  itemEvents,
  itemMovements,
  itemPosition,
  itemStatus,
} from "./consignment-fixtures";
import { actAs, connect, inTransaction, isolatedDatabase, scalar } from "./harness";
import {
  ADMIN,
  MECHANIC2,
  addPart,
  addStock,
  assertLedgerConsistent,
  completeJob,
  makeProduct,
  newJob,
  onHand,
  readAsOwner,
  reopenJob,
  transfer,
  unit,
} from "./inventory-fixtures";
import { failsWith, ownerMode, setStatus, voidLine } from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

/** A rolled-back transaction acting as the admin. */
const inTx = <T>(fn: (tx: pg.Client) => Promise<T>) =>
  inTransaction(conn, async (tx) => {
    await actAs(tx, ADMIN);
    return fn(tx);
  });

type Line = {
  unit_sale_price_snapshot: string;
  unit_direct_cost_snapshot: string;
  sale_total: string;
  cost_total: string;
  yield_total: string;
  cult_commons_share: string;
  cost_pending: boolean;
  consignment_item_id: string | null;
  consignor_payout_snapshot: string | null;
  quantity: string;
};

/** A line's economics (read as the owner). */
const lineRow = (tx: pg.Client, lineId: string) =>
  readAsOwner(tx, async () => {
    const { rows } = await tx.query<Line>(
      `select unit_sale_price_snapshot::text, unit_direct_cost_snapshot::text, sale_total::text,
              cost_total::text, yield_total::text, cult_commons_share::text, cost_pending,
              consignment_item_id, consignor_payout_snapshot::text, quantity::text
         from public.work_order_line_items where id = $1`,
      [lineId],
    );
    return rows[0];
  });

/** The job's BICII yield after Cult Commons, through the view_costs view (as the admin). */
const bicIiAfterCc = (tx: pg.Client, workOrderId: string) =>
  scalar<string>(
    tx,
    "select bicii_yield_after_cc::text from public.work_order_totals_staff where work_order_id = $1",
    [workOrderId],
  );

describe.skipIf(!isolatedDatabase())("a consigned unit as a job part (D44, D6/D25)", () => {
  it("is held on add with cost and payout = agreed, sold at completion with the liability, and its line follows SPEC §10", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const r = await intakeUnique(tx, { consignorId, agreed: "500.00", asking: "1000.00" });
      const job = await newJob(tx);
      const part = await addPart(tx, {
        workOrderId: job.id,
        productId: r.product_id,
        unitId: r.inventory_unit_id,
      });
      expect(part.replayed).toBe(false);
      expect((await unit(tx, r.inventory_unit_id!)).status).toBe("held_for_customer");
      expect(await lineRow(tx, part.line_id)).toMatchObject({
        unit_sale_price_snapshot: "1000.00",
        unit_direct_cost_snapshot: "500.00",
        consignment_item_id: r.item_id,
        consignor_payout_snapshot: "500.00",
        cost_pending: false,
      });
      expect(await itemStatus(tx, r.item_id)).toBe("active");
      expect(await itemPosition(tx, r.item_id)).toMatchObject({
        job_held_qty: 1,
        job_sold_qty: 0,
        remaining_qty: 0,
        owed_qty: 0,
        liability: "0.00",
      });
      const moves = await itemMovements(tx, r.product_id);
      expect(moves.at(-1)).toMatchObject({
        movement_type: "job_consumption",
        quantity_delta: -1,
        consignment_item_id: r.item_id,
        unit_cost_snapshot: "500.00",
      });

      const done = await completeJob(tx, job.id);
      expect((await unit(tx, r.inventory_unit_id!)).status).toBe("sold");
      expect(await itemStatus(tx, r.item_id)).toBe("sold");
      expect(await itemPosition(tx, r.item_id)).toMatchObject({
        job_sold_qty: 1,
        owed_qty: 1,
        liability: "500.00",
      });
      const sold = (await itemEvents(tx, r.item_id)).find((e) => e.event_type === "status_changed");
      expect(sold?.payload).toEqual({
        from: "active",
        to: "sold",
        cause: "job_completed",
        work_order_id: job.id,
        job_number: done.job_number,
      });
      // SPEC §10: yield after all direct costs (the payout is one), 30% CC.
      expect(await lineRow(tx, part.line_id)).toMatchObject({
        sale_total: "1000.00",
        cost_total: "500.00",
        yield_total: "500.00",
        cult_commons_share: "150.00",
      });
      expect(await bicIiAfterCc(tx, job.id)).toBe("350.00");
      await assertLedgerConsistent(tx);
    });
  });

  it("a shop charge raises the part's cost (D4); a consignor charge does not; a loss line has Cult Commons 0.00 (D1)", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const r = await intakeUnique(tx, { consignorId, agreed: "500.00", asking: "1000.00" });
      await addCharge(tx, { itemId: r.item_id, amount: "120.00", bearer: "shop" });
      await addCharge(tx, {
        itemId: r.item_id,
        amount: "45.00",
        bearer: "consignor",
        description: "Detailing",
      });
      const job = await newJob(tx);
      const part = await addPart(tx, {
        workOrderId: job.id,
        productId: r.product_id,
        unitId: r.inventory_unit_id,
      });
      await completeJob(tx, job.id);
      expect(await lineRow(tx, part.line_id)).toMatchObject({
        unit_direct_cost_snapshot: "620.00",
        consignor_payout_snapshot: "500.00",
        cost_total: "620.00",
        yield_total: "380.00",
        cult_commons_share: "114.00",
      });
      // The liability is the payout; consignor charges come off what is owed (step 2's ledger).
      expect(await itemPosition(tx, r.item_id)).toMatchObject({
        liability: "500.00",
        consignor_charges: "45.00",
        shop_charges: "120.00",
      });

      const loss = await intakeUnique(tx, { consignorId, agreed: "500.00", asking: "1000.00" });
      const lossJob = await newJob(tx);
      const lossPart = await addPart(tx, {
        workOrderId: lossJob.id,
        productId: loss.product_id,
        unitId: loss.inventory_unit_id,
        price: "400.00",
      });
      expect(await lineRow(tx, lossPart.line_id)).toMatchObject({
        sale_total: "400.00",
        cost_total: "500.00",
        yield_total: "-100.00",
        cult_commons_share: "0.00",
      });
      await assertLedgerConsistent(tx);
    });
  });

  it("reopen removes the sale and the liability; re-completion restores it once; a repeated completion is a no-op", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const r = await intakeUnique(tx, { consignorId, agreed: "500.00", asking: "1000.00" });
      const job = await newJob(tx);
      await addPart(tx, {
        workOrderId: job.id,
        productId: r.product_id,
        unitId: r.inventory_unit_id,
      });
      await completeJob(tx, job.id);
      expect((await itemPosition(tx, r.item_id)).liability).toBe("500.00");

      await reopenJob(tx, job.id);
      expect((await unit(tx, r.inventory_unit_id!)).status).toBe("held_for_customer");
      expect(await itemStatus(tx, r.item_id)).toBe("active");
      expect(await itemPosition(tx, r.item_id)).toMatchObject({ owed_qty: 0, liability: "0.00" });

      await completeJob(tx, job.id);
      await setStatus(tx, job.id, "completed");
      await setStatus(tx, job.id, "ready_for_collection");
      expect(await itemStatus(tx, r.item_id)).toBe("sold");
      expect(await itemPosition(tx, r.item_id)).toMatchObject({ owed_qty: 1, liability: "500.00" });
      const changes = (await itemEvents(tx, r.item_id))
        .filter((e) => e.event_type === "status_changed")
        .map((e) => [e.payload.from, e.payload.to, e.payload.cause]);
      expect(changes).toEqual([
        ["active", "sold", "job_completed"],
        ["sold", "active", "job_reopened"],
        ["active", "sold", "job_completed"],
      ]);
      await assertLedgerConsistent(tx);
    });
  });

  it("voiding the part on the open job writes a linked reversal carrying the item; the unit is available and the item active", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const r = await intakeUnique(tx, { consignorId, agreed: "500.00" });
      const job = await newJob(tx);
      const part = await addPart(tx, {
        workOrderId: job.id,
        productId: r.product_id,
        unitId: r.inventory_unit_id,
      });
      await completeJob(tx, job.id);
      await reopenJob(tx, job.id);
      await voidLine(tx, part.line_id, "Customer changed their mind");
      const moves = await itemMovements(tx, r.product_id);
      const consumption = moves.find((m) => m.movement_type === "job_consumption")!;
      expect(moves.at(-1)).toMatchObject({
        movement_type: "reversal",
        quantity_delta: 1,
        reversal_of_id: consumption.id,
        consignment_item_id: r.item_id,
      });
      expect((await unit(tx, r.inventory_unit_id!)).status).toBe("available");
      expect(await itemStatus(tx, r.item_id)).toBe("active");
      expect(await itemPosition(tx, r.item_id)).toMatchObject({
        remaining_qty: 1,
        job_held_qty: 0,
        liability: "0.00",
      });
      expect(await onHand(tx, r.product_id)).toBe(1);
      await assertLedgerConsistent(tx);
    });
  });

  it("A work-order part consumes stock exactly once: a replayed add returns the same line with no second movement", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const r = await intakeUnique(tx, { consignorId, agreed: "500.00" });
      const job = await newJob(tx);
      const lineId = randomUUID();
      const args = {
        lineId,
        workOrderId: job.id,
        productId: r.product_id,
        unitId: r.inventory_unit_id,
      };
      const first = await addPart(tx, args);
      const again = await addPart(tx, args);
      expect(again).toMatchObject({
        line_id: lineId,
        movement_id: first.movement_id,
        replayed: true,
      });
      expect(
        (await itemMovements(tx, r.product_id)).filter(
          (m) => m.movement_type === "job_consumption",
        ),
      ).toHaveLength(1);
      // A second job cannot take the held unit.
      const other = await newJob(tx);
      await failsWith(
        tx,
        () =>
          addPart(tx, {
            workOrderId: other.id,
            productId: r.product_id,
            unitId: r.inventory_unit_id,
          }),
        { code: "P0001", message: "unit_not_available" },
      );
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())("consigned quantity parts (D44, D45, D50)", () => {
  it("draw FIFO from one item at that item's asking price; never more than one item has; never below zero", async () => {
    await inTx(async (tx) => {
      const a = await createConsignor(tx);
      const b = await createConsignor(tx);
      const older = await intakeQuantity(tx, {
        consignorId: a,
        agreed: "20.00",
        asking: "30.00",
        quantity: 2,
        receivedAt: "2026-01-02T00:00:00Z",
      });
      const productId = older.product_id;
      const newer = await intakeQuantity(tx, {
        consignorId: b,
        agreed: "25.00",
        asking: "35.00",
        quantity: 3,
        productId,
      });
      const job = await newJob(tx);
      const one = await addPart(tx, { workOrderId: job.id, productId, quantity: 1 });
      expect(await lineRow(tx, one.line_id)).toMatchObject({
        consignment_item_id: older.item_id,
        unit_sale_price_snapshot: "30.00",
        unit_direct_cost_snapshot: "20.00",
        consignor_payout_snapshot: "20.00",
      });
      // The older item has 1 left, which does not cover 2: the next item does.
      const two = await addPart(tx, { workOrderId: job.id, productId, quantity: 2 });
      expect(await lineRow(tx, two.line_id)).toMatchObject({
        consignment_item_id: newer.item_id,
        unit_sale_price_snapshot: "35.00",
        unit_direct_cost_snapshot: "25.00",
        consignor_payout_snapshot: "25.00",
        sale_total: "70.00",
      });
      // An override wins (D14).
      const priced = await addPart(tx, {
        workOrderId: job.id,
        productId,
        quantity: 1,
        price: "28.00",
      });
      expect(await lineRow(tx, priced.line_id)).toMatchObject({
        consignment_item_id: older.item_id,
        unit_sale_price_snapshot: "28.00",
      });
      // 1 left on the newer item, none on the older: 2 is more than any one item has.
      await failsWith(tx, () => addPart(tx, { workOrderId: job.id, productId, quantity: 2 }), {
        code: "P0001",
        message: "consignment_quantity_unavailable",
      });

      await completeJob(tx, job.id);
      expect(await itemStatus(tx, older.item_id)).toBe("sold");
      expect(await itemStatus(tx, newer.item_id)).toBe("active");
      expect(await itemPosition(tx, older.item_id)).toMatchObject({
        owed_qty: 2,
        liability: "40.00",
      });
      expect(await itemPosition(tx, newer.item_id)).toMatchObject({
        owed_qty: 2,
        remaining_qty: 1,
        liability: "50.00",
      });

      // Covered by the item, but not at that location: no negative consigned stock.
      const c = await intakeQuantity(tx, { consignorId: a, agreed: "5.00", quantity: 3 });
      await transfer(tx, {
        productId: c.product_id,
        from: LOCATION.shopFloor,
        to: LOCATION.workshopStore,
        quantity: 2,
      });
      const second = await newJob(tx);
      await failsWith(
        tx,
        () =>
          addPart(tx, {
            workOrderId: second.id,
            productId: c.product_id,
            quantity: 2,
            locationId: LOCATION.shopFloor,
          }),
        { code: "P0001", message: "insufficient_stock" },
      );
      await addPart(tx, {
        workOrderId: second.id,
        productId: c.product_id,
        quantity: 2,
        locationId: LOCATION.workshopStore,
      });
      expect(await onHand(tx, c.product_id, LOCATION.workshopStore)).toBe(0);
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())(
  "whose stock is a part (D27 changed) and the line rules",
  () => {
    it("customer-owned stock is refused by add_inventory_line and, for any other writer, by the line trigger (ownership_not_saleable)", async () => {
      await inTx(async (tx) => {
        await ownerMode(tx);
        const customerProduct = await makeProduct(tx);
        await tx.query(
          "update public.products set ownership_type = 'customer_owned' where id = $1",
          [customerProduct],
        );
        const uniqueProduct = await makeProduct(tx, { tracking: "unique" });
        const customerUnit = randomUUID();
        await tx.query(
          `select private.register_unit($1, $2, $3, 'customer_owned', null, null, null, 100.00, null, null)`,
          [customerUnit, uniqueProduct, LOCATION.shopFloor],
        );
        await tx.query(
          `select private.record_movement($1, $2, $3, 1, 'stock_adjustment', 'Left with the shop', 100.00, null, null, null, null)`,
          [uniqueProduct, customerUnit, LOCATION.shopFloor],
        );
        await actAs(tx, ADMIN);
        const job = await newJob(tx);
        await failsWith(
          tx,
          () => addPart(tx, { workOrderId: job.id, productId: customerProduct }),
          {
            code: "P0001",
            message: "ownership_not_saleable",
          },
        );
        await failsWith(
          tx,
          () =>
            addPart(tx, { workOrderId: job.id, productId: uniqueProduct, unitId: customerUnit }),
          { code: "P0001", message: "ownership_not_saleable" },
        );
        await ownerMode(tx);
        for (const [productId, unitId] of [
          [customerProduct, null],
          [uniqueProduct, customerUnit],
        ]) {
          await failsWith(
            tx,
            () =>
              tx.query(
                `insert into public.work_order_line_items
                 (id, work_order_id, line_type, source_product_id, source_inventory_unit_id, description_snapshot,
                  quantity, unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency)
               values ($1, $2, 'inventory', $3, $4, 'Part', 1, 10, 5, 0.3, 'SGD')`,
                [randomUUID(), job.id, productId, unitId],
              ),
            { code: "P0001", message: "ownership_not_saleable" },
          );
        }
        await actAs(tx, ADMIN);
        await assertLedgerConsistent(tx);
      });
    });

    it("a line's consignment must match its source (line_consignment_mismatch); the new columns never change (line_immutable)", async () => {
      await inTx(async (tx) => {
        const consignorId = await createConsignor(tx);
        const r = await intakeUnique(tx, { consignorId, agreed: "500.00" });
        const otherItem = await intakeUnique(tx, {
          consignorId,
          agreed: "300.00",
          productId: r.product_id,
        });
        await ownerMode(tx);
        const shopProduct = await makeProduct(tx);
        await actAs(tx, ADMIN);
        const job = await newJob(tx);
        await ownerMode(tx);
        const insertLine = (
          productId: string,
          unitId: string | null,
          itemId: string | null,
          payout: string | null,
        ) =>
          tx.query(
            `insert into public.work_order_line_items
             (id, work_order_id, line_type, source_product_id, source_inventory_unit_id, description_snapshot,
              quantity, unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
              consignment_item_id, consignor_payout_snapshot)
           values ($1, $2, 'inventory', $3, $4, 'Part', 1, 10, 5, 0.3, 'SGD', $5, $6)`,
            [randomUUID(), job.id, productId, unitId, itemId, payout],
          );
        for (const [productId, unitId, itemId, payout] of [
          [r.product_id, r.inventory_unit_id, null, null],
          [r.product_id, r.inventory_unit_id, r.item_id, null],
          [r.product_id, r.inventory_unit_id, otherItem.item_id, "300.00"],
          [shopProduct, null, r.item_id, "500.00"],
          [shopProduct, null, null, "1.00"],
        ] as const) {
          await failsWith(tx, () => insertLine(productId, unitId, itemId, payout), {
            code: "P0001",
            message: "line_consignment_mismatch",
          });
        }

        await actAs(tx, ADMIN);
        const part = await addPart(tx, {
          workOrderId: job.id,
          productId: r.product_id,
          unitId: r.inventory_unit_id,
        });
        await ownerMode(tx);
        const voider = await scalar<string>(
          tx,
          "select id from public.staff order by created_at limit 1",
        );
        for (const set of [
          "consignor_payout_snapshot = 1",
          `consignment_item_id = '${otherItem.item_id}'`,
        ]) {
          await failsWith(
            tx,
            () =>
              tx.query(
                `update public.work_order_line_items
                  set voided_at = now(), voided_by = $2, void_reason = 'Mistake', ${set}
                where id = $1`,
                [part.line_id, voider],
              ),
            { code: "P0001", message: "line_immutable" },
          );
        }
        await actAs(tx, ADMIN);
        await assertLedgerConsistent(tx);
      });
    });

    it("D24: a part priced 0 and a part costing 0 are accepted with 0 snapshots and are not cost_pending; so is a consigned part agreed at 0", async () => {
      await inTx(async (tx) => {
        await ownerMode(tx);
        const freePart = await makeProduct(tx, { price: "0.00", cost: "3.00" });
        const freeCost = await makeProduct(tx, { price: "15.00", cost: "0.00" });
        await actAs(tx, ADMIN);
        await addStock(tx, freePart, 2);
        await addStock(tx, freeCost, 2);
        const consignorId = await createConsignor(tx);
        const gift = await intakeUnique(tx, { consignorId, agreed: "0", asking: "50.00" });

        // Any active staff member adds parts (D14).
        await actAs(tx, MECHANIC2);
        const job = await newJob(tx, MECHANIC2);
        const priced0 = await addPart(tx, { workOrderId: job.id, productId: freePart });
        const cost0 = await addPart(tx, { workOrderId: job.id, productId: freeCost });
        const override0 = await addPart(tx, {
          workOrderId: job.id,
          productId: freeCost,
          price: "0",
        });
        const consigned0 = await addPart(tx, {
          workOrderId: job.id,
          productId: gift.product_id,
          unitId: gift.inventory_unit_id,
        });
        expect(await lineRow(tx, priced0.line_id)).toMatchObject({
          unit_sale_price_snapshot: "0.00",
          unit_direct_cost_snapshot: "3.00",
          cost_pending: false,
        });
        expect(await lineRow(tx, cost0.line_id)).toMatchObject({
          unit_sale_price_snapshot: "15.00",
          unit_direct_cost_snapshot: "0.00",
          yield_total: "15.00",
          cost_pending: false,
        });
        expect(await lineRow(tx, override0.line_id)).toMatchObject({
          unit_sale_price_snapshot: "0.00",
          cost_pending: false,
        });
        expect(await lineRow(tx, consigned0.line_id)).toMatchObject({
          unit_direct_cost_snapshot: "0.00",
          consignor_payout_snapshot: "0.00",
          cost_pending: false,
        });
        await actAs(tx, ADMIN);
        await assertLedgerConsistent(tx);
      });
    });
  },
);
