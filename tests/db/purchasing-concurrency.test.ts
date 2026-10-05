/**
 * Purchasing under concurrency (SPEC §2 "Idempotent ... mutations", §23
 * "Receiving the same purchase receipt twice cannot double stock", §25;
 * PLAN D63 D-LASTCOST, D65 D-OVERRECEIPT; the global purchasing lock order
 * in the suppliers migration's header): real connections, committed
 * transactions. receive_purchase locks the PO row, then
 * private.lock_stock per product in ascending id, then updates products and
 * supplier_products in ascending id, so racing receipts serialise and never
 * deadlock with each other or with add_inventory_line.
 *
 * Commits its own supplier, products and POs, so the whole file runs only
 * on a per-file clone.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { LOCATION } from "../fixtures/ids";
import { actAs, connect, isolatedDatabase, openConnections, scalar } from "./harness";
import {
  ADMIN,
  addPart,
  addStock,
  committed,
  makeLocation,
  makeProduct,
  newJob,
} from "./inventory-fixtures";
import {
  createPO,
  makeSupplier,
  receive,
  setLine,
  submitPO,
  type ReceiveLine,
} from "./purchasing-fixtures";

let setup: pg.Client;

const SHOP = LOCATION.shopFloor;
const pause = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

/** A committed, submitted PO (submitted two days ago) with one line per product. */
async function committedPO(
  supplierId: string,
  lines: ReadonlyArray<{ productId: string; quantity: number; cost?: string }>,
) {
  const poId = randomUUID();
  const lineIds = lines.map(() => randomUUID());
  const res = await committed(setup, async (tx) => {
    await createPO(tx, { id: poId, supplierId });
    for (const [i, l] of lines.entries())
      await setLine(tx, {
        id: lineIds[i],
        poId,
        productId: l.productId,
        quantity: l.quantity,
        cost: l.cost,
      });
    await submitPO(tx, poId);
  });
  if (!res.ok) throw res.error;
  await setup.query(
    "update public.purchase_orders set submitted_at = now() - interval '2 days' where id = $1",
    [poId],
  );
  return { poId, lineIds };
}

const onHand = (productId: string, locationId = SHOP) =>
  scalar<number>(
    setup,
    `select coalesce(sum(quantity_delta), 0)::int from public.inventory_movements
      where product_id = $1 and location_id = $2`,
    [productId, locationId],
  );

const cost = (productId: string) =>
  scalar<string>(setup, "select default_direct_cost::text from public.products where id = $1", [
    productId,
  ]);

/** Begins an admin transaction on `c` (left open for the caller to commit). */
async function begin(c: pg.Client) {
  await c.query("begin");
  await actAs(c, ADMIN);
}

/** True while `p` is still pending after a pause (it is waiting on a lock). */
async function waiting(p: Promise<unknown>) {
  return (
    (await Promise.race([p.then(() => "settled"), pause().then(() => "waiting")])) === "waiting"
  );
}

