/**
 * Who reaches purchasing (SPEC §4.2, §14, §23 "Customers cannot read
 * internal notes, costs, ...", §27.2 "Mechanic permission boundaries";
 * PLAN D60 D-PO-COSTS, D62 D-PO-SCOPE).
 *
 *   * Active staff read suppliers, POs, lines, receipts and progress, never
 *     a purchase cost column; purchase costs (the *_staff views and the PO
 *     history) need view_costs or manage_purchasing (D60).
 *   * Every supplier/PO write and receiving needs manage_purchasing, which
 *     opens no Phase 3/4/5 cost, yield or financial surface.
 *   * Customers and anonymous visitors reach none of it.
 *
 * The data-dependent cases create POs (PO- sequence) and products, so they
 * skip in existing-database mode; the refusals run everywhere.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { LOCATION, STAFF } from "../fixtures/ids";
import { customerClaims, linkCustomerLogin } from "./customer-fixtures";
import { actAs, connect, inTransaction, isolatedDatabase, scalar } from "./harness";
import {
  ADMIN,
  MECHANIC1,
  MECHANIC2,
  addStock,
  makeProduct,
  readAsOwner,
} from "./inventory-fixtures";
import {
  cancelPO,
  createPO,
  grantPurchasing,
  makeSupplier,
  openPO,
  receive,
  setLine,
  submitPO,
  supplierLink,
  updatePO,
} from "./purchasing-fixtures";
import { COST_COLUMNS, FIN_COLUMNS } from "./reporting-fixtures";
import { failsWith, makeCustomer, ownerMode } from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const it7 = it.skipIf(!isolatedDatabase());
const DENIED = { code: "42501" };

/** Every purchasing RPC, with arguments that pass the argument checks. */
const RPC_CALLS: ReadonlyArray<string> = [
  "select public.create_purchase_order(gen_random_uuid(), gen_random_uuid())",
  "select public.update_purchase_order(gen_random_uuid(), gen_random_uuid(), null, null, null)",
  "select public.submit_purchase_order(gen_random_uuid())",
  "select public.cancel_purchase_order(gen_random_uuid(), 'No longer needed')",
  "select public.set_purchase_order_line(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 1)",
  "select * from public.remove_purchase_order_line(gen_random_uuid())",
  "select public.receive_purchase(gen_random_uuid(), gen_random_uuid(), '[]'::jsonb)",
  "select * from public.purchase_receipt_by_key(gen_random_uuid())",
  "select * from public.purchase_cost_defaults(gen_random_uuid(), '{}'::uuid[])",
  "select public.set_supplier_product(gen_random_uuid(), gen_random_uuid())",
  "select * from public.remove_supplier_product(gen_random_uuid(), gen_random_uuid())",
];

const TABLES = [
  "public.suppliers",
  "public.supplier_products",
  "public.purchase_orders",
  "public.purchase_order_lines",
  "public.purchase_order_events",
  "public.purchase_receipts",
  "public.purchase_receipt_lines",
];

const COST_VIEWS = [
  "public.supplier_products_staff",
  "public.purchase_order_lines_staff",
  "public.purchase_receipt_lines_staff",
  "public.purchase_order_totals_staff",
];

const REPORTING_VIEWS = ["reporting.purchase_order_progress", "reporting.product_on_order"];

/** Purchase cost columns authenticated has no grant on (D60). */
const COST_COLUMN_SELECTS = [
  "select unit_cost from public.purchase_order_lines",
  "select ordered_total from public.purchase_order_lines",
  "select unit_cost_actual from public.purchase_receipt_lines",
  "select received_total from public.purchase_receipt_lines",
  "select last_unit_cost from public.supplier_products",
];

const rows = (tx: pg.Client, relation: string) =>
  scalar<number>(tx, `select count(*)::int from ${relation}`);

/** A received-from PO with costs, history and a supplier link, built as the admin. */
async function buildPurchasing(tx: pg.Client) {
  const o = await openPO(tx, { quantity: 10, cost: "7.50" });
  await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 4, cost: "7.80" }] });
  await ownerMode(tx);
  return o;
}

