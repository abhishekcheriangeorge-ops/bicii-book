/**
 * The stock ledger and parts on jobs (SPEC §2 "Inventory ledger", §9, §10,
 * §12, §23, §25; DATA-MODEL §4, §5, §7, §16; PLAN D1, D6, D14, D15, D16,
 * D23 NEG-CONSUMPTION, D24 PART-PRICE-COST, D25 SOLD-AT-COMPLETION, D26
 * PUBLICATION-MACHINE, D27 as changed by the owner: customer-owned stock is
 * never a job part; consigned parts are tests/db/consignment-job-parts.test.ts).
 * Test names follow the SPEC §23
 * invariants and the TESTING.md Phase 4 rows.
 *
 * Every test that writes stock ends with assertLedgerConsistent(), which
 * runs the deferred unit-consistency checks before the rollback. Tests
 * create products, units and jobs (short-ID sequences) and the concurrency
 * tests commit, so the file runs only on a per-file clone (TESTING.md).
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { LOCATION, PRODUCT, STAFF } from "../fixtures/ids";
import {
  actAs,
  connect,
  inTransaction,
  isolatedDatabase,
  openConnections,
  scalar,
} from "./harness";
import {
  ADMIN,
  MECHANIC1,
  MECHANIC2,
  addPart,
  addPublicPhoto,
  addStock,
  assertLedgerConsistent,
  committed,
  completeJob,
  makeLocation,
  makeProduct,
  makeUniqueWithUnit,
  makeUnit,
  movements,
  newJob,
  onHand,
  publication,
  publish,
  readAsOwner,
  reopenJob,
  transfer,
  unit,
  unitEvents,
  writeOff,
} from "./inventory-fixtures";
import {
  createWorkOrder,
  eventTypes,
  events,
  failsWith,
  makeBike,
  makeCustomerWithBike,
  ownerMode,
  setStatus,
  voidLine,
  walkTo,
} from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

/** A rolled-back transaction starting as the owner. */
const inTx = <T>(fn: (tx: pg.Client) => Promise<T>) => inTransaction(conn, fn);

/** A quantity product (owner) with `qty` at the Shop floor (as the admin); leaves `tx` as the admin. */
async function stockedProduct(
  tx: pg.Client,
  qty: number,
  o: Parameters<typeof makeProduct>[1] = {},
): Promise<string> {
  await ownerMode(tx);
  const productId = await makeProduct(tx, o);
  await actAs(tx, ADMIN);
  if (qty > 0) await addStock(tx, productId, qty);
  return productId;
}

const lineRow = (tx: pg.Client, id: string) =>
  readAsOwner(tx, () =>
    tx
      .query<{
        id: string;
        unit_sale_price_snapshot: string;
        unit_direct_cost_snapshot: string;
        cost_pending: boolean;
        sale_total: string;
        cost_total: string;
        yield_total: string;
        cult_commons_share: string;
        voided_at: Date | null;
        description_snapshot: string;
      }>(
        `select id, unit_sale_price_snapshot::text, unit_direct_cost_snapshot::text, cost_pending,
              sale_total::text, cost_total::text, yield_total::text, cult_commons_share::text,
              voided_at, description_snapshot
         from public.work_order_line_items where id = $1`,
        [id],
      )
      .then((r) => r.rows[0]),
  );

const countWhere = (tx: pg.Client, sql: string, params: unknown[]) =>
  scalar<number>(tx, `select count(*)::int from ${sql}`, params);

describe.skipIf(!isolatedDatabase())(
  "a stock-consuming work-order line cannot consume inventory twice",
  () => {
    it("a replay with the same line id returns the line without a second movement", async () => {
      await inTx(async (tx) => {
        const productId = await stockedProduct(tx, 10);
        const job = await newJob(tx);
        const lineId = randomUUID();
        const first = await addPart(tx, { lineId, workOrderId: job.id, productId, quantity: 3 });
        expect(first).toMatchObject({ line_id: lineId, on_hand_after: 7, replayed: false });
        const again = await addPart(tx, { lineId, workOrderId: job.id, productId, quantity: 3 });
        expect(again).toEqual({ ...first, replayed: true });
        expect(await countWhere(tx, "public.work_order_line_items where id = $1", [lineId])).toBe(
          1,
        );
        expect(
          await countWhere(
            tx,
            "public.inventory_movements where work_order_line_item_id = $1 and movement_type = 'job_consumption'",
            [lineId],
          ),
        ).toBe(1);
        expect(await onHand(tx, productId)).toBe(7);
        expect((await eventTypes(tx, job.id)).filter((t) => t === "stock_consumed")).toHaveLength(
          1,
        );

        // After completion the replay still returns the line.
        await completeJob(tx, job.id);
        expect(await addPart(tx, { lineId, workOrderId: job.id, productId, quantity: 3 })).toEqual({
          ...first,
          replayed: true,
        });
        await assertLedgerConsistent(tx);
      });
    });

    it("the same line id with other arguments or on another job is line_conflict, never a replay", async () => {
      await inTx(async (tx) => {
        const productId = await stockedProduct(tx, 10);
        const other = await stockedProduct(tx, 10);
        const job = await newJob(tx);
        const elsewhere = await newJob(tx);
        const lineId = randomUUID();
        await addPart(tx, { lineId, workOrderId: job.id, productId, quantity: 2 });
        for (const attempt of [
          { lineId, workOrderId: job.id, productId, quantity: 3 },
          { lineId, workOrderId: job.id, productId: other, quantity: 2 },
          { lineId, workOrderId: elsewhere.id, productId, quantity: 2 },
        ]) {
          await failsWith(tx, () => addPart(tx, attempt), {
            code: "P0001",
            message: "line_conflict",
          });
        }
        expect(await onHand(tx, productId)).toBe(8);
        await assertLedgerConsistent(tx);
      });
    });
  },
);

