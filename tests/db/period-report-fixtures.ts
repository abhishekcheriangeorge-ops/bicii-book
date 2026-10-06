/**
 * The Phase 9 period-report scenario (DATA-MODEL §14, TESTING.md; PLAN
 * D100-D105). It builds, inside the test's transaction, a week of March
 * 2025 in Singapore time (3 Mar 2025 is a Monday) that no seed reaches:
 *
 *   Job A  in Mon 3 10:00, started 11:00, completed Wed 5 16:00, ready
 *          16:30, collected Sun 9 11:00; lead mechanic1. SV200, QP x 2
 *          (consumed Mon 12:00), a manual 10.00 line added and voided.
 *   Job B  in Tue 4 09:00, started 10:00, completed Fri 7 23:59:30; no
 *          lead. Manual 100.00 at cost 150.00 (a loss) and SV200.
 *   Job C  in Thu 6 12:00, started 13:00, still in progress; lead
 *          mechanic2. SV120.
 *   Job D  in Thu 6 13:00, cancelled 15:00, no lines (D16).
 *   Job E  in Fri 7 17:00, started 18:00, completed Sat 8 00:00:00 exactly;
 *          lead mechanic1. SV80 and a free 0.00 / 0.00 'Free valve cap'.
 *   S1     the consigned bike (agreed 500.00, asking 1,000.00, received
 *          20 Feb) sold for 1,000.00 on Tue 4 15:00.
 *   T1     200.00 settled to its consignor on Thu 6 10:00.
 *
 * Jobs are owner inserts through tests/db/reporting-fixtures.ts insertJob
 * (explicit stamps, lines, voids and consumption movements); the
 * consignment goes through the real RPCs as the admin, which accept these
 * past dates (only a future date is refused). Nothing relies on seeded
 * prices: the catalogue below is the scenario's own.
 *
 * PERIOD_EXPECTED holds the literal figures the tests assert; they are
 * worked out by hand from the lines above, never recomputed with the code
 * under test.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";

import { STAFF } from "../fixtures/ids";
import { actAs } from "./harness";
import { createConsignor, intakeUnique, recordSale, settle } from "./consignment-fixtures";
import { ADMIN, makeLocation, makeProduct } from "./inventory-fixtures";
import { insertJob, sgt, type InsertedJob } from "./reporting-fixtures";
import { makeService, ownerMode } from "./workshop-fixtures";

/** The scenario's days (Singapore shop days). */
export const MAR = {
  mon3: "2025-03-03",
  tue4: "2025-03-04",
  wed5: "2025-03-05",
  thu6: "2025-03-06",
  fri7: "2025-03-07",
  sat8: "2025-03-08",
  sun9: "2025-03-09",
} as const;

export type PeriodScenario = {
  services: { sv200: string; sv120: string; sv80: string };
  productQP: string;
  locationId: string;
  jobs: { A: InsertedJob; B: InsertedJob; C: InsertedJob; D: InsertedJob; E: InsertedJob };
  /** Job A's voided manual line; job B's manual loss line; job E's free line. */
  lines: { aVoided: string; bManual: string; eFree: string };
  consignorId: string;
  itemId: string;
  unitId: string;
  productBike: string;
  sale: { id: string; number: string };
  settlementId: string;
};

/**
 * Builds the March 2025 scenario. Call it as the connection's owner (before
 * actAs); it leaves `tx` as the owner.
 */
