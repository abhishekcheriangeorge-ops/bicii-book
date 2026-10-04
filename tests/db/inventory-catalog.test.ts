/**
 * Products, units and locations: identity, permissions, cost gating, the
 * archive rules, the shop-bike guard, the customer boundary, history
 * payloads and state-machine parity (SPEC §4.2, §11, §12, §15, §22, §23;
 * DATA-MODEL §6, §7, §11, §15; PLAN D9, D13, D24 PART-PRICE-COST, D25
 * SOLD-AT-COMPLETION, D26 PUBLICATION-MACHINE).
 *
 * Tests that create products, units, bikes or jobs consume short-ID
 * sequences, so they run only on a per-file clone (TESTING.md).
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import {
  canChangePublication,
  canChangeUnitStatus,
  PUBLICATION_STATUSES,
  UNIT_STATUSES,
} from "@/lib/inventory";

import { BIKE, CUSTOMER, LOCATION, PRODUCT, STAFF, UNIT } from "../fixtures/ids";
import { customerClaims, linkCustomerLogin } from "./customer-fixtures";
import { actAs, asAnon, connect, inTransaction, isolatedDatabase, scalar } from "./harness";
import {
  ADMIN,
  MECHANIC1,
  MECHANIC2,
  addPart,
  addPublicPhoto,
  addStock,
  completeJob,
  makeLocation,
  makeProduct,
  makeUniqueWithUnit,
  makeUnit,
  newJob,
  publish,
  readAsOwner,
  reopenJob,
  writeOff,
} from "./inventory-fixtures";
import { failsWith, makeBike, makeCustomer, ownerMode, voidLine } from "./workshop-fixtures";

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

const shortId = (tx: pg.Client, table: string, id: string) =>
  scalar<string>(tx, `select short_id from public.${table} where id = $1`, [id]);

const STOCK_TABLES = [
  "public.locations",
  "public.products",
  "public.inventory_units",
  "public.inventory_movements",
  "public.product_events",
  "public.inventory_unit_events",
  "public.product_costs",
  "public.inventory_unit_costs",
  "public.inventory_movement_costs",
  "public.selling_prices",
  "reporting.stock_levels",
  "reporting.product_stock",
  "reporting.low_stock",
];

describe.skipIf(!isolatedDatabase())("identity", () => {
  it("P- and U- short IDs are server-assigned, increasing and immutable", async () => {
    await inTx(async (tx) => {
      const a = randomUUID();
      const b = randomUUID();
      await tx.query(
        "insert into public.products (id, short_id, name, tracking_type) values ($1, 'P-999999', 'A', 'unique'), ($2, '', 'B', 'quantity')",
        [a, b],
      );
      const [pa, pb] = [await shortId(tx, "products", a), await shortId(tx, "products", b)];
      expect(pa).toMatch(/^P-\d{6}$/);
      expect(pa).not.toBe("P-999999");
      expect(Number(pb.slice(2))).toBe(Number(pa.slice(2)) + 1);
      await failsWith(
        tx,
        () => tx.query("update public.products set short_id = 'P-000999' where id = $1", [a]),
        {
          code: "P0001",
          message: "product_short_id_immutable",
        },
      );
      await failsWith(
        tx,
        () => tx.query("update public.products set tracking_type = 'quantity' where id = $1", [a]),
        { code: "P0001", message: "product_tracking_type_immutable" },
      );
      await actAs(tx, ADMIN);
      const u1 = await makeUnit(tx, a);
      const u2 = await makeUnit(tx, a);
      expect(u1.short_id).toMatch(/^U-\d{6}$/);
      expect(Number(u2.short_id.slice(2))).toBe(Number(u1.short_id.slice(2)) + 1);
      await ownerMode(tx);
      await failsWith(
        tx,
        () =>
          tx.query("update public.inventory_units set short_id = 'U-000999' where id = $1", [
            u1.unit_id,
          ]),
        { code: "P0001", message: "unit_short_id_immutable" },
      );
      // A quantity product has no units.
      await actAs(tx, ADMIN);
      await failsWith(tx, () => makeUnit(tx, b), { code: "P0001", message: "product_not_unique" });
    });
  });

  it("SKU uniqueness ignores case and punctuation", async () => {
    await inTx(async (tx) => {
      await makeProduct(tx, { sku: "abc-123" });
      await failsWith(tx, () => makeProduct(tx, { sku: "ABC 123" }), {
        code: "23505",
        constraint: "products_sku_key_unique",
      });
      // Phase 3's service category is the wrong kind for a product.
      await failsWith(
        tx,
        () =>
          tx.query(
            "insert into public.products (name, tracking_type, category_id) values ('X', 'quantity', 'ca000000-0000-4000-8000-000000000001')",
          ),
        { code: "P0001", message: "category_kind_mismatch" },
      );
    });
  });
});

describe.skipIf(!isolatedDatabase())("manage_inventory writes products and locations", () => {
  it("mechanic2 is refused; with manage_inventory the writes succeed", async () => {
    await inTx(async (tx) => {
      await actAs(tx, MECHANIC2);
      await failsWith(
        tx,
        () =>
          tx.query("insert into public.products (name, tracking_type) values ('Pump', 'quantity')"),
        { code: "42501" },
      );
      await failsWith(tx, () => tx.query("insert into public.locations (name) values ('Van')"), {
        code: "42501",
      });
      expect(
        (
          await tx.query("update public.products set name = 'Renamed' where id = $1", [
            PRODUCT.brakePads,
          ])
        ).rowCount,
      ).toBe(0);
      // Never their own publication, slug, short id or ownership.
      await failsWith(
        tx,
        () => tx.query("update public.products set publication_status = 'draft'"),
        {
          code: "42501",
        },
      );
      await ownerMode(tx);
      await grant(tx, STAFF.mechanic2, "manage_inventory");
      await actAs(tx, MECHANIC2);
      await tx.query(
        "insert into public.products (name, tracking_type) values ('Pump', 'quantity')",
      );
      await tx.query("insert into public.locations (name) values ('Van')");
      expect(
        (
          await tx.query("update public.products set name = 'Renamed' where id = $1", [
            PRODUCT.brakePads,
          ])
        ).rowCount,
      ).toBe(1);
      await failsWith(
        tx,
        () => tx.query("update public.products set ownership_type = 'consignment'"),
        {
          code: "42501",
        },
      );
      await failsWith(tx, () => tx.query("update public.inventory_units set status = 'sold'"), {
        code: "42501",
      });
    });
  });
});

describe("cost gating (SPEC §4.2)", () => {
  it("mechanic2 cannot select a cost column; the cost views return nothing to them", async () => {
    await inTx(async (tx) => {
      await actAs(tx, MECHANIC2);
      for (const sql of [
        "select default_direct_cost from public.products",
        "select direct_cost from public.inventory_units",
        "select unit_cost_snapshot from public.inventory_movements",
        "select * from public.products",
      ]) {
        await failsWith(tx, () => tx.query(sql), { code: "42501" });
      }
      for (const view of ["product_costs", "inventory_unit_costs", "inventory_movement_costs"]) {
        expect(await scalar(tx, `select count(*)::int from public.${view}`)).toBe(0);
      }
      expect(await scalar(tx, "select count(*)::int from public.selling_prices")).toBeGreaterThan(
        0,
      );
    });
  });

  it("view_costs reads them; seeded product 02 yields 37.00 with 11.10 Cult Commons", async () => {
    for (const claims of [MECHANIC1, ADMIN]) {
      await inTx(async (tx) => {
        await actAs(tx, claims);
        const { rows } = await tx.query(
          "select default_direct_cost::text, expected_yield::text, expected_cult_commons::text from public.product_costs where product_id = $1",
          [PRODUCT.gp5000Tyre],
        );
        expect(rows).toEqual([
          { default_direct_cost: "52.00", expected_yield: "37.00", expected_cult_commons: "11.10" },
        ]);
        const unit = await tx.query(
          "select direct_cost::text, effective_cost::text, expected_yield::text from public.inventory_unit_costs where unit_id = $1",
          [UNIT.colnago],
        );
        expect(unit.rows).toEqual([
          { direct_cost: "4200.00", effective_cost: "4200.00", expected_yield: "2600.00" },
        ]);
        expect(
          await scalar(tx, "select count(*)::int from public.inventory_movement_costs"),
        ).toBeGreaterThan(0);
        expect(
          await scalar(
            tx,
            "select selling_price::text from public.selling_prices where product_id = $1 and inventory_unit_id = $2",
            [PRODUCT.colnago, UNIT.colnago],
          ),
        ).toBe("6800.00");
      });
    }
  });

  it.skipIf(!isolatedDatabase())(
    "direct cost writes need view_costs (the invoker guards), both ways",
    async () => {
      await inTx(async (tx) => {
        const { productId, unitId } = await makeUniqueWithUnit(tx);
        await ownerMode(tx);
        await grant(tx, STAFF.mechanic2, "manage_inventory");
        await grant(tx, STAFF.mechanic1, "manage_inventory");
        await actAs(tx, MECHANIC2);
        await failsWith(
          tx,
          () =>
            tx.query("update public.products set default_direct_cost = 1 where id = $1", [
              productId,
            ]),
          { code: "42501" },
        );
        await failsWith(
          tx,
          () =>
            tx.query(
              "insert into public.products (name, tracking_type, default_direct_cost) values ('Pump', 'quantity', 5)",
            ),
          { code: "42501" },
        );
        await failsWith(
          tx,
          () =>
            tx.query("update public.inventory_units set direct_cost = 1 where id = $1", [unitId]),
          { code: "42501" },
        );
        // Other columns, and a unit without a cost, are fine.
        await tx.query("update public.products set default_sale_price = 25 where id = $1", [
          productId,
        ]);
        await tx.query("update public.inventory_units set condition = 'Scuffed' where id = $1", [
          unitId,
        ]);
        await tx.query(
          "insert into public.products (name, tracking_type) values ('Pump', 'quantity')",
        );
        await makeUnit(tx, productId);
        await failsWith(tx, () => makeUnit(tx, productId, { cost: "10.00" }), { code: "42501" });

        await actAs(tx, MECHANIC1);
        await tx.query("update public.products set default_direct_cost = 11 where id = $1", [
          productId,
        ]);
        await tx.query("update public.inventory_units set direct_cost = 12 where id = $1", [
          unitId,
        ]);
        await tx.query(
          "insert into public.products (name, tracking_type, default_direct_cost) values ('Pump 2', 'quantity', 5)",
        );

        // The owner (what every definer function runs as) passes the guard.
        await ownerMode(tx);
        await tx.query("update public.products set default_direct_cost = 13 where id = $1", [
          productId,
        ]);
        expect(
          await scalar(tx, "select default_direct_cost::text from public.products where id = $1", [
            productId,
          ]),
        ).toBe("13.00");
      });
    },
  );
});

describe.skipIf(!isolatedDatabase())("archive rules", () => {
  it("product_published, product_has_stock, unit_in_stock and location_has_stock", async () => {
    await inTx(async (tx) => {
      const store = await makeLocation(tx);
      const counted = await makeProduct(tx);
      const { productId, unitId } = await makeUniqueWithUnit(tx);
      await ownerMode(tx);
      await addPublicPhoto(tx, "product", productId);
      await publish(tx, productId);
      await actAs(tx, ADMIN);
      await addStock(tx, counted, 2, { locationId: store });
      const archive = (id: string) =>
        tx.query("update public.products set archived_at = now() where id = $1", [id]);
      await failsWith(tx, () => archive(productId), {
        code: "P0001",
        message: "product_published",
      });
      await failsWith(tx, () => archive(counted), { code: "P0001", message: "product_has_stock" });
      await failsWith(
        tx,
        () =>
          tx.query("update public.inventory_units set archived_at = now() where id = $1", [unitId]),
        { code: "P0001", message: "unit_in_stock" },
      );
      await failsWith(
        tx,
        () => tx.query("update public.locations set active = false where id = $1", [store]),
        {
          code: "P0001",
          message: "location_has_stock",
        },
      );
      await addStock(tx, counted, -2, { locationId: store });
      await tx.query("update public.locations set active = false where id = $1", [store]);
      await archive(counted);
      await writeOff(tx, unitId);
      await tx.query("update public.inventory_units set archived_at = now() where id = $1", [
        unitId,
      ]);
    });
  });
});

describe("the shop-bike guard (bike_in_stock)", () => {
  it("a shop bike in stock cannot go to a customer or be archived until its unit is gone", async () => {
    await inTx(async (tx) => {
      await actAs(tx, ADMIN);
      const transfer = () =>
        tx.query("select public.transfer_bike_ownership($1, $2, 'Sold')", [
          BIKE.shopColnago,
          CUSTOMER.tan,
        ]);
      await failsWith(tx, transfer, { code: "P0001", message: "bike_in_stock" });
      await failsWith(
        tx,
        () =>
          tx.query("update public.bikes set archived_at = now() where id = $1", [BIKE.shopColnago]),
        { code: "P0001", message: "bike_in_stock" },
      );
      await writeOff(tx, UNIT.colnago);
      await transfer();
      expect(
        await scalar(tx, "select customer_id from public.bikes where id = $1", [BIKE.shopColnago]),
      ).toBe(CUSTOMER.tan);
    });
  });

  it.skipIf(!isolatedDatabase())(
    "create_unique_unit refuses an owned or already linked bike",
    async () => {
      await inTx(async (tx) => {
        const owned = await makeBike(tx, await makeCustomer(tx));
        const productId = await makeProduct(tx, { tracking: "unique" });
        await actAs(tx, ADMIN);
        await failsWith(tx, () => makeUnit(tx, productId, { bikeId: owned }), {
          code: "P0001",
          message: "bike_has_owner",
        });
        await failsWith(tx, () => makeUnit(tx, productId, { bikeId: BIKE.shopSurly }), {
          code: "P0001",
          message: "bike_already_linked",
        });
      });
    },
  );
});

describe("no customer or anonymous access", () => {
  it("anon is denied every stock table and view", async () => {
    for (const table of STOCK_TABLES) {
      await expect(
        asAnon(conn, (tx) => tx.query(`select 1 from ${table} limit 1`)),
      ).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("a signed-in customer reads zero rows everywhere", async () => {
    await inTx(async (tx) => {
      const authUserId = await linkCustomerLogin(tx, CUSTOMER.hafiz);
      await actAs(tx, customerClaims(authUserId));
      for (const table of STOCK_TABLES) {
        const column = [
          "public.products",
          "public.inventory_units",
          "public.inventory_movements",
        ].includes(table)
          ? "id"
          : "*";
        expect(await scalar(tx, `select count(${column})::int from ${table}`)).toBe(0);
      }
      // The job projection is unchanged (no parts or stock leak into it).
      expect(await scalar(tx, "select count(*)::int from public.my_work_orders()")).toBeGreaterThan(
        0,
      );
    });
  });
});

describe.skipIf(!isolatedDatabase())("product and unit history", () => {
  const COSTS = ["13.57", "771.23", "19.41", "802.66"];

  it("records the actor and exact created payloads, and never a cost", async () => {
    await inTx(async (tx) => {
      await actAs(tx, ADMIN);
      const productId = randomUUID();
      await tx.query(
        "insert into public.products (id, name, tracking_type, default_sale_price, default_direct_cost) values ($1, 'Frame', 'unique', 900, $2)",
        [productId, COSTS[0]],
      );
      const created = await makeUnit(tx, productId, { cost: COSTS[1], price: "950.00" });
      await tx.query(
        "update public.products set default_direct_cost = $2, name = 'Frame set' where id = $1",
        [productId, COSTS[2]],
      );
      await tx.query("update public.inventory_units set direct_cost = $2 where id = $1", [
        created.unit_id,
        COSTS[3],
      ]);
      // On a job: add, complete, reopen, void.
      const job = await newJob(tx);
      const part = await addPart(tx, { workOrderId: job.id, productId, unitId: created.unit_id });
      await completeJob(tx, job.id);
      await reopenJob(tx, job.id);
      await voidLine(tx, part.line_id, "Returned");

      const productEvents = await tx.query<{
        event_type: string;
        actor_staff_id: string;
        payload: object;
      }>(
        "select event_type::text, actor_staff_id, payload from public.product_events where product_id = $1 order by created_at",
        [productId],
      );
      expect(productEvents.rows.map((e) => e.event_type)).toEqual([
        "created",
        "details_changed",
        "cost_changed",
      ]);
      expect(productEvents.rows.every((e) => e.actor_staff_id === STAFF.admin)).toBe(true);
      expect(Object.keys(productEvents.rows[0].payload).sort()).toEqual(
        ["name", "publication_status", "short_id", "tracking_type"].sort(),
      );
      expect(productEvents.rows[1].payload).toEqual({ fields: ["name"] });
      expect(productEvents.rows[2].payload).toEqual({});

      const unitEventRows = await tx.query<{ event_type: string; payload: object }>(
        "select event_type::text, payload from public.inventory_unit_events where unit_id = $1 order by created_at",
        [created.unit_id],
      );
      expect(Object.keys(unitEventRows.rows[0].payload).sort()).toEqual(
        ["location_id", "ownership_type", "product_id", "short_id", "status"].sort(),
      );
      expect(unitEventRows.rows.map((e) => e.event_type)).toEqual([
        "created",
        "cost_changed",
        "status_changed",
        "status_changed",
        "status_changed",
        "status_changed",
      ]);

      const texts = await readAsOwner(tx, () =>
        tx.query<{ t: string }>(
          `select payload::text as t from public.product_events where product_id = $1
           union all select payload::text from public.inventory_unit_events where unit_id = $2
           union all select payload::text from public.work_order_events where work_order_id = $3`,
          [productId, created.unit_id, job.id],
        ),
      );
      const COST_KEYS = [
        "default_direct_cost",
        "direct_cost",
        "unit_cost_snapshot",
        "unit_direct_cost_snapshot",
      ];
      for (const { t } of texts.rows) {
        for (const cost of COSTS) expect(t).not.toContain(cost);
        for (const key of COST_KEYS) expect(t).not.toContain(`"${key}"`);
      }
    });
  });
});

describe.skipIf(!isolatedDatabase())(
  "publication rules (PUBLICATION-MACHINE), for every writer",
  () => {
    it("starts unpublished, needs a price, a photo and an available unit, and gets a slug once", async () => {
      await inTx(async (tx) => {
        await failsWith(
          tx,
          () =>
            tx.query(
              "insert into public.products (name, tracking_type, publication_status) values ('X', 'quantity', 'public')",
            ),
          { code: "P0001", message: "publication_initial_invalid" },
        );
        const draft = await makeProduct(tx, { publication: "draft" });
        await failsWith(tx, () => publish(tx, draft), {
          code: "P0001",
          message: "publication_transition_invalid",
        });

        const unpriced = await makeProduct(tx, { name: "Café  Pump!", price: null });
        await failsWith(tx, () => publish(tx, unpriced), {
          code: "P0001",
          message: "publication_requires_price",
        });
        await tx.query("update public.products set default_sale_price = 30 where id = $1", [
          unpriced,
        ]);
        await failsWith(tx, () => publish(tx, unpriced), {
          code: "P0001",
          message: "publication_requires_photo",
        });
        await addPublicPhoto(tx, "product", unpriced);
        await publish(tx, unpriced);
        const short = (await shortId(tx, "products", unpriced)).toLowerCase();
        const slug = await scalar<string>(
          tx,
          "select public_slug from public.products where id = $1",
          [unpriced],
        );
        expect(slug).toBe(`caf-pump-${short}`);
        // Back to internal and public again: the slug never changes; never sold by hand.
        await tx.query(
          "update public.products set publication_status = 'internal_only', name = 'Track pump' where id = $1",
          [unpriced],
        );
        await publish(tx, unpriced);
        expect(
          await scalar(tx, "select public_slug from public.products where id = $1", [unpriced]),
        ).toBe(slug);
        await failsWith(
          tx,
          () =>
            tx.query("update public.products set publication_status = 'sold' where id = $1", [
              unpriced,
            ]),
          { code: "P0001", message: "publication_transition_invalid" },
        );

        const symbols = await makeProduct(tx, { name: "***" });
        await addPublicPhoto(tx, "product", symbols);
        await publish(tx, symbols);
        expect(
          await scalar(tx, "select public_slug from public.products where id = $1", [symbols]),
        ).toBe(`item-${(await shortId(tx, "products", symbols)).toLowerCase()}`);

        // A unique product needs an available unit; a photo on its unit or the unit's bike counts.
        const bike = await makeBike(tx, null);
        const unique = await makeProduct(tx, { tracking: "unique" });
        await failsWith(tx, () => publish(tx, unique), {
          code: "P0001",
          message: "publication_requires_available_unit",
        });
        await actAs(tx, ADMIN);
        await makeUnit(tx, unique, { bikeId: bike });
        await ownerMode(tx);
        await failsWith(tx, () => publish(tx, unique), {
          code: "P0001",
          message: "publication_requires_photo",
        });
        await addPublicPhoto(tx, "bike", bike);
        await publish(tx, unique);
      });
    });
  },
);

describe("state machine parity with src/lib/inventory.ts", () => {
  it("canChangePublication equals private.publication_transition_allowed for all 25 pairs", async () => {
    const { rows } = await conn.query<{ f: string; t: string; ok: boolean }>(
      `select f::text, t::text, private.publication_transition_allowed(f, t) as ok
         from unnest(enum_range(null::public.publication_status)) f,
              unnest(enum_range(null::public.publication_status)) t`,
    );
    expect(rows).toHaveLength(PUBLICATION_STATUSES.length ** 2);
    expect(rows).toHaveLength(25);
    for (const r of rows) {
      expect([r.f, r.t, canChangePublication(r.f as never, r.t as never)]).toEqual([
        r.f,
        r.t,
        r.ok,
      ]);
    }
  });

  it("canChangeUnitStatus equals private.unit_status_transition_allowed for all 36 pairs", async () => {
    const { rows } = await conn.query<{ f: string; t: string; ok: boolean }>(
      `select f::text, t::text, private.unit_status_transition_allowed(f, t) as ok
         from unnest(enum_range(null::public.unit_status)) f,
              unnest(enum_range(null::public.unit_status)) t`,
    );
    expect(rows).toHaveLength(UNIT_STATUSES.length ** 2);
    expect(rows).toHaveLength(36);
    for (const r of rows) {
      expect([r.f, r.t, canChangeUnitStatus(r.f as never, r.t as never)]).toEqual([r.f, r.t, r.ok]);
    }
  });
});

describe("the bootstrap location", () => {
  it("'Shop floor' is the default location (lowest sort order)", async () => {
    expect(
      await scalar(
        conn,
        "select id from public.locations where active order by sort_order, name limit 1",
      ),
    ).toBe(LOCATION.shopFloor);
  });
});