describe.skipIf(!isolatedDatabase())(
  "voiding a consumed line creates a linked reversal rather than erasing the original movement",
  () => {
    it("keeps the original, links one reversal, restores stock and records each event once", async () => {
      await inTx(async (tx) => {
        const productId = await stockedProduct(tx, 5);
        const job = await newJob(tx);
        const part = await addPart(tx, { workOrderId: job.id, productId, quantity: 2 });
        expect(await voidLine(tx, part.line_id, "Wrong size")).toBe(part.line_id);
        expect(await voidLine(tx, part.line_id, "Wrong size")).toBe(part.line_id);
        await ownerMode(tx);
        const rows = await movements(tx, productId);
        expect(rows.map((m) => [m.movement_type, m.quantity_delta])).toEqual([
          ["stock_adjustment", 5],
          ["job_consumption", -2],
          ["reversal", 2],
        ]);
        expect(rows[1].id).toBe(part.movement_id);
        expect(rows[2]).toMatchObject({
          reversal_of_id: part.movement_id,
          work_order_line_item_id: part.line_id,
          reason: "Wrong size",
          unit_cost_snapshot: rows[1].unit_cost_snapshot,
        });
        expect(await onHand(tx, productId)).toBe(5);
        const types = await eventTypes(tx, job.id);
        expect(types.filter((t) => t === "line_voided")).toHaveLength(1);
        expect(types.filter((t) => t === "stock_reversed")).toHaveLength(1);
        const reversed = (await events(tx, job.id)).find((e) => e.event_type === "stock_reversed");
        expect(reversed?.payload).toMatchObject({
          line_id: part.line_id,
          reversal_of_id: Number(part.movement_id),
          quantity: 2,
          on_hand_after: 5,
          location_name: "Shop floor",
        });
        await assertLedgerConsistent(tx);
      });
    });

    it("voiding is never blocked by publication rules", async () => {
      await inTx(async (tx) => {
        const { productId, unitId } = await makeUniqueWithUnit(tx, {
          price: "900.00",
          cost: "500.00",
        });
        await ownerMode(tx);
        const photo = await addPublicPhoto(tx, "product", productId);
        await publish(tx, productId);
        await actAs(tx, ADMIN);
        const job = await newJob(tx);
        const part = await addPart(tx, { workOrderId: job.id, productId, unitId });
        await completeJob(tx, job.id);
        expect((await unit(tx, unitId)).status).toBe("sold");
        expect(await publication(tx, productId)).toBe("sold");

        // After the sale the photo goes and the prices are cleared.
        await ownerMode(tx);
        await tx.query("select private.set_change_reason('Removed')");
        await tx.query("delete from public.attachments where id = $1", [photo]);
        await tx.query("select private.set_change_reason(null)");
        await tx.query("update public.products set default_sale_price = null where id = $1", [
          productId,
        ]);
        await actAs(tx, ADMIN);

        await reopenJob(tx, job.id);
        expect((await unit(tx, unitId)).status).toBe("held_for_customer");
        expect(await publication(tx, productId)).toBe("sold");
        await voidLine(tx, part.line_id, "Customer changed their mind");
        expect((await unit(tx, unitId)).status).toBe("available");
        expect(await publication(tx, productId)).toBe("public");
        await ownerMode(tx);
        expect((await movements(tx, productId)).map((m) => m.movement_type)).toEqual([
          "stock_adjustment",
          "job_consumption",
          "reversal",
        ]);
        await assertLedgerConsistent(tx);
      });
    });
  },
);

describe.skipIf(!isolatedDatabase())(
  "a unique inventory unit cannot be consumed or sold twice",
  () => {
    it("a unit on one line is unit_not_available for a second; written-off and held units too", async () => {
      await inTx(async (tx) => {
        const { productId, unitId } = await makeUniqueWithUnit(tx);
        const job = await newJob(tx);
        const other = await newJob(tx);
        await addPart(tx, { workOrderId: job.id, productId, unitId });
        for (const workOrderId of [job.id, other.id]) {
          await failsWith(tx, () => addPart(tx, { workOrderId, productId, unitId }), {
            code: "P0001",
            message: "unit_not_available",
          });
        }
        const gone = await makeUnit(tx, productId);
        await writeOff(tx, gone.unit_id);
        await failsWith(
          tx,
          () => addPart(tx, { workOrderId: job.id, productId, unitId: gone.unit_id }),
          {
            code: "P0001",
            message: "unit_not_available",
          },
        );
        const sums = await tx.query<{ net: number }>(
          "select sum(quantity_delta)::int as net from public.inventory_movements where product_id = $1 group by inventory_unit_id",
          [productId],
        );
        for (const { net } of sums.rows) expect([0, 1]).toContain(net);
        await assertLedgerConsistent(tx);
      });
    });

    it("forged movements or moves are refused at commit (unit_ledger_inconsistent)", async () => {
      await inTx(async (tx) => {
        const { productId, unitId } = await makeUniqueWithUnit(tx);
        const elsewhere = await (async () => {
          await ownerMode(tx);
          return makeLocation(tx);
        })();
        const forge = async (sql: string, params: unknown[]) => {
          await failsWith(
            tx,
            async () => {
              await tx.query(sql, params);
              await tx.query("set constraints all immediate");
            },
            { code: "P0001", message: "unit_ledger_inconsistent" },
          );
          await tx.query("set constraints all deferred");
        };
        // A second +1 for an available unit.
        await forge(
          `insert into public.inventory_movements (product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason)
         values ($1, $2, $3, 1, 'stock_adjustment', 'Forged')`,
          [productId, unitId, LOCATION.shopFloor],
        );
        // Its location changed without a movement.
        await forge("update public.inventory_units set location_id = $1 where id = $2", [
          elsewhere,
          unitId,
        ]);

        // A sold unit: +1 at one location and -1 at another.
        await actAs(tx, ADMIN);
        const job = await newJob(tx);
        await addPart(tx, { workOrderId: job.id, productId, unitId });
        await completeJob(tx, job.id);
        await ownerMode(tx);
        await forge(
          `insert into public.inventory_movements (product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason)
         values ($1, $2, $3, 1, 'stock_adjustment', 'Forged'), ($1, $2, $4, -1, 'stock_adjustment', 'Forged')`,
          [productId, unitId, LOCATION.shopFloor, elsewhere],
        );

        // A linked bike that does not point back at its unit.
        const linked = await makeUniqueWithUnit(tx);
        await ownerMode(tx);
        const shopBike = await makeBike(tx, null);
        await forge("update public.inventory_units set bike_id = $1 where id = $2", [
          shopBike,
          linked.unitId,
        ]);
        // An in-stock unit whose linked bike a customer owns (D29): the owner
        // is forged with triggers off (bike_in_stock refuses it otherwise),
        // then any status change re-runs the check.
        const owned = await makeProduct(tx, { tracking: "unique" });
        const ownedBike = await makeBike(tx, null);
        await actAs(tx, ADMIN);
        const ownedUnit = await makeUnit(tx, owned, { bikeId: ownedBike });
        await assertLedgerConsistent(tx);
        await ownerMode(tx);
        const { customerId } = await makeCustomerWithBike(tx);
        await tx.query("set local session_replication_role = replica");
        await tx.query("update public.bikes set customer_id = $1 where id = $2", [
          customerId,
          ownedBike,
        ]);
        await tx.query("set local session_replication_role = origin");
        await forge("update public.inventory_units set status = 'reserved' where id = $1", [
          ownedUnit.unit_id,
        ]);
        await assertLedgerConsistent(tx);
      });
    });
  },
);

