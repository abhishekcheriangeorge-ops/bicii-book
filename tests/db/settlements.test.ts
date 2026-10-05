/**
 * Consignment settlements, their reversals and the consignor ledgers (SPEC
 * §2, §13, §23 "Consignment sale liability and consignment settlement are
 * separate facts", "Consignment outstanding balance and partial
 * settlements", "Settlement allocations cannot exceed the amount owed
 * without an explicit override", "Archived entities remain available to
 * historical references"; DATA-MODEL §9, §16; PLAN D4, D44 CONS-JOB-PART,
 * D46 CONS-RESTOCK, D47 SETTLEMENT-RULES, D48 SALES-ACCESS).
 *
 * Tests create items and sales (the P, U, C and S sequences), so the file
 * runs only on a per-file clone. They assert only on rows they created.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { LOCATION } from "../fixtures/ids";
import {
  addCharge,
  consignorLedger,
  createConsignor,
  intakeQuantity,
  intakeUnique,
  itemLedger,
  recordSale,
  restock,
  returnItem,
  reverseSettlement,
  saleLines,
  settle,
  staffWith,
  voidCharge,
} from "./consignment-fixtures";
import { actAs, connect, inTransaction, isolatedDatabase, scalar } from "./harness";
import {
  ADMIN,
  MECHANIC1,
  MECHANIC2,
  addPart,
  assertLedgerConsistent,
  completeJob,
  newJob,
  readAsOwner,
  reopenJob,
} from "./inventory-fixtures";
import { failsWith, ownerMode } from "./workshop-fixtures";

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

/** A consignor with one unique item (agreed 500.00, asking 1000.00) sold on a retail sale. */
async function soldItem(tx: pg.Client, consignorId?: string) {
  const consignor = consignorId ?? (await createConsignor(tx));
  const item = await intakeUnique(tx, {
    consignorId: consignor,
    agreed: "500.00",
    asking: "1000.00",
  });
  const sale = await recordSale(tx, { lines: [{ inventory_unit_id: item.inventory_unit_id! }] });
  const [line] = await saleLines(tx, sale.sale_id);
  return { consignorId: consignor, item, sale, line };
}

const settlementCount = (tx: pg.Client, consignorId: string) =>
  readAsOwner(tx, () =>
    scalar<number>(
      tx,
      "select count(*)::int from public.consignment_settlements where consignor_id = $1",
      [consignorId],
    ),
  );

