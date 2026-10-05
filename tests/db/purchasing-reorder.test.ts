/**
 * Reorder suggestions and the one-tap draft PO from low stock (SPEC §11
 * "low-stock alerts", §14 "Purchase orders"; PLAN D24 as amended,
 * D60 D-PO-COSTS, D62 D-PO-SCOPE, D66 D-REORDER).
 *
 *   * suggested quantity = max(2 x reorder_point - on_hand - on_order, 0),
 *     NULLs as 0;
 *   * on order counts submitted and partially received POs, never drafts;
 *     drafts already holding a product are listed by number;
 *   * the draft from low stock has one line per distinct product (ascending
 *     id), quantity max(suggestion, 1), cost = supplier last cost, else the
 *     product's cost (0 included), else 0; replaying its id adds nothing and
 *     does not advance the PO sequence;
 *   * suggestions are for active staff (no costs); the draft needs
 *     manage_purchasing.
 *
 * The PO-creating cases consume private.seq_short_id_po, so they skip in
 * existing-database mode; the seeded reads and the refusals run everywhere.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { CUSTOMER, PO_NUMBER, PRODUCT, STAFF, SUPPLIER } from "../fixtures/ids";
import { customerClaims, linkCustomerLogin } from "./customer-fixtures";
import {
  actAs,
  asAnon,
  asStaff,
  connect,
  inTransaction,
  isolatedDatabase,
  scalar,
} from "./harness";
import { ADMIN, MECHANIC2, addStock, makeProduct, readAsOwner } from "./inventory-fixtures";
import {
  createPO,
  makeSupplier,
  openPO,
  poEvents,
  receive,
  setLine,
  submitPO,
  cancelPO,
} from "./purchasing-fixtures";
import { failsWith, ownerMode } from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const it7 = it.skipIf(!isolatedDatabase());
const DENIED = { code: "42501" };

type Suggestion = {
  product_id: string;
  short_id: string;
  sku: string | null;
  name: string;
  on_hand: number;
  reorder_point: number | null;
  on_order: number;
  suggested_quantity: number;
  supplier_linked: boolean;
  preferred_supplier_id: string | null;
  supplier_sku: string | null;
  draft_po_numbers: string[];
};

const suggestions = (tx: pg.Client, supplierId: string | null = null) =>
  tx
    .query<Suggestion>("select * from public.reorder_suggestions($1)", [supplierId])
    .then((r) => r.rows);

type PoRow = {
  id: string;
  po_number: string;
  supplier_id: string;
  status: string;
  currency: string;
};

const fromLowStock = (tx: pg.Client, id: string, supplierId: string, productIds: unknown) =>
  tx
    .query<PoRow>(
      `select id, po_number, supplier_id, status::text, currency
         from public.create_purchase_order_from_low_stock($1, $2, $3::uuid[])`,
      [id, supplierId, productIds],
    )
    .then((r) => r.rows[0]);

/** The PO's lines as the owner reads them, ascending product id. */
const lines = (tx: pg.Client, poId: string) =>
  readAsOwner(tx, () =>
    tx
      .query<{ product_id: string; quantity_ordered: number; unit_cost: string; currency: string }>(
        `select product_id, quantity_ordered, unit_cost::text, currency
           from public.purchase_order_lines where purchase_order_id = $1 order by product_id`,
        [poId],
      )
      .then((r) => r.rows),
  );

const poSequence = (tx: pg.Client) =>
  readAsOwner(tx, () => scalar<string>(tx, "select last_value::text from private.seq_short_id_po"));

describe("private.suggested_reorder_quantity (D66 D-REORDER)", () => {
  it("is max(2 x reorder point - on hand - on order, 0), NULLs counting as 0", async () => {
    const cases: [number | null, number | null, number | null, number][] = [
      [5, 1, 0, 9],
      [4, 2, 0, 6],
      [3, 2, 0, 4],
      [5, 1, 4, 5],
      [5, 1, 9, 0],
      [5, 1, 20, 0], // never negative
      [5, 10, 0, 0],
      [0, 0, 0, 0],
      [2, -3, 1, 6], // negative stock adds to the suggestion
      [10, 3, null, 17],
      [null, -2, null, 2],
      [3, null, null, 6],
      [null, null, null, 0],
    ];
    for (const [rp, onHand, onOrder, expected] of cases) {
      const got = await scalar<number>(
        conn,
        "select private.suggested_reorder_quantity($1, $2, $3)",
        [rp, onHand, onOrder],
      );
      expect(got, `${rp}, ${onHand}, ${onOrder}`).toBe(expected);
    }
  });
});