describe.skipIf(!isolatedDatabase())(
  "every manual stock adjustment records actor, timestamp and reason",
  () => {
    it("requires a reason and records who, when and why", async () => {
      await inTx(async (tx) => {
        const productId = await stockedProduct(tx, 0);
        for (const reason of [null, "", "   "]) {
          await failsWith(tx, () => addStock(tx, productId, 5, { reason }), {
            code: "P0001",
            message: "reason_required",
          });
        }
        const before = await scalar<Date>(tx, "select clock_timestamp()");
        const added = await addStock(tx, productId, 5, { reason: "  Found a box  " });
        expect(added.on_hand).toBe(5);
        const row = (
          await tx.query(
            "select created_by, reason, created_at from public.inventory_movements where id = $1",
            [added.movement_id],
          )
        ).rows[0];
        expect(row).toMatchObject({ created_by: STAFF.admin, reason: "Found a box" });
        expect(row.created_at.getTime()).toBeGreaterThanOrEqual(before.getTime());

        await failsWith(tx, () => addStock(tx, productId, 1, { type: "damaged" }), {
          code: "P0001",
          message: "quantity_invalid",
        });
        await failsWith(tx, () => addStock(tx, productId, -1, { type: "retail_sale" }), {
          code: "P0001",
          message: "movement_type_not_manual",
        });
        await failsWith(tx, () => addStock(tx, productId, -6), {
          code: "P0001",
          message: "insufficient_stock",
        });
        expect(
          (await addStock(tx, productId, -2, { type: "damaged", reason: "Crushed" })).on_hand,
        ).toBe(3);
        await assertLedgerConsistent(tx);
      });
    });

    it("a request id replays its movement and conflicts with anything else", async () => {
      await inTx(async (tx) => {
        const productId = await stockedProduct(tx, 0);
        const requestId = randomUUID();
        const first = await addStock(tx, productId, 4, { requestId });
        expect(await addStock(tx, productId, 4, { requestId })).toEqual(first);
        await failsWith(tx, () => addStock(tx, productId, 5, { requestId }), {
          code: "P0001",
          message: "request_conflict",
        });
        expect(await onHand(tx, productId)).toBe(4);
      });
    });

    it("needs adjust_stock: mechanics are refused, the admin succeeds", async () => {
      await inTx(async (tx) => {
        const productId = await stockedProduct(tx, 0);
        for (const claims of [MECHANIC1, MECHANIC2]) {
          await actAs(tx, claims);
          await failsWith(tx, () => addStock(tx, productId, 1), { code: "42501" });
        }
        await actAs(tx, ADMIN);
        expect((await addStock(tx, productId, 1)).on_hand).toBe(1);
      });
    });

    it("a unit cost needs view_costs and a positive delta", async () => {
      await inTx(async (tx) => {
        const productId = await stockedProduct(tx, 0);
        await ownerMode(tx);
        await tx.query(
          "insert into public.staff_permissions (staff_id, permission) values ($1, 'adjust_stock')",
          [STAFF.mechanic2],
        );
        await actAs(tx, MECHANIC2);
        await failsWith(tx, () => addStock(tx, productId, 2, { unitCost: "3.00" }), {
          code: "42501",
        });
        const plain = await addStock(tx, productId, 2);
        await actAs(tx, ADMIN);
        const costed = await addStock(tx, productId, 2, { unitCost: "3.25" });
        await ownerMode(tx);
        const costs = await tx.query<{ id: string; unit_cost_snapshot: string }>(
          "select id::text, unit_cost_snapshot::text from public.inventory_movements where id = any($1::bigint[]) order by id",
          [[plain.movement_id, costed.movement_id]],
        );
        // Without a cost the product's default is snapshotted.
        expect(costs.rows.map((r) => r.unit_cost_snapshot)).toEqual(["8.00", "3.25"]);
      });
    });
  },
);

describe.skipIf(!isolatedDatabase())("write-off", () => {
  it("is replay-safe by request id and can be repeated after a restore with a new one", async () => {
    await inTx(async (tx) => {
      const { productId, unitId } = await makeUniqueWithUnit(tx);
      const requestId = randomUUID();
      expect(await writeOff(tx, unitId, { requestId })).toEqual({
        unit_id: unitId,
        status: "written_off",
      });
      expect(await writeOff(tx, unitId, { requestId })).toEqual({
        unit_id: unitId,
        status: "written_off",
      });
      // Already written off: another request is a no-op.
      expect(await writeOff(tx, unitId)).toEqual({ unit_id: unitId, status: "written_off" });
      await ownerMode(tx);
      expect(
        (await movements(tx, productId)).map((m) => [m.movement_type, m.quantity_delta]),
      ).toEqual([
        ["stock_adjustment", 1],
        ["damaged", -1],
      ]);
      // Restored by the owner (a found unit), then written off again.
      await tx.query("update public.inventory_units set status = 'available' where id = $1", [
        unitId,
      ]);
      await tx.query(
        `insert into public.inventory_movements (product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason)
         values ($1, $2, $3, 1, 'stock_adjustment', 'Found again')`,
        [productId, unitId, LOCATION.shopFloor],
      );
      await assertLedgerConsistent(tx);
      await actAs(tx, ADMIN);
      expect((await writeOff(tx, unitId)).status).toBe("written_off");
      // The first request id still replays (no third damaged row).
      expect((await writeOff(tx, unitId, { requestId })).status).toBe("written_off");
      await ownerMode(tx);
      expect(
        (await movements(tx, productId)).filter((m) => m.movement_type === "damaged"),
      ).toHaveLength(2);
      await assertLedgerConsistent(tx);
    });
  });

  it("needs a reason and adjust_stock; a held unit cannot be written off", async () => {
    await inTx(async (tx) => {
      const { productId, unitId } = await makeUniqueWithUnit(tx);
      await failsWith(tx, () => writeOff(tx, unitId, { reason: " " }), {
        code: "P0001",
        message: "reason_required",
      });
      await actAs(tx, MECHANIC1);
      await failsWith(tx, () => writeOff(tx, unitId), { code: "42501" });
      await actAs(tx, ADMIN);
      const job = await newJob(tx);
      await addPart(tx, { workOrderId: job.id, productId, unitId });
      await failsWith(tx, () => writeOff(tx, unitId), {
        code: "P0001",
        message: "unit_not_available",
      });
      await assertLedgerConsistent(tx);
    });
  });
});