describe("Customers cannot read internal notes or costs (SPEC §23)", () => {
  it7("a signed-in customer reads no purchasing row and calls no purchasing RPC", async () => {
    await inTransaction(conn, async (tx) => {
      await buildPurchasing(tx);
      const authUserId = await linkCustomerLogin(tx, await makeCustomer(tx));
      await actAs(tx, customerClaims(authUserId));
      for (const relation of [...TABLES, ...COST_VIEWS, ...REPORTING_VIEWS])
        expect(await rows(tx, relation), relation).toBe(0);
      for (const sql of RPC_CALLS) await failsWith(tx, () => tx.query(sql), DENIED);
    });
  });

  it("anon is refused every purchasing relation and RPC", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, { role: "anon" });
      for (const relation of [...TABLES, ...COST_VIEWS, ...REPORTING_VIEWS])
        await failsWith(tx, () => rows(tx, relation), DENIED);
      for (const sql of RPC_CALLS) await failsWith(tx, () => tx.query(sql), DENIED);
    });
  });
});

describe("Mechanic permission boundaries (SPEC §27.2) and D60 D-PO-COSTS", () => {
  it7(
    "mechanic2 (no permissions) reads quantities and progress, never a cost, and writes nothing",
    async () => {
      await inTransaction(conn, async (tx) => {
        const o = await buildPurchasing(tx);
        await actAs(tx, MECHANIC2);
        expect(await rows(tx, "public.purchase_orders")).toBeGreaterThan(0);
        const line = await tx.query(
          "select quantity_ordered, product_id from public.purchase_order_lines where id = $1",
          [o.lineId],
        );
        expect(line.rows).toEqual([{ quantity_ordered: 10, product_id: o.productId }]);
        expect(await rows(tx, "public.purchase_receipts")).toBeGreaterThan(0);
        expect(
          (
            await tx.query(
              "select quantity_received from reporting.purchase_order_progress where purchase_order_id = $1",
              [o.poId],
            )
          ).rows,
        ).toEqual([{ quantity_received: 4 }]);
        for (const sql of COST_COLUMN_SELECTS) await failsWith(tx, () => tx.query(sql), DENIED);
        for (const view of COST_VIEWS) expect(await rows(tx, view), view).toBe(0);
        expect(await rows(tx, "public.purchase_order_events")).toBe(0);
        for (const sql of RPC_CALLS) await failsWith(tx, () => tx.query(sql), DENIED);
        await failsWith(
          tx,
          () => tx.query("insert into public.suppliers (name) values ('Mechanic supplier')"),
          DENIED,
        );
        // RLS hides the row from an update, as for Phase 1's tables.
        const updated = await tx.query("update public.suppliers set notes = 'x' where id = $1", [
          o.supplierId,
        ]);
        expect(updated.rowCount).toBe(0);
      });
    },
  );

  it7("mechanic1 (view_costs) reads purchase costs and history but writes nothing", async () => {
    await inTransaction(conn, async (tx) => {
      const o = await buildPurchasing(tx);
      await actAs(tx, MECHANIC1);
      for (const view of COST_VIEWS) expect(await rows(tx, view), view).toBeGreaterThan(0);
      expect(
        (
          await tx.query(
            "select unit_cost::text, ordered_total::text, received_value::text from public.purchase_order_lines_staff where purchase_order_line_id = $1",
            [o.lineId],
          )
        ).rows,
      ).toEqual([{ unit_cost: "7.50", ordered_total: "75.00", received_value: "31.20" }]);
      expect(
        (
          await tx.query(
            "select ordered_total::text, received_total::text, outstanding_total::text from public.purchase_order_totals_staff where purchase_order_id = $1",
            [o.poId],
          )
        ).rows,
      ).toEqual([{ ordered_total: "75.00", received_total: "31.20", outstanding_total: "45.00" }]);
      expect(await rows(tx, "public.purchase_order_events")).toBeGreaterThan(0);
      for (const sql of RPC_CALLS) await failsWith(tx, () => tx.query(sql), DENIED);
      await failsWith(
        tx,
        () => tx.query("insert into public.suppliers (name) values ('Mechanic supplier')"),
        DENIED,
      );
    });
  });

  it7(
    "manage_purchasing reads the cost prefill only for products a PO can hold (D60, D62)",
    async () => {
      await inTransaction(conn, async (tx) => {
        await grantPurchasing(tx, STAFF.mechanic2);
        await ownerMode(tx);
        const supplierId = await makeSupplier(tx);
        const orderable = await makeProduct(tx, { cost: "8.00" });
        const unique = await makeProduct(tx, { tracking: "unique", cost: "4200.00" });
        const consigned = await makeProduct(tx, { cost: "300.00" });
        const customerOwned = await makeProduct(tx, { cost: "250.00" });
        const inactive = await makeProduct(tx, { cost: "12.00", active: false });
        const archived = await makeProduct(tx, { cost: "14.00" });
        await tx.query("update public.products set ownership_type = 'consignment' where id = $1", [
          consigned,
        ]);
        await tx.query(
          "update public.products set ownership_type = 'customer_owned' where id = $1",
          [customerOwned],
        );
        await tx.query("update public.products set archived_at = now() where id = $1", [archived]);
        await actAs(tx, MECHANIC2);
        // mechanic2 has no view_costs: the product cost views stay closed.
        expect(await rows(tx, "public.product_costs")).toBe(0);

        const { rows: prefill } = await tx.query(
          "select product_id, unit_cost::text, source from public.purchase_cost_defaults($1, $2::uuid[])",
          [supplierId, [orderable, unique, consigned, customerOwned, inactive, archived]],
        );
        expect(prefill).toEqual([{ product_id: orderable, unit_cost: "8.00", source: "product" }]);
      });
    },
  );

  it7(
    "manage_purchasing alone runs purchasing and sees purchase costs, but no Phase 3/4/5 cost surface",
    async () => {
      await inTransaction(conn, async (tx) => {
        await grantPurchasing(tx, STAFF.mechanic2);
        const supplierId = await makeSupplier(tx);
        const productId = await makeProduct(tx, { cost: "8.00" });
        await actAs(tx, MECHANIC2);

        // Purchasing, end to end.
        const supplier = await tx.query<{ id: string }>(
          "insert into public.suppliers (name) values ($1) returning id",
          [`Buyer's supplier ${randomUUID().slice(0, 6)}`],
        );
        expect(
          (
            await tx.query("update public.suppliers set notes = 'Net 30' where id = $1", [
              supplier.rows[0].id,
            ])
          ).rowCount,
        ).toBe(1);
        await tx.query("select public.set_supplier_product($1, $2, 'SKU-1', 3, true)", [
          supplierId,
          productId,
        ]);
        const po = await createPO(tx, { supplierId });
        await updatePO(tx, { poId: po.id, supplierId, notes: "Urgent" });
        const line = await setLine(tx, { poId: po.id, productId, quantity: 5, cost: "6.00" });
        const defaults = await tx.query(
          "select unit_cost::text, source from public.purchase_cost_defaults($1, $2::uuid[])",
          [supplierId, [productId]],
        );
        expect(defaults.rows).toEqual([{ unit_cost: "8.00", source: "product" }]);
        await submitPO(tx, po.id);
        await readAsOwner(tx, () =>
          tx.query(
            "update public.purchase_orders set submitted_at = now() - interval '1 day' where id = $1",
            [po.id],
          ),
        );
        const key = randomUUID();
        const receipt = await receive(tx, {
          poId: po.id,
          key,
          lines: [{ lineId: line.id, quantity: 2, cost: "6.10" }],
        });
        expect(
          (await tx.query("select id from public.purchase_receipt_by_key($1)", [key])).rows,
        ).toEqual([{ id: receipt.id }]);
        expect((await cancelPO(tx, po.id, "Enough for now")).status).toBe("cancelled");
        for (const view of COST_VIEWS) expect(await rows(tx, view), view).toBeGreaterThan(0);
        expect(await rows(tx, "public.purchase_order_events")).toBeGreaterThan(0);
        expect(await supplierLink(tx, supplierId, productId)).toMatchObject({
          last_unit_cost: "6.10",
        });

        // ... and still no Phase 3/4/5 cost, yield or financial surface (D60).
        for (const sql of [
          "select default_direct_cost from public.products limit 1",
          "select unit_cost_snapshot from public.inventory_movements limit 1",
          "select direct_cost from public.inventory_units limit 1",
          "select default_direct_cost from public.services limit 1",
          "select unit_direct_cost_snapshot from public.work_order_line_items limit 1",
          "select cost_total from public.work_order_line_items limit 1",
          "select yield_total from public.work_order_line_items limit 1",
          "select cult_commons_share from public.work_order_line_items limit 1",
          "select cult_commons_rate_snapshot from public.work_order_line_items limit 1",
          "select * from public.financial_lines(current_date - 1, current_date)",
          "select * from public.work_order_yield(gen_random_uuid())",
        ])
          await failsWith(tx, () => tx.query(sql), DENIED);
        for (const view of [
          "public.product_costs",
          "public.inventory_unit_costs",
          "public.inventory_movement_costs",
          "public.services_staff",
          "public.work_order_line_items_staff",
          "public.work_order_totals_staff",
          "public.cult_commons_rates",
        ])
          expect(await rows(tx, view), view).toBe(0);
        const summary = await tx.query("select * from public.daily_summary(null, null)");
        expect(summary.rows.length).toBeGreaterThan(0);
        for (const row of summary.rows)
          for (const c of [...FIN_COLUMNS, ...COST_COLUMNS]) expect(row[c], c).toBeNull();
        const dash = (await tx.query("select * from public.today_dashboard(null)")).rows[0];
        expect(dash).toMatchObject({ can_see_financials: false, can_see_costs: false });
        for (const c of [...FIN_COLUMNS, ...COST_COLUMNS]) expect(dash[c], c).toBeNull();

        // The same surfaces are populated for the admin (the zeros above are real).
        await ownerMode(tx);
        await actAs(tx, ADMIN);
        for (const view of ["public.product_costs", "public.inventory_movement_costs"])
          expect(await rows(tx, view), view).toBeGreaterThan(0);
      });
    },
  );

  it7("the admin can do everything", async () => {
    await inTransaction(conn, async (tx) => {
      const o = await buildPurchasing(tx);
      await actAs(tx, ADMIN);
      for (const view of [...COST_VIEWS, "public.purchase_order_events"])
        expect(await rows(tx, view), view).toBeGreaterThan(0);
      await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 6 }] });
      expect(
        await scalar(tx, "select status::text from public.purchase_orders where id = $1", [o.poId]),
      ).toBe("received");
      await tx.query("update public.suppliers set archived_at = now() where id = $1", [
        o.supplierId,
      ]);
    });
  });
});

