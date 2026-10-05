/**
 * What the seeded shop history must produce (Phase 5; DATA-MODEL §18
 * "Phase 5 part"; TESTING.md "Seed data"). Every value here is worked out
 * by hand from the rows in supabase/seed.sql, never read from the database:
 * the views are tested against it, not the other way round.
 *
 * Days are counted back from the seed's anchor: the shop day `db:reset`
 * ran (Asia/Singapore, D35), read from REPORT_JOB.todayReceived's check-in
 * (tests/db/reporting-fixtures.ts seedToday(); E2E_SEED_ANCHOR in E2E).
 * Day 0 is the anchor. Money is a fixed-2 string (compare with money()),
 * counts are numbers.
 *
 * Recognition (D32): a non-voided line counts on the shop day of its job's
 * current completed_at; open and cancelled jobs never count. Cult Commons
 * is per line, max(yield, 0) x 0.3000 rounded half up to cents (D1), and a
 * day's or job's share is the sum of its lines' shares.
 *
 * Sales (Phase 6) are recognised at their recognized_at (DATA-MODEL §14),
 * every line at its snapshot: refunds are not netted and restocked lines
 * stay (D49). The consignment columns count the entries that sold
 * consigned stock (sales and completed jobs): consignment_sales = distinct
 * documents, consignment_sales_total = their sale total,
 * new_consignor_liability = Σ quantity x payout snapshot (D44, D46); 0 on
 * days without any.
 *
 * The contributions behind each day (H = Phase 5 cases, J = Phase 3 jobs,
 * T = Phase 5 jobs today, A = Phase 5 stock adjustments, S = Phase 6 sales):
 *
 *   day 6  checked in H1, J-000005; started H1; completed, ready H1;
 *          collected J-000001. Money H1: 200.00 / 0.00 / 200.00 / 60.00.
 *   day 5  checked in H2, J-000002; started H2; collected H1. H2's wheelset
 *          consumed (1 line, qty 1). Money S-000001 (2 consigned jerseys):
 *          140.00 / 70.00 / 70.00 / 21.00. Consignment 1 / 140.00 / 70.00.
 *   day 4  checked in H3, J-000008; started H3, J-000002; completed, ready
 *          H2; cancelled J-000008. H3's wheelset consumed. Money H2:
 *          800.00 / 400.00 / 400.00 / 120.00, S-000002 (2 shop-owned tubes;
 *          its 14.00 refund is not netted, D49) 28.00 / 12.00 / 16.00 /
 *          4.80.
 *   day 3  checked in H4, J-000004; started H4; completed, ready H3;
 *          collected H2. H4's tyre consumed. Money H3 (2 lines):
 *          1000.00 / 400.00 / 600.00 / 180.00, S-000003 (Daniel's consigned
 *          Cervélo, SPEC §10's consignment example) 1000.00 / 500.00 /
 *          500.00 / 150.00. Consignment 1 / 1000.00 / 500.00.
 *   day 2  checked in H5, H8, J-000003; started H5; completed, ready H4;
 *          collected H3; cancelled H8. A1. Money H4 (2 lines): 60.00 /
 *          35.00 / 25.00 / 12.00 (the tyre line yields -15.00 with share
 *          0.00, so not 7.50).
 *   day 1  checked in T2, J-000009; started J-000003, J-000004; completed
 *          H5, J-000002, J-000003; ready H5, J-000002; collected H4. A2
 *          (significant). Money H5 112.04 / 42.00 / 70.04 / 21.02 (21.00 +
 *          0.02, the 0.015 rounded half up), J-000002 300.00 / 124.00 /
 *          176.00 / 52.80, J-000003 90.00 / 5.00 / 85.00 / 25.50.
 *   day 0  checked in T1, T3, J-000007, J-000010; started T1, T2;
 *          completed, ready, collected T2. T2's chain and J-000010's tube
 *          and tyre consumed, the tyre returned (voided). A3. Money T2
 *          (2 lines): 165.00 / 22.00 / 143.00 / 42.90 (36.00 + 6.90),
 *          S-000004 (1 consigned jersey) 70.00 / 35.00 / 35.00 / 10.50.
 *          Consignment 1 / 70.00 / 35.00.
 *   Sale movements, intakes and the return are written at seed time, but
 *   none is a job consumption or a stock adjustment, so the parts and
 *   adjustment columns are unchanged.
 *
 * Appointments (Phase 2, D41: by scheduled shop day and CURRENT status;
 * scheduled = not cancelled, arrived = arrived/checked_in/completed):
 *   day 3  Tan's Tarmac, checked in as J-000014 and completed with it:
 *          scheduled 1, arrived 1.
 *   day 1  Daniel's Cannondale, a no-show: scheduled 1, no-show 1.
 *   day 0  Priya arrived, Hafiz confirmed, Chloe (online) and Nurul booked:
 *          scheduled 4, arrived 1.
 *   Days 2, 4, 5 and 6 have none; the cancelled and future ones fall after
 *   the anchor.
 */
