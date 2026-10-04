/**
 * Cult Commons fixtures (SPEC §10; PLAN D1; TESTING.md "Cult Commons
 * formula"). Run through src/lib/cult-commons.ts (tests/unit) AND through
 * the database's generated columns and work_order_totals_staff
 * (tests/db/work-order-lines.test.ts), so the preview and the stored
 * figures can never disagree. Every value was worked out by hand:
 * sale = round(q × price, 2), cost = round(q × cost, 2), yield = sale − cost,
 * cc = round(max(yield, 0) × rate, 2), afterCc = yield − cc.
 */

export type LineFixture = {
  name: string;
  quantity: string;
  unitSalePrice: string;
  unitDirectCost: string;
  rate: string;
  sale: string;
  cost: string;
  yield: string;
  cc: string;
  afterCc: string;
};

export const LINE_FIXTURES: readonly LineFixture[] = [
  {
    name: "SPEC: $200 service with no direct cost -> $60 Cult Commons",
    quantity: "1",
    unitSalePrice: "200.00",
    unitDirectCost: "0.00",
    rate: "0.3",
    sale: "200.00",
    cost: "0.00",
    yield: "200.00",
    cc: "60.00",
    afterCc: "140.00",
  },
  {
    name: "SPEC: $800 parts costing $400 -> $120 Cult Commons",
    quantity: "1",
    unitSalePrice: "800.00",
    unitDirectCost: "400.00",
    rate: "0.3",
    sale: "800.00",
    cost: "400.00",
    yield: "400.00",
    cc: "120.00",
    afterCc: "280.00",
  },
  {
    name: "SPEC: $1,000 consignment bike, $500 owed to the consignor (a direct cost) -> $150",
    quantity: "1",
    unitSalePrice: "1000.00",
    unitDirectCost: "500.00",
    rate: "0.3",
    sale: "1000.00",
    cost: "500.00",
    yield: "500.00",
    cc: "150.00",
    afterCc: "350.00",
  },
  {
    name: "a loss is reported and creates no negative share",
    quantity: "1",
    unitSalePrice: "50.00",
    unitDirectCost: "80.00",
    rate: "0.3",
    sale: "50.00",
    cost: "80.00",
    yield: "-30.00",
    cc: "0.00",
    afterCc: "-30.00",
  },
  {
    name: "fractional quantity (1.5 hours of labour)",
    quantity: "1.5",
    unitSalePrice: "60.00",
    unitDirectCost: "0.00",
    rate: "0.3",
    sale: "90.00",
    cost: "0.00",
    yield: "90.00",
    cc: "27.00",
    afterCc: "63.00",
  },
  {
    name: "half-up rounding of the share (30.015 -> 30.02)",
    quantity: "3",
    unitSalePrice: "33.35",
    unitDirectCost: "0.00",
    rate: "0.3",
    sale: "100.05",
    cost: "0.00",
    yield: "100.05",
    cc: "30.02",
    afterCc: "70.03",
  },
  {
    name: "per-line rounding of sale and cost before yield (3.3033 -> 3.30)",
    quantity: "0.33",
    unitSalePrice: "10.01",
    unitDirectCost: "3.00",
    rate: "0.3",
    sale: "3.30",
    cost: "0.99",
    yield: "2.31",
    cc: "0.69",
    afterCc: "1.62",
  },
  {
    name: "another rate (25%) applies to lines snapshotted under it",
    quantity: "1",
    unitSalePrice: "100.00",
    unitDirectCost: "20.00",
    rate: "0.25",
    sale: "100.00",
    cost: "20.00",
    yield: "80.00",
    cc: "20.00",
    afterCc: "60.00",
  },
  {
    name: "zero yield, zero share",
    quantity: "1",
    unitSalePrice: "40.00",
    unitDirectCost: "40.00",
    rate: "0.3",
    sale: "40.00",
    cost: "40.00",
    yield: "0.00",
    cc: "0.00",
    afterCc: "0.00",
  },
];

export type JobFixture = {
  name: string;
  /** Indexes into LINE_FIXTURES. */
  lines: readonly number[];
  sale: string;
  cost: string;
  yield: string;
  cc: string;
  afterCc: string;
};

export const JOB_FIXTURES: readonly JobFixture[] = [
  {
    name: "SPEC: combined $1,000 job with $400 cost -> $600 yield -> $180 Cult Commons",
    lines: [0, 1],
    sale: "1000.00",
    cost: "400.00",
    yield: "600.00",
    cc: "180.00",
    afterCc: "420.00",
  },
  {
    name: "D1: a loss-making line contributes 0 and does not offset the others (180.00, not 171.00)",
    lines: [0, 1, 3],
    sale: "1050.00",
    cost: "480.00",
    yield: "570.00",
    cc: "180.00",
    afterCc: "390.00",
  },
];
