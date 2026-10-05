/**
 * Purchasing: receiving, the PO state machine, last cost and history
 * (SPEC §2, §12, §14, §23 "Receiving the same purchase receipt twice cannot
 * double stock", §27.2 "Partial PO receipt adds correct stock"; TESTING
 * "over-receipt raises"; PLAN D5, D24 as amended, D60 D-PO-COSTS,
 * D61 D-PO-CANCEL, D62 D-PO-SCOPE, D63 D-LASTCOST, D64 D-RECEIPT-TIME,
 * D65 D-OVERRECEIPT).
 *
 * Every test creates a PO (private.seq_short_id_po) and products, so the
 * file runs only on a per-file clone.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { CONSIGNMENT_PRODUCT, LOCATION, STAFF } from "../fixtures/ids";
import { actAs, connect, inTransaction, isolatedDatabase, scalar } from "./harness";
import {
  ADMIN,
  addPart,
  addStock,
  assertLedgerConsistent,
  makeLocation,
  makeProduct,
  newJob,
  readAsOwner,
} from "./inventory-fixtures";
import {
  backdateSubmission,
  cancelPO,
  createPO,
  makeSupplier,
  openPO,
  poEvents,
  productCost,
  progress,
  purchaseOrder,
  receive,
  removeLine,
  setLine,
  submitPO,
  supplierLink,
  updatePO,
} from "./purchasing-fixtures";
import { dbNow, shopToday } from "./reporting-fixtures";
import { failsWith, ownerMode } from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const SHOP: string = LOCATION.shopFloor;
const it7 = it.skipIf(!isolatedDatabase());

const p0001 = (message: string) => ({ code: "P0001", message });

/** Ledger on-hand through reporting.stock_levels, as whoever `tx` is. */
const stockLevel = (tx: pg.Client, productId: string, locationId = SHOP) =>
  scalar<number | null>(
    tx,
    "select on_hand from reporting.stock_levels where product_id = $1 and location_id = $2",
    [productId, locationId],
  ).then((v) => v ?? 0);

const count = (tx: pg.Client, sql: string, params: unknown[] = []) =>
  readAsOwner(tx, () => scalar<number>(tx, sql, params));

const receiptCount = (tx: pg.Client, poId: string) =>
  count(tx, "select count(*)::int from public.purchase_receipts where purchase_order_id = $1", [
    poId,
  ]);

const receiptLineCount = (tx: pg.Client, poId: string) =>
  count(
    tx,
    `select count(*)::int from public.purchase_receipt_lines rl
       join public.purchase_receipts r on r.id = rl.purchase_receipt_id
      where r.purchase_order_id = $1`,
    [poId],
  );

const receivedMovements = (tx: pg.Client, productId: string) =>
  count(
    tx,
    "select count(*)::int from public.inventory_movements where product_id = $1 and movement_type = 'purchase_received'",
    [productId],
  );

const eventCount = (tx: pg.Client, poId: string, type?: string) =>
  count(
    tx,
    `select count(*)::int from public.purchase_order_events
      where purchase_order_id = $1 and ($2::text is null or event_type::text = $2)`,
    [poId, type ?? null],
  );

describe("Receiving the same purchase receipt twice cannot double stock (SPEC §23, §27.2)", () => {
  it7(
    "a replay returns the first receipt and writes nothing; a reused key is refused",
    async () => {
      await inTransaction(conn, async (tx) => {
        const o = await openPO(tx, { quantity: 20, cost: "7.50" });
        const key = randomUUID();
        const lines = [{ lineId: o.lineId, quantity: 18, cost: "7.90" }];
        const first = await receive(tx, { poId: o.poId, key, lines, reference: "DN-1" });
        const costAfterFirst = await productCost(tx, o.productId);
        expect(costAfterFirst).toBe("7.90");

        const replay = await receive(tx, { poId: o.poId, key, lines, reference: "DN-1" });
        expect(replay.id).toBe(first.id);
        expect(await receiptCount(tx, o.poId)).toBe(1);
        expect(await receiptLineCount(tx, o.poId)).toBe(1);
        expect(await receivedMovements(tx, o.productId)).toBe(1);
        expect(await stockLevel(tx, o.productId)).toBe(18);
        expect(await productCost(tx, o.productId)).toBe(costAfterFirst);
        expect(await eventCount(tx, o.poId, "received")).toBe(1);

        // The same key with another count, or on another order.
        await failsWith(
          tx,
          () => receive(tx, { poId: o.poId, key, lines: [{ lineId: o.lineId, quantity: 17 }] }),
          p0001("purchase_receipt_key_reused"),
        );
        const other = await openPO(tx, { quantity: 5 });
        await failsWith(
          tx,
          () =>
            receive(tx, { poId: other.poId, key, lines: [{ lineId: other.lineId, quantity: 1 }] }),
          p0001("purchase_receipt_key_reused"),
        );
        expect(await receiptCount(tx, o.poId)).toBe(1);
        expect(await receiptCount(tx, other.poId)).toBe(0);
        expect(await stockLevel(tx, o.productId)).toBe(18);

        // A replay without the cost still matches after the PO line's cost changed.
        await setLine(tx, {
          id: o.lineId,
          poId: o.poId,
          productId: o.productId,
          quantity: 20,
          cost: "9.00",
        });
        const late = await receive(tx, {
          poId: o.poId,
          key,
          lines: [{ lineId: o.lineId, quantity: 18 }],
        });
        expect(late.id).toBe(first.id);
        expect(await stockLevel(tx, o.productId)).toBe(18);
        expect(await eventCount(tx, o.poId, "received")).toBe(1);
        await assertLedgerConsistent(tx);
      });
    },
  );
});