import { REPORT_JOB, REPORT_PRODUCT, WORK_ORDER } from "./ids";

export type SeedDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const SEED_DAY_NUMBERS: readonly SeedDay[] = [0, 1, 2, 3, 4, 5, 6];

/** Every reporting.daily_summary column but `day` (columns 2-27), as public.daily_summary returns them to an admin. */
export type DayExpectation = {
  jobs_checked_in: number;
  jobs_started: number;
  jobs_completed: number;
  jobs_ready_for_collection: number;
  jobs_collected: number;
  jobs_cancelled: number;
  currency: "SGD";
  lines_recognised: number;
  gross_sales: string;
  cogs: string;
  yield_total: string;
  cult_commons_share: string;
  bicii_yield_after_cc: string;
  loss_lines: number;
  loss_total: string;
  parts_consumed_qty: number;
  parts_consumed_lines: number;
  parts_returned_qty: number;
  stock_adjustments: number;
  significant_stock_adjustments: number;
  appointments_scheduled: number;
  appointments_arrived: number;
  appointments_no_show: number;
  consignment_sales: number;
  consignment_sales_total: string;
  new_consignor_liability: string;
};

/** The money columns of DayExpectation (fixed-2 strings). */
export const DAY_MONEY_COLUMNS = [
  "gross_sales",
  "cogs",
  "yield_total",
  "cult_commons_share",
  "bicii_yield_after_cc",
  "loss_total",
  "consignment_sales_total",
  "new_consignor_liability",
] as const;

/** Phase 6's columns on a day without consigned sales. */
const NO_CONSIGNMENT = {
  consignment_sales: 0,
  consignment_sales_total: "0.00",
  new_consignor_liability: "0.00",
} as const;

/** D41 appointment counts of a day with no appointments. */
const NO_APPOINTMENTS = {
  appointments_scheduled: 0,
  appointments_arrived: 0,
  appointments_no_show: 0,
} as const;