export async function buildPeriodScenario(tx: pg.Client): Promise<PeriodScenario> {
  await ownerMode(tx);
  const tag = randomUUID().slice(0, 8);
  const sv200 = await makeService(tx, { name: `SV200 ${tag}`, price: "200.00", cost: "0.00" });
  const sv120 = await makeService(tx, { name: `SV120 ${tag}`, price: "120.00", cost: "0.00" });
  const sv80 = await makeService(tx, { name: `SV80 ${tag}`, price: "80.00", cost: "0.00" });
  const productQP = await makeProduct(tx, { name: `QP ${tag}`, price: "50.00", cost: "30.00" });
  const locationId = await makeLocation(tx);

  const A = await insertJob(tx, {
    checkedInAt: sgt(MAR.mon3, "10:00"),
    leadMechanicId: STAFF.mechanic1,
    path: [
      { status: "in_progress", at: sgt(MAR.mon3, "11:00") },
      { status: "completed", at: sgt(MAR.wed5, "16:00") },
      { status: "ready_for_collection", at: sgt(MAR.wed5, "16:30") },
      { status: "collected", at: sgt(MAR.sun9, "11:00") },
    ],
    lines: [
      {
        type: "service",
        serviceId: sv200,
        unitSale: "200.00",
        unitCost: "0.00",
        createdAt: sgt(MAR.mon3, "11:30"),
        description: "SV200",
      },
      {
        type: "inventory",
        productId: productQP,
        locationId,
        quantity: 2,
        unitSale: "50.00",
        unitCost: "30.00",
        createdAt: sgt(MAR.mon3, "12:00"),
        description: "QP",
      },
      {
        type: "manual",
        unitSale: "10.00",
        unitCost: "0.00",
        createdAt: sgt(MAR.mon3, "13:00"),
        voidedAt: sgt(MAR.mon3, "14:00"),
        description: "Added by mistake",
      },
    ],
  });

  const B = await insertJob(tx, {
    checkedInAt: sgt(MAR.tue4, "09:00"),
    path: [
      { status: "in_progress", at: sgt(MAR.tue4, "10:00") },
      { status: "completed", at: sgt(MAR.fri7, "23:59:30") },
    ],
    lines: [
      {
        type: "manual",
        unitSale: "100.00",
        unitCost: "150.00",
        createdAt: sgt(MAR.tue4, "11:00"),
        description: "Frame repair at a loss",
      },
      {
        type: "service",
        serviceId: sv200,
        unitSale: "200.00",
        unitCost: "0.00",
        createdAt: sgt(MAR.tue4, "11:30"),
        description: "SV200",
      },
    ],
  });

  const C = await insertJob(tx, {
    checkedInAt: sgt(MAR.thu6, "12:00"),
    leadMechanicId: STAFF.mechanic2,
    path: [{ status: "in_progress", at: sgt(MAR.thu6, "13:00") }],
    lines: [
      {
        type: "service",
        serviceId: sv120,
        unitSale: "120.00",
        unitCost: "0.00",
        createdAt: sgt(MAR.thu6, "12:30"),
        description: "SV120",
      },
    ],
  });

  const D = await insertJob(tx, {
    checkedInAt: sgt(MAR.thu6, "13:00"),
    path: [{ status: "cancelled", at: sgt(MAR.thu6, "15:00"), reason: "Customer changed plans" }],
  });

  const E = await insertJob(tx, {
    checkedInAt: sgt(MAR.fri7, "17:00"),
    leadMechanicId: STAFF.mechanic1,
    path: [
      { status: "in_progress", at: sgt(MAR.fri7, "18:00") },
      { status: "completed", at: sgt(MAR.sat8, "00:00:00") },
    ],
    lines: [
      {
        type: "service",
        serviceId: sv80,
        unitSale: "80.00",
        unitCost: "0.00",
        createdAt: sgt(MAR.fri7, "17:30"),
        description: "SV80",
      },
      {
        type: "manual",
        unitSale: "0.00",
        unitCost: "0.00",
        createdAt: sgt(MAR.fri7, "17:45"),
        description: "Free valve cap",
      },
    ],
  });

  // The consignment, through the real RPCs as the admin.
  await actAs(tx, ADMIN);
  const consignorId = await createConsignor(tx, { displayName: `Period consignor ${tag}` });
  const item = await intakeUnique(tx, {
    consignorId,
    agreed: "500.00",
    asking: "1000.00",
    productName: `Consigned bike ${tag}`,
    receivedAt: sgt("2025-02-20", "10:00"),
  });
  const sale = await recordSale(tx, {
    lines: [{ inventory_unit_id: item.inventory_unit_id!, unit_sale_price: "1000.00" }],
    recognizedAt: sgt(MAR.tue4, "15:00"),
  });
  const settlement = await settle(tx, {
    consignorId,
    amount: "200.00",
    allocations: [{ consignment_item_id: item.item_id, amount: "200.00" }],
    paidAt: sgt(MAR.thu6, "10:00"),
  });
  await ownerMode(tx);

  return {
    services: { sv200, sv120, sv80 },
    productQP,
    locationId,
    jobs: { A, B, C, D, E },
    lines: { aVoided: A.lineIds[2], bManual: B.lineIds[0], eFree: E.lineIds[1] },
    consignorId,
    itemId: item.item_id,
    unitId: item.inventory_unit_id!,
    productBike: item.product_id,
    sale: { id: sale.sale_id, number: sale.sale_number },
    settlementId: settlement.settlement_id,
  };
}

