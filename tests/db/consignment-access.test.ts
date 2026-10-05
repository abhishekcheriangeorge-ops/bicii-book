/**
 * Who sees consignment data (SPEC §4.2, §23 "Customers cannot read internal
 * notes, costs, yield, consignor or Cult Commons data"; DATA-MODEL §15; PLAN
 * D30 FIN-ACCESS, D48 SALES-ACCESS): customers and anonymous visitors reach
 * none of it; staff read consignors and items without payout details, agreed
 * amounts or fingerprints; charges and item history need consignment money
 * access (manage_consignments or view_costs); view_financial_reports alone
 * reveals neither money nor sale costs.
 *
 * Tests create items (short-ID sequences), so the file runs only on a
 * per-file clone.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { LOCATION } from "../fixtures/ids";
import {
  addCharge,
  createConsignor,
  intakeQuantity,
  intakeUnique,
  staffWith,
} from "./consignment-fixtures";
import { customerClaims, linkCustomerLogin } from "./customer-fixtures";
import { actAs, connect, inTransaction, isolatedDatabase, scalar, type Claims } from "./harness";
import {
  ADMIN,
  MECHANIC1,
  MECHANIC2,
  addPart,
  assertLedgerConsistent,
  newJob,
} from "./inventory-fixtures";
import { failsWith, makeCustomer, ownerMode } from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const inTx = <T>(fn: (tx: pg.Client) => Promise<T>) =>
  inTransaction(conn, async (tx) => {
    await actAs(tx, ADMIN);
    return fn(tx);
  });

const TABLES = [
  "public.consignors",
  "public.consignment_items",
  "public.consignment_item_charges",
  "public.consignment_item_events",
];

/** Every new RPC, called with harmless arguments. */
const RPC_CALLS: [string, unknown[]][] = [
  [
    "select public.create_consignment_item($1, $2, $3, 1)",
    [randomUUID(), randomUUID(), LOCATION.shopFloor],
  ],
  ["select public.update_consignment_terms($1, 1, 1, 'x')", [randomUUID()]],
  [
    "select public.add_consignment_charge($1, $2, 'x', 1, 'consignor')",
    [randomUUID(), randomUUID()],
  ],
  ["select public.void_consignment_charge($1, 'x')", [randomUUID()]],
  ["select public.return_consignment_item($1, $2, 'x')", [randomUUID(), randomUUID()]],
];

/** A scenario: one consignor with a unique item carrying both kinds of charge, on a job. */
async function scenario(tx: pg.Client) {
  const consignorId = await createConsignor(tx, { payoutDetails: "PayNow 9123 4567" });
  const item = await intakeUnique(tx, { consignorId, agreed: "500.00", asking: "1000.00" });
  await addCharge(tx, { itemId: item.item_id, amount: "120.00", bearer: "shop" });
  await addCharge(tx, { itemId: item.item_id, amount: "45.00", bearer: "consignor" });
  await intakeQuantity(tx, { consignorId, agreed: "5.00", quantity: 2 });
  const job = await newJob(tx);
  const part = await addPart(tx, {
    workOrderId: job.id,
    productId: item.product_id,
    unitId: item.inventory_unit_id,
  });
  return { consignorId, item, lineId: part.line_id };
}

const count = (tx: pg.Client, table: string) =>
  scalar<number>(tx, `select count(id)::int from ${table}`);

describe.skipIf(!isolatedDatabase())(
  "Customers cannot read internal notes, costs, yield, consignor or Cult Commons data (D48)",
  () => {
    it("a signed-in customer reads 0 rows from every consignment table and is refused every consignment RPC", async () => {
      await inTx(async (tx) => {
        const s = await scenario(tx);
        await ownerMode(tx);
        const customerId = await makeCustomer(tx);
        const login = await linkCustomerLogin(tx, customerId);
        // Even a customer who is also the consignor sees nothing.
        await tx.query("update public.consignors set customer_id = $1 where id = $2", [
          customerId,
          s.consignorId,
        ]);
        await actAs(tx, customerClaims(login));
        for (const table of TABLES) expect(await count(tx, table), table).toBe(0);
        for (const [sql, params] of RPC_CALLS) {
          await failsWith(tx, () => tx.query(sql, params), { code: "42501" });
        }
        await failsWith(
          tx,
          () => tx.query("select count(*) from reporting.consignment_item_position"),
          { code: "42501" },
        );
        await actAs(tx, ADMIN);
        await assertLedgerConsistent(tx);
      });
    });

    it("anonymous visitors hold no privilege on any consignment table, view or RPC", async () => {
      await inTx(async (tx) => {
        await scenario(tx);
        await actAs(tx, { role: "anon" });
        for (const table of [...TABLES, "reporting.consignment_item_position"]) {
          await failsWith(tx, () => tx.query(`select 1 from ${table} limit 1`), { code: "42501" });
        }
        for (const [sql, params] of RPC_CALLS) {
          await failsWith(tx, () => tx.query(sql, params), { code: "42501" });
        }
      });
    });
  },
);