describe.skipIf(!isolatedDatabase())("liability and settlement (D46, D47)", () => {
  it("Consignment sale liability and consignment settlement are separate facts", async () => {
    await inTx(async (tx) => {
      const { consignorId, item, line } = await soldItem(tx);
      // The sale created the liability; nothing was paid.
      expect(await itemLedger(tx, item.item_id)).toMatchObject({
        liability: "500.00",
        owed: "500.00",
        paid: "0.00",
        outstanding: "500.00",
        last_settlement_at: null,
      });
      expect(await settlementCount(tx, consignorId)).toBe(0);

      const paid = await settle(tx, {
        consignorId,
        amount: "500.00",
        allocations: [{ consignment_item_id: item.item_id, amount: "500.00" }],
        reference: "  PayNow 1234  ",
      });
      expect(paid).toMatchObject({ consignor_id: consignorId, amount: "500.00", replayed: false });
      // Paying changes what was paid, never what was owed or the sale.
      expect(await itemLedger(tx, item.item_id)).toMatchObject({
        liability: "500.00",
        owed: "500.00",
        paid: "500.00",
        outstanding: "0.00",
      });
      expect((await itemLedger(tx, item.item_id)).last_settlement_at).toEqual(paid.paid_at);
      const [after] = await saleLines(tx, line.sale_id);
      expect(after).toEqual(line);
      expect(
        await readAsOwner(tx, () =>
          scalar<string>(tx, "select reference from public.consignment_settlements where id = $1", [
            paid.settlement_id,
          ]),
        ),
      ).toBe("PayNow 1234");
      await assertLedgerConsistent(tx);
    });
  });

  it("Consignment outstanding balance and partial settlements: 200.00 then 300.00 leaves 0.00", async () => {
    await inTx(async (tx) => {
      const { consignorId, item } = await soldItem(tx);
      await settle(tx, {
        consignorId,
        amount: "200",
        allocations: [{ consignment_item_id: item.item_id, amount: "200" }],
      });
      expect(await itemLedger(tx, item.item_id)).toMatchObject({
        paid: "200.00",
        outstanding: "300.00",
      });
      expect(await consignorLedger(tx, consignorId)).toMatchObject({
        awaiting_settlement_items: 1,
        outstanding: "300.00",
      });
      await settle(tx, {
        consignorId,
        amount: "300.00",
        allocations: [{ consignment_item_id: item.item_id, amount: 300 }],
      });
      expect(await itemLedger(tx, item.item_id)).toMatchObject({
        paid: "500.00",
        outstanding: "0.00",
      });
      expect(await consignorLedger(tx, consignorId)).toMatchObject({
        awaiting_settlement_items: 0,
        owed: "500.00",
        paid: "500.00",
        outstanding: "0.00",
      });
      // Nothing more can be paid without an override.
      await failsWith(
        tx,
        () =>
          settle(tx, {
            consignorId,
            amount: "0.01",
            allocations: [{ consignment_item_id: item.item_id, amount: "0.01" }],
          }),
        { code: "P0001", message: "settlement_exceeds_outstanding" },
      );
    });
  });

  it("consignor-borne charges reduce what is owed (D4); voiding one restores it; shop-borne charges never do", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const item = await intakeUnique(tx, { consignorId, agreed: "500.00", asking: "1000.00" });
      const theirs = await addCharge(tx, {
        itemId: item.item_id,
        amount: "45.00",
        bearer: "consignor",
      });
      await addCharge(tx, { itemId: item.item_id, amount: "120.00", bearer: "shop" });
      await recordSale(tx, { lines: [{ inventory_unit_id: item.inventory_unit_id! }] });
      expect(await itemLedger(tx, item.item_id)).toMatchObject({
        liability: "500.00",
        consignor_charges: "45.00",
        shop_charges: "120.00",
        owed: "455.00",
        outstanding: "455.00",
      });
      await failsWith(
        tx,
        () =>
          settle(tx, {
            consignorId,
            amount: "500.00",
            allocations: [{ consignment_item_id: item.item_id, amount: "500.00" }],
          }),
        { code: "P0001", message: "settlement_exceeds_outstanding" },
      );
      await settle(tx, {
        consignorId,
        amount: "455.00",
        allocations: [{ consignment_item_id: item.item_id, amount: "455.00" }],
      });
      expect((await itemLedger(tx, item.item_id)).outstanding).toBe("0.00");
      await voidCharge(tx, theirs.id, "The consignor did not ask for it");
      expect(await itemLedger(tx, item.item_id)).toMatchObject({
        owed: "500.00",
        outstanding: "45.00",
      });
    });
  });

  it("Settlement allocations cannot exceed the amount owed without an explicit override", async () => {
    await inTx(async (tx) => {
      const { consignorId, item } = await soldItem(tx);
      const unsold = await intakeUnique(tx, { consignorId, agreed: "300.00" });
      await failsWith(
        tx,
        () =>
          settle(tx, {
            consignorId,
            amount: "600.00",
            allocations: [{ consignment_item_id: item.item_id, amount: "600.00" }],
          }),
        { code: "P0001", message: "settlement_exceeds_outstanding" },
      );
      // An unsold item owes nothing yet, so any advance needs a reason.
      await failsWith(
        tx,
        () =>
          settle(tx, {
            consignorId,
            amount: "50.00",
            allocations: [
              { consignment_item_id: unsold.item_id, amount: "50.00", override_reason: "   " },
            ],
          }),
        { code: "P0001", message: "settlement_exceeds_outstanding" },
      );
      expect(await settlementCount(tx, consignorId)).toBe(0);

      const over = await settle(tx, {
        consignorId,
        amount: "650.00",
        allocations: [
          {
            consignment_item_id: item.item_id,
            amount: "600.00",
            override_reason: "  Agreed bonus for a quick sale  ",
          },
          { consignment_item_id: unsold.item_id, amount: "50.00", override_reason: "Advance" },
        ],
      });
      const lines = await readAsOwner(tx, async () => {
        const { rows } = await tx.query<{
          consignment_item_id: string;
          amount_applied: string;
          override_reason: string;
        }>(
          `select consignment_item_id, amount_applied::text, override_reason
             from public.settlement_lines where settlement_id = $1 order by amount_applied desc`,
          [over.settlement_id],
        );
        return rows;
      });
      expect(lines).toEqual([
        {
          consignment_item_id: item.item_id,
          amount_applied: "600.00",
          override_reason: "Agreed bonus for a quick sale",
        },
        {
          consignment_item_id: unsold.item_id,
          amount_applied: "50.00",
          override_reason: "Advance",
        },
      ]);
      expect((await itemLedger(tx, item.item_id)).outstanding).toBe("-100.00");
      expect((await itemLedger(tx, unsold.item_id)).outstanding).toBe("-50.00");
      expect(await consignorLedger(tx, consignorId)).toMatchObject({
        owed: "500.00",
        paid: "650.00",
        outstanding: "-150.00",
        awaiting_settlement_items: 0,
      });
    });
  });

  it("a consigned job part's liability is settled the same way, and exists only while its job is completed (D44)", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const item = await intakeUnique(tx, { consignorId, agreed: "250.00", asking: "400.00" });
      const job = await newJob(tx);
      await addPart(tx, {
        workOrderId: job.id,
        productId: item.product_id,
        unitId: item.inventory_unit_id,
      });
      expect(await itemLedger(tx, item.item_id)).toMatchObject({
        job_held_qty: 1,
        liability: "0.00",
      });
      await completeJob(tx, job.id);
      expect(await itemLedger(tx, item.item_id)).toMatchObject({
        job_sold_qty: 1,
        liability: "250.00",
        outstanding: "250.00",
      });
      await settle(tx, {
        consignorId,
        amount: "250.00",
        allocations: [{ consignment_item_id: item.item_id, amount: "250.00" }],
      });
      expect((await itemLedger(tx, item.item_id)).outstanding).toBe("0.00");
      // A reopen removes the liability, not the payment (D46: overpaid).
      await reopenJob(tx, job.id);
      expect(await itemLedger(tx, item.item_id)).toMatchObject({
        liability: "0.00",
        paid: "250.00",
        outstanding: "-250.00",
      });
      await completeJob(tx, job.id);
      expect((await itemLedger(tx, item.item_id)).outstanding).toBe("0.00");
      await assertLedgerConsistent(tx);
    });
  });
});