describe("Suppliers (SPEC §14)", () => {
  const asAdmin = async (tx: pg.Client) => {
    await ownerMode(tx);
    await actAs(tx, ADMIN);
  };

  it("store blanks as null, keep active names unique and check website and email", async () => {
    await inTransaction(conn, async (tx) => {
      await asAdmin(tx);
      const name = `Velo Supply ${randomUUID().slice(0, 6)}`;
      const { rows: created } = await tx.query(
        `insert into public.suppliers (name, contact_name, email, phone, website, account_reference, notes)
         values ($1, '  ', ' ', '', null, '  ', ' ') returning *`,
        [`  ${name}  `],
      );
      expect(created[0]).toMatchObject({
        name,
        contact_name: null,
        email: null,
        phone: null,
        website: null,
        account_reference: null,
        notes: null,
        archived_at: null,
      });
      await failsWith(
        tx,
        () => tx.query("insert into public.suppliers (name) values ($1)", [name.toUpperCase()]),
        { code: "23505", constraint: "suppliers_name_active_key" },
      );
      await tx.query("update public.suppliers set archived_at = now() where id = $1", [
        created[0].id,
      ]);
      await tx.query("insert into public.suppliers (name) values ($1)", [name]);
      for (const [column, value, constraint] of [
        ["website", "shimano.sg", "suppliers_website_check"],
        ["website", "https://has space.sg", "suppliers_website_check"],
        ["email", "not-an-email", "suppliers_email_check"],
      ])
        await failsWith(
          tx,
          () =>
            tx.query(`insert into public.suppliers (name, ${column}) values ($1, $2)`, [
              `Checked ${randomUUID().slice(0, 6)}`,
              value,
            ]),
          { code: "23514", constraint },
        );
      await failsWith(tx, () => tx.query("insert into public.suppliers (name) values ('   ')"), {
        code: "23514",
        constraint: "suppliers_name_check",
      });
      const ok = await tx.query<{ website: string; phone_digits: string }>(
        `insert into public.suppliers (name, website, phone) values ($1, 'https://shimano.sg/b2b', '+65 6123 4567')
         returning website, phone_digits`,
        [`Shimano ${randomUUID().slice(0, 6)}`],
      );
      expect(ok.rows[0]).toEqual({ website: "https://shimano.sg/b2b", phone_digits: "6561234567" });
    });
  });

  it7("are archived only without open orders", async () => {
    await inTransaction(conn, async (tx) => {
      const o = await openPO(tx, { quantity: 2 });
      const archive = () =>
        tx.query("update public.suppliers set archived_at = now() where id = $1", [o.supplierId]);
      await failsWith(tx, archive, { code: "P0001", message: "supplier_has_open_orders" });
      const draft = await createPO(tx, { supplierId: o.supplierId });
      await cancelPO(tx, o.poId);
      await failsWith(tx, archive, { code: "P0001", message: "supplier_has_open_orders" });
      await cancelPO(tx, draft.id);
      expect((await archive()).rowCount).toBe(1);
      await failsWith(tx, () => createPO(tx, { supplierId: o.supplierId }), {
        code: "P0001",
        message: "supplier_archived",
      });
    });
  });

  it7(
    "set_supplier_product keeps at most one preferred supplier and takes the product's currency",
    async () => {
      await inTransaction(conn, async (tx) => {
        await ownerMode(tx);
        const s1 = await makeSupplier(tx);
        const s2 = await makeSupplier(tx);
        const usd = (
          await tx.query<{ id: string }>(
            "insert into public.products (name, tracking_type, currency) values ('Imported tyre', 'quantity', 'USD') returning id",
          )
        ).rows[0].id;
        await actAs(tx, ADMIN);
        const link = async (supplierId: string, preferred: boolean) =>
          (
            await tx.query(
              `select supplier_id, currency, preferred, supplier_sku, lead_days
               from public.set_supplier_product($1, $2, $3, $4, $5)`,
              [supplierId, usd, " TYR-1 ", 5, preferred],
            )
          ).rows[0];
        expect(await link(s1, true)).toEqual({
          supplier_id: s1,
          currency: "USD",
          preferred: true,
          supplier_sku: "TYR-1",
          lead_days: 5,
        });
        expect((await link(s2, true)).preferred).toBe(true);
        const preferred = await tx.query(
          "select supplier_id from public.supplier_products where product_id = $1 and preferred",
          [usd],
        );
        expect(preferred.rows).toEqual([{ supplier_id: s2 }]);
        await failsWith(
          tx,
          () => tx.query("select public.set_supplier_product($1, $2, null, 400)", [s1, usd]),
          { code: "23514", constraint: "supplier_products_lead_days_check" },
        );
        await failsWith(
          tx,
          () => tx.query("select public.set_supplier_product($1, $2)", [randomUUID(), usd]),
          { code: "P0002" },
        );

        const removed = await tx.query(
          "select supplier_id from public.remove_supplier_product($1, $2)",
          [s1, usd],
        );
        expect(removed.rows).toEqual([{ supplier_id: s1 }]);
        expect(
          (await tx.query("select * from public.remove_supplier_product($1, $2)", [s1, usd])).rows,
        ).toEqual([]);

        // last_unit_cost is written only by receiving.
        await failsWith(
          tx,
          () =>
            tx.query(
              "update public.supplier_products set last_unit_cost = 1 where product_id = $1",
              [usd],
            ),
          DENIED,
        );
        await failsWith(
          tx,
          () =>
            tx.query(
              "insert into public.supplier_products (supplier_id, product_id, currency) values ($1, $2, 'USD')",
              [s1, usd],
            ),
          DENIED,
        );
      });
    },
  );
});