describe("Partial PO receipt adds correct stock (SPEC §27.2)", () => {
  it7("18 of 20 is partially received, the remaining 2 complete it", async () => {
    await inTransaction(conn, async (tx) => {
      const o = await openPO(tx, { quantity: 20, cost: "7.50" });
      const receipt = await receive(tx, {
        poId: o.poId,
        lines: [{ lineId: o.lineId, quantity: 18, cost: "7.25" }],
      });
      expect((await purchaseOrder(tx, o.poId)).status).toBe("partially_received");
      expect(await progress(tx, o.poId)).toMatchObject([
        {
          po_status: "partially_received",
          quantity_ordered: 20,
          quantity_received: 18,
          quantity_outstanding: 2,
          quantity_cancelled: 0,
        },
      ]);

      const { rows: moves } = await readAsOwner(tx, () =>
        tx.query(
          `select m.product_id, m.location_id, m.quantity_delta, m.movement_type::text,
                  m.unit_cost_snapshot::text, m.created_by, m.purchase_receipt_line_id,
                  rl.purchase_receipt_id
             from public.inventory_movements m
             join public.purchase_receipt_lines rl on rl.id = m.purchase_receipt_line_id
            where m.product_id = $1`,
          [o.productId],
        ),
      );
      expect(moves).toEqual([
        {
          product_id: o.productId,
          location_id: SHOP,
          quantity_delta: 18,
          movement_type: "purchase_received",
          unit_cost_snapshot: "7.25",
          created_by: STAFF.admin,
          purchase_receipt_line_id: expect.any(String),
          purchase_receipt_id: receipt.id,
        },
      ]);
      expect(await stockLevel(tx, o.productId)).toBe(18);

      const last = await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 2 }] });
      const po = await purchaseOrder(tx, o.poId);
      expect(po.status).toBe("received");
      expect(po.received_at).toEqual(last.received_at);
      expect(await progress(tx, o.poId)).toMatchObject([
        { quantity_received: 20, quantity_outstanding: 0, quantity_cancelled: 0 },
      ]);
      expect(await stockLevel(tx, o.productId)).toBe(20);
    });
  });

  it7("is overdue only when the expected day is before the shop's today", async () => {
    await inTransaction(conn, async (tx) => {
      const o = await openPO(tx, { quantity: 4 });
      const today = await shopToday(tx);
      const yesterday = await scalar<string>(tx, "select ($1::date - 1)::text", [today]);
      await updatePO(tx, { poId: o.poId, supplierId: o.supplierId, expectedAt: today });
      expect((await progress(tx, o.poId))[0]).toMatchObject({
        expected_at: today,
        is_overdue: false,
      });
      await updatePO(tx, { poId: o.poId, supplierId: o.supplierId, expectedAt: yesterday });
      expect((await progress(tx, o.poId))[0].is_overdue).toBe(true);
      // A line's own date wins over the PO's.
      await setLine(tx, {
        id: o.lineId,
        poId: o.poId,
        productId: o.productId,
        quantity: 4,
        expectedAt: today,
      });
      expect((await progress(tx, o.poId))[0]).toMatchObject({
        expected_at: today,
        is_overdue: false,
      });
      // A draft is never overdue.
      const draft = await openPO(tx, { quantity: 1, submit: false });
      await updatePO(tx, { poId: draft.poId, supplierId: draft.supplierId, expectedAt: yesterday });
      expect((await progress(tx, draft.poId))[0].is_overdue).toBe(false);
    });
  });

  it7(
    "one PO line split across two locations writes two movements, each location up by its share",
    async () => {
      await inTransaction(conn, async (tx) => {
        const o = await openPO(tx, { quantity: 10 });
        await ownerMode(tx);
        const store = await makeLocation(tx);
        await actAs(tx, ADMIN);
        await receive(tx, {
          poId: o.poId,
          lines: [
            { lineId: o.lineId, quantity: 6 },
            { lineId: o.lineId, quantity: 4, locationId: store },
          ],
        });
        expect(await receivedMovements(tx, o.productId)).toBe(2);
        expect(await stockLevel(tx, o.productId)).toBe(6);
        expect(await stockLevel(tx, o.productId, store)).toBe(4);
        expect((await purchaseOrder(tx, o.poId)).status).toBe("received");
      });
    },
  );

  it7(
    "D64 D-RECEIPT-TIME: a back-dated receipt keeps record time on its movement and the shop-time date in its reason",
    async () => {
      await inTransaction(conn, async (tx) => {
        const o = await openPO(tx, { quantity: 3 });
        const twoDaysAgo = await dbNow(tx, "-2 days");
        const receipt = await receive(tx, {
          poId: o.poId,
          lines: [{ lineId: o.lineId, quantity: 3 }],
          receivedAt: twoDaysAgo,
        });
        expect(receipt.received_at.toISOString()).toBe(new Date(twoDaysAgo).toISOString());
        const { rows } = await readAsOwner(tx, () =>
          tx.query<{ reason: string; record_time: boolean; expected: string }>(
            `select m.reason,
                  m.created_at >= now() as record_time,
                  $2 || ' received ' || to_char($3::timestamptz at time zone private.shop_timezone(),
                                                'FMDD Mon YYYY HH24:MI') as expected
             from public.inventory_movements m where m.product_id = $1`,
            [o.productId, o.poNumber, twoDaysAgo],
          ),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].record_time).toBe(true);
        expect(rows[0].reason).toBe(rows[0].expected);
        expect(rows[0].reason).toMatch(
          /^PO-\d{6} received \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/,
        );
      });
    },
  );

  it7("D64: a receipt dated before the PO was submitted is refused", async () => {
    await inTransaction(conn, async (tx) => {
      const o = await openPO(tx, { quantity: 3, backdate: false });
      await failsWith(
        tx,
        () =>
          receive(tx, {
            poId: o.poId,
            lines: [{ lineId: o.lineId, quantity: 1 }],
            receivedAt: "2000-01-01T00:00:00Z",
          }),
        p0001("purchase_receipt_too_old"),
      );
      await backdateSubmission(tx, o.poId, "1 day");
      await failsWith(
        tx,
        async () =>
          receive(tx, {
            poId: o.poId,
            lines: [{ lineId: o.lineId, quantity: 1 }],
            receivedAt: await dbNow(tx, "-2 days"),
          }),
        p0001("purchase_receipt_before_submission"),
      );
      expect(await receiptCount(tx, o.poId)).toBe(0);
    });
  });
});