describe.skipIf(!isolatedDatabase())("record_settlement: validation and access (D47, D48)", () => {
  it("refuses a malformed settlement with its own code", async () => {
    await inTx(async (tx) => {
      const { consignorId, item } = await soldItem(tx);
      const other = await soldItem(tx);
      const alloc = (amount: string | number = "100.00", itemId = item.item_id) => [
        { consignment_item_id: itemId, amount },
      ];
      const call = (a: Partial<Parameters<typeof settle>[1]>) =>
        settle(tx, { consignorId, amount: "100.00", allocations: alloc(), ...a });

      await failsWith(
        tx,
        () => tx.query("select public.record_settlement(null, $1, 10, '[]'::jsonb)", [consignorId]),
        { code: "22004" },
      );
      await failsWith(
        tx,
        () =>
          tx.query("select public.record_settlement($1, $2, null, '[]'::jsonb)", [
            randomUUID(),
            consignorId,
          ]),
        { code: "22004" },
      );
      await failsWith(tx, () => call({ consignorId: randomUUID() }), { code: "P0002" });
      await failsWith(tx, () => call({ paidAt: new Date(Date.now() + 3_600_000) }), {
        code: "P0001",
        message: "settlement_paid_in_future",
      });
      for (const allocations of [
        [],
        null,
        {},
        [{ consignment_item_id: item.item_id }],
        [{ amount: "100.00" }],
        alloc("0"),
        alloc("-5"),
        ["x"],
      ]) {
        await failsWith(tx, () => call({ allocations }), {
          code: "P0001",
          message: "settlement_allocations_required",
        });
      }
      await failsWith(
        tx,
        () =>
          call({
            allocations: [
              { consignment_item_id: item.item_id, amount: "50.00" },
              { consignment_item_id: item.item_id.toUpperCase(), amount: "50.00" },
            ],
          }),
        { code: "P0001", message: "settlement_duplicate_item" },
      );
      await failsWith(tx, () => call({ allocations: alloc("100.00", other.item.item_id) }), {
        code: "P0001",
        message: "settlement_item_wrong_consignor",
      });
      await failsWith(tx, () => call({ allocations: alloc("100.00", randomUUID()) }), {
        code: "P0002",
      });
      await failsWith(tx, () => call({ amount: "100.01" }), {
        code: "P0001",
        message: "settlement_allocation_mismatch",
      });
      await failsWith(tx, () => call({ allocations: alloc("NaN") }), { code: "23514" });
      await failsWith(tx, () => call({ allocations: alloc("ten") }), { code: "22P02" });
      expect(await settlementCount(tx, consignorId)).toBe(0);
    });
  });

  it("needs manage_consignments: mechanic1 (view_costs) and mechanic2 are refused; a manage_consignments-only member records and reverses", async () => {
    await inTx(async (tx) => {
      const { consignorId, item } = await soldItem(tx);
      const request = {
        consignorId,
        amount: "100.00",
        allocations: [{ consignment_item_id: item.item_id, amount: "100.00" }],
      };
      for (const claims of [MECHANIC1, MECHANIC2]) {
        await actAs(tx, claims);
        await failsWith(tx, () => settle(tx, request), { code: "42501" });
      }
      await ownerMode(tx);
      const manager = await staffWith(tx, ["manage_consignments"]);
      await actAs(tx, manager.claims);
      const s = await settle(tx, request);
      expect(
        await scalar<string>(
          tx,
          "select created_by from public.consignment_settlements where id = $1",
          [s.settlement_id],
        ),
      ).toBe(manager.staffId);
      await actAs(tx, MECHANIC1);
      await failsWith(tx, () => reverseSettlement(tx, { settlementId: s.settlement_id }), {
        code: "42501",
      });
      await actAs(tx, manager.claims);
      await reverseSettlement(tx, { settlementId: s.settlement_id });
    });
  });

  it("a settlement for an archived consignor is refused (consignor_archived)", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const item = await intakeUnique(tx, { consignorId, agreed: "100.00" });
      // Returned with nothing owed, so it can be archived.
      await tx.query("select public.return_consignment_item($1, $2, 'Collected')", [
        randomUUID(),
        item.item_id,
      ]);
      await tx.query("update public.consignors set archived_at = now() where id = $1", [
        consignorId,
      ]);
      await failsWith(
        tx,
        () =>
          settle(tx, {
            consignorId,
            amount: "10.00",
            allocations: [
              { consignment_item_id: item.item_id, amount: "10.00", override_reason: "Advance" },
            ],
          }),
        { code: "P0001", message: "consignor_archived" },
      );
    });
  });
});