describe.skipIf(!isolatedDatabase())("purchasing under concurrency", () => {
  beforeAll(async () => {
    setup = await connect();
  });

  it("the same key from two connections at once records one receipt and adds stock once (SPEC §23)", async () => {
    const supplierId = await makeSupplier(setup);
    const productId = await makeProduct(setup);
    const { poId, lineIds } = await committedPO(supplierId, [{ productId, quantity: 20 }]);
    const key = randomUUID();
    const lines: ReceiveLine[] = [{ lineId: lineIds[0], quantity: 18 }];
    const [a, b] = await openConnections(2);
    const results = await Promise.all([
      committed(a, (tx) => receive(tx, { poId, key, lines })),
      committed(b, (tx) => receive(tx, { poId, key, lines })),
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    const ids = results.map((r) => (r.ok ? r.value.id : null));
    expect(ids[0]).toBe(ids[1]);
    expect(
      await scalar(
        setup,
        "select count(*)::int from public.purchase_receipts where purchase_order_id = $1",
        [poId],
      ),
    ).toBe(1);
    expect(
      await scalar(
        setup,
        "select count(*)::int from public.inventory_movements where product_id = $1 and movement_type = 'purchase_received'",
        [productId],
      ),
    ).toBe(1);
    expect(await onHand(productId)).toBe(18);
  });

  it("two different keys each receiving 18 of 20 at once: one succeeds, the other is an over-receipt (D65)", async () => {
    const supplierId = await makeSupplier(setup);
    const productId = await makeProduct(setup);
    const { poId, lineIds } = await committedPO(supplierId, [{ productId, quantity: 20 }]);
    const lines: ReceiveLine[] = [{ lineId: lineIds[0], quantity: 18 }];
    const [a, b] = await openConnections(2);
    const results = await Promise.all([
      committed(a, (tx) => receive(tx, { poId, lines })),
      committed(b, (tx) => receive(tx, { poId, lines })),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok && failed.error).toMatchObject({
      code: "P0001",
      message: "purchase_over_receipt",
    });
    expect(await onHand(productId)).toBe(18);
  });

  it("a receipt and a quantity reduction at once: whichever commits second sees the first", async () => {
    const supplierId = await makeSupplier(setup);
    for (const receiveFirst of [true, false]) {
      const productId = await makeProduct(setup);
      const { poId, lineIds } = await committedPO(supplierId, [{ productId, quantity: 20 }]);
      const doReceive = (tx: pg.Client) =>
        receive(tx, { poId, lines: [{ lineId: lineIds[0], quantity: 18 }] });
      const doReduce = (tx: pg.Client) =>
        setLine(tx, { id: lineIds[0], poId, productId, quantity: 10 });
      const [a, b] = await openConnections(2);
      await begin(a);
      await (receiveFirst ? doReceive(a) : doReduce(a));
      const second = committed(b, receiveFirst ? doReduce : doReceive);
      expect(await waiting(second)).toBe(true);
      await a.query("commit");
      const result = await second;
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatchObject({
        code: "P0001",
        message: receiveFirst ? "purchase_line_below_received" : "purchase_over_receipt",
      });
      const { rows } = await setup.query(
        `select quantity_ordered, quantity_received from reporting.purchase_order_progress
          where purchase_order_id = $1`,
        [poId],
      );
      expect(rows).toEqual([
        receiveFirst
          ? { quantity_ordered: 20, quantity_received: 18 }
          : { quantity_ordered: 10, quantity_received: 0 },
      ]);
    }
  });

  it("two receipts touching the same products in opposite order never deadlock; the later received_at sets the cost (D63)", async () => {
    const supplierId = await makeSupplier(setup);
    const p1 = await makeProduct(setup, { cost: "1.00" });
    const p2 = await makeProduct(setup, { cost: "1.00" });
    const store = await makeLocation(setup);
    const one = await committedPO(supplierId, [
      { productId: p1, quantity: 10 },
      { productId: p2, quantity: 10 },
    ]);
    const two = await committedPO(supplierId, [
      { productId: p2, quantity: 10 },
      { productId: p1, quantity: 10 },
    ]);
    const earlier = await scalar<Date>(setup, "select now() - interval '1 hour'");
    const later = await scalar<Date>(setup, "select now() - interval '10 minutes'");
    const [a, b] = await openConnections(2);
    const results = await Promise.all([
      committed(a, (tx) =>
        receive(tx, {
          poId: two.poId,
          receivedAt: later,
          lines: [
            { lineId: two.lineIds[0], quantity: 3, cost: "7.00" },
            { lineId: two.lineIds[1], quantity: 3, cost: "8.00", locationId: store },
          ],
        }),
      ),
      committed(b, (tx) =>
        receive(tx, {
          poId: one.poId,
          receivedAt: earlier,
          lines: [
            { lineId: one.lineIds[0], quantity: 2, cost: "5.00" },
            { lineId: one.lineIds[1], quantity: 2, cost: "6.00", locationId: store },
          ],
        }),
      ),
    ]);
    expect(results.map((r) => (r.ok ? "ok" : (r.error as { code?: string }).code))).toEqual([
      "ok",
      "ok",
    ]);
    expect(await cost(p1)).toBe("8.00");
    expect(await cost(p2)).toBe("7.00");
    expect((await onHand(p1)) + (await onHand(p1, store))).toBe(5);
    expect((await onHand(p2)) + (await onHand(p2, store))).toBe(5);
    expect(
      await scalar(
        setup,
        "select last_unit_cost::text from public.supplier_products where supplier_id = $1 and product_id = $2",
        [supplierId, p1],
      ),
    ).toBe("8.00");
  });

  it("a receipt and a part on a job for the same product both commit, in either order", async () => {
    const supplierId = await makeSupplier(setup);
    for (const receiveFirst of [true, false]) {
      const productId = await makeProduct(setup);
      const stocked = await committed(setup, (tx) => addStock(tx, productId, 5));
      if (!stocked.ok) throw stocked.error;
      const job = await committed(setup, (tx) => newJob(tx));
      if (!job.ok) throw job.error;
      const { poId, lineIds } = await committedPO(supplierId, [{ productId, quantity: 10 }]);
      const doReceive = (tx: pg.Client) =>
        receive(tx, { poId, lines: [{ lineId: lineIds[0], quantity: 10 }] });
      const doPart = (tx: pg.Client) =>
        addPart(tx, { workOrderId: job.value.id, productId, quantity: 3, locationId: SHOP });
      const [a, b] = await openConnections(2);
      await begin(a);
      await (receiveFirst ? doReceive(a) : doPart(a));
      const second = committed(b, receiveFirst ? doPart : doReceive);
      expect(await waiting(second)).toBe(true);
      await a.query("commit");
      const result = await second;
      expect(result.ok ? "ok" : (result.error as { code?: string }).code).toBe("ok");
      expect(await onHand(productId)).toBe(5 + 10 - 3);
    }
  });

  it("two preferred-supplier links for one product at once leave exactly one preferred: the second committer's", async () => {
    const s1 = await makeSupplier(setup);
    const s2 = await makeSupplier(setup);
    const productId = await makeProduct(setup);
    const prefer = (supplierId: string) => (tx: pg.Client) =>
      tx.query("select public.set_supplier_product($1, $2, null, null, true)", [
        supplierId,
        productId,
      ]);
    const [a, b] = await openConnections(2);
    await begin(a);
    await prefer(s1)(a);
    const second = committed(b, prefer(s2));
    expect(await waiting(second)).toBe(true);
    await a.query("commit");
    const result = await second;
    expect(result.ok ? "ok" : (result.error as { code?: string }).code).toBe("ok");
    const { rows } = await setup.query(
      "select supplier_id from public.supplier_products where product_id = $1 and preferred",
      [productId],
    );
    expect(rows).toEqual([{ supplier_id: s2 }]);

    // And when both race freely.
    const p2 = await makeProduct(setup);
    const [c, d] = await openConnections(2);
    const raced = await Promise.all(
      [s1, s2].map((s, i) =>
        committed([c, d][i], (tx) =>
          tx.query("select public.set_supplier_product($1, $2, null, null, true)", [s, p2]),
        ),
      ),
    );
    expect(raced.map((r) => r.ok)).toEqual([true, true]);
    expect(
      await scalar(
        setup,
        "select count(*)::int from public.supplier_products where product_id = $1 and preferred",
        [p2],
      ),
    ).toBe(1);
  });
});