describe("reorder_suggestions over the seed", () => {
  it("lists the low-stock products, linked to the supplier first, with drafts that hold them", async () => {
    const rows = await asStaff(conn, STAFF.mechanic2, (tx) => suggestions(tx, SUPPLIER.veloParts));
    expect(rows).toEqual([
      {
        product_id: PRODUCT.hydraulicHose,
        short_id: "P-000009",
        sku: "SHI-BH90-1000",
        name: "SM-BH90 hydraulic hose 1000mm",
        on_hand: 1,
        reorder_point: 5,
        on_order: 0,
        suggested_quantity: 9,
        supplier_linked: true,
        preferred_supplier_id: SUPPLIER.veloParts,
        supplier_sku: "VPA-BH90-1000",
        draft_po_numbers: [PO_NUMBER.draft],
      },
      {
        product_id: PRODUCT.cableKit,
        short_id: "P-000008",
        sku: "JAG-PRO-BRK",
        name: "Pro brake cable kit",
        on_hand: 2,
        reorder_point: 4,
        on_order: 0,
        suggested_quantity: 6,
        supplier_linked: true,
        preferred_supplier_id: SUPPLIER.veloParts,
        supplier_sku: "VPA-JAG-PRO",
        draft_po_numbers: [PO_NUMBER.draft],
      },
      {
        product_id: PRODUCT.sealant,
        short_id: "P-000012",
        sku: "OS-REG-237",
        name: "Tubeless sealant 237ml",
        on_hand: 2,
        reorder_point: 3,
        on_order: 0,
        suggested_quantity: 4,
        supplier_linked: false,
        preferred_supplier_id: null,
        supplier_sku: null,
        draft_po_numbers: [],
      },
    ]);
  });

  it("without a supplier (or for another one) nothing is linked; the order is by suggestion", async () => {
    for (const supplier of [null, SUPPLIER.tropicTyre]) {
      const rows = await asStaff(conn, STAFF.mechanic2, (tx) => suggestions(tx, supplier));
      expect(rows.map((r) => [r.product_id, r.supplier_linked, r.supplier_sku])).toEqual([
        [PRODUCT.hydraulicHose, false, null],
        [PRODUCT.cableKit, false, null],
        [PRODUCT.sealant, false, null],
      ]);
      // The preferred supplier does not depend on the one asked about.
      expect(rows[0].preferred_supplier_id).toBe(SUPPLIER.veloParts);
    }
  });

  it("carries no cost column (D60)", async () => {
    const rows = await asStaff(conn, STAFF.mechanic2, (tx) => suggestions(tx));
    for (const key of Object.keys(rows[0])) expect(key).not.toMatch(/cost|price|total|value/);
  });
});

describe("reorder_suggestions: what is on order", () => {
  it7(
    "counts submitted and partially received POs as on order, never drafts or cancelled ones",
    async () => {
      await inTransaction(conn, async (tx) => {
        await ownerMode(tx);
        const supplierId = await makeSupplier(tx);
        const other = await makeSupplier(tx);
        const productId = await makeProduct(tx, { reorderPoint: 5, cost: "8.00" });
        await actAs(tx, ADMIN);
        const find = async (sid: string | null = supplierId) =>
          (await suggestions(tx, sid)).find((r) => r.product_id === productId);

        expect(await find()).toMatchObject({
          on_hand: 0,
          on_order: 0,
          suggested_quantity: 10,
          supplier_linked: false,
          draft_po_numbers: [],
        });

        // A draft is not on order, but it is listed.
        const draft = await createPO(tx, { supplierId: other });
        await setLine(tx, { poId: draft.id, productId, quantity: 3 });
        expect(await find()).toMatchObject({
          on_order: 0,
          suggested_quantity: 10,
          draft_po_numbers: [draft.po_number],
        });

        // Submitted: on order.
        const submitted = await createPO(tx, { supplierId });
        await setLine(tx, { poId: submitted.id, productId, quantity: 4 });
        await submitPO(tx, submitted.id);
        expect(await find()).toMatchObject({ on_order: 4, suggested_quantity: 6 });

        // Partially received: the outstanding units are on order, the received ones on hand.
        const partial = await openPO(tx, { supplierId, productId, quantity: 3 });
        await receive(tx, { poId: partial.poId, lines: [{ lineId: partial.lineId, quantity: 1 }] });
        expect(await find()).toMatchObject({ on_hand: 1, on_order: 6, suggested_quantity: 3 });

        // Cancelled: no longer on order.
        await cancelPO(tx, submitted.id);
        expect(await find()).toMatchObject({ on_order: 2, suggested_quantity: 7 });

        // Receiving linked the supplier; the other is still not linked.
        expect(await find()).toMatchObject({ supplier_linked: true });
        expect(await find(other)).toMatchObject({ supplier_linked: false });

        // Draft numbers stay listed until the draft is submitted.
        await submitPO(tx, draft.id);
        expect(await find()).toMatchObject({ draft_po_numbers: [], on_order: 5 });
      });
    },
  );
});

