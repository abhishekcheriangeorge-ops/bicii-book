/**
 * The consignment core (SPEC §2, §11, §12, §13, §23; DATA-MODEL §6, §7, §9,
 * §16; PLAN D4, D9, D13/D19, D24 (amended), D26, D27 (changed), D29, D45
 * CONS-QTY-FIFO, D50 CONS-STOCK-MOVES, D51 CONS-BIKE-LINK, D52
 * CONS-PHOTOS-INTERNAL): intake of unique and quantity items, the single
 * selling price, terms, charges, consignors, history, photos, bikes and
 * returns. Consigned parts on jobs (D44) are
 * tests/db/consignment-job-parts.test.ts; access (D48) is
 * consignment-access.test.ts; races are consignment-concurrency.test.ts.
 *
 * Tests create products, units, items and jobs (short-ID sequences), so the
 * file runs only on a per-file clone. Tests assert only on rows they
 * created and never on exact C- numbers. Every test that writes stock ends
 * with assertLedgerConsistent().
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { LOCATION, STAFF } from "../fixtures/ids";
import {
  addCharge,
  createConsignor,
  intakeQuantity,
  intakeUnique,
  itemEvents,
  itemMovements,
  itemPosition,
  itemRow,
  itemStatus,
  returnItem,
  sellingPrice,
  staffWith,
  updateTerms,
  voidCharge,
} from "./consignment-fixtures";
import { attachmentPath, putStorageObject } from "./customer-fixtures";
import { actAs, connect, inTransaction, isolatedDatabase, scalar } from "./harness";
import {
  ADMIN,
  MECHANIC2,
  addPart,
  addPublicPhoto,
  addStock,
  assertLedgerConsistent,
  completeJob,
  makeLocation,
  makeProduct,
  makeUnit,
  newJob,
  onHand,
  publicItems,
  publication,
  publishProduct,
  readAsOwner,
  transfer,
  unit,
  writeOff,
} from "./inventory-fixtures";
import { failsWith, makeBike, makeCustomer, ownerMode, tryAndUndo } from "./workshop-fixtures";

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

/** A unit's cost-bearing columns (read as the owner). */
const unitRow = (tx: pg.Client, unitId: string) =>
  readAsOwner(tx, async () => {
    const { rows } = await tx.query<{
      ownership_type: string;
      consignment_item_id: string | null;
      status: string;
      direct_cost: string | null;
      sale_price: string | null;
      bike_id: string | null;
      short_id: string;
    }>(
      `select ownership_type::text, consignment_item_id, status::text, direct_cost::text, sale_price::text,
              bike_id, short_id
         from public.inventory_units where id = $1`,
      [unitId],
    );
    return rows[0];
  });

/** Σ on-hand over every location equals Σ remaining over the product's items (D50). */
async function expectStockMatchesConsignors(tx: pg.Client, productId: string): Promise<number> {
  return readAsOwner(tx, async () => {
    const onHandTotal = await scalar<number>(
      tx,
      "select coalesce(sum(quantity_delta), 0)::int from public.inventory_movements where product_id = $1",
      [productId],
    );
    const remainingTotal = await scalar<number>(
      tx,
      "select coalesce(sum(remaining_qty), 0)::int from reporting.consignment_item_position where product_id = $1",
      [productId],
    );
    expect(onHandTotal).toBe(remainingTotal);
    return onHandTotal;
  });
}

