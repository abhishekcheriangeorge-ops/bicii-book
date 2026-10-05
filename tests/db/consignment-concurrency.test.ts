/**
 * Consignment under concurrency (SPEC §2 "Idempotent ... mutations", §23,
 * §25; PLAN D44 CONS-JOB-PART, D45, D50 CONS-STOCK-MOVES; the lock order in
 * the header of supabase/migrations/20261004003300_consignment.sql): real
 * connections, committed transactions.
 *
 * Every case starts the first call in an open transaction, proves the second
 * call is waiting on a lock (pg_stat_activity wait_event_type 'Lock', as
 * appointment-concurrency.test.ts does), then commits the first: so each case
 * proves the serialisation, not only an outcome that timing could also
 * produce.
 *
 *   * A replayed intake waits on its own advisory lock (lock order 0) and
 *     then returns the same item.
 *   * A replayed return waits on the product's stock lock (3) and then finds
 *     its movement by request_id.
 *   * add_inventory_line, return_consignment_item and adjust_stock all take
 *     private.lock_stock(product) before reading the unit or the stock.
 *   * Two completions serialise on the job row (1); the liability is derived
 *     from the live lines, so it exists once.
 *
 * Commits, so the whole file runs only on a per-file clone (no cleanup).
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { LOCATION } from "../fixtures/ids";
import {
  createConsignor,
  intakeQuantity,
  intakeUnique,
  itemEvents,
  itemPosition,
  itemStatus,
  returnItem,
  type ItemResult,
} from "./consignment-fixtures";
import { actAs, connect, isolatedDatabase, openConnections, scalar, type Claims } from "./harness";
import {
  ADMIN,
  type Outcome,
  addPart,
  addStock,
  committed,
  makeProduct,
  onHand,
  unit,
} from "./inventory-fixtures";
import { createWorkOrder, makeCustomerWithBike, setStatus } from "./workshop-fixtures";

let setup: pg.Client;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until `c`'s backend is blocked on a lock (advisory and row locks
 * both report wait_event_type 'Lock'). Fails if `settled()` turns true first
 * (the statement finished without waiting) or after `timeoutMs`.
 */
async function untilBlocked(c: pg.Client, settled: () => boolean, timeoutMs = 10_000) {
  const pid = (c as unknown as { processID: number }).processID;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (settled()) throw new Error("the second transaction finished without waiting on a lock");
    const waiting = await scalar<number>(
      setup,
      `select count(*)::int from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'`,
      [pid],
    );
    if (waiting === 1) return;
    if (Date.now() > deadline) throw new Error("the second transaction never waited on a lock");
    await pause(20);
  }
}

/**
 * Runs `first` in an open transaction (holding its locks), starts `second`
 * in a committed transaction on another connection, proves it waits on a
 * lock, commits `first`, and returns both outcomes.
 */
async function race<A, B>(
  first: (tx: pg.Client) => Promise<A>,
  second: (tx: pg.Client) => Promise<B>,
  claims: Claims = ADMIN,
): Promise<[Outcome<A>, Outcome<B>]> {
  const [a, b] = await openConnections(2);
  await a.query("begin");
  await actAs(a, claims);
  let firstResult: Outcome<A>;
  try {
    firstResult = { ok: true, value: await first(a) };
  } catch (error) {
    await a.query("rollback");
    throw error;
  }
  let settled = false;
  const secondResult = committed(b, second, claims).finally(() => {
    settled = true;
  });
  try {
    await untilBlocked(b, () => settled);
  } catch (error) {
    await a.query("rollback");
    await secondResult;
    throw error;
  }
  await a.query("commit");
  return [firstResult, await secondResult];
}

/** Unwraps a committed setup step. */
async function must<T>(outcome: Promise<Outcome<T>>): Promise<T> {
  const r = await outcome;
  if (!r.ok) throw r.error;
  return r.value;
}

/** Committed: an open job; returns its id. */
async function job(): Promise<string> {
  const ids = await makeCustomerWithBike(setup);
  return (await must(committed(setup, (tx) => createWorkOrder(tx, ids)))).id;
}

/** Committed: a consigned unique item (agreed 500.00, asking 1000.00). */
async function consignedUnit(): Promise<ItemResult> {
  const consignorId = await createConsignor(setup);
  return must(
    committed(setup, (tx) =>
      intakeUnique(tx, { consignorId, agreed: "500.00", asking: "1000.00" }),
    ),
  );
}

const count = (sql: string, params: unknown[]) =>
  scalar<number>(setup, `select count(*)::int from ${sql}`, params);

const failedWith = (r: Outcome<unknown>, message: string) => {
  expect(r.ok).toBe(false);
  expect(!r.ok && r.error).toMatchObject({ code: "P0001", message });
};