describe.skipIf(!isolatedDatabase())("idempotency (D47)", () => {
  it('a replay with the same payload ("200" or "200.00", allocations in any order) returns the settlement, even after the outstanding changed; another payload is settlement_conflict', async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const a = await intakeUnique(tx, { consignorId, agreed: "300.00" });
      const b = await intakeUnique(tx, { consignorId, agreed: "200.00" });
      await recordSale(tx, {
        lines: [
          { inventory_unit_id: a.inventory_unit_id! },
          { inventory_unit_id: b.inventory_unit_id! },
        ],
      });
      const settlementId = randomUUID();
      const first = await settle(tx, {
        settlementId,
        consignorId,
        amount: "200",
        allocations: [
          { consignment_item_id: a.item_id, amount: "150" },
          { consignment_item_id: b.item_id, amount: 50 },
        ],
        reference: "PayNow 77",
      });
      expect(first.replayed).toBe(false);
      const again = await settle(tx, {
        settlementId,
        consignorId,
        amount: "200.00",
        allocations: [
          { consignment_item_id: b.item_id, amount: "50.00" },
          { consignment_item_id: a.item_id, amount: "150.00" },
        ],
        reference: " PayNow 77 ",
      });
      expect(again).toEqual({ ...first, replayed: true });

      // Another settlement pays the rest; the replay still answers.
      await settle(tx, {
        consignorId,
        amount: "300.00",
        allocations: [
          { consignment_item_id: a.item_id, amount: "150.00" },
          { consignment_item_id: b.item_id, amount: "150.00" },
        ],
      });
      expect(await consignorLedger(tx, consignorId)).toMatchObject({ outstanding: "0.00" });
      expect(
        await settle(tx, {
          settlementId,
          consignorId,
          amount: "200.00",
          allocations: [
            { consignment_item_id: a.item_id, amount: "150.00" },
            { consignment_item_id: b.item_id, amount: "50.00" },
          ],
          reference: "PayNow 77",
        }),
      ).toEqual({ ...first, replayed: true });
      await failsWith(
        tx,
        () =>
          settle(tx, {
            settlementId,
            consignorId,
            amount: "200.00",
            allocations: [{ consignment_item_id: a.item_id, amount: "200.00" }],
            reference: "PayNow 77",
          }),
        { code: "P0001", message: "settlement_conflict" },
      );
      expect(await settlementCount(tx, consignorId)).toBe(2);
    });
  });

  it("paid_at NULL records now(), and a replay that again omits it matches", async () => {
    await inTx(async (tx) => {
      const { consignorId, item } = await soldItem(tx);
      const settlementId = randomUUID();
      const request = {
        settlementId,
        consignorId,
        amount: "100.00",
        allocations: [{ consignment_item_id: item.item_id, amount: "100.00" }],
      };
      const first = await settle(tx, request);
      expect(first.paid_at).toEqual(await scalar<Date>(tx, "select now()"));
      expect(await settle(tx, request)).toEqual({ ...first, replayed: true });
      // Giving the instant it was stamped with is another payload.
      await failsWith(tx, () => settle(tx, { ...request, paidAt: first.paid_at }), {
        code: "P0001",
        message: "settlement_conflict",
      });
    });
  });
});