describe.skipIf(!isolatedDatabase())("staff access to consignment money (D48, D30)", () => {
  it("staff without money access read consignors and items but no payout details, agreed amounts, fingerprints, payouts, charges or history", async () => {
    await inTx(async (tx) => {
      const s = await scenario(tx);
      await actAs(tx, MECHANIC2);
      expect(
        await scalar<number>(tx, "select count(id)::int from public.consignors where id = $1", [
          s.consignorId,
        ]),
      ).toBe(1);
      expect(
        await scalar<string>(
          tx,
          "select status::text from public.consignment_items where id = $1",
          [s.item.item_id],
        ),
      ).toBe("active");
      expect(
        await scalar<string>(
          tx,
          "select consignment_item_id from public.work_order_line_items where id = $1",
          [s.lineId],
        ),
      ).toBe(s.item.item_id);
      for (const sql of [
        "select payout_details from public.consignors",
        "select agreed_amount_owed from public.consignment_items",
        "select request_fingerprint from public.consignment_items",
        "select consignor_payout_snapshot from public.work_order_line_items",
      ]) {
        await failsWith(tx, () => tx.query(sql), { code: "42501" });
      }
      expect(await count(tx, "public.consignment_item_charges")).toBe(0);
      expect(await count(tx, "public.consignment_item_events")).toBe(0);
      // The payout is in the view_costs line view only.
      expect(await count(tx, "public.work_order_line_items_staff")).toBe(0);
      for (const [sql, params] of RPC_CALLS) {
        await failsWith(tx, () => tx.query(sql, params), { code: "42501" });
      }
      await actAs(tx, ADMIN);
      await assertLedgerConsistent(tx);
    });
  });

  it("view_costs or manage_consignments reveal charges and history; view_financial_reports alone reveals neither", async () => {
    await inTx(async (tx) => {
      const s = await scenario(tx);
      await ownerMode(tx);
      const manager = await staffWith(tx, ["manage_consignments"]);
      const reports = await staffWith(tx, ["view_financial_reports"]);
      const cases: [string, Claims, boolean, boolean][] = [
        // who, claims, can_view_sale_costs, can_view_consignment_money
        ["mechanic1 (view_costs)", MECHANIC1, true, true],
        ["manage_consignments only", manager.claims, false, true],
        ["view_financial_reports only", reports.claims, false, false],
        ["mechanic2 (no permissions)", MECHANIC2, false, false],
      ];
      for (const [who, claims, saleCosts, money] of cases) {
        await actAs(tx, claims);
        expect(
          await scalar<boolean>(tx, "select private.can_view_sale_costs()"),
          `${who}: sale costs`,
        ).toBe(saleCosts);
        expect(
          await scalar<boolean>(tx, "select private.can_view_consignment_money()"),
          `${who}: consignment money`,
        ).toBe(money);
        const charges = await scalar<number>(
          tx,
          "select count(id)::int from public.consignment_item_charges where consignment_item_id = $1",
          [s.item.item_id],
        );
        const events = await scalar<number>(
          tx,
          "select count(id)::int from public.consignment_item_events where consignment_item_id = $1",
          [s.item.item_id],
        );
        expect(charges, `${who}: charges`).toBe(money ? 2 : 0);
        expect(events, `${who}: history`).toBe(money ? 3 : 0);
      }
      // Payout details stay manage_consignments-only: view_costs cannot read them.
      await actAs(tx, MECHANIC1);
      await failsWith(tx, () => tx.query("select payout_details from public.consignors"), {
        code: "42501",
      });
      await actAs(tx, ADMIN);
      await assertLedgerConsistent(tx);
    });
  });
});