describe("current stock is derivable from the ledger", () => {
  it("the seed's stock levels, product stock and low stock", async () => {
    await inTx(async (tx) => {
      await actAs(tx, ADMIN);
      const low = await tx.query<{ product_id: string; on_hand: number; shortfall: number }>(
        "select product_id, on_hand, shortfall from reporting.low_stock",
      );
      expect(low.rows).toEqual([
        { product_id: PRODUCT.hydraulicHose, on_hand: 1, shortfall: 4 },
        { product_id: PRODUCT.cableKit, on_hand: 2, shortfall: 2 },
        { product_id: PRODUCT.sealant, on_hand: 2, shortfall: 1 },
      ]);
      const stock = await tx.query<{ product_id: string; on_hand: number; below_reorder: boolean }>(
        "select product_id, on_hand, below_reorder from reporting.product_stock where product_id = any($1::uuid[])",
        [[PRODUCT.roadTube, PRODUCT.bromptonTube, PRODUCT.marathonRacer, PRODUCT.colnago]],
      );
      expect(Object.fromEntries(stock.rows.map((r) => [r.product_id, r.on_hand]))).toEqual({
        [PRODUCT.roadTube]: 60,
        [PRODUCT.bromptonTube]: 14,
        [PRODUCT.marathonRacer]: 6,
        [PRODUCT.colnago]: 1,
      });
    });
  });

  it.skipIf(!isolatedDatabase())(
    "stock_levels equals the sum of movements after mixed operations",
    async () => {
      await inTx(async (tx) => {
        await ownerMode(tx);
        const store = await makeLocation(tx);
        const productId = await stockedProduct(tx, 9);
        await transfer(tx, { productId, from: LOCATION.shopFloor, to: store, quantity: 4 });
        const job = await newJob(tx);
        const part = await addPart(tx, {
          workOrderId: job.id,
          productId,
          quantity: 2,
          locationId: store,
        });
        await addPart(tx, { workOrderId: job.id, productId, quantity: 1 });
        await voidLine(tx, part.line_id, "Not needed");
        await addStock(tx, productId, -1, {
          type: "damaged",
          reason: "Dropped",
          locationId: store,
        });
        const levels = await tx.query<{ location_id: string; on_hand: number }>(
          "select location_id, on_hand from reporting.stock_levels where product_id = $1 order by on_hand",
          [productId],
        );
        expect(levels.rows).toEqual([
          { location_id: store, on_hand: 3 },
          { location_id: LOCATION.shopFloor, on_hand: 4 },
        ]);
        const mismatches = await scalar<number>(
          tx,
          `select count(*)::int from reporting.stock_levels s
          full join (
            select product_id, location_id, sum(quantity_delta)::int as net
              from public.inventory_movements group by 1, 2
          ) m using (product_id, location_id)
         where s.on_hand is distinct from m.net`,
        );
        expect(mismatches).toBe(0);
        await assertLedgerConsistent(tx);
      });
    },
  );
});

describe.skipIf(!isolatedDatabase())("transfers", () => {
  it("writes paired rows sharing the request id, refuses too much and the same location", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      const store = await makeLocation(tx);
      const productId = await stockedProduct(tx, 5);
      const requestId = randomUUID();
      const rows = await transfer(tx, {
        requestId,
        productId,
        from: LOCATION.shopFloor,
        to: store,
        quantity: 3,
      });
      expect(rows.map((r) => [r.location_id, r.quantity_delta])).toEqual([
        [LOCATION.shopFloor, -3],
        [store, 3],
      ]);
      expect(
        await transfer(tx, {
          requestId,
          productId,
          from: LOCATION.shopFloor,
          to: store,
          quantity: 3,
        }),
      ).toEqual(rows);
      await failsWith(
        tx,
        () => transfer(tx, { productId, from: LOCATION.shopFloor, to: store, quantity: 3 }),
        {
          code: "P0001",
          message: "insufficient_stock",
        },
      );
      await failsWith(tx, () => transfer(tx, { productId, from: store, to: store, quantity: 1 }), {
        code: "P0001",
        message: "transfer_same_location",
      });
      await actAs(tx, MECHANIC1);
      await failsWith(tx, () => transfer(tx, { productId, from: store, to: LOCATION.shopFloor }), {
        code: "42501",
      });
      await actAs(tx, ADMIN);
      expect(await onHand(tx, productId, store)).toBe(3);
      expect(await onHand(tx, productId)).toBe(2);
    });
  });

  it("moves a unit with its location and a moved event; a held unit stays put", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      const store = await makeLocation(tx);
      const { productId, unitId } = await makeUniqueWithUnit(tx);
      await transfer(tx, { productId, from: LOCATION.shopFloor, to: store, unitId });
      expect((await unit(tx, unitId)).location_id).toBe(store);
      expect((await unitEvents(tx, unitId)).map((e) => e.event_type)).toEqual(["created", "moved"]);
      const job = await newJob(tx);
      await addPart(tx, { workOrderId: job.id, productId, unitId });
      await failsWith(
        tx,
        () => transfer(tx, { productId, from: store, to: LOCATION.shopFloor, unitId }),
        {
          code: "P0001",
          message: "unit_not_available",
        },
      );
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())(
  "consumption may take a location negative (NEG-CONSUMPTION)",
  () => {
    it("adds a part beyond on-hand and reports the negative location in low stock", async () => {
      await inTx(async (tx) => {
        const noReorder = await stockedProduct(tx, 1, { reorderPoint: null });
        const job = await newJob(tx);
        expect(
          (await addPart(tx, { workOrderId: job.id, productId: noReorder, quantity: 3 }))
            .on_hand_after,
        ).toBe(-2);
        // Positive in total, negative at one location.
        await ownerMode(tx);
        const store = await makeLocation(tx);
        const split = await stockedProduct(tx, 10, { reorderPoint: 2 });
        await addPart(tx, {
          workOrderId: job.id,
          productId: split,
          quantity: 1,
          locationId: store,
        });
        const low = await tx.query<{
          product_id: string;
          on_hand: number;
          negative_locations: number;
        }>(
          "select product_id, on_hand, negative_locations from reporting.low_stock where product_id = any($1::uuid[]) order by on_hand",
          [[noReorder, split]],
        );
        expect(low.rows).toEqual([
          { product_id: noReorder, on_hand: -2, negative_locations: 1 },
          { product_id: split, on_hand: 9, negative_locations: 1 },
        ]);
        // Manual changes never go below zero.
        await failsWith(tx, () => addStock(tx, noReorder, -1, { type: "damaged", reason: "x" }), {
          code: "P0001",
          message: "insufficient_stock",
        });
        // A positive adjustment at a negative location is fine.
        expect((await addStock(tx, noReorder, 1)).on_hand).toBe(-1);
      });
    });
  },
);