describe("PO currency is the shop currency (D62 D-PO-SCOPE)", () => {
  it7(
    "the PO stores private.shop_currency(); lines and receipt lines copy it; another currency is refused",
    async () => {
      await inTransaction(conn, async (tx) => {
        const o = await openPO(tx, { quantity: 2 });
        const shopCurrency = await readAsOwner(tx, () =>
          scalar<string>(tx, "select private.shop_currency()"),
        );
        expect((await purchaseOrder(tx, o.poId)).currency).toBe(shopCurrency);
        await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 2 }] });
        const currencies = await readAsOwner(tx, () =>
          tx.query(
            `select l.currency as line, rl.currency as receipt_line
             from public.purchase_order_lines l
             join public.purchase_receipt_lines rl on rl.purchase_order_line_id = l.id
            where l.id = $1`,
            [o.lineId],
          ),
        );
        expect(currencies.rows).toEqual([{ line: shopCurrency, receipt_line: shopCurrency }]);

        await ownerMode(tx);
        const usd = (
          await tx.query<{ id: string }>(
            `insert into public.products (name, tracking_type, currency) values ('Imported part', 'quantity', 'USD') returning id`,
          )
        ).rows[0].id;
        await actAs(tx, ADMIN);
        const draft = await createPO(tx, { supplierId: o.supplierId });
        await failsWith(
          tx,
          () => setLine(tx, { poId: draft.id, productId: usd, quantity: 1 }),
          p0001("purchase_currency_mismatch"),
        );
      });
    },
  );
});

describe("Over-receipt raises (TESTING) and closed orders refuse receipts (D65 D-OVERRECEIPT)", () => {
  it7("refuses more than is outstanding, and every malformed or invalid receipt", async () => {
    await inTransaction(conn, async (tx) => {
      const o = await openPO(tx, { quantity: 20, cost: "6.00" });
      await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 18 }] });
      await failsWith(
        tx,
        () => receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 3 }] }),
        {
          ...p0001("purchase_over_receipt"),
          detail: expect.stringMatching(/ordered 20, already received 18, this delivery 3/),
        },
      );
      await ownerMode(tx);
      const store = await makeLocation(tx);
      const inactive = await makeLocation(tx, { active: false });
      await actAs(tx, ADMIN);
      await failsWith(
        tx,
        () =>
          receive(tx, {
            poId: o.poId,
            lines: [
              { lineId: o.lineId, quantity: 2 },
              { lineId: o.lineId, quantity: 1, locationId: store },
            ],
          }),
        p0001("purchase_over_receipt"),
      );
      expect(await stockLevel(tx, o.productId)).toBe(18);
      expect(await stockLevel(tx, o.productId, store)).toBe(0);
      expect(await receiptCount(tx, o.poId)).toBe(1);

      const bad = (lines: unknown, expected: Record<string, unknown>) =>
        failsWith(tx, () => receive(tx, { poId: o.poId, lines }), expected);
      await bad([], p0001("purchase_receipt_empty"));
      for (const quantity of [0, -1, 1.5])
        await bad(
          [{ purchase_order_line_id: o.lineId, quantity_received: quantity, location_id: SHOP }],
          p0001("purchase_receipt_quantity_invalid"),
        );
      await bad(
        [
          {
            purchase_order_line_id: o.lineId,
            quantity_received: 1,
            location_id: SHOP,
            unit_cost_actual: "100000.00",
          },
        ],
        p0001("purchase_receipt_cost_invalid"),
      );
      await bad(
        [
          {
            purchase_order_line_id: o.lineId,
            quantity_received: 1,
            location_id: SHOP,
            unit_cost_actual: "-0.01",
          },
        ],
        p0001("purchase_receipt_cost_invalid"),
      );
      await bad(
        [{ purchase_order_line_id: o.lineId, quantity_received: 1, location_id: inactive }],
        p0001("location_inactive"),
      );
      await bad(
        [
          { purchase_order_line_id: o.lineId, quantity_received: 1, location_id: SHOP },
          { purchase_order_line_id: o.lineId, quantity_received: 1, location_id: SHOP },
        ],
        p0001("purchase_receipt_line_duplicate"),
      );
      await bad(["not an object"], { code: "22023" });
      await bad({ not: "an array" }, { code: "22023" });
      await bad([{ purchase_order_line_id: "nope", quantity_received: 1, location_id: SHOP }], {
        code: "22P02",
      });
      const foreign = await openPO(tx, { quantity: 5 });
      await bad(
        [{ purchase_order_line_id: foreign.lineId, quantity_received: 1, location_id: SHOP }],
        p0001("purchase_receipt_line_foreign"),
      );
      await failsWith(
        tx,
        async () =>
          receive(tx, {
            poId: o.poId,
            lines: [{ lineId: o.lineId, quantity: 1 }],
            receivedAt: await dbNow(tx, "1 hour"),
          }),
        p0001("purchase_receipt_in_future"),
      );
      await failsWith(
        tx,
        async () =>
          receive(tx, {
            poId: o.poId,
            lines: [{ lineId: o.lineId, quantity: 1 }],
            receivedAt: await dbNow(tx, "-31 days"),
          }),
        p0001("purchase_receipt_too_old"),
      );
      // 4 minutes ahead (clock skew) and 29 days back are accepted.
      await receive(tx, {
        poId: o.poId,
        lines: [{ lineId: o.lineId, quantity: 1 }],
        receivedAt: await dbNow(tx, "4 minutes"),
      });
      // A missing cost is the PO line's cost.
      await receive(tx, {
        poId: o.poId,
        lines: [{ lineId: o.lineId, quantity: 1 }],
        receivedAt: await dbNow(tx, "-29 days"),
      });
      const costs = await readAsOwner(tx, () =>
        tx.query<{ c: string }>(
          `select rl.unit_cost_actual::text as c from public.purchase_receipt_lines rl
            where rl.purchase_order_line_id = $1 order by rl.created_at`,
          [o.lineId],
        ),
      );
      expect(costs.rows.map((r) => r.c)).toEqual(["6.00", "6.00", "6.00"]);
      expect(await stockLevel(tx, o.productId)).toBe(20);
      expect((await purchaseOrder(tx, o.poId)).status).toBe("received");
      await assertLedgerConsistent(tx);
    });
  });

  it7("draft, received and cancelled orders take no receipt", async () => {
    await inTransaction(conn, async (tx) => {
      const draft = await openPO(tx, { quantity: 2, submit: false });
      await failsWith(
        tx,
        () => receive(tx, { poId: draft.poId, lines: [{ lineId: draft.lineId, quantity: 1 }] }),
        p0001("purchase_order_not_submitted"),
      );
      const cancelled = await openPO(tx, { quantity: 2 });
      await cancelPO(tx, cancelled.poId);
      await failsWith(
        tx,
        () =>
          receive(tx, { poId: cancelled.poId, lines: [{ lineId: cancelled.lineId, quantity: 1 }] }),
        p0001("purchase_order_closed"),
      );

      // Ordered 10, received 10: closed for edits and receipts alike.
      const full = await openPO(tx, { quantity: 10 });
      await receive(tx, { poId: full.poId, lines: [{ lineId: full.lineId, quantity: 10 }] });
      expect((await purchaseOrder(tx, full.poId)).status).toBe("received");
      await failsWith(
        tx,
        () =>
          setLine(tx, {
            id: full.lineId,
            poId: full.poId,
            productId: full.productId,
            quantity: 12,
          }),
        p0001("purchase_order_closed"),
      );
      await failsWith(
        tx,
        () => receive(tx, { poId: full.poId, lines: [{ lineId: full.lineId, quantity: 1 }] }),
        p0001("purchase_order_closed"),
      );

      // On an open PO, raising the quantity first lets the extra units in.
      const open = await openPO(tx, { quantity: 10 });
      await receive(tx, { poId: open.poId, lines: [{ lineId: open.lineId, quantity: 8 }] });
      await setLine(tx, {
        id: open.lineId,
        poId: open.poId,
        productId: open.productId,
        quantity: 12,
        reason: "Supplier sent extra",
      });
      await receive(tx, { poId: open.poId, lines: [{ lineId: open.lineId, quantity: 4 }] });
      expect((await purchaseOrder(tx, open.poId)).status).toBe("received");
      expect(await stockLevel(tx, open.productId)).toBe(12);
    });
  });
});

