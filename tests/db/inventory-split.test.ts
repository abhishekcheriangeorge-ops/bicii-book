/**
 * Bulk-to-unique splits (SPEC §11 "bulk-to-unique with no machinery", §12,
 * §23; DATA-MODEL §7, §16; PLAN D27 SHOP-OWNED-ONLY, D28 SPLIT-COST):
 * split_unit_from_stock takes one counted item out of stock (a
 * stock_adjustment with the reason) and creates a draft unique product and
 * an available shop-owned unit at the same location, carrying the source's
 * default direct cost; replay-safe by the new unit id; adjust_stock and
 * manage_inventory both required.
 *
 * Tests create products and units (short-ID sequences) and the concurrency
 * test commits, so the file runs only on a per-file clone. Every test ends
 * with assertLedgerConsistent().
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { LOCATION, PRODUCT, PRODUCT_CATEGORY, STAFF } from "../fixtures/ids";
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
  assertLedgerConsistent,
  committed,
  makeLocation,
  makeProduct,
  makeUnit,
  movements,
  onHand,
  readAsOwner,
  splitUnit,
  unit,
} from "./inventory-fixtures";
import { failsWith, ownerMode } from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const inTx = <T>(fn: (tx: pg.Client) => Promise<T>) => inTransaction(conn, fn);

const grant = (tx: pg.Client, staffId: string, permission: string) =>
  tx.query(
    "insert into public.staff_permissions (staff_id, permission) values ($1, $2) on conflict do nothing",
    [staffId, permission],
  );

// The seeded GP5000 tyre: 12 at the Shop floor, none in the Workshop store;
// price 89.00, default direct cost 52.00, Continental, Tyres & tubes.
const SOURCE = PRODUCT.gp5000Tyre;

/**
 * The new product's cost and its unit's, read through the cost views as the
 * admin (leaves `tx` acting as the admin).
 */
async function costsAsAdmin(tx: pg.Client, productId: string, unitId: string) {
  await actAs(tx, ADMIN);
  return {
    product: await scalar<string>(
      tx,
      "select default_direct_cost::text from public.product_costs where product_id = $1",
      [productId],
    ),
    unit: await scalar<string>(
      tx,
      "select direct_cost::text from public.inventory_unit_costs where unit_id = $1",
      [unitId],
    ),
  };
}