describe.skipIf(!isolatedDatabase())(
  "prices and ownership (PART-PRICE-COST, D27 changed: customer-owned never)",
  () => {
    it("refuses a part with no price or no cost; lines are never cost_pending", async () => {
      await inTx(async (tx) => {
        const noPrice = await stockedProduct(tx, 2, { price: null });
        const noCost = await stockedProduct(tx, 2, { cost: null });
        const job = await newJob(tx);
        await failsWith(tx, () => addPart(tx, { workOrderId: job.id, productId: noPrice }), {
          code: "P0001",
          message: "part_price_missing",
        });
        await failsWith(tx, () => addPart(tx, { workOrderId: job.id, productId: noCost }), {
          code: "P0001",
          message: "part_cost_missing",
        });
        // An override price makes the unpriced part usable.
        const part = await addPart(tx, { workOrderId: job.id, productId: noPrice, price: "12.00" });
        expect(await lineRow(tx, part.line_id)).toMatchObject({
          unit_sale_price_snapshot: "12.00",
          cost_pending: false,
        });
      });
    });

    it("the default line price is private.selling_price (unit over product); an override wins", async () => {
      await inTx(async (tx) => {
        const { productId, unitId } = await makeUniqueWithUnit(tx, {
          price: "1000.00",
          cost: "600.00",
          unitPrice: "1200.00",
        });
        const other = await makeUnit(tx, productId);
        const job = await newJob(tx);
        const priced = await addPart(tx, { workOrderId: job.id, productId, unitId });
        const fallback = await addPart(tx, {
          workOrderId: job.id,
          productId,
          unitId: other.unit_id,
        });
        await ownerMode(tx);
        expect(await lineRow(tx, priced.line_id)).toMatchObject({
          unit_sale_price_snapshot: "1200.00",
          unit_direct_cost_snapshot: "600.00",
          yield_total: "600.00",
          cult_commons_share: "180.00",
        });
        expect((await lineRow(tx, priced.line_id)).description_snapshot).toMatch(/ · U-\d{6}$/);
        expect((await lineRow(tx, fallback.line_id)).unit_sale_price_snapshot).toBe("1000.00");
        const quantity = await stockedProduct(tx, 3, { price: "30.00" });
        const overridden = await addPart(tx, {
          workOrderId: job.id,
          productId: quantity,
          price: "25.50",
        });
        await ownerMode(tx);
        expect((await lineRow(tx, overridden.line_id)).unit_sale_price_snapshot).toBe("25.50");
        expect(
          await scalar<string>(tx, "select private.selling_price($1, $2)::text", [
            productId,
            unitId,
          ]),
        ).toBe("1200.00");
      });
    });

    // D27 was changed by the owner (2026-10-05): consigned stock may be a
    // job part (D44, tests/db/consignment-job-parts.test.ts); customer-owned
    // stock never is. Consigned stock is never faked here: it exists only
    // through create_consignment_item.
    it("customer-owned stock is never a job part (ownership_not_saleable; D27 changed, D44)", async () => {
      await inTx(async (tx) => {
        await ownerMode(tx);
        const productId = await makeProduct(tx, { tracking: "unique" });
        const customerUnit = randomUUID();
        await tx.query(
          `select private.register_unit($1, $2, $3, 'customer_owned', null, null, null, 100.00, null, null)`,
          [customerUnit, productId, LOCATION.shopFloor],
        );
        await tx.query(
          `select private.record_movement($1, $2, $3, 1, 'stock_adjustment', 'Left with the shop', 100.00, null, null, null, null)`,
          [productId, customerUnit, LOCATION.shopFloor],
        );
        const quantity = await makeProduct(tx);
        await tx.query(
          "update public.products set ownership_type = 'customer_owned' where id = $1",
          [quantity],
        );
        await actAs(tx, ADMIN);
        const job = await newJob(tx);
        await failsWith(
          tx,
          () => addPart(tx, { workOrderId: job.id, productId, unitId: customerUnit }),
          { code: "P0001", message: "ownership_not_saleable" },
        );
        await failsWith(tx, () => addPart(tx, { workOrderId: job.id, productId: quantity }), {
          code: "P0001",
          message: "ownership_not_saleable",
        });
        await assertLedgerConsistent(tx);
      });
    });
  },
);