describe("Zero cost is a known cost (D24 as amended, D63 D-LASTCOST)", () => {
  it7("a 0 line cost and a 0 actual cost are accepted and become the last cost", async () => {
    await inTransaction(conn, async (tx) => {
      const o = await openPO(tx, { quantity: 5, cost: "0.00" });
      expect(await productCost(tx, o.productId)).toBe("8.00");
      await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 5, cost: "0" }] });
      expect(await productCost(tx, o.productId)).toBe("0.00");
      expect(await supplierLink(tx, o.supplierId, o.productId)).toMatchObject({
        last_unit_cost: "0.00",
      });
      const snapshot = await readAsOwner(tx, () =>
        scalar<string>(
          tx,
          "select unit_cost_snapshot::text from public.inventory_movements where product_id = $1",
          [o.productId],
        ),
      );
      expect(snapshot).toBe("0.00");

      await ownerMode(tx);
      const zero = await makeProduct(tx, { cost: "0.00" });
      const unknown = await makeProduct(tx, { cost: null });
      await actAs(tx, ADMIN);
      const { rows } = await tx.query(
        `select product_id, unit_cost::text, source from public.purchase_cost_defaults($1, $2::uuid[])
          order by source`,
        [o.supplierId, [zero, unknown, o.productId, randomUUID()]],
      );
      expect(rows).toEqual([
        { product_id: unknown, unit_cost: "0.00", source: "none" },
        { product_id: zero, unit_cost: "0.00", source: "product" },
        { product_id: o.productId, unit_cost: "0.00", source: "supplier_last" },
      ]);
    });
  });
});