describe.skipIf(!isolatedDatabase())("reverse_settlement (D47)", () => {
  it("reverses a whole settlement with a reason: paid drops, the rows stay; a replay returns it; a second reversal is settlement_already_reversed", async () => {
    await inTx(async (tx) => {
      const { consignorId, item } = await soldItem(tx);
      const s = await settle(tx, {
        consignorId,
        amount: "200.00",
        allocations: [{ consignment_item_id: item.item_id, amount: "200.00" }],
      });
      for (const reason of [null, "  "]) {
        await failsWith(
          tx,
          () => reverseSettlement(tx, { settlementId: s.settlement_id, reason }),
          {
            code: "P0001",
            message: "reason_required",
          },
        );
      }
      await failsWith(
        tx,
        () => reverseSettlement(tx, { settlementId: s.settlement_id, reason: "x".repeat(501) }),
        { code: "P0001", message: "reason_too_long" },
      );
      await failsWith(tx, () => reverseSettlement(tx, { settlementId: randomUUID() }), {
        code: "P0002",
      });

      const reversalId = randomUUID();
      const r = await reverseSettlement(tx, {
        reversalId,
        settlementId: s.settlement_id,
        reason: " Wrong amount ",
      });
      expect(r).toEqual({ id: reversalId, settlement_id: s.settlement_id, reason: "Wrong amount" });
      expect(await itemLedger(tx, item.item_id)).toMatchObject({
        paid: "0.00",
        outstanding: "500.00",
        last_settlement_at: null,
      });
      // The settlement and its line are still there.
      expect(
        await readAsOwner(tx, () =>
          scalar<number>(
            tx,
            "select count(*)::int from public.settlement_lines where settlement_id = $1",
            [s.settlement_id],
          ),
        ),
      ).toBe(1);
      expect(await reverseSettlement(tx, { reversalId, settlementId: s.settlement_id })).toEqual(r);
      await failsWith(tx, () => reverseSettlement(tx, { settlementId: s.settlement_id }), {
        code: "P0001",
        message: "settlement_already_reversed",
      });
      const other = await settle(tx, {
        consignorId,
        amount: "100.00",
        allocations: [{ consignment_item_id: item.item_id, amount: "100.00" }],
      });
      await failsWith(
        tx,
        () => reverseSettlement(tx, { reversalId, settlementId: other.settlement_id }),
        {
          code: "P0001",
          message: "settlement_reversal_conflict",
        },
      );
      expect((await itemLedger(tx, item.item_id)).paid).toBe("100.00");
    });
  });

  it("settlements, their lines and reversals are append-only (settlement_immutable)", async () => {
    await inTx(async (tx) => {
      const { consignorId, item } = await soldItem(tx);
      const s = await settle(tx, {
        consignorId,
        amount: "100.00",
        allocations: [{ consignment_item_id: item.item_id, amount: "100.00" }],
      });
      const r = await reverseSettlement(tx, { settlementId: s.settlement_id });
      await ownerMode(tx);
      for (const sql of [
        "update public.consignment_settlements set amount = 1 where id = $1",
        "delete from public.consignment_settlements where id = $1",
        "update public.settlement_lines set amount_applied = 1 where settlement_id = $1",
        "delete from public.settlement_lines where settlement_id = $1",
        "update public.consignment_settlement_reversals set reason = 'x' where settlement_id = $1",
        "delete from public.consignment_settlement_reversals where settlement_id = $1",
      ]) {
        await failsWith(tx, () => tx.query(sql, [s.settlement_id]), {
          code: "P0001",
          message: "settlement_immutable",
        });
      }
      expect(r.settlement_id).toBe(s.settlement_id);
    });
  });
});