describe("create_purchase_order_from_low_stock (D66 D-REORDER)", () => {
  it7(
    "drafts one line per distinct product: max(suggestion, 1) at supplier last -> product (0 included) -> 0",
    async () => {
      await inTransaction(conn, async (tx) => {
        await ownerMode(tx);
        const supplierId = await makeSupplier(tx);
        // A: received from this supplier at 6.25, then the product's cost moved to 9.00.
        const a = await makeProduct(tx, { reorderPoint: 6, cost: "8.00" });
        // B: a known cost of 0 (D24 as amended), one on hand.
        const b = await makeProduct(tx, { reorderPoint: 3, cost: "0.00" });
        // C: a product cost, nothing on hand.
        const c = await makeProduct(tx, { reorderPoint: 5, cost: "4.40" });
        // D: no cost at all.
        const d = await makeProduct(tx, { reorderPoint: 2, cost: null });

        const opened = await openPO(tx, { supplierId, productId: a, quantity: 20, cost: "6.25" });
        await receive(tx, { poId: opened.poId, lines: [{ lineId: opened.lineId, quantity: 5 }] });
        await readAsOwner(tx, () =>
          tx.query("update public.products set default_direct_cost = 9.00 where id = $1", [a]),
        );
        await addStock(tx, b, 1);

        const id = randomUUID();
        const po = await fromLowStock(tx, id, supplierId, [c, a, c, b, d, a]);
        const currency = await readAsOwner(tx, () =>
          scalar<string>(tx, "select private.shop_currency()"),
        );
        expect(po).toMatchObject({ id, supplier_id: supplierId, status: "draft", currency });
        expect(po.po_number).toMatch(/^PO-\d{6}$/);

        const expected = [
          // A: 2 x 6 - 5 on hand - 15 on order = -8 -> 0 -> ordered at 1; supplier last cost.
          { product_id: a, quantity_ordered: 1, unit_cost: "6.25", currency },
          // B: 2 x 3 - 1 = 5; the product's own 0.00.
          { product_id: b, quantity_ordered: 5, unit_cost: "0.00", currency },
          // C: 2 x 5 - 0 = 10; the product's cost.
          { product_id: c, quantity_ordered: 10, unit_cost: "4.40", currency },
          // D: 2 x 2 = 4; no cost known -> 0.
          { product_id: d, quantity_ordered: 4, unit_cost: "0.00", currency },
        ].sort((x, y) => x.product_id.localeCompare(y.product_id));
        expect(await lines(tx, id)).toEqual(expected);

        // History: created, then one line_added per product in ascending id order (the trigger's).
        const events = await poEvents(tx, id);
        expect(events.map((e) => e.event_type)).toEqual([
          "created",
          "line_added",
          "line_added",
          "line_added",
          "line_added",
        ]);
        expect(events.slice(1).map((e) => e.payload.product_id)).toEqual(
          expected.map((l) => l.product_id),
        );
        for (const e of events) expect(e.actor_staff_id).toBe(STAFF.admin);
      });
    },
  );

  it7("a replay by id adds nothing and does not advance the PO sequence", async () => {
    await inTransaction(conn, async (tx) => {
      await ownerMode(tx);
      const supplierId = await makeSupplier(tx);
      const p1 = await makeProduct(tx, { reorderPoint: 4 });
      const p2 = await makeProduct(tx, { reorderPoint: 4 });
      await actAs(tx, ADMIN);
      const id = randomUUID();
      const first = await fromLowStock(tx, id, supplierId, [p1]);
      const sequence = await poSequence(tx);
      const eventCount = (await poEvents(tx, id)).length;

      // The same id again, even with another selection: the first PO, unchanged.
      for (const selection of [[p1], [p1, p2]]) {
        expect(await fromLowStock(tx, id, supplierId, selection)).toEqual(first);
      }
      expect((await lines(tx, id)).map((l) => l.product_id)).toEqual([p1]);
      expect(await poSequence(tx)).toBe(sequence);
      expect((await poEvents(tx, id)).length).toBe(eventCount);

      // The same id for another supplier is a conflict.
      const other = await readAsOwner(tx, () => makeSupplier(tx));
      await failsWith(tx, () => fromLowStock(tx, id, other, [p1]), {
        code: "P0001",
        message: "purchase_order_conflict",
      });
      expect(await poSequence(tx)).toBe(sequence);
    });
  });

  it7("keeps set_purchase_order_line's rules and the supplier checks", async () => {
    await inTransaction(conn, async (tx) => {
      await ownerMode(tx);
      const supplierId = await makeSupplier(tx);
      const archived = await makeSupplier(tx, { archived: true });
      const ok = await makeProduct(tx, { reorderPoint: 4 });
      const unique = await makeProduct(tx, { tracking: "unique", cost: "100.00" });
      const inactive = await makeProduct(tx, { reorderPoint: 4, active: false });
      await actAs(tx, ADMIN);

      await failsWith(tx, () => fromLowStock(tx, randomUUID(), archived, [ok]), {
        code: "P0001",
        message: "supplier_archived",
      });
      await failsWith(tx, () => fromLowStock(tx, randomUUID(), randomUUID(), [ok]), {
        code: "P0002",
      });
      await failsWith(tx, () => fromLowStock(tx, randomUUID(), supplierId, [ok, unique]), {
        code: "P0001",
        message: "purchase_line_unique_product",
      });
      await failsWith(tx, () => fromLowStock(tx, randomUUID(), supplierId, [inactive]), {
        code: "P0001",
        message: "purchase_line_product_inactive",
      });
      await failsWith(tx, () => fromLowStock(tx, randomUUID(), supplierId, [randomUUID()]), {
        code: "P0002",
      });
    });
  });
});