describe("Receiving updates cost per D5 and D63 D-LASTCOST (last cost by received_at)", () => {
  it7(
    "the latest receipt's actual cost wins; a back-dated receipt recorded later changes nothing",
    async () => {
      await inTransaction(conn, async (tx) => {
        const o = await openPO(tx, { quantity: 30, cost: "7.50" });
        await ownerMode(tx);
        const store = await makeLocation(tx);
        await actAs(tx, ADMIN);
        expect(await supplierLink(tx, o.supplierId, o.productId)).toBeNull();

        // Two lines of one product in one receipt: the highest line_number wins.
        const today = await receive(tx, {
          poId: o.poId,
          reference: "DN-5531",
          lines: [
            { lineId: o.lineId, quantity: 5, cost: "7.00" },
            { lineId: o.lineId, quantity: 5, cost: "9.00", locationId: store },
          ],
        });
        expect(await productCost(tx, o.productId)).toBe("9.00");
        const link = await supplierLink(tx, o.supplierId, o.productId);
        expect(link).toMatchObject({ last_unit_cost: "9.00", currency: "SGD", preferred: false });
        expect(link?.last_received_at).toEqual(today.received_at);

        const { rows: costEvents } = await readAsOwner(tx, () =>
          tx.query<{ reason: string }>(
            `select reason from public.product_events
            where product_id = $1 and event_type = 'cost_changed' order by created_at`,
            [o.productId],
          ),
        );
        expect(costEvents).toEqual([
          { reason: `Received on ${o.poNumber} (delivery note DN-5531)` },
        ]);

        // Back-dated 5 days, recorded after today's: no cost changes.
        await receive(tx, {
          poId: o.poId,
          lines: [{ lineId: o.lineId, quantity: 5, cost: "4.00" }],
          receivedAt: await dbNow(tx, "-5 days"),
        });
        expect(await productCost(tx, o.productId)).toBe("9.00");
        const after = await supplierLink(tx, o.supplierId, o.productId);
        expect(after?.last_unit_cost).toBe("9.00");
        expect(after?.last_received_at).toEqual(today.received_at);
        expect(
          await count(
            tx,
            "select count(*)::int from public.product_events where product_id = $1 and event_type = 'cost_changed'",
            [o.productId],
          ),
        ).toBe(1);

        // A receipt from another supplier: the product cost follows it, this
        // supplier's last cost does not.
        await ownerMode(tx);
        const otherSupplier = await makeSupplier(tx);
        await actAs(tx, ADMIN);
        const second = await openPO(tx, {
          supplierId: otherSupplier,
          productId: o.productId,
          quantity: 2,
        });
        await receive(tx, {
          poId: second.poId,
          lines: [{ lineId: second.lineId, quantity: 2, cost: "10.50" }],
        });
        expect(await productCost(tx, o.productId)).toBe("10.50");
        expect((await supplierLink(tx, o.supplierId, o.productId))?.last_unit_cost).toBe("9.00");
        expect((await supplierLink(tx, otherSupplier, o.productId))?.last_unit_cost).toBe("10.50");
      });
    },
  );
});

describe("Historical line snapshots do not change with catalog edits (SPEC §23)", () => {
  it7(
    "a part already on a job keeps its cost snapshot after a receipt changes the product's cost",
    async () => {
      await inTransaction(conn, async (tx) => {
        const job = await newJob(tx);
        await ownerMode(tx);
        const productId = await makeProduct(tx, { cost: "8.00", price: "20.00" });
        await actAs(tx, ADMIN);
        await addStock(tx, productId, 5, { unitCost: "8.00" });
        const part = await addPart(tx, { workOrderId: job.id, productId, quantity: 2 });
        const before = await readAsOwner(tx, () =>
          tx.query(
            `select unit_direct_cost_snapshot::text, cost_total::text, sale_total::text
             from public.work_order_line_items where id = $1`,
            [part.line_id],
          ),
        );
        const movesBefore = await readAsOwner(tx, () =>
          tx.query(
            "select id, unit_cost_snapshot::text from public.inventory_movements where product_id = $1 order by id",
            [productId],
          ),
        );

        const o = await openPO(tx, { productId, quantity: 4 });
        await receive(tx, {
          poId: o.poId,
          lines: [{ lineId: o.lineId, quantity: 4, cost: "11.00" }],
        });
        expect(await productCost(tx, productId)).toBe("11.00");

        const after = await readAsOwner(tx, () =>
          tx.query(
            `select unit_direct_cost_snapshot::text, cost_total::text, sale_total::text
             from public.work_order_line_items where id = $1`,
            [part.line_id],
          ),
        );
        expect(after.rows).toEqual(before.rows);
        expect(before.rows[0]).toMatchObject({
          unit_direct_cost_snapshot: "8.00",
          cost_total: "16.00",
        });
        const movesAfter = await readAsOwner(tx, () =>
          tx.query(
            "select id, unit_cost_snapshot::text from public.inventory_movements where product_id = $1 and id = any($2::bigint[]) order by id",
            [productId, movesBefore.rows.map((r) => r.id)],
          ),
        );
        expect(movesAfter.rows).toEqual(movesBefore.rows);
        await assertLedgerConsistent(tx);
      });
    },
  );
});