describe.skipIf(!isolatedDatabase())("consignment under concurrency", () => {
  beforeAll(async () => {
    setup = await connect();
  });

  it("a replayed intake on two connections: one item, one unit, one movement; both get the same item", async () => {
    const consignorId = await createConsignor(setup);
    const itemId = randomUUID();
    const intake = (tx: pg.Client) =>
      intakeUnique(tx, {
        itemId,
        consignorId,
        agreed: "500",
        asking: "1000",
        productName: "Canyon Grail",
      });
    const [first, second] = await race(intake, intake);
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.value).toEqual(first.ok && first.value);
    const productId = first.ok ? first.value.product_id : "";
    expect(await count("public.consignment_items where id = $1", [itemId])).toBe(1);
    expect(await count("public.inventory_units where product_id = $1", [productId])).toBe(1);
    expect(await count("public.inventory_movements where request_id = $1", [itemId])).toBe(1);
    expect(
      await count("public.consignment_item_events where consignment_item_id = $1", [itemId]),
    ).toBe(1);
  });

  it("Partial returns are recorded once: a replayed partial return on two connections writes one movement and one event", async () => {
    const consignorId = await createConsignor(setup);
    const item = await must(
      committed(setup, (tx) => intakeQuantity(tx, { consignorId, agreed: "10.00", quantity: 6 })),
    );
    const returnId = randomUUID();
    const ret = (tx: pg.Client) =>
      returnItem(tx, {
        returnId,
        itemId: item.item_id,
        quantity: 2,
        locationId: LOCATION.shopFloor,
      });
    const [first, second] = await race(ret, ret);
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.value).toEqual(first.ok && first.value);
    expect(await count("public.inventory_movements where request_id = $1", [returnId])).toBe(1);
    expect(
      (await itemEvents(setup, item.item_id)).filter((e) => e.event_type === "stock_returned"),
    ).toHaveLength(1);
    expect((await itemPosition(setup, item.item_id)).remaining_qty).toBe(4);
    expect(await onHand(setup, item.product_id)).toBe(4);
    expect(await itemStatus(setup, item.item_id)).toBe("active");
  });

  it("A unique unit cannot be sold twice: two jobs adding the same consigned unit, one wins (unit_not_available)", async () => {
    const item = await consignedUnit();
    const jobs = [await job(), await job()];
    const add = (i: number) => (tx: pg.Client) =>
      addPart(tx, {
        workOrderId: jobs[i],
        productId: item.product_id,
        unitId: item.inventory_unit_id,
      });
    const [first, second] = await race(add(0), add(1));
    expect(first.ok).toBe(true);
    failedWith(second, "unit_not_available");
    expect(
      await count("public.work_order_line_items where consignment_item_id = $1", [item.item_id]),
    ).toBe(1);
    expect((await unit(setup, item.inventory_unit_id!)).status).toBe("held_for_customer");
    expect(await onHand(setup, item.product_id)).toBe(0);
  });

  it("adding a consigned unit to a job while it is returned to the consignor: exactly one succeeds, either way round", async () => {
    // The add holds the stock and the unit; the return waits, then finds the unit held.
    {
      const item = await consignedUnit();
      const jobId = await job();
      const [add, ret] = await race(
        (tx) =>
          addPart(tx, {
            workOrderId: jobId,
            productId: item.product_id,
            unitId: item.inventory_unit_id,
          }),
        (tx) => returnItem(tx, { itemId: item.item_id }),
      );
      expect(add.ok).toBe(true);
      failedWith(ret, "unit_not_available");
      expect(await itemStatus(setup, item.item_id)).toBe("active");
      expect((await unit(setup, item.inventory_unit_id!)).status).toBe("held_for_customer");
      expect(await onHand(setup, item.product_id)).toBe(0);
    }
    // The return holds them; the add waits, then finds the unit gone back.
    {
      const item = await consignedUnit();
      const jobId = await job();
      const [ret, add] = await race(
        (tx) => returnItem(tx, { itemId: item.item_id }),
        (tx) =>
          addPart(tx, {
            workOrderId: jobId,
            productId: item.product_id,
            unitId: item.inventory_unit_id,
          }),
      );
      expect(ret.ok).toBe(true);
      failedWith(add, "unit_not_available");
      expect(await itemStatus(setup, item.item_id)).toBe("returned");
      expect((await unit(setup, item.inventory_unit_id!)).status).toBe("returned_to_consignor");
      expect(
        await count("public.work_order_line_items where consignment_item_id = $1", [item.item_id]),
      ).toBe(0);
      expect(await onHand(setup, item.product_id)).toBe(0);
    }
  });

  it("two completions of the same job at once: one liability, one sale of the item (D44)", async () => {
    const item = await consignedUnit();
    const jobId = await job();
    await must(
      committed(setup, (tx) =>
        addPart(tx, {
          workOrderId: jobId,
          productId: item.product_id,
          unitId: item.inventory_unit_id,
        }),
      ),
    );
    await must(committed(setup, (tx) => setStatus(tx, jobId, "in_progress")));
    const complete = (tx: pg.Client) => setStatus(tx, jobId, "completed");
    const [first, second] = await race(complete, complete);
    expect(first.ok && second.ok).toBe(true);
    expect(await itemPosition(setup, item.item_id)).toMatchObject({
      job_sold_qty: 1,
      owed_qty: 1,
      liability: "500.00",
    });
    expect(await itemStatus(setup, item.item_id)).toBe("sold");
    expect(
      (await itemEvents(setup, item.item_id)).filter((e) => e.event_type === "status_changed"),
    ).toHaveLength(1);
    expect((await unit(setup, item.inventory_unit_id!)).status).toBe("sold");
  });

  it("a shop-owned part and a stock adjustment of the same product still serialise on the shared stock lock", async () => {
    const productId = await makeProduct(setup);
    await must(committed(setup, (tx) => addStock(tx, productId, 5)));
    const jobId = await job();
    const [adjust, add] = await race(
      (tx) => addStock(tx, productId, 3),
      (tx) => addPart(tx, { workOrderId: jobId, productId, quantity: 2 }),
    );
    expect(adjust.ok && add.ok).toBe(true);
    // The part saw the adjustment it waited for.
    expect(add.ok && add.value.on_hand_after).toBe(6);
    expect(await onHand(setup, productId)).toBe(6);
  });
});