export const SEED_DAYS: Record<SeedDay, DayExpectation> = {
  0: {
    jobs_checked_in: 4,
    jobs_started: 2,
    jobs_completed: 1,
    jobs_ready_for_collection: 1,
    jobs_collected: 1,
    jobs_cancelled: 0,
    currency: "SGD",
    lines_recognised: 3,
    gross_sales: "235.00",
    cogs: "57.00",
    yield_total: "178.00",
    cult_commons_share: "53.40",
    bicii_yield_after_cc: "124.60",
    loss_lines: 0,
    loss_total: "0.00",
    parts_consumed_qty: 3,
    parts_consumed_lines: 3,
    parts_returned_qty: 1,
    stock_adjustments: 1,
    significant_stock_adjustments: 0,
    appointments_scheduled: 4,
    appointments_arrived: 1,
    appointments_no_show: 0,
    consignment_sales: 1,
    consignment_sales_total: "70.00",
    new_consignor_liability: "35.00",
  },
  1: {
    jobs_checked_in: 2,
    jobs_started: 2,
    jobs_completed: 3,
    jobs_ready_for_collection: 2,
    jobs_collected: 1,
    jobs_cancelled: 0,
    currency: "SGD",
    lines_recognised: 6,
    gross_sales: "502.04",
    cogs: "171.00",
    yield_total: "331.04",
    cult_commons_share: "99.32",
    bicii_yield_after_cc: "231.72",
    loss_lines: 0,
    loss_total: "0.00",
    parts_consumed_qty: 0,
    parts_consumed_lines: 0,
    parts_returned_qty: 0,
    stock_adjustments: 1,
    significant_stock_adjustments: 1,
    appointments_scheduled: 1,
    appointments_arrived: 0,
    appointments_no_show: 1,
    ...NO_CONSIGNMENT,
  },
  2: {
    jobs_checked_in: 3,
    jobs_started: 1,
    jobs_completed: 1,
    jobs_ready_for_collection: 1,
    jobs_collected: 1,
    jobs_cancelled: 1,
    currency: "SGD",
    lines_recognised: 2,
    gross_sales: "60.00",
    cogs: "35.00",
    yield_total: "25.00",
    cult_commons_share: "12.00",
    bicii_yield_after_cc: "13.00",
    loss_lines: 1,
    loss_total: "-15.00",
    parts_consumed_qty: 0,
    parts_consumed_lines: 0,
    parts_returned_qty: 0,
    stock_adjustments: 1,
    significant_stock_adjustments: 0,
    ...NO_APPOINTMENTS,
    ...NO_CONSIGNMENT,
  },
  3: {
    jobs_checked_in: 2,
    jobs_started: 1,
    jobs_completed: 1,
    jobs_ready_for_collection: 1,
    jobs_collected: 1,
    jobs_cancelled: 0,
    currency: "SGD",
    lines_recognised: 3,
    gross_sales: "2000.00",
    cogs: "900.00",
    yield_total: "1100.00",
    cult_commons_share: "330.00",
    bicii_yield_after_cc: "770.00",
    loss_lines: 0,
    loss_total: "0.00",
    parts_consumed_qty: 1,
    parts_consumed_lines: 1,
    parts_returned_qty: 0,
    stock_adjustments: 0,
    significant_stock_adjustments: 0,
    appointments_scheduled: 1,
    appointments_arrived: 1,
    appointments_no_show: 0,
    consignment_sales: 1,
    consignment_sales_total: "1000.00",
    new_consignor_liability: "500.00",
  },
  4: {
    jobs_checked_in: 2,
    jobs_started: 2,
    jobs_completed: 1,
    jobs_ready_for_collection: 1,
    jobs_collected: 0,
    jobs_cancelled: 1,
    currency: "SGD",
    lines_recognised: 2,
    gross_sales: "828.00",
    cogs: "412.00",
    yield_total: "416.00",
    cult_commons_share: "124.80",
    bicii_yield_after_cc: "291.20",
    loss_lines: 0,
    loss_total: "0.00",
    parts_consumed_qty: 1,
    parts_consumed_lines: 1,
    parts_returned_qty: 0,
    stock_adjustments: 0,
    significant_stock_adjustments: 0,
    ...NO_APPOINTMENTS,
    ...NO_CONSIGNMENT,
  },
  5: {
    jobs_checked_in: 2,
    jobs_started: 1,
    jobs_completed: 0,
    jobs_ready_for_collection: 0,
    jobs_collected: 1,
    jobs_cancelled: 0,
    currency: "SGD",
    lines_recognised: 1,
    gross_sales: "140.00",
    cogs: "70.00",
    yield_total: "70.00",
    cult_commons_share: "21.00",
    bicii_yield_after_cc: "49.00",
    loss_lines: 0,
    loss_total: "0.00",
    parts_consumed_qty: 1,
    parts_consumed_lines: 1,
    parts_returned_qty: 0,
    stock_adjustments: 0,
    significant_stock_adjustments: 0,
    ...NO_APPOINTMENTS,
    consignment_sales: 1,
    consignment_sales_total: "140.00",
    new_consignor_liability: "70.00",
  },
  6: {
    jobs_checked_in: 2,
    jobs_started: 1,
    jobs_completed: 1,
    jobs_ready_for_collection: 1,
    jobs_collected: 1,
    jobs_cancelled: 0,
    currency: "SGD",
    lines_recognised: 1,
    gross_sales: "200.00",
    cogs: "0.00",
    yield_total: "200.00",
    cult_commons_share: "60.00",
    bicii_yield_after_cc: "140.00",
    loss_lines: 0,
    loss_total: "0.00",
    parts_consumed_qty: 0,
    parts_consumed_lines: 0,
    parts_returned_qty: 0,
    stock_adjustments: 0,
    significant_stock_adjustments: 0,
    ...NO_APPOINTMENTS,
    ...NO_CONSIGNMENT,
  },
};

export type JobExpectation = {
  id: string;
  /** Shop days before the anchor on which the job is recognised (its completed_at). */
  recognizedDaysAgo: SeedDay;
  line_count: number;
  sale_total: string;
  cost_total: string;
  yield_total: string;
  cult_commons_share: string;
  bicii_yield_after_cc: string;
  loss_line_count: number;
  loss_total: string;
};

/** The SPEC §10 worked examples as seeded (H1-H3), and H4's loss line (D1). */
export const SPEC_EXAMPLE_JOBS: Record<
  "serviceOnly" | "partsOnly" | "combined" | "lossLine",
  JobExpectation