describe.skipIf(!isolatedDatabase())("overpayment and the derived ledger (D46)", () => {
  it("a restock after a settlement turns outstanding negative (the consignor owes the shop); a later resale brings it back to 0.00", async () => {
    await inTx(async (tx) => {
      const { consignorId, item, line } = await soldItem(tx);
      await settle(tx, {
        consignorId,
        amount: "500.00",
        allocations: [{ consignment_item_id: item.item_id, amount: "500.00" }],
      });
      await restock(tx, {
        unitId: item.inventory_unit_id!,
        saleLineId: line.id,
        reason: "Returned in 7 days",
      });
      expect(await itemLedger(tx, item.item_id)).toMatchObject({
        status: "active",
        liability: "0.00",
        paid: "500.00",
        outstanding: "-500.00",
      });
      // Never recovered automatically: nothing new was written for it.
      expect(await settlementCount(tx, consignorId)).toBe(1);
      await recordSale(tx, { lines: [{ inventory_unit_id: item.inventory_unit_id! }] });
      expect(await itemLedger(tx, item.item_id)).toMatchObject({
        status: "sold",
        liability: "500.00",
        outstanding: "0.00",
      });
      await assertLedgerConsistent(tx);
    });
  });

  it("Owed, paid and outstanding are derived, never stored", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      const stored = await scalar<number>(
        tx,
        `select count(*)::int from information_schema.columns c
           join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
            and c.column_name in ('owed', 'paid', 'outstanding', 'liability')`,
      );
      expect(stored).toBe(0);
    });
  });

  it("the consignor ledger is the sum of its item ledgers", async () => {
    await inTx(async (tx) => {
      const consignorId = await createConsignor(tx);
      const sold = await soldItem(tx, consignorId);
      const jerseys = await intakeQuantity(tx, { consignorId, agreed: "20.00", quantity: 5 });
      await recordSale(tx, { lines: [{ product_id: jerseys.product_id, quantity: 2 }] });
      await returnItem(tx, {
        itemId: jerseys.item_id,
        quantity: 2,
        locationId: LOCATION.shopFloor,
        reason: "Collected two",
      });
      const unsold = await intakeUnique(tx, { consignorId, agreed: "80.00" });
      await addCharge(tx, { itemId: unsold.item_id, amount: "15.00", bearer: "consignor" });
      await settle(tx, {
        consignorId,
        amount: "530.00",
        allocations: [
          { consignment_item_id: sold.item.item_id, amount: "500.00" },
          { consignment_item_id: jerseys.item_id, amount: "30.00" },
        ],
      });
      const items = await Promise.all(
        [sold.item.item_id, jerseys.item_id, unsold.item_id].map((id) => itemLedger(tx, id)),
      );
      const sum = (k: "liability" | "consignor_charges" | "owed" | "paid" | "outstanding") =>
        items.reduce((s, i) => s + Number(i[k]), 0).toFixed(2);
      expect(await consignorLedger(tx, consignorId)).toEqual({
        items_total: 3,
        active_items: 2,
        awaiting_settlement_items: 1,
        returned_items: 0,
        liability: sum("liability"),
        consignor_charges: sum("consignor_charges"),
        owed: sum("owed"),
        paid: sum("paid"),
        outstanding: sum("outstanding"),
      });
      expect(await consignorLedger(tx, consignorId)).toMatchObject({
        liability: "540.00",
        consignor_charges: "15.00",
        owed: "525.00",
        paid: "530.00",
        outstanding: "-5.00",
      });
    });
  });
});