describe("Purchase order state machine (D61 D-PO-CANCEL, D62 D-PO-SCOPE, D65 D-OVERRECEIPT)", () => {
  it7(
    "create is replay-safe by id and numbers are server-assigned, increasing and immutable",
    async () => {
      await inTransaction(conn, async (tx) => {
        await ownerMode(tx);
        const supplierId = await makeSupplier(tx);
        const otherSupplier = await makeSupplier(tx);
        await actAs(tx, ADMIN);
        const id = randomUUID();
        const first = await createPO(tx, { id, supplierId, notes: "First" });
        expect(first.po_number).toMatch(/^PO-\d{6}$/);
        expect(first).toMatchObject({ status: "draft", created_by: STAFF.admin });
        const replay = await createPO(tx, { id, supplierId, notes: "Changed on replay" });
        expect(replay).toEqual(first);
        await failsWith(
          tx,
          () => createPO(tx, { id, supplierId: otherSupplier }),
          p0001("purchase_order_conflict"),
        );
        // Replays did not consume a number: the next PO gets the following one.
        const next = await createPO(tx, { supplierId });
        expect(Number(next.po_number.slice(3))).toBe(Number(first.po_number.slice(3)) + 1);
        expect(await eventCount(tx, id, "created")).toBe(1);

        await ownerMode(tx);
        await failsWith(
          tx,
          () =>
            tx.query("update public.purchase_orders set po_number = 'PO-999999' where id = $1", [
              id,
            ]),
          p0001("purchase_order_number_immutable"),
        );
        // Whatever the caller sends, the trigger assigns the number.
        const direct = await tx.query<{ po_number: string }>(
          `insert into public.purchase_orders (supplier_id, currency, po_number)
         values ($1, 'SGD', 'PO-000000') returning po_number`,
          [supplierId],
        );
        expect(direct.rows[0].po_number).not.toBe("PO-000000");
        await actAs(tx, ADMIN);
        await failsWith(tx, () => createPO(tx, { supplierId: randomUUID() }), { code: "P0002" });
        await ownerMode(tx);
        const archived = await makeSupplier(tx, { archived: true });
        await actAs(tx, ADMIN);
        await failsWith(
          tx,
          () => createPO(tx, { supplierId: archived }),
          p0001("supplier_archived"),
        );
      });
    },
  );

  it7("submit needs a line; lines order shop-owned quantity products once each", async () => {
    await inTransaction(conn, async (tx) => {
      await ownerMode(tx);
      const supplierId = await makeSupplier(tx);
      const plain = await makeProduct(tx);
      const unique = await makeProduct(tx, { tracking: "unique" });
      const inactive = await makeProduct(tx, { active: false });
      const archived = await makeProduct(tx);
      await tx.query("update public.products set archived_at = now() where id = $1", [archived]);
      const consigned = await makeProduct(tx);
      await tx.query("update public.products set ownership_type = 'consignment' where id = $1", [
        consigned,
      ]);
      await actAs(tx, ADMIN);
      const po = await createPO(tx, { supplierId });
      await failsWith(tx, () => submitPO(tx, po.id), p0001("purchase_order_needs_lines"));

      const line = (productId: string, extra: Partial<Parameters<typeof setLine>[1]> = {}) =>
        setLine(tx, { poId: po.id, productId, quantity: 1, ...extra });
      await failsWith(tx, () => line(unique), p0001("purchase_line_unique_product"));
      await failsWith(tx, () => line(consigned), p0001("purchase_line_not_shop_owned"));
      await failsWith(tx, () => line(inactive), p0001("purchase_line_product_inactive"));
      await failsWith(tx, () => line(archived), p0001("purchase_line_product_inactive"));
      await failsWith(tx, () => line(randomUUID()), { code: "P0002" });
      await failsWith(tx, () => line(plain, { cost: "100000.00" }), {
        code: "23514",
        constraint: "purchase_order_lines_unit_cost_check",
      });
      await failsWith(tx, () => line(plain, { quantity: 0 }), {
        code: "23514",
        constraint: "purchase_order_lines_quantity_ordered_check",
      });
      const added = await line(plain, { cost: "99999.99", quantity: 100000 });
      expect(added.ordered_total).toBe("9999999000.00");
      await failsWith(tx, () => line(plain), p0001("purchase_line_duplicate_product"));
      // The same line id cannot move to another product.
      await failsWith(
        tx,
        () => setLine(tx, { id: added.id, poId: po.id, productId: unique, quantity: 1 }),
        p0001("purchase_line_conflict"),
      );
      // An unchanged line is a replay: no event.
      const before = await eventCount(tx, po.id);
      await setLine(tx, {
        id: added.id,
        poId: po.id,
        productId: plain,
        quantity: 100000,
        cost: "99999.99",
      });
      expect(await eventCount(tx, po.id)).toBe(before);
      expect((await submitPO(tx, po.id)).status).toBe("submitted");
    });
  });

  it7(
    "Phase 6's consigned stock is never purchased: no PO line, no low-stock draft, no supplier link, no cost prefill",
    async () => {
      await inTransaction(conn, async (tx) => {
        await ownerMode(tx);
        const supplierId = await makeSupplier(tx);
        // The seeded jerseys (C-000003): a counted, active, consignment-owned
        // product with stock, so only its ownership keeps it off a PO.
        const jersey = CONSIGNMENT_PRODUCT.jersey;
        expect(
          (
            await tx.query(
              `select tracking_type::text, ownership_type::text, active, archived_at
                 from public.products where id = $1`,
              [jersey],
            )
          ).rows[0],
        ).toEqual({
          tracking_type: "quantity",
          ownership_type: "consignment",
          active: true,
          archived_at: null,
        });
        await actAs(tx, ADMIN);
        const po = await createPO(tx, { supplierId });
        await failsWith(
          tx,
          () => setLine(tx, { poId: po.id, productId: jersey, quantity: 1 }),
          p0001("purchase_line_not_shop_owned"),
        );
        await failsWith(
          tx,
          () =>
            tx.query("select public.create_purchase_order_from_low_stock($1, $2, $3::uuid[])", [
              randomUUID(),
              supplierId,
              [jersey],
            ]),
          p0001("purchase_line_not_shop_owned"),
        );
        await failsWith(
          tx,
          () =>
            tx.query("select public.set_supplier_product($1, $2, 'JER-M', 5, true)", [
              supplierId,
              jersey,
            ]),
          p0001("purchase_line_not_shop_owned"),
        );
        const { rows: prefill } = await tx.query(
          "select product_id from public.purchase_cost_defaults($1, $2::uuid[])",
          [supplierId, [jersey]],
        );
        expect(prefill).toEqual([]);
        const { rows: suggested } = await tx.query(
          "select product_id from public.reorder_suggestions($1) where product_id = $2",
          [supplierId, jersey],
        );
        expect(suggested).toEqual([]);
      });
    },
  );

  it7("quantities never go below what was received; reducing to it completes the PO", async () => {
    await inTransaction(conn, async (tx) => {
      const o = await openPO(tx, { quantity: 10 });
      await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 5 }] });
      const edit = (quantity: number) =>
        setLine(tx, { id: o.lineId, poId: o.poId, productId: o.productId, quantity });
      await failsWith(tx, () => edit(4), p0001("purchase_line_below_received"));
      await edit(5);
      expect((await purchaseOrder(tx, o.poId)).status).toBe("received");
    });
  });

  it7(
    "removal: never a line with receipts; once submitted, a reason and never the last line",
    async () => {
      await inTransaction(conn, async (tx) => {
        const o = await openPO(tx, { quantity: 4 });
        await ownerMode(tx);
        const second = await makeProduct(tx);
        const third = await makeProduct(tx);
        await actAs(tx, ADMIN);
        const l2 = await setLine(tx, { poId: o.poId, productId: second, quantity: 2 });
        const l3 = await setLine(tx, { poId: o.poId, productId: third, quantity: 2 });
        await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 1 }] });
        await failsWith(
          tx,
          () => removeLine(tx, o.lineId, "Wrong"),
          p0001("purchase_line_has_receipts"),
        );
        await failsWith(tx, () => removeLine(tx, l2.id), p0001("reason_required"));
        expect(await removeLine(tx, l2.id, "Out of stock at the supplier")).toEqual([l2.id]);
        expect(await removeLine(tx, l2.id, "Out of stock at the supplier")).toEqual([]);
        expect(await removeLine(tx, randomUUID())).toEqual([]);

        // The last line of a submitted PO stays.
        const lone = await openPO(tx, { quantity: 1 });
        await failsWith(
          tx,
          () => removeLine(tx, lone.lineId, "Changed my mind"),
          p0001("purchase_order_needs_lines"),
        );
        // A draft line goes without a reason.
        const draft = await openPO(tx, { quantity: 1, submit: false });
        expect(await removeLine(tx, draft.lineId)).toEqual([draft.lineId]);

        // Removing the only outstanding line completes a partially received PO.
        await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 3 }] });
        expect((await purchaseOrder(tx, o.poId)).status).toBe("partially_received");
        await removeLine(tx, l3.id, "Supplier cannot deliver");
        expect((await purchaseOrder(tx, o.poId)).status).toBe("received");
      });
    },
  );

  it7(
    "the supplier is locked after submission; cancel keeps what arrived and reports the rest as cancelled",
    async () => {
      await inTransaction(conn, async (tx) => {
        const o = await openPO(tx, { quantity: 20 });
        await ownerMode(tx);
        const other = await makeSupplier(tx);
        await actAs(tx, ADMIN);
        await failsWith(
          tx,
          () => updatePO(tx, { poId: o.poId, supplierId: other }),
          p0001("purchase_order_supplier_locked"),
        );
        const draft = await openPO(tx, { quantity: 1, submit: false });
        expect((await updatePO(tx, { poId: draft.poId, supplierId: other })).supplier_id).toBe(
          other,
        );

        await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 18 }] });
        await failsWith(tx, () => cancelPO(tx, o.poId, "  "), p0001("reason_required"));
        await failsWith(tx, () => cancelPO(tx, o.poId, "x".repeat(501)), p0001("reason_too_long"));
        const movementsBefore = await receivedMovements(tx, o.productId);
        const cancelled = await cancelPO(tx, o.poId, "Supplier ran out");
        expect(cancelled).toMatchObject({
          status: "cancelled",
          cancelled_by: STAFF.admin,
          cancellation_reason: "Supplier ran out",
        });
        expect(await receiptCount(tx, o.poId)).toBe(1);
        expect(await receivedMovements(tx, o.productId)).toBe(movementsBefore);
        expect(await stockLevel(tx, o.productId)).toBe(18);
        expect(await progress(tx, o.poId)).toMatchObject([
          {
            po_status: "cancelled",
            quantity_received: 18,
            quantity_outstanding: 0,
            quantity_cancelled: 2,
          },
        ]);
        const events = await eventCount(tx, o.poId);
        expect((await cancelPO(tx, o.poId, "Again")).cancellation_reason).toBe("Supplier ran out");
        await failsWith(tx, () => submitPO(tx, o.poId), p0001("purchase_order_closed"));
        await failsWith(
          tx,
          () => updatePO(tx, { poId: o.poId, supplierId: o.supplierId, notes: "Late note" }),
          p0001("purchase_order_closed"),
        );
        expect(await eventCount(tx, o.poId)).toBe(events);

        const full = await openPO(tx, { quantity: 1 });
        await receive(tx, { poId: full.poId, lines: [{ lineId: full.lineId, quantity: 1 }] });
        await failsWith(tx, () => cancelPO(tx, full.poId), p0001("purchase_order_closed"));
        const submittedEvents = await eventCount(tx, full.poId, "submitted");
        expect((await submitPO(tx, full.poId)).status).toBe("received");
        expect(await eventCount(tx, full.poId, "submitted")).toBe(submittedEvents);
      });
    },
  );

  it7(
    "purchase_cost_defaults: the supplier's last cost, else the product's, else none",
    async () => {
      await inTransaction(conn, async (tx) => {
        const o = await openPO(tx, { quantity: 2, product: { cost: "8.00" } });
        const defaults = async () =>
          (
            await tx.query(
              "select unit_cost::text, source from public.purchase_cost_defaults($1, $2::uuid[])",
              [o.supplierId, [o.productId]],
            )
          ).rows[0];
        expect(await defaults()).toEqual({ unit_cost: "8.00", source: "product" });
        await receive(tx, {
          poId: o.poId,
          lines: [{ lineId: o.lineId, quantity: 1, cost: "6.40" }],
        });
        expect(await defaults()).toEqual({ unit_cost: "6.40", source: "supplier_last" });
        await failsWith(
          tx,
          () =>
            tx.query("select * from public.purchase_cost_defaults($1, $2::uuid[])", [
              o.supplierId,
              Array.from({ length: 201 }, () => randomUUID()),
            ]),
          { code: "22023" },
        );
      });
    },
  );
});