describe.skipIf(!isolatedDatabase())("split_unit_from_stock (SPLIT-COST)", () => {
  it("decrements the source by one and creates a draft unique product and an available unit with the cost carried over", async () => {
    await inTx(async (tx) => {
      await actAs(tx, ADMIN);
      const before = await onHand(tx, SOURCE);
      const r = await splitUnit(tx, {
        sourceProductId: SOURCE,
        name: "  GP5000 700x25c (ex-display)  ",
        reason: "  Display tyre, sold on its own  ",
        serial: "DOT 2425",
        condition: "Shop-worn sidewall",
      });
      expect(r.product_short_id).toMatch(/^P-\d{6}$/);
      expect(r.unit_short_id).toMatch(/^U-\d{6}$/);
      expect(await onHand(tx, SOURCE)).toBe(before - 1);
      expect(await onHand(tx, r.product_id)).toBe(1);

      const { rows: products } = await tx.query(
        `select name, tracking_type::text, publication_status::text, public_slug, description, brand,
                category_id, currency, default_sale_price::text, ownership_type::text, sku, active
           from public.products where id = $1`,
        [r.product_id],
      );
      expect(products[0]).toEqual({
        name: "GP5000 700x25c (ex-display)",
        tracking_type: "unique",
        publication_status: "draft",
        public_slug: null,
        description: "Folding clincher road tyre, BlackChili compound.",
        brand: "Continental",
        category_id: PRODUCT_CATEGORY.tyresAndTubes,
        currency: "SGD",
        default_sale_price: "89.00",
        ownership_type: "shop_owned",
        sku: null,
        active: true,
      });
      expect(await unit(tx, r.unit_id)).toMatchObject({
        short_id: r.unit_short_id,
        status: "available",
        location_id: LOCATION.shopFloor,
        bike_id: null,
      });
      const { rows: units } = await tx.query(
        "select product_id, serial_number, condition, sale_price, ownership_type::text from public.inventory_units where id = $1",
        [r.unit_id],
      );
      expect(units[0]).toEqual({
        product_id: r.product_id,
        serial_number: "DOT 2425",
        condition: "Shop-worn sidewall",
        sale_price: null,
        ownership_type: "shop_owned",
      });
      expect(await costsAsAdmin(tx, r.product_id, r.unit_id)).toEqual({
        product: "52.00",
        unit: "52.00",
      });

      // One stock_adjustment each side, keyed by the unit id, with the reason.
      const reason = `Split to ${r.unit_short_id}: Display tyre, sold on its own`;
      const out = (await movements(tx, SOURCE)).filter((m) => m.request_id === r.unit_id);
      expect(out).toEqual([
        expect.objectContaining({
          movement_type: "stock_adjustment",
          quantity_delta: -1,
          location_id: LOCATION.shopFloor,
          inventory_unit_id: null,
          reason,
          created_by: STAFF.admin,
          unit_cost_snapshot: "52.00",
        }),
      ]);
      expect(await movements(tx, r.product_id)).toEqual([
        expect.objectContaining({
          movement_type: "stock_adjustment",
          quantity_delta: 1,
          location_id: LOCATION.shopFloor,
          inventory_unit_id: r.unit_id,
          request_id: r.unit_id,
          reason,
          unit_cost_snapshot: "52.00",
        }),
      ]);
      // History names the actor and the reason, never a cost.
      const { rows: events } = await tx.query(
        "select event_type::text, reason, actor_staff_id from public.product_events where product_id = $1",
        [r.product_id],
      );
      expect(events).toEqual([
        {
          event_type: "created",
          reason: "Display tyre, sold on its own",
          actor_staff_id: STAFF.admin,
        },
      ]);

      // A sale price given for the new item wins over the source's.
      const priced = await splitUnit(tx, { sourceProductId: SOURCE, price: "70.00" });
      expect(
        await scalar(tx, "select default_sale_price::text from public.products where id = $1", [
          priced.product_id,
        ]),
      ).toBe("70.00");
      expect(await onHand(tx, SOURCE)).toBe(before - 2);
      await ownerMode(tx);
      await assertLedgerConsistent(tx);
    });
  });

  it("is replay-safe: the same ids return the same result with one pair of movements", async () => {
    await inTx(async (tx) => {
      await actAs(tx, ADMIN);
      const ids = { newProductId: randomUUID(), unitId: randomUUID(), sourceProductId: SOURCE };
      const before = await onHand(tx, SOURCE);
      const first = await splitUnit(tx, ids);
      expect(await splitUnit(tx, ids)).toEqual(first);
      expect(await onHand(tx, SOURCE)).toBe(before - 1);
      const count = await scalar<number>(
        tx,
        "select count(*)::int from public.inventory_movements where request_id = $1",
        [ids.unitId],
      );
      expect(count).toBe(2);
      // The unit id on another new product, or the new product id taken: unit_conflict.
      await failsWith(tx, () => splitUnit(tx, { ...ids, newProductId: randomUUID() }), {
        code: "P0001",
        message: "unit_conflict",
      });
      await failsWith(
        tx,
        () => splitUnit(tx, { sourceProductId: SOURCE, newProductId: PRODUCT.brakePads }),
        { code: "P0001", message: "unit_conflict" },
      );
      await ownerMode(tx);
      await assertLedgerConsistent(tx);
    });
  });

  it("validates the source, the location, the stock and the reason", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      const empty = await makeLocation(tx);
      const inactive = await makeLocation(tx, { active: false });
      const consigned = await makeProduct(tx);
      await tx.query("update public.products set ownership_type = 'consignment' where id = $1", [
        consigned,
      ]);
      await actAs(tx, ADMIN);
      const cases: [Parameters<typeof splitUnit>[1], Record<string, unknown>][] = [
        [
          { sourceProductId: SOURCE, locationId: LOCATION.workshopStore },
          { message: "insufficient_stock" },
        ],
        [{ sourceProductId: SOURCE, locationId: empty }, { message: "insufficient_stock" }],
        [{ sourceProductId: SOURCE, locationId: inactive }, { message: "location_inactive" }],
        [{ sourceProductId: SOURCE, locationId: randomUUID() }, { code: "P0002" }],
        [{ sourceProductId: PRODUCT.colnago }, { message: "product_not_quantity" }],
        [{ sourceProductId: PRODUCT.chainX10Archived }, { message: "product_archived" }],
        [{ sourceProductId: consigned }, { message: "ownership_not_saleable" }],
        [{ sourceProductId: randomUUID() }, { code: "P0002" }],
        [{ sourceProductId: SOURCE, reason: null }, { message: "reason_required" }],
        [{ sourceProductId: SOURCE, reason: "   " }, { message: "reason_required" }],
        [{ sourceProductId: SOURCE, reason: "x".repeat(481) }, { message: "reason_too_long" }],
        [
          { sourceProductId: SOURCE, name: "   " },
          { code: "23514", constraint: "products_name_check" },
        ],
      ];
      for (const [args, expected] of cases) {
        await failsWith(tx, () => splitUnit(tx, args), expected);
      }
      // A failed check never prints the row (the new product's cost).
      await failsWith(tx, () => splitUnit(tx, { sourceProductId: SOURCE, name: " " }), {
        detail: undefined,
      });
      // The longest reason fits the ledger.
      await splitUnit(tx, { sourceProductId: SOURCE, reason: "y".repeat(480) });
      await ownerMode(tx);
      await assertLedgerConsistent(tx);
    });
  });

  it("needs both adjust_stock and manage_inventory", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      for (const [claims, permission] of [
        [MECHANIC1, null],
        [MECHANIC2, null],
        [MECHANIC2, "adjust_stock"],
      ] as const) {
        await ownerMode(tx);
        if (permission) await grant(tx, STAFF.mechanic2, permission);
        await actAs(tx, claims);
        await failsWith(tx, () => splitUnit(tx, { sourceProductId: SOURCE }), { code: "42501" });
      }
      await ownerMode(tx);
      await tx.query(
        "delete from public.staff_permissions where staff_id = $1 and permission = 'adjust_stock'",
        [STAFF.mechanic2],
      );
      await grant(tx, STAFF.mechanic2, "manage_inventory");
      await actAs(tx, MECHANIC2);
      await failsWith(tx, () => splitUnit(tx, { sourceProductId: SOURCE }), { code: "42501" });
      await actAs(tx, { role: "anon" });
      await failsWith(tx, () => splitUnit(tx, { sourceProductId: SOURCE }), { code: "42501" });
    });
  });

  it("carries the cost for a caller without view_costs, who still cannot write a cost directly", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      await grant(tx, STAFF.mechanic2, "adjust_stock");
      await grant(tx, STAFF.mechanic2, "manage_inventory");
      await actAs(tx, MECHANIC2);
      const r = await splitUnit(tx, { sourceProductId: SOURCE });
      // The result never carries a cost, and mechanic2 cannot read one.
      expect(Object.keys(r).sort()).toEqual(
        ["product_id", "product_short_id", "unit_id", "unit_short_id"].sort(),
      );
      expect(
        await scalar<number>(
          tx,
          "select count(*)::int from public.product_costs where product_id = $1",
          [r.product_id],
        ),
      ).toBe(0);
      // The definer path wrote the source's cost (read as the admin).
      expect(await costsAsAdmin(tx, r.product_id, r.unit_id)).toEqual({
        product: "52.00",
        unit: "52.00",
      });
      // The invoker guards still refuse the same caller's direct cost writes.
      await actAs(tx, MECHANIC2);
      await failsWith(
        tx,
        () =>
          tx.query("update public.products set default_direct_cost = 1 where id = $1", [
            r.product_id,
          ]),
        { code: "42501" },
      );
      await failsWith(
        tx,
        () =>
          tx.query("update public.inventory_units set direct_cost = 1 where id = $1", [r.unit_id]),
        { code: "42501" },
      );
      expect(
        await readAsOwner(tx, () =>
          scalar<string>(
            tx,
            "select default_direct_cost::text from public.products where id = $1",
            [r.product_id],
          ),
        ),
      ).toBe("52.00");
      await ownerMode(tx);
      await assertLedgerConsistent(tx);
    });
  });

  it("a unit created by a split can be used like any other (a second unit on the product works too)", async () => {
    await inTx(async (tx) => {
      await actAs(tx, ADMIN);
      const r = await splitUnit(tx, { sourceProductId: SOURCE });
      const second = await makeUnit(tx, r.product_id);
      expect((await unit(tx, second.unit_id)).status).toBe("available");
      expect(await onHand(tx, r.product_id)).toBe(2);
      await ownerMode(tx);
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())("split_unit_from_stock under concurrency", () => {
  it("two calls with the same unit id give one result and one pair of movements", async () => {
    const setup = await connect();
    const sourceProductId = await makeProduct(setup);
    const stocked = await committed(setup, (tx) =>
      tx.query("select public.adjust_stock($1, $2, $3, 3, 'stock_adjustment', 'Count')", [
        randomUUID(),
        sourceProductId,
        LOCATION.shopFloor,
      ]),
    );
    if (!stocked.ok) throw stocked.error;
    const ids = { newProductId: randomUUID(), unitId: randomUUID(), sourceProductId };
    const [a, b] = await openConnections(2);
    const results = await Promise.all([a, b].map((c) => committed(c, (tx) => splitUnit(tx, ids))));
    expect(results.every((r) => r.ok)).toBe(true);
    const values = results.map((r) => (r.ok ? r.value : null));
    expect(values[0]).toEqual(values[1]);
    expect(await onHand(setup, sourceProductId)).toBe(2);
    expect(
      await scalar<number>(
        setup,
        "select count(*)::int from public.inventory_movements where request_id = $1",
        [ids.unitId],
      ),
    ).toBe(2);

    // Two different splits draining the last item: one succeeds.
    const draining = await committed(setup, (tx) =>
      tx.query("select public.adjust_stock($1, $2, $3, -1, 'stock_adjustment', 'Count')", [
        randomUUID(),
        sourceProductId,
        LOCATION.shopFloor,
      ]),
    );
    if (!draining.ok) throw draining.error;
    expect(await onHand(setup, sourceProductId)).toBe(1);
    const race = await Promise.all(
      [a, b].map((c) => committed(c, (tx) => splitUnit(tx, { sourceProductId }))),
    );
    expect(race.filter((r) => r.ok)).toHaveLength(1);
    expect(race.find((r) => !r.ok)).toMatchObject({ error: { message: "insufficient_stock" } });
    expect(await onHand(setup, sourceProductId)).toBe(0);
  });
});