describe("create_purchase_order_from_low_stock: arguments and access", () => {
  it("an empty selection is reorder_nothing_selected; more than 100 products is 22023", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, ADMIN);
      for (const selection of [[], null]) {
        await failsWith(tx, () => fromLowStock(tx, randomUUID(), SUPPLIER.veloParts, selection), {
          code: "P0001",
          message: "reorder_nothing_selected",
        });
      }
      const many = Array.from({ length: 101 }, () => randomUUID());
      await failsWith(tx, () => fromLowStock(tx, randomUUID(), SUPPLIER.veloParts, many), {
        code: "22023",
      });
      await failsWith(
        tx,
        () => fromLowStock(tx, randomUUID(), SUPPLIER.veloParts, [PRODUCT.cableKit, null]),
        { code: "22004" },
      );
    });
  });

  it("customers, anonymous visitors and staff without manage_purchasing are refused", async () => {
    const call = (tx: pg.Client) =>
      fromLowStock(tx, randomUUID(), SUPPLIER.veloParts, [PRODUCT.cableKit]);
    await expect(asAnon(conn, call)).rejects.toMatchObject(DENIED);
    await expect(
      inTransaction(conn, async (tx) => {
        await actAs(tx, customerClaims(await linkCustomerLogin(tx, CUSTOMER.priya)));
        return call(tx);
      }),
    ).rejects.toMatchObject(DENIED);
    await expect(
      inTransaction(conn, async (tx) => {
        await actAs(tx, MECHANIC2);
        return call(tx);
      }),
    ).rejects.toMatchObject(DENIED);
  });

  it("reorder_suggestions is for active staff only", async () => {
    await expect(asAnon(conn, (tx) => suggestions(tx))).rejects.toMatchObject(DENIED);
    await expect(
      inTransaction(conn, async (tx) => {
        await actAs(tx, customerClaims(await linkCustomerLogin(tx, CUSTOMER.priya)));
        return suggestions(tx);
      }),
    ).rejects.toMatchObject(DENIED);
    await expect(
      inTransaction(conn, async (tx) => {
        await tx.query("update public.staff set active = false where id = $1", [STAFF.mechanic2]);
        await actAs(tx, MECHANIC2);
        return suggestions(tx);
      }),
    ).rejects.toMatchObject(DENIED);
  });
});