describe.skipIf(!isolatedDatabase())("archiving a consignor (D47)", () => {
  it("is refused while the balance is not exactly 0 (consignor_has_balance), owed or overpaid", async () => {
    await inTx(async (tx) => {
      const { consignorId, item } = await soldItem(tx);
      const archive = () =>
        tx.query("update public.consignors set archived_at = now() where id = $1", [consignorId]);
      await failsWith(tx, archive, {
        code: "P0001",
        message: "consignor_has_balance",
        detail: expect.stringContaining("still owed 500.00"),
      });
      await settle(tx, {
        consignorId,
        amount: "520.00",
        allocations: [
          { consignment_item_id: item.item_id, amount: "520.00", override_reason: "Rounded up" },
        ],
      });
      await failsWith(tx, archive, {
        code: "P0001",
        message: "consignor_has_balance",
        detail: expect.stringContaining("Overpaid 20.00 (the consignor owes the shop)"),
      });
    });
  });

  it("at 0 a manage_consignments-only member archives with a plain UPDATE, and the ledgers and old lines still join (Archived entities remain available to historical references)", async () => {
    await inTx(async (tx) => {
      const { consignorId, item, line } = await soldItem(tx);
      await settle(tx, {
        consignorId,
        amount: "500.00",
        allocations: [{ consignment_item_id: item.item_id, amount: "500.00" }],
      });
      await ownerMode(tx);
      const manager = await staffWith(tx, ["manage_consignments"]);
      await actAs(tx, manager.claims);
      await tx.query("update public.consignors set archived_at = now() where id = $1", [
        consignorId,
      ]);
      await actAs(tx, ADMIN);
      expect(
        await scalar<boolean>(
          tx,
          "select archived_at is not null from public.consignors where id = $1",
          [consignorId],
        ),
      ).toBe(true);
      expect(await consignorLedger(tx, consignorId)).toMatchObject({
        items_total: 1,
        liability: "500.00",
        paid: "500.00",
        outstanding: "0.00",
      });
      expect(await itemLedger(tx, item.item_id)).toMatchObject({
        status: "sold",
        outstanding: "0.00",
      });
      expect(
        await readAsOwner(tx, () =>
          scalar<string>(
            tx,
            `select c.display_name from public.sale_lines sl
               join public.consignment_items i on i.id = sl.consignment_item_id
               join public.consignors c on c.id = i.consignor_id
              where sl.id = $1`,
            [line.id],
          ),
        ),
      ).toMatch(/^Consignor /);
    });
  });
});