describe.skipIf(!isolatedDatabase())("sold at completion (SOLD-AT-COMPLETION, D15)", () => {
  it("held on add, available after a void before completion, sold at completion", async () => {
    await inTx(async (tx) => {
      const { productId, unitId } = await makeUniqueWithUnit(tx);
      const job = await newJob(tx);
      const first = await addPart(tx, { workOrderId: job.id, productId, unitId });
      expect((await unit(tx, unitId)).status).toBe("held_for_customer");
      await voidLine(tx, first.line_id, "Wrong bike");
      expect((await unit(tx, unitId)).status).toBe("available");
      await addPart(tx, { workOrderId: job.id, productId, unitId });
      const completed = await completeJob(tx, job.id);
      const sold = await unit(tx, unitId);
      expect(sold.status).toBe("sold");
      expect(sold.sold_at).toEqual(completed.completed_at);
      const last = (await unitEvents(tx, unitId)).at(-1);
      expect(last).toMatchObject({
        event_type: "status_changed",
        payload: {
          from: "held_for_customer",
          to: "sold",
          cause: "job_completed",
          work_order_id: job.id,
        },
      });
      await assertLedgerConsistent(tx);
    });
  });

  it("refuses adds and voids on a completed or ready job (work_order_locked)", async () => {
    await inTx(async (tx) => {
      const productId = await stockedProduct(tx, 5);
      for (const status of ["completed", "ready_for_collection"] as const) {
        const job = await newJob(tx);
        const part = await addPart(tx, { workOrderId: job.id, productId });
        await walkTo(tx, job.id, status);
        await failsWith(tx, () => addPart(tx, { workOrderId: job.id, productId }), {
          code: "P0001",
          message: "work_order_locked",
        });
        await failsWith(tx, () => voidLine(tx, part.line_id, "Returned"), {
          code: "P0001",
          message: "work_order_locked",
        });
      }
    });
  });

  it("complete, reopen, void: held again with no movement, product stays sold, then the reversal", async () => {
    await inTx(async (tx) => {
      const { productId, unitId } = await makeUniqueWithUnit(tx);
      await ownerMode(tx);
      await addPublicPhoto(tx, "product", productId);
      await publish(tx, productId);
      await actAs(tx, ADMIN);
      const job = await newJob(tx);
      const part = await addPart(tx, { workOrderId: job.id, productId, unitId });
      await completeJob(tx, job.id);
      expect(await publication(tx, productId)).toBe("sold");
      const before = (await movements(tx, productId)).length;
      await reopenJob(tx, job.id);
      const held = await unit(tx, unitId);
      expect(held).toMatchObject({ status: "held_for_customer", sold_at: null });
      expect((await unitEvents(tx, unitId)).at(-1)).toMatchObject({
        event_type: "status_changed",
        payload: { from: "sold", to: "held_for_customer", cause: "job_reopened" },
      });
      expect((await movements(tx, productId)).length).toBe(before);
      expect(await publication(tx, productId)).toBe("sold");
      await voidLine(tx, part.line_id, "Returned");
      expect((await unit(tx, unitId)).status).toBe("available");
      expect(await publication(tx, productId)).toBe("public");
      expect((await movements(tx, productId)).at(-1)?.movement_type).toBe("reversal");
      await assertLedgerConsistent(tx);
    });
  });

  it("complete, reopen, re-complete: sold again at the new completion, one consumption", async () => {
    await inTx(async (tx) => {
      const { productId, unitId } = await makeUniqueWithUnit(tx);
      const job = await newJob(tx);
      await addPart(tx, { workOrderId: job.id, productId, unitId });
      await completeJob(tx, job.id);
      await reopenJob(tx, job.id);
      const again = await setStatus(tx, job.id, "completed");
      const sold = await unit(tx, unitId);
      expect(sold.status).toBe("sold");
      expect(sold.sold_at).toEqual(again.completed_at);
      expect(
        (await movements(tx, productId)).filter((m) => m.movement_type === "job_consumption"),
      ).toHaveLength(1);
      await assertLedgerConsistent(tx);
    });
  });

  it("a sold shop bike handed to its buyer is never stock again: the reopen is refused (bike_with_customer, D29)", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      const bike = await makeBike(tx, null);
      const productId = await makeProduct(tx, { tracking: "unique", name: "Shop bike" });
      await addPublicPhoto(tx, "product", productId);
      await actAs(tx, ADMIN);
      const u = await makeUnit(tx, productId, { bikeId: bike });
      await ownerMode(tx);
      await publish(tx, productId);
      await actAs(tx, ADMIN);
      const job = await newJob(tx);
      const part = await addPart(tx, { workOrderId: job.id, productId, unitId: u.unit_id });
      await walkTo(tx, job.id, "ready_for_collection");
      const sold = await unit(tx, u.unit_id);
      expect(sold.status).toBe("sold");
      expect(await publication(tx, productId)).toBe("sold");

      const handOver = (to: string | null, reason: string) =>
        tx.query("select public.transfer_bike_ownership($1, $2, $3)", [bike, to, reason]);
      await handOver(job.customer_id, "Sold on the job");

      // The reopen would hold the unit again, clear sold_at and let a void
      // put a customer's bike back in stock.
      await failsWith(tx, () => reopenJob(tx, job.id), {
        code: "P0001",
        message: "bike_with_customer",
      });
      expect(await unit(tx, u.unit_id)).toMatchObject({ status: "sold", sold_at: sold.sold_at });
      expect(await publication(tx, productId)).toBe("sold");
      expect(
        await scalar<string>(tx, "select status::text from public.work_orders where id = $1", [
          job.id,
        ]),
      ).toBe("ready_for_collection");

      // Back with the shop (the buyer returned it), the documented path works.
      await handOver(null, "Buyer returned the bike");
      await reopenJob(tx, job.id);
      expect((await unit(tx, u.unit_id)).status).toBe("held_for_customer");
      await voidLine(tx, part.line_id, "Returned");
      expect((await unit(tx, u.unit_id)).status).toBe("available");
      expect(await publication(tx, productId)).toBe("public");
      await assertLedgerConsistent(tx);
    });
  });

  it("void_line refuses to return a unit whose bike a customer owns (bike_with_customer)", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      const bike = await makeBike(tx, null);
      const productId = await makeProduct(tx, { tracking: "unique" });
      await actAs(tx, ADMIN);
      const u = await makeUnit(tx, productId, { bikeId: bike });
      const job = await newJob(tx);
      const part = await addPart(tx, { workOrderId: job.id, productId, unitId: u.unit_id });
      // Unreachable through the RPCs (bike_in_stock refuses the transfer
      // while the unit is held): forge the owner with triggers off.
      await ownerMode(tx);
      await tx.query("set local session_replication_role = replica");
      await tx.query("update public.bikes set customer_id = $1 where id = $2", [
        job.customer_id,
        bike,
      ]);
      await tx.query("set local session_replication_role = origin");
      await actAs(tx, ADMIN);
      await failsWith(tx, () => voidLine(tx, part.line_id, "Returned"), {
        code: "P0001",
        message: "bike_with_customer",
      });
    });
  });

  it("a job with a live part cannot be cancelled (D16); after the void it can", async () => {
    await inTx(async (tx) => {
      const productId = await stockedProduct(tx, 3);
      const job = await newJob(tx);
      const part = await addPart(tx, { workOrderId: job.id, productId, quantity: 2 });
      await failsWith(tx, () => setStatus(tx, job.id, "cancelled", "Customer withdrew"), {
        code: "P0001",
        message: "work_order_has_lines",
      });
      await voidLine(tx, part.line_id, "Customer withdrew");
      expect(await onHand(tx, productId)).toBe(3);
      expect((await setStatus(tx, job.id, "cancelled", "Customer withdrew")).status).toBe(
        "cancelled",
      );
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())(
  "historical line snapshots do not change with catalog edits",
  () => {
    it("keeps the line's snapshots, totals and the movement's cost snapshot", async () => {
      await inTx(async (tx) => {
        const productId = await stockedProduct(tx, 5, { price: "40.00", cost: "15.00" });
        const unique = await makeUniqueWithUnit(tx, { price: "500.00", cost: "300.00" });
        const job = await newJob(tx);
        const part = await addPart(tx, { workOrderId: job.id, productId, quantity: 2 });
        const unitPart = await addPart(tx, {
          workOrderId: job.id,
          productId: unique.productId,
          unitId: unique.unitId,
        });
        await ownerMode(tx);
        const lines = [await lineRow(tx, part.line_id), await lineRow(tx, unitPart.line_id)];
        const costs = (await movements(tx, productId)).map((m) => m.unit_cost_snapshot);
        await tx.query(
          "update public.products set default_sale_price = 99, default_direct_cost = 77 where id = any($1::uuid[])",
          [[productId, unique.productId]],
        );
        await tx.query(
          "update public.inventory_units set sale_price = 1, direct_cost = 1 where id = $1",
          [unique.unitId],
        );
        expect([await lineRow(tx, part.line_id), await lineRow(tx, unitPart.line_id)]).toEqual(
          lines,
        );
        expect(lines[0]).toMatchObject({
          sale_total: "80.00",
          cost_total: "30.00",
          yield_total: "50.00",
        });
        expect((await movements(tx, productId)).map((m) => m.unit_cost_snapshot)).toEqual(costs);
        expect(costs).toEqual(["15.00", "15.00"]);
      });
    });
  },
);

describe("append-only", () => {
  it("the ledger and both histories refuse updates and deletes, even from the owner", async () => {
    await inTx(async (tx) => {
      for (const [table, code] of [
        ["public.inventory_movements", "movement_append_only"],
        ["public.product_events", "product_events_append_only"],
        ["public.inventory_unit_events", "inventory_unit_events_append_only"],
      ]) {
        await failsWith(tx, () => tx.query(`delete from ${table}`), {
          code: "P0001",
          message: code,
        });
        await failsWith(tx, () => tx.query(`update ${table} set created_at = now()`), {
          code: "P0001",
          message: code,
        });
      }
      await actAs(tx, ADMIN);
      for (const table of [
        "public.inventory_movements",
        "public.product_events",
        "public.inventory_unit_events",
      ]) {
        await failsWith(tx, () => tx.query(`delete from ${table}`), { code: "42501" });
        await failsWith(tx, () => tx.query(`insert into ${table} default values`), {
          code: "42501",
        });
      }
    });
  });
});

describe.skipIf(!isolatedDatabase())(
  "archived entities remain available to historical references",
  () => {
    it("an archived product keeps its movements and job lines", async () => {
      await inTx(async (tx) => {
        const productId = await stockedProduct(tx, 2);
        const job = await newJob(tx);
        const part = await addPart(tx, { workOrderId: job.id, productId, quantity: 2 });
        await tx.query(
          "update public.products set active = false, archived_at = now() where id = $1",
          [productId],
        );
        const joined = await scalar<number>(
          tx,
          `select count(*)::int from public.work_order_line_items li
           join public.products p on p.id = li.source_product_id
           join public.inventory_movements m on m.work_order_line_item_id = li.id
          where li.id = $1 and p.archived_at is not null`,
          [part.line_id],
        );
        expect(joined).toBe(1);
        expect(
          await countWhere(tx, "public.inventory_movements where product_id = $1", [productId]),
        ).toBe(2);
        // Archived: no new stock or parts.
        await failsWith(tx, () => addPart(tx, { workOrderId: job.id, productId }), {
          code: "P0001",
          message: "product_archived",
        });
      });
    });
  },
);

// ---------------------------------------------------------------------------
// Concurrency: real connections, committed transactions.
// ---------------------------------------------------------------------------

describe.skipIf(!isolatedDatabase())("under concurrency", () => {
  let setup: pg.Client;

  beforeAll(async () => {
    setup = await connect();
  });

  /** Committed: a quantity product with `qty` at the Shop floor. */
  async function product(qty: number): Promise<string> {
    const productId = await makeProduct(setup);
    if (qty > 0) {
      const r = await committed(setup, (tx) => addStock(tx, productId, qty));
      if (!r.ok) throw r.error;
    }
    return productId;
  }

  /** Committed: a unique product with `n` available units. */
  async function uniqueProduct(n: number): Promise<{ productId: string; unitIds: string[] }> {
    const productId = await makeProduct(setup, {
      tracking: "unique",
      price: "700.00",
      cost: "400.00",
    });
    const unitIds: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = await committed(setup, (tx) => makeUnit(tx, productId));
      if (!r.ok) throw r.error;
      unitIds.push(r.value.unit_id);
    }
    return { productId, unitIds };
  }

  /** Committed: an open job. */
  async function job(): Promise<string> {
    const ids = await makeCustomerWithBike(setup);
    const r = await committed(setup, (tx) => createWorkOrder(tx, ids));
    if (!r.ok) throw r.error;
    return r.value.id;
  }

  /** Committed: the job moved to in_progress. */
  async function started(id: string) {
    const r = await committed(setup, (tx) => setStatus(tx, id, "in_progress"));
    if (!r.ok) throw r.error;
  }

  it("the same line id twice, a quantity part: one line, one movement, the second replays", async () => {
    const productId = await product(10);
    const jobId = await job();
    const lineId = randomUUID();
    const [a, b] = await openConnections(2);
    const results = await Promise.all(
      [a, b].map((c) =>
        committed(c, (tx) => addPart(tx, { lineId, workOrderId: jobId, productId, quantity: 2 })),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const values = results.map((r) => (r.ok ? r.value : null));
    expect(values.map((v) => v?.replayed).sort()).toEqual([false, true]);
    expect(await onHand(setup, productId)).toBe(8);
    expect(
      await countWhere(setup, "public.inventory_movements where work_order_line_item_id = $1", [
        lineId,
      ]),
    ).toBe(1);
  });

  it("the same line id twice, a unique unit: one line, the second replays (not unit_not_available)", async () => {
    const { productId, unitIds } = await uniqueProduct(1);
    const jobId = await job();
    const lineId = randomUUID();
    const [a, b] = await openConnections(2);
    const results = await Promise.all(
      [a, b].map((c) =>
        committed(c, (tx) =>
          addPart(tx, { lineId, workOrderId: jobId, productId, unitId: unitIds[0] }),
        ),
      ),
    );
    expect(results.map((r) => r.ok && r.value.replayed).sort()).toEqual([false, true]);
    expect(await countWhere(setup, "public.work_order_line_items where id = $1", [lineId])).toBe(1);
    expect((await unit(setup, unitIds[0])).status).toBe("held_for_customer");
  });

  it("one unit on two jobs at once: exactly one succeeds", async () => {
    const { productId, unitIds } = await uniqueProduct(1);
    const jobs = [await job(), await job()];
    const [a, b] = await openConnections(2);
    const results = await Promise.all(
      [a, b].map((c, i) =>
        committed(c, (tx) => addPart(tx, { workOrderId: jobs[i], productId, unitId: unitIds[0] })),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok && failed.error).toMatchObject({
      code: "P0001",
      message: "unit_not_available",
    });
    expect(
      await countWhere(setup, "public.work_order_line_items where source_inventory_unit_id = $1", [
        unitIds[0],
      ]),
    ).toBe(1);
  });

  it("two voids at once write one reversal", async () => {
    const productId = await product(4);
    const jobId = await job();
    const added = await committed(setup, (tx) =>
      addPart(tx, { workOrderId: jobId, productId, quantity: 2 }),
    );
    if (!added.ok) throw added.error;
    const [a, b] = await openConnections(2);
    const results = await Promise.all(
      [a, b].map((c) => committed(c, (tx) => voidLine(tx, added.value.line_id, "Not needed"))),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(
      await countWhere(
        setup,
        "public.inventory_movements where product_id = $1 and movement_type = 'reversal'",
        [productId],
      ),
    ).toBe(1);
    expect(await onHand(setup, productId)).toBe(4);
  });

  it("the same adjustment request twice gives one movement", async () => {
    const productId = await product(0);
    const requestId = randomUUID();
    const [a, b] = await openConnections(2);
    const results = await Promise.all(
      [a, b].map((c) => committed(c, (tx) => addStock(tx, productId, 6, { requestId }))),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await onHand(setup, productId)).toBe(6);
    expect(
      await countWhere(setup, "public.inventory_movements where request_id = $1", [requestId]),
    ).toBe(1);
  });

  it("two transfers draining the same stock: exactly one succeeds", async () => {
    const productId = await product(3);
    const store = await makeLocation(setup);
    const [a, b] = await openConnections(2);
    const results = await Promise.all(
      [a, b].map((c) =>
        committed(c, (tx) =>
          transfer(tx, { productId, from: LOCATION.shopFloor, to: store, quantity: 2 }),
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok && failed.error).toMatchObject({ message: "insufficient_stock" });
    expect(await onHand(setup, productId)).toBe(1);
    expect(await onHand(setup, productId, store)).toBe(2);
  });

  it("adding a unit while completing the job: sold with the job, or refused and still available", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { productId, unitIds } = await uniqueProduct(1);
      const jobId = await job();
      await started(jobId);
      const [a, b] = await openConnections(2);
      const [add, complete] = await Promise.all([
        committed(a, (tx) => addPart(tx, { workOrderId: jobId, productId, unitId: unitIds[0] })),
        committed(b, (tx) => setStatus(tx, jobId, "completed")),
      ]);
      expect(complete.ok).toBe(true);
      const u = await unit(setup, unitIds[0]);
      if (add.ok) {
        const completedAt = await scalar<Date>(
          setup,
          "select completed_at from public.work_orders where id = $1",
          [jobId],
        );
        expect(u.status).toBe("sold");
        expect(u.sold_at).toEqual(completedAt);
      } else {
        expect(add.error).toMatchObject({ code: "P0001", message: "work_order_locked" });
        expect(u.status).toBe("available");
      }
    }
    expect(
      await countWhere(
        setup,
        `public.inventory_units u join public.work_order_line_items li on li.source_inventory_unit_id = u.id
           join public.work_orders w on w.id = li.work_order_id
         where u.status = 'held_for_customer' and w.completed_at is not null and li.voided_at is null`,
        [],
      ),
    ).toBe(0);
  });

  it("adding a part while cancelling: either the part and an open job, or a cancelled job and no part", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const productId = await product(5);
      const jobId = await job();
      const [a, b] = await openConnections(2);
      const [add, cancel] = await Promise.all([
        committed(a, (tx) => addPart(tx, { workOrderId: jobId, productId })),
        committed(b, (tx) => setStatus(tx, jobId, "cancelled", "Customer withdrew")),
      ]);
      const status = await scalar<string>(
        setup,
        "select status::text from public.work_orders where id = $1",
        [jobId],
      );
      if (add.ok) {
        expect(cancel.ok).toBe(false);
        expect(!cancel.ok && cancel.error).toMatchObject({ message: "work_order_has_lines" });
        expect(status).toBe("received");
        expect(await onHand(setup, productId)).toBe(4);
      } else {
        expect(add.error).toMatchObject({ message: "work_order_locked" });
        expect(cancel.ok).toBe(true);
        expect(status).toBe("cancelled");
        expect(await onHand(setup, productId)).toBe(5);
      }
    }
  });

  it("a public product's last two units sold on two jobs completed at once ends sold", async () => {
    const { productId, unitIds } = await uniqueProduct(2);
    await addPublicPhoto(setup, "product", productId);
    await publish(setup, productId);
    const jobs = [await job(), await job()];
    for (const [i, jobId] of jobs.entries()) {
      const r = await committed(setup, async (tx) => {
        await addPart(tx, { workOrderId: jobId, productId, unitId: unitIds[i] });
        await setStatus(tx, jobId, "in_progress");
      });
      if (!r.ok) throw r.error;
    }
    expect(await publication(setup, productId)).toBe("public");
    const [a, b] = await openConnections(2);
    const results = await Promise.all(
      [a, b].map((c, i) => committed(c, (tx) => setStatus(tx, jobs[i], "completed"))),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await publication(setup, productId)).toBe("sold");
    for (const id of unitIds) expect((await unit(setup, id)).status).toBe("sold");
  });
});