describe("Purchase history is appended, never overwritten (SPEC §2)", () => {
  it7(
    "every change appends one event with actor, reason and correlation id; replays append none",
    async () => {
      await inTransaction(conn, async (tx) => {
        await ownerMode(tx);
        const supplierId = await makeSupplier(tx);
        const productA = await makeProduct(tx);
        const productB = await makeProduct(tx);
        await actAs(tx, ADMIN);
        await tx.query(
          `select set_config('request.headers', '{"x-correlation-id": "req-purchasing-0001"}', true)`,
        );
        const id = randomUUID();
        await createPO(tx, { id, supplierId });
        await createPO(tx, { id, supplierId });
        await updatePO(tx, {
          poId: id,
          supplierId,
          notes: "Call before delivery",
          reference: "Q-77",
        });
        await updatePO(tx, {
          poId: id,
          supplierId,
          notes: "Call before delivery",
          reference: "Q-77",
        });
        const a = await setLine(tx, { poId: id, productId: productA, quantity: 3, cost: "5.00" });
        const b = await setLine(tx, { poId: id, productId: productB, quantity: 1 });
        await setLine(tx, {
          id: a.id,
          poId: id,
          productId: productA,
          quantity: 4,
          cost: "5.00",
          reason: "Bulk price",
        });
        await removeLine(tx, b.id, "Not needed");
        await submitPO(tx, id);
        await submitPO(tx, id);
        await backdateSubmission(tx, id);
        const key = randomUUID();
        const receipt = await receive(tx, {
          poId: id,
          key,
          lines: [{ lineId: a.id, quantity: 4 }],
        });
        await receive(tx, { poId: id, key, lines: [{ lineId: a.id, quantity: 4 }] });

        const events = await poEvents(tx, id);
        expect(events.map((e) => e.event_type)).toEqual([
          "created",
          "details_changed",
          "line_added",
          "line_added",
          "line_changed",
          "line_removed",
          "submitted",
          "received",
          "status_changed",
        ]);
        for (const e of events) {
          expect(e.actor_staff_id).toBe(STAFF.admin);
          expect(e.correlation_id).toBe("req-purchasing-0001");
        }
        expect(events[1].payload).toEqual({
          notes: { from: null, to: "Call before delivery" },
          supplier_reference: { from: null, to: "Q-77" },
        });
        expect(events[4]).toMatchObject({
          purchase_order_line_id: a.id,
          reason: "Bulk price",
          payload: { quantity_ordered: { from: 3, to: 4 } },
        });
        expect(events[5]).toMatchObject({
          purchase_order_line_id: b.id,
          reason: "Not needed",
          payload: { id: b.id, product_id: productB },
        });
        expect(events[7]).toMatchObject({
          purchase_receipt_id: receipt.id,
          payload: { units: 4, lines: [{ purchase_order_line_id: a.id, quantity_received: 4 }] },
        });
        expect(events[8].payload).toEqual({ from: "submitted", to: "received" });

        // Cancelling appends exactly one event, with the reason.
        const o = await openPO(tx, { quantity: 1 });
        await cancelPO(tx, o.poId, "Ordered by mistake");
        const cancelled = (await poEvents(tx, o.poId)).filter((e) => e.event_type === "cancelled");
        expect(cancelled).toMatchObject([{ reason: "Ordered by mistake" }]);
      });
    },
  );

  it7(
    "history, receipts and receipt lines refuse update and delete, even for the table owner",
    async () => {
      await inTransaction(conn, async (tx) => {
        const o = await openPO(tx, { quantity: 2 });
        await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 1 }] });
        await ownerMode(tx);
        for (const sql of [
          "update public.purchase_order_events set reason = 'x' where purchase_order_id = $1",
          "delete from public.purchase_order_events where purchase_order_id = $1",
        ])
          await failsWith(
            tx,
            () => tx.query(sql, [o.poId]),
            p0001("purchase_order_history_append_only"),
          );
        for (const sql of [
          "update public.purchase_receipts set reference = 'x' where purchase_order_id = $1",
          "delete from public.purchase_receipts where purchase_order_id = $1",
          `update public.purchase_receipt_lines set quantity_received = 2
          where purchase_order_line_id in (select id from public.purchase_order_lines where purchase_order_id = $1)`,
          `delete from public.purchase_receipt_lines
          where purchase_order_line_id in (select id from public.purchase_order_lines where purchase_order_id = $1)`,
        ])
          await failsWith(tx, () => tx.query(sql, [o.poId]), p0001("purchase_receipt_immutable"));
      });
    },
  );
});