describe("Archived entities remain available to historical references (SPEC §23)", () => {
  it7("an archived supplier and product still join from their PO lines and receipts", async () => {
    await inTransaction(conn, async (tx) => {
      const o = await openPO(tx, { quantity: 3 });
      await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 3 }] });
      await addStock(tx, o.productId, -3, { reason: "Returned to the supplier" });
      await tx.query("update public.suppliers set archived_at = now() where id = $1", [
        o.supplierId,
      ]);
      await tx.query("update public.products set archived_at = now() where id = $1", [o.productId]);
      await actAs(tx, MECHANIC2);
      const { rows: joined } = await tx.query(
        `select s.name is not null as supplier, s.archived_at is not null as supplier_archived,
                p.short_id is not null as product, p.archived_at is not null as product_archived,
                rl.quantity_received
           from public.purchase_orders po
           join public.suppliers s on s.id = po.supplier_id
           join public.purchase_order_lines l on l.purchase_order_id = po.id
           join public.products p on p.id = l.product_id
           join public.purchase_receipt_lines rl on rl.purchase_order_line_id = l.id
          where po.id = $1`,
        [o.poId],
      );
      expect(joined).toEqual([
        {
          supplier: true,
          supplier_archived: true,
          product: true,
          product_archived: true,
          quantity_received: 3,
        },
      ]);
    });
  });

  it7(
    "an outstanding line whose product was archived after submission can still be received",
    async () => {
      await inTransaction(conn, async (tx) => {
        const o = await openPO(tx, { quantity: 10 });
        await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 4 }] });
        await addStock(tx, o.productId, -4, { reason: "Count correction" });
        await tx.query("update public.products set archived_at = now() where id = $1", [
          o.productId,
        ]);
        await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 6 }] });
        expect(
          await scalar(tx, "select status::text from public.purchase_orders where id = $1", [
            o.poId,
          ]),
        ).toBe("received");
        expect(
          await scalar(
            tx,
            "select on_hand from reporting.stock_levels where product_id = $1 and location_id = $2",
            [o.productId, LOCATION.shopFloor],
          ),
        ).toBe(6);
      });
    },
  );
});