describe.skipIf(!isolatedDatabase())("intake (create_consignment_item; D9, D45)", () => {
  it("a unique intake creates a C- item, an available consigned U- unit, a draft consignment product and one consignment_received movement", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx, { displayName: "Daniel Ong" });
      const r = await intakeUnique(tx, { consignorId, agreed: "500", asking: "1000.00" });
      expect(r).toMatchObject({ status: "active" });
      expect(r.short_id).toMatch(/^C-\d{6}$/);
      expect(r.inventory_unit_id).not.toBeNull();

      const u = await unitRow(tx, r.inventory_unit_id!);
      expect(u).toMatchObject({
        ownership_type: "consignment",
        consignment_item_id: r.item_id,
        status: "available",
        direct_cost: "500.00",
        sale_price: "1000.00",
      });
      expect(u.short_id).toMatch(/^U-\d{6}$/);
      const { rows: products } = await tx.query(
        `select ownership_type::text, publication_status::text, tracking_type::text,
                default_sale_price::text, short_id
           from public.products where id = $1`,
        [r.product_id],
      );
      expect(products[0]).toMatchObject({
        ownership_type: "consignment",
        publication_status: "draft",
        tracking_type: "unique",
        default_sale_price: "1000.00",
      });
      expect(await itemRow(tx, r.item_id)).toMatchObject({
        consignor_id: consignorId,
        quantity: 1,
        agreed_amount_owed: "500.00",
        asking_price: "1000.00",
        status: "active",
        sold_at: null,
        returned_at: null,
      });

      const moves = await itemMovements(tx, r.product_id);
      expect(moves).toEqual([
        expect.objectContaining({
          movement_type: "consignment_received",
          quantity_delta: 1,
          inventory_unit_id: r.inventory_unit_id,
          consignment_item_id: r.item_id,
          request_id: r.item_id,
          unit_cost_snapshot: "500.00",
          location_id: LOCATION.shopFloor,
        }),
      ]);
      const events = await itemEvents(tx, r.item_id);
      expect(events).toEqual([
        expect.objectContaining({
          event_type: "received",
          actor_staff_id: STAFF.admin,
          payload: {
            quantity: 1,
            agreed_amount_owed: 500,
            asking_price: 1000,
            product_id: r.product_id,
            inventory_unit_id: r.inventory_unit_id,
            bike_id: null,
          },
        }),
      ]);
      expect(await itemPosition(tx, r.item_id)).toMatchObject({
        remaining_qty: 1,
        owed_qty: 0,
        liability: "0.00",
      });
      await assertLedgerConsistent(tx);
    });
  });

  it("a quantity intake adds its quantity to on-hand, and a second item reuses the consignment product", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const first = await intakeQuantity(tx, { consignorId, agreed: "12.00", quantity: 6 });
      expect(first.inventory_unit_id).toBeNull();
      expect(await onHand(tx, first.product_id)).toBe(6);
      const other = await createConsignor(tx);
      const second = await intakeQuantity(tx, {
        consignorId: other,
        agreed: "15.00",
        quantity: 4,
        productId: first.product_id,
        locationId: LOCATION.workshopStore,
      });
      expect(second.product_id).toBe(first.product_id);
      expect(await onHand(tx, first.product_id)).toBe(6);
      expect(await onHand(tx, first.product_id, LOCATION.workshopStore)).toBe(4);
      expect((await itemPosition(tx, first.item_id)).remaining_qty).toBe(6);
      expect((await itemPosition(tx, second.item_id)).remaining_qty).toBe(4);
      expect(await expectStockMatchesConsignors(tx, first.product_id)).toBe(10);
      await assertLedgerConsistent(tx);
    });
  });

  it("validates the intake: shape, product, consignor, amounts and permission", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      await ownerMode(tx);
      const shopProduct = await makeProduct(tx, { tracking: "unique" });
      await actAs(tx, ADMIN);
      const uniqueItem = await intakeUnique(tx, { consignorId, agreed: "100.00" });
      const qtyItem = await intakeQuantity(tx, { consignorId, agreed: "5.00", quantity: 2 });
      const cases: [() => Promise<unknown>, Record<string, unknown>][] = [
        [
          () => intakeUnique(tx, { consignorId, agreed: "100.00", productId: shopProduct }),
          { code: "P0001", message: "product_not_consignment" },
        ],
        [
          () => intakeUnique(tx, { consignorId, agreed: "100.00", quantity: 2 }),
          { code: "P0001", message: "consignment_unique_quantity_one" },
        ],
        [
          () => intakeQuantity(tx, { consignorId, agreed: "5.00", quantity: 0 }),
          { code: "P0001", message: "consignment_quantity_invalid" },
        ],
        [
          () =>
            intakeQuantity(tx, {
              consignorId,
              agreed: "5.00",
              quantity: 1,
              productId: uniqueItem.product_id,
            }),
          { code: "P0001", message: "consignment_tracking_mismatch" },
        ],
        [
          () => intakeUnique(tx, { consignorId, agreed: "5.00", productId: qtyItem.product_id }),
          { code: "P0001", message: "consignment_tracking_mismatch" },
        ],
        [
          () =>
            intakeUnique(tx, {
              consignorId,
              agreed: "5.00",
              receivedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            }),
          { code: "P0001", message: "consignment_received_in_future" },
        ],
        [
          () => intakeUnique(tx, { consignorId, agreed: "5.00", productName: "   " }),
          { code: "P0001", message: "consignment_product_required" },
        ],
        [() => intakeUnique(tx, { consignorId: randomUUID(), agreed: "5.00" }), { code: "P0002" }],
        [() => intakeUnique(tx, { consignorId, agreed: "-1.00" }), { code: "23514" }],
        [() => intakeUnique(tx, { consignorId, agreed: "NaN" }), { code: "23514" }],
        [
          () => intakeQuantity(tx, { consignorId, agreed: "-1.00", quantity: 2 }),
          { code: "23514", constraint: "consignment_items_agreed_amount_owed_check" },
        ],
        [
          () =>
            tx.query("select public.create_consignment_item($1, $2, $3, null)", [
              randomUUID(),
              consignorId,
              LOCATION.shopFloor,
            ]),
          { code: "22004" },
        ],
      ];
      for (const [call, expected] of cases) await failsWith(tx, call, expected);

      const archived = await createConsignor(tx);
      await tx.query("update public.consignors set archived_at = now() where id = $1", [archived]);
      await failsWith(tx, () => intakeUnique(tx, { consignorId: archived, agreed: "5.00" }), {
        code: "P0001",
        message: "consignor_archived",
      });

      await actAs(tx, MECHANIC2);
      await failsWith(tx, () => intakeUnique(tx, { consignorId, agreed: "5.00" }), {
        code: "42501",
      });
      await actAs(tx, ADMIN);
      await assertLedgerConsistent(tx);
    });
  });

  it("D24: an agreed amount of 0 and an asking price of 0 are known values, stored as 0", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const r = await intakeUnique(tx, { consignorId, agreed: "0", asking: "0" });
      expect(await itemRow(tx, r.item_id)).toMatchObject({
        agreed_amount_owed: "0.00",
        asking_price: "0.00",
      });
      expect(await unitRow(tx, r.inventory_unit_id!)).toMatchObject({
        direct_cost: "0.00",
        sale_price: "0.00",
      });
      expect(await sellingPrice(tx, r.product_id, r.inventory_unit_id)).toBe("0.00");
      const q = await intakeQuantity(tx, { consignorId, agreed: "0", asking: "0", quantity: 2 });
      expect((await itemRow(tx, q.item_id)).agreed_amount_owed).toBe("0.00");
      expect((await itemMovements(tx, q.product_id))[0].unit_cost_snapshot).toBe("0.00");
      await assertLedgerConsistent(tx);
    });
  });

  it("a replayed intake has one business effect: one item, one unit, one movement", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const itemId = randomUUID();
      const first = await intakeUnique(tx, {
        itemId,
        consignorId,
        agreed: "500",
        asking: "1000",
        productName: "Canyon Ultimate",
      });
      const again = await intakeUnique(tx, {
        itemId,
        consignorId,
        agreed: "500.00",
        asking: "1000.00",
        productName: "  canyon ultimate ",
      });
      expect(again).toEqual(first);
      expect(
        await scalar<number>(
          tx,
          "select count(*)::int from public.inventory_units where product_id = $1",
          [first.product_id],
        ),
      ).toBe(1);
      expect(await itemMovements(tx, first.product_id)).toHaveLength(1);

      const other = await createConsignor(tx);
      for (const conflicting of [
        { consignorId: other, agreed: "500.00" },
        { consignorId, agreed: "600.00" },
      ]) {
        await failsWith(
          tx,
          () =>
            intakeUnique(tx, {
              itemId,
              asking: "1000.00",
              productName: "Canyon Ultimate",
              ...conflicting,
            }),
          { code: "P0001", message: "consignment_item_conflict" },
        );
      }
      const qtyId = randomUUID();
      await intakeQuantity(tx, {
        itemId: qtyId,
        consignorId,
        agreed: "5.00",
        quantity: 3,
        productName: "Bottle",
      });
      await failsWith(
        tx,
        () =>
          intakeQuantity(tx, {
            itemId: qtyId,
            consignorId,
            agreed: "5.00",
            quantity: 4,
            productName: "Bottle",
          }),
        { code: "P0001", message: "consignment_item_conflict" },
      );

      // A replay after the consignor was archived still returns the item:
      // no state check runs before the replay.
      await returnItem(tx, { itemId: first.item_id });
      await returnItem(tx, { itemId: qtyId, locationId: LOCATION.shopFloor });
      await tx.query("update public.consignors set archived_at = now() where id = $1", [
        consignorId,
      ]);
      const late = await intakeUnique(tx, {
        itemId,
        consignorId,
        agreed: "500",
        asking: "1000",
        productName: "Canyon Ultimate",
      });
      expect(late).toMatchObject({ item_id: itemId, status: "returned" });
      await assertLedgerConsistent(tx);
    });
  });

  it("A consigned unit cannot exist without its consignment item", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const r = await intakeUnique(tx, { consignorId, agreed: "100.00" });
      await ownerMode(tx);
      const shopProduct = await makeProduct(tx, { tracking: "unique" });
      const insertUnit = (productId: string, ownership: string, itemId: string | null) =>
        tx.query(
          `insert into public.inventory_units (product_id, location_id, ownership_type, consignment_item_id)
           values ($1, $2, $3, $4)`,
          [productId, LOCATION.shopFloor, ownership, itemId],
        );
      await failsWith(tx, () => insertUnit(r.product_id, "consignment", null), {
        code: "23514",
        constraint: "inventory_units_consignment_shape",
      });
      await failsWith(tx, () => insertUnit(shopProduct, "shop_owned", r.item_id), {
        code: "23514",
        constraint: "inventory_units_consignment_item_ownership",
      });
      await failsWith(
        tx,
        async () => {
          await insertUnit(r.product_id, "consignment", randomUUID());
          await tx.query("set constraints all immediate");
        },
        { code: "23503", constraint: "inventory_units_consignment_item_id_fkey" },
      );
      // A unit keeps its item and its ownership for life.
      await failsWith(
        tx,
        () =>
          tx.query(
            "update public.inventory_units set ownership_type = 'shop_owned' where id = $1",
            [r.inventory_unit_id],
          ),
        { code: "P0001", message: "consignment_item_immutable" },
      );
      await actAs(tx, ADMIN);
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())("CONS-STOCK-MOVES (D50) and ownership (D45)", () => {
  it("consigned stock moves only by intake, return, job consumption and transfer: on-hand always equals the consignors' remaining quantity", async () => {
    await inTx(async (tx) => {
      const a = await createConsignor(tx);
      const b = await createConsignor(tx);
      const first = await intakeQuantity(tx, { consignorId: a, agreed: "10.00", quantity: 6 });
      const productId = first.product_id;
      await intakeQuantity(tx, { consignorId: b, agreed: "12.00", quantity: 4, productId });
      expect(await expectStockMatchesConsignors(tx, productId)).toBe(10);

      const job = await newJob(tx);
      await addPart(tx, { workOrderId: job.id, productId, quantity: 2 });
      expect(await expectStockMatchesConsignors(tx, productId)).toBe(8);
      await returnItem(tx, { itemId: first.item_id, quantity: 1, locationId: LOCATION.shopFloor });
      expect(await expectStockMatchesConsignors(tx, productId)).toBe(7);

      for (const [quantity, type] of [
        [1, "stock_adjustment"],
        [-1, "stock_adjustment"],
        [-1, "damaged"],
      ] as const) {
        await failsWith(tx, () => addStock(tx, productId, quantity, { type }), {
          code: "P0001",
          message: "consignment_stock_adjust_blocked",
        });
      }
      // A purchase receipt or any other movement by an owner is refused too.
      await ownerMode(tx);
      await failsWith(
        tx,
        () =>
          tx.query(
            `select private.record_movement($1, null, $2, 1, 'purchase_received', null, 1.00, null, null, null, null)`,
            [productId, LOCATION.shopFloor],
          ),
        { code: "P0001", message: "consignment_stock_adjust_blocked" },
      );
      await actAs(tx, ADMIN);

      await transfer(tx, {
        productId,
        from: LOCATION.shopFloor,
        to: LOCATION.workshopStore,
        quantity: 3,
      });
      expect(await expectStockMatchesConsignors(tx, productId)).toBe(7);

      const unique = await intakeUnique(tx, { consignorId: a, agreed: "300.00" });
      await failsWith(tx, () => makeUnit(tx, unique.product_id), {
        code: "P0001",
        message: "consignment_stock_adjust_blocked",
      });
      await failsWith(tx, () => writeOff(tx, unique.inventory_unit_id!), {
        code: "P0001",
        message: "consignment_unit_write_off_blocked",
      });
      expect((await unit(tx, unique.inventory_unit_id!)).status).toBe("available");
      expect(await expectStockMatchesConsignors(tx, unique.product_id)).toBe(1);
      await assertLedgerConsistent(tx);
    });
  });

  it("a product with stock history keeps its ownership (product_ownership_immutable)", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const consigned = await intakeQuantity(tx, { consignorId, agreed: "5.00", quantity: 2 });
      await ownerMode(tx);
      const stocked = await makeProduct(tx);
      await actAs(tx, ADMIN);
      await addStock(tx, stocked, 3);
      await ownerMode(tx);
      const unused = await makeProduct(tx);
      for (const [productId, to] of [
        [consigned.product_id, "shop_owned"],
        [stocked, "consignment"],
      ]) {
        await failsWith(
          tx,
          () =>
            tx.query("update public.products set ownership_type = $2 where id = $1", [
              productId,
              to,
            ]),
          { code: "P0001", message: "product_ownership_immutable" },
        );
      }
      await tx.query("update public.products set ownership_type = 'consignment' where id = $1", [
        unused,
      ]);
      await actAs(tx, ADMIN);
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())("one selling price (D45)", () => {
  it("a consigned unit sells at its item's asking price, before and after new terms, and the public page shows the same", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const r = await intakeUnique(tx, { consignorId, agreed: "500.00", asking: "1000.00" });
      expect(await sellingPrice(tx, r.product_id, r.inventory_unit_id)).toBe("1000.00");
      await updateTerms(tx, r.item_id, { asking: "900.00" });
      expect(await sellingPrice(tx, r.product_id, r.inventory_unit_id)).toBe("900.00");
      // The product row uses its FIFO-head item's price.
      expect(await sellingPrice(tx, r.product_id)).toBe("900.00");

      await ownerMode(tx);
      await addPublicPhoto(tx, "product", r.product_id);
      await actAs(tx, ADMIN);
      await publishProduct(tx, r.product_id);
      const unitShort = (await unit(tx, r.inventory_unit_id!)).short_id;
      const productShort = await scalar<string>(
        tx,
        "select short_id from public.products where id = $1",
        [r.product_id],
      );
      const visible = await publicItems(tx);
      expect(visible.find((i) => i.short_id === unitShort)).toMatchObject({
        kind: "unit",
        sale_price: "900.00",
        availability: "available",
      });
      expect(visible.find((i) => i.short_id === productShort)).toMatchObject({
        kind: "product",
        sale_price: "900.00",
      });
      await assertLedgerConsistent(tx);
    });
  });

  it("a consigned quantity product sells at its FIFO-head item's asking price; shop-owned prices are unchanged", async () => {
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
      await intakeQuantity(tx, {
        consignorId: b,
        agreed: "25.00",
        asking: "35.00",
        quantity: 3,
        productId,
      });
      expect(await sellingPrice(tx, productId)).toBe("30.00");
      await returnItem(tx, { itemId: older.item_id, locationId: LOCATION.shopFloor });
      expect(await sellingPrice(tx, productId)).toBe("35.00");

      await ownerMode(tx);
      const shop = await makeProduct(tx, { price: "20.00", tracking: "unique" });
      await actAs(tx, ADMIN);
      const shopUnit = await makeUnit(tx, shop, { price: "24.00" });
      expect(await sellingPrice(tx, shop)).toBe("20.00");
      expect(await sellingPrice(tx, shop, shopUnit.unit_id)).toBe("24.00");
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())("terms (update_consignment_terms)", () => {
  it("a new agreed amount needs a reason and is recorded with from/to; the unit's price and cost follow", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const r = await intakeUnique(tx, { consignorId, agreed: "500.00", asking: "1000.00" });
      for (const reason of [null, "   "]) {
        await failsWith(tx, () => updateTerms(tx, r.item_id, { agreed: "450.00", reason }), {
          code: "P0001",
          message: "reason_required",
        });
      }
      await updateTerms(tx, r.item_id, {
        agreed: "450.00",
        asking: "950.00",
        reason: "Consignor agreed a lower price",
      });
      expect(await itemRow(tx, r.item_id)).toMatchObject({
        agreed_amount_owed: "450.00",
        asking_price: "950.00",
      });
      expect(await unitRow(tx, r.inventory_unit_id!)).toMatchObject({
        direct_cost: "450.00",
        sale_price: "950.00",
      });
      // Identical values change nothing; a new asking price alone needs no reason.
      await updateTerms(tx, r.item_id, { agreed: "450.00" });
      await updateTerms(tx, r.item_id, { asking: "940.00" });
      const terms = (await itemEvents(tx, r.item_id)).filter(
        (e) => e.event_type === "terms_changed",
      );
      expect(terms).toEqual([
        expect.objectContaining({
          payload: {
            agreed_amount_owed: { from: 500, to: 450 },
            asking_price: { from: 1000, to: 950 },
          },
          reason: "Consignor agreed a lower price",
        }),
        expect.objectContaining({
          payload: { asking_price: { from: 950, to: 940 } },
          reason: null,
        }),
      ]);

      await returnItem(tx, { itemId: r.item_id });
      await failsWith(tx, () => updateTerms(tx, r.item_id, { asking: "800.00" }), {
        code: "P0001",
        message: "consignment_item_not_active",
      });
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())("charges (D4, D45)", () => {
  it("every charge has an explicit bearer; shop charges only on an available unique item; voided with a reason, never edited", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const bike = await intakeUnique(tx, { consignorId, agreed: "500.00", asking: "1000.00" });
      const qty = await intakeQuantity(tx, { consignorId, agreed: "5.00", quantity: 2 });

      await failsWith(
        tx,
        () => addCharge(tx, { itemId: bike.item_id, amount: "20.00", bearer: null }),
        {
          code: "P0001",
          message: "charge_bearer_required",
        },
      );
      await failsWith(
        tx,
        () => addCharge(tx, { itemId: qty.item_id, amount: "2.00", bearer: "shop" }),
        {
          code: "P0001",
          message: "shop_charge_unique_only",
        },
      );
      await failsWith(
        tx,
        () => addCharge(tx, { itemId: bike.item_id, amount: "0.00", bearer: "consignor" }),
        { code: "23514", constraint: "consignment_item_charges_amount_check" },
      );

      const chargeId = randomUUID();
      const shop = await addCharge(tx, {
        chargeId,
        itemId: bike.item_id,
        description: "  New tyres ",
        amount: "120.00",
        bearer: "shop",
      });
      expect(shop).toMatchObject({ description: "New tyres", amount: "120.00", bearer: "shop" });
      // Replay by id; the same id for anything else is a conflict.
      expect(
        await addCharge(tx, {
          chargeId,
          itemId: bike.item_id,
          description: "New tyres",
          amount: "120.00",
          bearer: "shop",
        }),
      ).toEqual(shop);
      await failsWith(
        tx,
        () =>
          addCharge(tx, {
            chargeId,
            itemId: bike.item_id,
            description: "New tyres",
            amount: "125.00",
            bearer: "shop",
          }),
        { code: "P0001", message: "consignment_charge_conflict" },
      );
      const consignorCharge = await addCharge(tx, {
        itemId: bike.item_id,
        description: "Detailing",
        amount: "45.00",
        bearer: "consignor",
      });
      expect(await itemPosition(tx, bike.item_id)).toMatchObject({
        shop_charges: "120.00",
        consignor_charges: "45.00",
      });

      // While the unit is on a job its cost is fixed: no shop charge, no void.
      const job = await newJob(tx);
      await addPart(tx, {
        workOrderId: job.id,
        productId: bike.product_id,
        unitId: bike.inventory_unit_id,
      });
      await failsWith(
        tx,
        () => addCharge(tx, { itemId: bike.item_id, amount: "10.00", bearer: "shop" }),
        { code: "P0001", message: "shop_charge_unit_not_available" },
      );
      await failsWith(tx, () => voidCharge(tx, shop.id), {
        code: "P0001",
        message: "shop_charge_unit_not_available",
      });

      // A consignor charge is allowed on a sold item.
      await completeJob(tx, job.id);
      expect(await itemStatus(tx, bike.item_id)).toBe("sold");
      await addCharge(tx, {
        itemId: bike.item_id,
        description: "Courier",
        amount: "15.00",
        bearer: "consignor",
      });

      for (const reason of [null, "  "]) {
        await failsWith(tx, () => voidCharge(tx, consignorCharge.id, reason), {
          code: "P0001",
          message: "reason_required",
        });
      }
      const voided = await voidCharge(tx, consignorCharge.id, "Entered twice");
      expect(voided.voided_at).not.toBeNull();
      expect(voided.void_reason).toBe("Entered twice");
      expect(await voidCharge(tx, consignorCharge.id, "Again")).toEqual(voided);
      expect((await itemPosition(tx, bike.item_id)).consignor_charges).toBe("15.00");

      await ownerMode(tx);
      for (const sql of [
        "update public.consignment_item_charges set amount = 1 where id = $1",
        "update public.consignment_item_charges set voided_at = null, void_reason = null where id = $1",
        "delete from public.consignment_item_charges where id = $1",
      ]) {
        await failsWith(tx, () => tx.query(sql, [consignorCharge.id]), {
          code: "P0001",
          message: "consignment_charges_immutable",
        });
      }
      await actAs(tx, ADMIN);
      const types = (await itemEvents(tx, bike.item_id)).map((e) => e.event_type);
      expect(types.filter((t) => t === "charge_added")).toHaveLength(3);
      expect(types.filter((t) => t === "charge_voided")).toHaveLength(1);
      const voidEvent = (await itemEvents(tx, bike.item_id)).find(
        (e) => e.event_type === "charge_voided",
      );
      expect(voidEvent).toMatchObject({
        reason: "Entered twice",
        payload: { charge_id: consignorCharge.id, amount: 45, bearer: "consignor" },
      });
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())("consignors (D47, D48)", () => {
  it("manage_consignments writes consignors; archiving needs no active item; payout details stay hidden", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      const manager = await staffWith(tx, ["manage_consignments"]);
      const archivedCustomer = await makeCustomer(tx);
      await tx.query("update public.customers set archived_at = now() where id = $1", [
        archivedCustomer,
      ]);
      const customer = await makeCustomer(tx);

      await actAs(tx, MECHANIC2);
      await failsWith(tx, () => createConsignor(tx), { code: "42501" });

      await actAs(tx, manager.claims);
      const id = await createConsignor(tx, {
        displayName: "  Daniel Ong ",
        customerId: customer,
        email: " daniel@example.com ",
        phone: " ",
        payoutDetails: "PayNow 9123 4567",
      });
      const { rows } = await tx.query(
        "select display_name, email::text, phone, created_by from public.consignors where id = $1",
        [id],
      );
      expect(rows[0]).toEqual({
        display_name: "Daniel Ong",
        email: "daniel@example.com",
        phone: null,
        created_by: manager.staffId,
      });
      await failsWith(
        tx,
        () => tx.query("select payout_details from public.consignors where id = $1", [id]),
        { code: "42501" },
      );
      await failsWith(tx, () => createConsignor(tx, { customerId: customer }), {
        code: "23505",
        constraint: "consignors_customer_id_key",
      });
      await failsWith(tx, () => createConsignor(tx, { customerId: archivedCustomer }), {
        code: "P0001",
        message: "customer_archived",
      });
      await failsWith(tx, () => createConsignor(tx, { displayName: "  " }), {
        code: "23514",
        constraint: "consignors_display_name_check",
      });

      // Archiving is a plain UPDATE: refused while an item is active.
      const busy = await createConsignor(tx);
      await intakeQuantity(tx, { consignorId: busy, agreed: "5.00", quantity: 1 });
      await failsWith(
        tx,
        () => tx.query("update public.consignors set archived_at = now() where id = $1", [busy]),
        { code: "P0001", message: "consignor_has_open_items" },
      );
      expect(
        (await tx.query("update public.consignors set archived_at = now() where id = $1", [id]))
          .rowCount,
      ).toBe(1);
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())("intake with a new consignor: one transaction", () => {
  /** create_consignment_item with new_consignor, as whoever `tx` is. */
  const intakeWithNew = (
    tx: pg.Client,
    a: { itemId: string; consignorId: string; locationId: string; name: string; email?: string },
  ) =>
    tx.query(
      `select (r).item_id from (select public.create_consignment_item(
         item_id => $1, consignor_id => $2, location_id => $3, agreed_amount_owed => 50.00,
         asking_price => 90.00, product_name => 'Consigned wheel', tracking_type => 'unique',
         new_product_id => $4, new_unit_id => $5,
         new_consignor => jsonb_build_object('display_name', $6::text, 'phone', '+65 9000 0000',
                                             'email', $7::text)
       ) r) s`,
      [
        a.itemId,
        a.consignorId,
        a.locationId,
        // Fixed per item, like the sheet's ids, so a retry is the same request.
        a.itemId.replace(/^.{8}/, "aaaaaaaa"),
        a.itemId.replace(/^.{8}/, "bbbbbbbb"),
        a.name,
        a.email ?? null,
      ],
    );
  const consignor = async (tx: pg.Client, id: string) => {
    const { rows } = await tx.query<{ display_name: string; email: string | null }>(
      "select display_name, email::text from public.consignors where id = $1",
      [id],
    );
    return rows[0] ?? null;
  };

  it("a refused intake leaves no consignor; the retry stores the edited name; a replay changes nothing", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      const closed = await makeLocation(tx, { active: false });
      await actAs(tx, ADMIN);
      const itemId = randomUUID();
      const consignorId = randomUUID();
      await failsWith(
        tx,
        () => intakeWithNew(tx, { itemId, consignorId, locationId: closed, name: "Jon" }),
        { code: "P0001", message: "location_inactive" },
      );
      expect(await consignor(tx, consignorId)).toBeNull();

      const retry = { itemId, consignorId, locationId: LOCATION.shopFloor, name: " John " };
      await intakeWithNew(tx, retry);
      expect(await consignor(tx, consignorId)).toEqual({ display_name: "John", email: null });
      expect((await itemRow(tx, itemId)).consignor_id).toBe(consignorId);
      // A double tap: the same request returns the same item.
      await intakeWithNew(tx, retry);
      expect(
        await scalar<number>(
          tx,
          "select count(*)::integer from public.consignment_items where consignor_id = $1",
          [consignorId],
        ),
      ).toBe(1);
      // The same item id with another new consignor is another request.
      await failsWith(tx, () => intakeWithNew(tx, { ...retry, name: "Johnny" }), {
        code: "P0001",
        message: "consignment_item_conflict",
      });
      await assertLedgerConsistent(tx);
    });
  });

  it("an existing consignor with that id is used only when the details match (consignor_conflict otherwise)", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx, {
        displayName: "Mei Tan",
        email: "Mei@Example.com",
        phone: "+65 9000 0000",
      });
      await failsWith(
        tx,
        () =>
          intakeWithNew(tx, {
            itemId: randomUUID(),
            consignorId,
            locationId: LOCATION.shopFloor,
            name: "Someone else",
          }),
        { code: "P0001", message: "consignor_conflict" },
      );
      await intakeWithNew(tx, {
        itemId: randomUUID(),
        consignorId,
        locationId: LOCATION.shopFloor,
        name: "Mei Tan",
        email: "mei@example.com",
      });
      expect(await consignor(tx, consignorId)).toEqual({
        display_name: "Mei Tan",
        email: "Mei@Example.com",
      });
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())("immutability and history", () => {
  it("items keep their identity and short ID; the agreed amount changes only with a reason; history is append-only", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const r = await intakeQuantity(tx, { consignorId, agreed: "5.00", quantity: 3 });
      // Staff may edit notes only.
      await tx.query(
        "update public.consignment_items set agreement_notes = ' 60/40 split ' where id = $1",
        [r.item_id],
      );
      await failsWith(
        tx,
        () =>
          tx.query("update public.consignment_items set status = 'sold' where id = $1", [
            r.item_id,
          ]),
        { code: "42501" },
      );
      await ownerMode(tx);
      expect((await itemRow(tx, r.item_id)).short_id).toBe(r.short_id);
      const cases: [string, Record<string, unknown>][] = [
        [
          "update public.consignment_items set quantity = 4 where id = $1",
          { message: "consignment_item_immutable" },
        ],
        [
          "update public.consignment_items set consignor_id = gen_random_uuid() where id = $1",
          { message: "consignment_item_immutable" },
        ],
        [
          "update public.consignment_items set short_id = 'C-999999' where id = $1",
          { message: "consignment_item_short_id_immutable" },
        ],
        [
          "update public.consignment_items set agreed_amount_owed = 1 where id = $1",
          { message: "reason_required" },
        ],
        [
          "update public.consignment_item_events set reason = 'x' where consignment_item_id = $1",
          { message: "consignment_history_append_only" },
        ],
        [
          "delete from public.consignment_item_events where consignment_item_id = $1",
          { message: "consignment_history_append_only" },
        ],
      ];
      for (const [sql, expected] of cases) {
        await failsWith(tx, () => tx.query(sql, [r.item_id]), { code: "P0001", ...expected });
      }
      await actAs(tx, ADMIN);
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())(
  "photos on a consignment item (D52; D13 and D19 still hold)",
  () => {
    const record = (
      tx: pg.Client,
      a: { id: string; entityType: string; entityId: string; visibility: string },
    ) =>
      tx.query(
        `select (r).id from (
         select public.record_attachment($1, $2::public.attachment_entity, $3, $4, $5, 'image/jpeg',
                                         null, 1600, 1200, null, $6::public.attachment_visibility) r
       ) s`,
        [
          a.id,
          a.entityType,
          a.entityId,
          a.visibility === "public" ? "media-public" : "media-internal",
          attachmentPath(a.entityType, a.entityId, a.id),
          a.visibility,
        ],
      );

    /** Puts the object in both buckets (owner), so only the visibility rule decides. */
    const stage = async (tx: pg.Client, entityType: string, entityId: string, id: string) => {
      await ownerMode(tx);
      for (const bucket of ["media-internal", "media-public"]) {
        await putStorageObject(tx, bucket, attachmentPath(entityType, entityId, id));
      }
      await actAs(tx, ADMIN);
    };

    it("an agreement photo is internal only: record_attachment, set_attachment_visibility and the CHECK refuse customer and public", async () => {
      await inTx(async (tx) => {
        const consignorId = await createConsignor(tx);
        const r = await intakeUnique(tx, { consignorId, agreed: "500.00" });
        const internal = randomUUID();
        await stage(tx, "consignment_item", r.item_id, internal);
        await record(tx, {
          id: internal,
          entityType: "consignment_item",
          entityId: r.item_id,
          visibility: "internal",
        });
        for (const visibility of ["customer", "public"]) {
          const id = randomUUID();
          await stage(tx, "consignment_item", r.item_id, id);
          await failsWith(
            tx,
            () =>
              record(tx, { id, entityType: "consignment_item", entityId: r.item_id, visibility }),
            { code: "P0001", message: "attachment_consignment_internal_only" },
          );
        }
        await failsWith(
          tx,
          () =>
            tx.query("select public.set_attachment_visibility($1, 'public', 'media-public', $2)", [
              internal,
              attachmentPath("consignment_item", r.item_id, internal),
            ]),
          { code: "P0001", message: "attachment_consignment_internal_only" },
        );
        await failsWith(
          tx,
          () => tx.query("select public.set_attachment_visibility($1, 'customer')", [internal]),
          { code: "P0001", message: "attachment_consignment_internal_only" },
        );
        // The CHECK is the backstop for a writer that skips the trigger.
        await ownerMode(tx);
        await failsWith(
          tx,
          async () => {
            await tx.query("set local session_replication_role = replica");
            await tx.query("update public.attachments set visibility = 'customer' where id = $1", [
              internal,
            ]);
          },
          { code: "23514", constraint: "attachments_consignment_item_internal_only" },
        );
        await actAs(tx, ADMIN);

        // D13 and D19 are unchanged.
        const customerId = await scalar<string>(
          tx,
          "select id from public.customers where archived_at is null order by created_at limit 1",
        );
        const onCustomer = randomUUID();
        await stage(tx, "customer", customerId, onCustomer);
        await failsWith(
          tx,
          () =>
            record(tx, {
              id: onCustomer,
              entityType: "customer",
              entityId: customerId,
              visibility: "public",
            }),
          { code: "P0001", message: "attachment_customer_never_public" },
        );
        const job = await newJob(tx);
        const onJob = randomUUID();
        await stage(tx, "work_order", job.id, onJob);
        await failsWith(
          tx,
          () =>
            record(tx, {
              id: onJob,
              entityType: "work_order",
              entityId: job.id,
              visibility: "public",
            }),
          { code: "P0001", message: "attachment_work_order_never_public" },
        );
        await assertLedgerConsistent(tx);
      });
    });
  },
);

describe.skipIf(!isolatedDatabase())("bikes (D51 CONS-BIKE-LINK, D29)", () => {
  it("a consigned bike links a shop bike record both ways; a customer's, archived or already linked bike is refused", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      await ownerMode(tx);
      const shopBike = await makeBike(tx, null);
      const customerId = await makeCustomer(tx);
      const customersBike = await makeBike(tx, customerId);
      const archivedBike = await makeBike(tx, null);
      await tx.query("update public.bikes set archived_at = now() where id = $1", [archivedBike]);
      await actAs(tx, ADMIN);

      const r = await intakeUnique(tx, { consignorId, agreed: "800.00", bikeId: shopBike });
      expect((await unit(tx, r.inventory_unit_id!)).bike_id).toBe(shopBike);
      expect(
        await scalar<string>(tx, "select inventory_unit_id from public.bikes where id = $1", [
          shopBike,
        ]),
      ).toBe(r.inventory_unit_id);
      expect((await itemEvents(tx, r.item_id))[0].payload).toMatchObject({ bike_id: shopBike });

      const cases: [string, Record<string, unknown>][] = [
        [customersBike, { message: "bike_has_owner" }],
        [archivedBike, { message: "bike_archived" }],
        [shopBike, { message: "bike_already_linked" }],
        [randomUUID(), { code: "P0002" }],
      ];
      for (const [bikeId, expected] of cases) {
        await failsWith(
          tx,
          () => intakeUnique(tx, { consignorId, agreed: "1.00", bikeId }),
          expected,
        );
      }
      await failsWith(
        tx,
        () =>
          tx.query(
            `select public.create_consignment_item(item_id => $1, consignor_id => $2, location_id => $3,
               agreed_amount_owed => 1, product_name => 'Bikes', tracking_type => 'quantity', quantity => 2,
               bike_id => $4)`,
            [randomUUID(), consignorId, LOCATION.shopFloor, shopBike],
          ),
        { code: "P0001", message: "consignment_bike_requires_unique" },
      );
      // While the unit is in stock the bike stays the shop's.
      await failsWith(
        tx,
        () =>
          tx.query("select public.transfer_bike_ownership($1, $2, 'Back to Daniel')", [
            shopBike,
            customerId,
          ]),
        { code: "P0001", message: "bike_in_stock" },
      );

      // After the return the link stays, the bike goes back to its owner, and
      // the same bike record cannot be consigned again (RISKS R-020).
      await returnItem(tx, { itemId: r.item_id, reason: "Consignor took it back" });
      expect((await unit(tx, r.inventory_unit_id!)).bike_id).toBe(shopBike);
      await tx.query("select public.transfer_bike_ownership($1, $2, 'Back to Daniel')", [
        shopBike,
        customerId,
      ]);
      await tx.query("select public.transfer_bike_ownership($1, null, 'Consigned again')", [
        shopBike,
      ]);
      await failsWith(
        tx,
        () => intakeUnique(tx, { consignorId, agreed: "1.00", bikeId: shopBike }),
        {
          code: "P0001",
          message: "bike_already_linked",
        },
      );
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())(
  "returns to the consignor (return_consignment_item; D50, D51)",
  () => {
    it("a unique return writes one consignment_returned movement and returns the item, the unit and the product", async () => {
      await inTx(async (tx) => {
        const consignorId = await createConsignor(tx);
        const r = await intakeUnique(tx, { consignorId, agreed: "500.00", asking: "1000.00" });
        await ownerMode(tx);
        await addPublicPhoto(tx, "product", r.product_id);
        await actAs(tx, ADMIN);
        await publishProduct(tx, r.product_id);
        const returnId = randomUUID();
        const result = await returnItem(tx, {
          returnId,
          itemId: r.item_id,
          reason: " Consignor collected it ",
        });
        expect(result).toMatchObject({ item_id: r.item_id, status: "returned" });
        const moves = await itemMovements(tx, r.product_id);
        expect(moves).toHaveLength(2);
        expect(moves[1]).toMatchObject({
          movement_type: "consignment_returned",
          quantity_delta: -1,
          request_id: returnId,
          consignment_item_id: r.item_id,
          inventory_unit_id: r.inventory_unit_id,
          reason: "Consignor collected it",
        });
        expect((await unit(tx, r.inventory_unit_id!)).status).toBe("returned_to_consignor");
        const row = await itemRow(tx, r.item_id);
        expect(row).toMatchObject({ status: "returned", return_reason: "Consignor collected it" });
        expect(row.returned_at).not.toBeNull();
        expect(await publication(tx, r.product_id)).toBe("archived");
        const events = await itemEvents(tx, r.item_id);
        expect(events.map((e) => e.event_type)).toEqual([
          "received",
          "stock_returned",
          "status_changed",
        ]);
        expect(events[1]).toMatchObject({
          reason: "Consignor collected it",
          payload: {
            quantity: 1,
            location_id: LOCATION.shopFloor,
            inventory_unit_id: r.inventory_unit_id,
          },
        });
        expect(events[2]).toMatchObject({
          reason: "Consignor collected it",
          payload: { from: "active", to: "returned" },
        });

        // Replay: no second effect.
        expect(await returnItem(tx, { returnId, itemId: r.item_id })).toEqual(result);
        expect(await itemMovements(tx, r.product_id)).toHaveLength(2);
        await failsWith(tx, () => returnItem(tx, { itemId: r.item_id }), {
          code: "P0001",
          message: "consignment_item_not_active",
        });
        const other = await intakeUnique(tx, { consignorId, agreed: "100.00" });
        await failsWith(tx, () => returnItem(tx, { returnId, itemId: other.item_id }), {
          code: "P0001",
          message: "consignment_return_conflict",
        });
        await failsWith(tx, () => returnItem(tx, { itemId: other.item_id, reason: " " }), {
          code: "P0001",
          message: "reason_required",
        });
        await assertLedgerConsistent(tx);
      });
    });

    it("Partial returns are recorded once", async () => {
      await inTx(async (tx) => {
        const consignorId = await createConsignor(tx);
        const r = await intakeQuantity(tx, { consignorId, agreed: "10.00", quantity: 6 });
        const returnId = randomUUID();
        const args = { returnId, itemId: r.item_id, quantity: 2, locationId: LOCATION.shopFloor };
        const first = await returnItem(tx, args);
        expect(await returnItem(tx, args)).toEqual(first);
        expect(await returnItem(tx, { returnId, itemId: r.item_id })).toEqual(first);
        await failsWith(tx, () => returnItem(tx, { ...args, quantity: 3 }), {
          code: "P0001",
          message: "consignment_return_conflict",
        });
        expect((await itemPosition(tx, r.item_id)).remaining_qty).toBe(4);
        expect(await onHand(tx, r.product_id)).toBe(4);
        expect(
          (await itemMovements(tx, r.product_id)).filter(
            (m) => m.movement_type === "consignment_returned",
          ),
        ).toHaveLength(1);
        expect(
          (await itemEvents(tx, r.item_id)).filter((e) => e.event_type === "stock_returned"),
        ).toHaveLength(1);
        expect(await itemRow(tx, r.item_id)).toMatchObject({ status: "active", returned_at: null });

        await failsWith(
          tx,
          () => returnItem(tx, { itemId: r.item_id, quantity: 5, locationId: LOCATION.shopFloor }),
          { code: "P0001", message: "consignment_return_quantity_invalid" },
        );
        await failsWith(tx, () => returnItem(tx, { itemId: r.item_id, quantity: 1 }), {
          code: "22004",
        });
        await transfer(tx, {
          productId: r.product_id,
          from: LOCATION.shopFloor,
          to: LOCATION.workshopStore,
          quantity: 3,
        });
        await failsWith(
          tx,
          () => returnItem(tx, { itemId: r.item_id, quantity: 4, locationId: LOCATION.shopFloor }),
          { code: "P0001", message: "insufficient_stock" },
        );
        expect(await expectStockMatchesConsignors(tx, r.product_id)).toBe(4);
        await assertLedgerConsistent(tx);
      });
    });

    it("a unit on a job is not returned until its line is voided (unit_not_available)", async () => {
      await inTx(async (tx) => {
        const consignorId = await createConsignor(tx);
        const r = await intakeUnique(tx, { consignorId, agreed: "500.00" });
        const job = await newJob(tx);
        const part = await addPart(tx, {
          workOrderId: job.id,
          productId: r.product_id,
          unitId: r.inventory_unit_id,
        });
        await failsWith(tx, () => returnItem(tx, { itemId: r.item_id }), {
          code: "P0001",
          message: "unit_not_available",
        });
        await tx.query("select public.void_line($1, 'Consignor wants it back')", [part.line_id]);
        expect(await returnItem(tx, { itemId: r.item_id })).toMatchObject({ status: "returned" });
        await tryAndUndo(tx, async () => {
          expect(await itemStatus(tx, r.item_id)).toBe("returned");
        });
        await assertLedgerConsistent(tx);
      });
    });
  },
);