> = {
  serviceOnly: {
    id: REPORT_JOB.serviceOnly,
    recognizedDaysAgo: 6,
    line_count: 1,
    sale_total: "200.00",
    cost_total: "0.00",
    yield_total: "200.00",
    cult_commons_share: "60.00",
    bicii_yield_after_cc: "140.00",
    loss_line_count: 0,
    loss_total: "0.00",
  },
  partsOnly: {
    id: REPORT_JOB.partsOnly,
    recognizedDaysAgo: 4,
    line_count: 1,
    sale_total: "800.00",
    cost_total: "400.00",
    yield_total: "400.00",
    cult_commons_share: "120.00",
    bicii_yield_after_cc: "280.00",
    loss_line_count: 0,
    loss_total: "0.00",
  },
  combined: {
    id: REPORT_JOB.combined,
    recognizedDaysAgo: 3,
    line_count: 2,
    sale_total: "1000.00",
    cost_total: "400.00",
    yield_total: "600.00",
    cult_commons_share: "180.00",
    bicii_yield_after_cc: "420.00",
    loss_line_count: 0,
    loss_total: "0.00",
  },
  lossLine: {
    id: REPORT_JOB.lossLine,
    recognizedDaysAgo: 2,
    line_count: 2,
    sale_total: "60.00",
    cost_total: "35.00",
    yield_total: "25.00",
    // 12.00 from the Wheel True line; the tyre line's -15.00 yields 0.00 (not 7.50).
    cult_commons_share: "12.00",
    bicii_yield_after_cc: "13.00",
    loss_line_count: 1,
    loss_total: "-15.00",
  },
};

/** The rounding case (H5), recognised yesterday. */
export const ROUNDING_JOB: JobExpectation = {
  id: REPORT_JOB.rounding,
  recognizedDaysAgo: 1,
  line_count: 2,
  sale_total: "112.04",
  cost_total: "42.00",
  yield_total: "70.04",
  // 21.00 (69.99 x 0.3 = 20.997) + 0.02 (0.05 x 0.3 = 0.015, half up).
  cult_commons_share: "21.02",
  bicii_yield_after_cc: "49.02",
  loss_line_count: 0,
  loss_total: "0.00",
};

/**
 * public.today_dashboard's *_now snapshot at the anchor, before any test
 * adds a job (D31; BOARD_GROUPS):
 *   received            J-000007, J-000009 (diagnosing), J-000010, T3
 *   waiting             J-000005, J-000006, H7
 *   in progress         J-000004, T1
 *   awaiting collection J-000002, J-000003, H5, H6
 *   overdue (D20)       J-000006 (checked in 8 days back), H7 (11)
 *   low stock           cableKit, hydraulicHose, sealant (Phase 4)
 *   exceptions (D34)    SEED_EXCEPTIONS
 * Tests that run after others have added rows assert "at least" these.
 */
export const SEED_SNAPSHOT = {
  received_now: 4,
  waiting_now: 3,
  ready_to_start_now: 0,
  in_progress_now: 2,
  awaiting_collection_now: 4,
  open_jobs_now: 9,
  overdue_now: 2,
  low_stock_now: 3,
  exceptions_now: 3,
} as const;

/**
 * public.operational_exceptions at the anchor: H7 and J-000006 overdue,
 * H6 uncollected (ready 9 days). Not H5, J-000002 or J-000003 (completed
 * yesterday, under the 7-day line).
 */
export const SEED_EXCEPTIONS: ReadonlyArray<{ kind: string; entity_id: string }> = [
  { kind: "overdue_job", entity_id: REPORT_JOB.overdue },
  { kind: "overdue_job", entity_id: WORK_ORDER.danielCannondaleAwaitingCustomer },
  { kind: "uncollected_job", entity_id: REPORT_JOB.uncollected },
];

export type AdjustmentExpectation = {
  product_id: string;
  daysAgo: SeedDay;
  movement_type: "stock_adjustment" | "damaged";
  quantity_delta: number;
  reason: string;
  /** D33: |delta| >= 5, a unit, or |delta| x unit cost >= 100.00. */
  significant: boolean;
  /** |delta| x the cost snapshot (view_costs only). */
  value_at_cost: string;
};

/** The seeded stock adjustments by Asha Admin on the Phase 5 products (Shop floor). */
export const SEED_ADJUSTMENTS: Record<"A1" | "A2" | "A3", AdjustmentExpectation> = {
  A1: {
    product_id: REPORT_PRODUCT.brakePads,
    daysAgo: 2,
    movement_type: "stock_adjustment",
    quantity_delta: -1,
    reason: "Damaged packaging, written off",
    significant: false,
    value_at_cost: "15.00",
  },
  A2: {
    product_id: REPORT_PRODUCT.innerTube,
    daysAgo: 1,
    movement_type: "damaged",
    quantity_delta: -6,
    reason: "Water damage in storage",
    significant: true,
    value_at_cost: "30.00",
  },
  A3: {
    product_id: REPORT_PRODUCT.co2,
    daysAgo: 0,
    movement_type: "stock_adjustment",
    quantity_delta: 2,
    reason: "Recount found two in the workshop drawer",
    significant: false,
    value_at_cost: "6.00",
  },
};