/** Money as sale / cost / yield / Cult Commons, fixed 2. */
export type Money4 = { sale: string; cost: string; yield: string; cc: string };

const ZERO: Money4 = { sale: "0.00", cost: "0.00", yield: "0.00", cc: "0.00" };
const A_MONEY: Money4 = { sale: "300.00", cost: "60.00", yield: "240.00", cc: "72.00" };
const B_MONEY: Money4 = { sale: "300.00", cost: "150.00", yield: "150.00", cc: "60.00" };
const E_MONEY: Money4 = { sale: "80.00", cost: "0.00", yield: "80.00", cc: "24.00" };
const S1_MONEY: Money4 = { sale: "1000.00", cost: "500.00", yield: "500.00", cc: "150.00" };

/**
 * The literal expectations (hand-computed; D1 per line, D100 bases, D35
 * shop days). byDay[basis][day] is the day's money on that basis.
 */
export const PERIOD_EXPECTED = {
  byDay: {
    check_in: {
      [MAR.mon3]: { sale: "300.00", cost: "60.00", yield: "240.00", cc: "72.00" },
      [MAR.tue4]: { sale: "300.00", cost: "150.00", yield: "150.00", cc: "60.00" },
      [MAR.wed5]: ZERO,
      [MAR.thu6]: { sale: "120.00", cost: "0.00", yield: "120.00", cc: "36.00" },
      [MAR.fri7]: E_MONEY,
      [MAR.sat8]: ZERO,
      [MAR.sun9]: ZERO,
    },
    completion: {
      [MAR.mon3]: ZERO,
      [MAR.tue4]: ZERO,
      [MAR.wed5]: A_MONEY,
      [MAR.thu6]: ZERO,
      [MAR.fri7]: B_MONEY,
      [MAR.sat8]: E_MONEY,
      [MAR.sun9]: ZERO,
    },
    collection: {
      [MAR.mon3]: ZERO,
      [MAR.tue4]: ZERO,
      [MAR.wed5]: ZERO,
      [MAR.thu6]: ZERO,
      [MAR.fri7]: ZERO,
      [MAR.sat8]: ZERO,
      [MAR.sun9]: A_MONEY,
    },
    sale: {
      [MAR.mon3]: ZERO,
      [MAR.tue4]: S1_MONEY,
      [MAR.wed5]: A_MONEY,
      [MAR.thu6]: ZERO,
      [MAR.fri7]: B_MONEY,
      [MAR.sat8]: E_MONEY,
      [MAR.sun9]: ZERO,
    },
  } as Record<string, Record<string, Money4>>,
  /** The week Mon 3 - Sun 9 March 2025 on each basis. */
  week: {
    check_in: {
      sale: "800.00",
      cost: "210.00",
      yield: "590.00",
      cc: "192.00",
      job_count: 4,
      sale_count: 0,
      line_count: 7,
      loss_line_count: 1,
    },
    completion: {
      sale: "680.00",
      cost: "210.00",
      yield: "470.00",
      cc: "156.00",
      job_count: 3,
      sale_count: 0,
      line_count: 6,
      loss_line_count: 1,
    },
    collection: {
      sale: "300.00",
      cost: "60.00",
      yield: "240.00",
      cc: "72.00",
      job_count: 1,
      sale_count: 0,
      line_count: 2,
      loss_line_count: 0,
    },
    sale: {
      sale: "1680.00",
      cost: "710.00",
      yield: "970.00",
      cc: "306.00",
      yield_after_cc: "664.00",
      job_count: 3,
      sale_count: 1,
      line_count: 7,
      loss_line_count: 1,
      consignment_sales: 1,
      consignment_sales_total: "1000.00",
      new_consignor_liability: "500.00",
      settlements_paid_total: "200.00",
    },
  },
  activity: {
    jobs_checked_in: 5,
    jobs_started: 4,
    jobs_completed: 3,
    jobs_ready_for_collection: 1,
    jobs_collected: 1,
    jobs_cancelled: 1,
    jobs_open_at_end: 1,
    // A 54.0 h, B 86 h 59 min 30 s, E 7.0 h: the median is A's.
    median_hours_to_complete: "54.0",
    // A only: Wed 5 Mar 16:00 to Sun 9 Mar 11:00 = 91 hours.
    median_hours_to_collect: "91.0",
    parts_consumed_qty: 2,
    parts_consumed_lines: 1,
  },
};