describe("One purchase_received movement per receipt line (Phase 4's inventory_movements_receipt_line_once)", () => {
  it7("the ledger requires the receipt line, accepts it once and only when it exists", async () => {
    await inTransaction(conn, async (tx) => {
      const o = await openPO(tx, { quantity: 2 });
      await receive(tx, { poId: o.poId, lines: [{ lineId: o.lineId, quantity: 1 }] });
      await ownerMode(tx);
      const receiptLine = await scalar<string>(
        tx,
        "select id from public.purchase_receipt_lines where purchase_order_line_id = $1",
        [o.lineId],
      );
      const insert = (lineId: string | null) =>
        tx.query(
          `insert into public.inventory_movements
             (product_id, location_id, quantity_delta, movement_type, purchase_receipt_line_id)
           values ($1, $2, 1, 'purchase_received', $3)`,
          [o.productId, SHOP, lineId],
        );
      await failsWith(tx, () => insert(null), {
        code: "23514",
        constraint: "inventory_movements_purchase_received_has_receipt_line",
      });
      await failsWith(tx, () => insert(receiptLine), {
        code: "23505",
        constraint: "inventory_movements_receipt_line_once",
      });
      await failsWith(tx, () => insert(randomUUID()), {
        code: "23503",
        constraint: "inventory_movements_purchase_receipt_line_id_fkey",
      });
      const { rows } = await tx.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'inventory_movements'
            and indexdef ilike 'create unique index%(purchase_receipt_line_id)%'`,
      );
      expect(rows.map((r) => r.indexname)).toEqual(["inventory_movements_receipt_line_once"]);
      expect(rows[0].indexdef).toContain("WHERE (movement_type = 'purchase_received'");
    });
  });
});
