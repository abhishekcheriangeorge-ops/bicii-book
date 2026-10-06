/**
 * Fixed IDs from supabase/seed.sql. Tests reference seeded rows by these
 * IDs, never by name (TESTING.md "Seed data"). Keep in sync with the seed.
 */

/** auth.users.id of each seeded login. */
export const AUTH_USER = {
  admin: "a0000000-0000-4000-8000-000000000001",
  mechanic1: "a0000000-0000-4000-8000-000000000002",
  mechanic2: "a0000000-0000-4000-8000-000000000003",
  manager: "a0000000-0000-4000-8000-000000000004",
} as const;

/**
 * public.staff.id (D90). admin: role admin. manager: role manager, no
 * exceptions. mechanic1: role mechanic, view_costs as an exception.
 * mechanic2: role mechanic, no exceptions.
 */
export const STAFF = {
  admin: "5a000000-0000-4000-8000-000000000001",
  mechanic1: "5a000000-0000-4000-8000-000000000002",
  mechanic2: "5a000000-0000-4000-8000-000000000003",
  manager: "5a000000-0000-4000-8000-000000000004",
} as const;

export const STAFF_EMAIL = {
  admin: "admin@bicii.test",
  mechanic1: "mechanic1@bicii.test",
  mechanic2: "mechanic2@bicii.test",
  manager: "manager@bicii.test",
} as const;

export type SeedStaff = keyof typeof STAFF;

/**
 * public.customers.id (Phase 1). Only chloe has a login (Phase 2,
 * CUSTOMER_LOGIN); other tests that act as a customer create an Auth user
 * and link it (tests/db/customer-fixtures.ts), never to chloe. tan and
 * daniel have internal_notes; nurul has no email.
 */
export const CUSTOMER = {
  tan: "c1000000-0000-4000-8000-000000000001",
  priya: "c1000000-0000-4000-8000-000000000002",
  hafiz: "c1000000-0000-4000-8000-000000000003",
  chloe: "c1000000-0000-4000-8000-000000000004",
  daniel: "c1000000-0000-4000-8000-000000000005",
  nurul: "c1000000-0000-4000-8000-000000000006",
} as const;

export type SeedCustomer = keyof typeof CUSTOMER;

/**
 * public.bikes.id (Phase 1). Owner in the key; shopCervelo has no owner.
 * nurulBianchi was registered to daniel and then transferred to nurul.
 * Phase 4 adds three shop bikes without an owner, each in stock as a unique
 * unit (UNIT): shopColnago, shopBrompton, shopSurly. Phase 5 adds four
 * customers' bikes for its jobs (REPORT_JOB), so no bike has two open jobs
 * at once: chloeDiverge (H2, T2, T3 in turn), danielEndurace (H3, T1),
 * priyaCervelo (H7) and hafizDahon (H8).
 */
export const BIKE = {
  tanTarmac: "b1000000-0000-4000-8000-000000000001",
  tanBrompton: "b1000000-0000-4000-8000-000000000002",
  priyaDomane: "b1000000-0000-4000-8000-000000000003",
  priyaTern: "b1000000-0000-4000-8000-000000000004",
  hafizBrompton: "b1000000-0000-4000-8000-000000000005",
  chloeGiant: "b1000000-0000-4000-8000-000000000006",
  chloeSurly: "b1000000-0000-4000-8000-000000000007",
  danielCannondale: "b1000000-0000-4000-8000-000000000008",
  nurulBianchi: "b1000000-0000-4000-8000-000000000009",
  shopCervelo: "b1000000-0000-4000-8000-000000000010",
  shopColnago: "b1000000-0000-4000-8000-000000000011",
  shopBrompton: "b1000000-0000-4000-8000-000000000012",
  shopSurly: "b1000000-0000-4000-8000-000000000013",
  chloeDiverge: "b1000000-0000-4000-8000-000000000014",
  danielEndurace: "b1000000-0000-4000-8000-000000000015",
  priyaCervelo: "b1000000-0000-4000-8000-000000000016",
  hafizDahon: "b1000000-0000-4000-8000-000000000017",
} as const;

export type SeedBike = keyof typeof BIKE;

/**
 * Short IDs the database assigned to the seeded bikes, in insert order on
 * a freshly built database (private.next_short_id('B')).
 */
export const BIKE_SHORT_ID: Record<SeedBike, string> = {
  tanTarmac: "B-000001",
  tanBrompton: "B-000002",
  priyaDomane: "B-000003",
  priyaTern: "B-000004",
  hafizBrompton: "B-000005",
  chloeGiant: "B-000006",
  chloeSurly: "B-000007",
  danielCannondale: "B-000008",
  nurulBianchi: "B-000009",
  shopCervelo: "B-000010",
  shopColnago: "B-000011",
  shopBrompton: "B-000012",
  shopSurly: "B-000013",
  chloeDiverge: "B-000014",
  danielEndurace: "B-000015",
  priyaCervelo: "B-000016",
  hafizDahon: "B-000017",
};

/** Serial numbers as entered in the seed (chloeSurly has none). */
export const BIKE_SERIAL = {
  tanTarmac: "WSBC604123456N",
  priyaDomane: "WTU291C1234K",
  priyaTern: "TRN-19-0045821",
  shopCervelo: "CV-CAL5-0921",
  shopColnago: "COL-C64-11873",
  shopBrompton: "2209183344",
  shopSurly: "SRY-BC-55102",
} as const;

/**
 * The base Cult Commons rate row (0.3000 from 1970-01-01), shipped by the
 * workshop catalog migration rather than the seed: production needs it.
 */
export const CULT_COMMONS_BASE_RATE = "cc000000-0000-4000-8000-000000000001";

/** public.categories.id (Phase 3): the five service categories, sort_order 1..5. */
export const CATEGORY = {
  servicing: "ca000000-0000-4000-8000-000000000001",
  wheelsAndTyres: "ca000000-0000-4000-8000-000000000002",
  brakes: "ca000000-0000-4000-8000-000000000003",
  builds: "ca000000-0000-4000-8000-000000000004",
  labour: "ca000000-0000-4000-8000-000000000005",
} as const;

/**
 * public.services.id (Phase 3), SGD, price / default direct cost:
 * basicService 80/0, fullService 200/0, wheelTrue 35/0 (per wheel),
 * tyreInstallation 15/0 (per tyre), brakeBleed 45/8 (per brake),
 * drivetrainService 90/5, bikeBuild 250/0, customLabour 60/0 (per hour,
 * not public), forkServiceArchived 120/25 (inactive, archived 30 days ago).
 */
export const SERVICE = {
  basicService: "5e000000-0000-4000-8000-000000000001",
  fullService: "5e000000-0000-4000-8000-000000000002",
  wheelTrue: "5e000000-0000-4000-8000-000000000003",
  tyreInstallation: "5e000000-0000-4000-8000-000000000004",
  brakeBleed: "5e000000-0000-4000-8000-000000000005",
  drivetrainService: "5e000000-0000-4000-8000-000000000006",
  bikeBuild: "5e000000-0000-4000-8000-000000000007",
  customLabour: "5e000000-0000-4000-8000-000000000008",
  forkServiceArchived: "5e000000-0000-4000-8000-000000000009",
} as const;

/**
 * public.work_orders.id (Phase 3): bike and status in the key, inserted in
 * this order (JOB_NUMBER). Every timeline is dated on the nine shop days
 * before the reset day (pg_temp.seed_at, 10:00 local time plus offsets) so
 * it reads true (DATA-MODEL §18 "Phase 3 part"); hafizBromptonCompleted
 * was started at 10:00 and completed at 16:00 the day before the reset.
 * danielCannondaleAwaitingCustomer is Phase 3's one overdue job (D20:
 * open, checked in 8 days ago; Phase 5's REPORT_JOB.overdue is the other);
 * nurulBianchiReceived was checked in at seed time, after the Bianchi's
 * sale to Nurul.
 */
export const WORK_ORDER = {
  tanTarmacCollected: "f1000000-0000-4000-8000-000000000001",
  priyaDomaneReady: "f1000000-0000-4000-8000-000000000002",
  hafizBromptonCompleted: "f1000000-0000-4000-8000-000000000003",
  chloeGiantInProgress: "f1000000-0000-4000-8000-000000000004",
  chloeSurlyAwaitingParts: "f1000000-0000-4000-8000-000000000005",
  danielCannondaleAwaitingCustomer: "f1000000-0000-4000-8000-000000000006",
  nurulBianchiReceived: "f1000000-0000-4000-8000-000000000007",
  tanBromptonCancelled: "f1000000-0000-4000-8000-000000000008",
  priyaTernDiagnosing: "f1000000-0000-4000-8000-000000000009",
} as const;

export type SeedWorkOrder = keyof typeof WORK_ORDER;

/**
 * Job numbers the database assigned to the seeded jobs, in insert order on
 * a freshly built database (private.next_short_id('J')).
 */
export const JOB_NUMBER: Record<SeedWorkOrder, string> = {
  tanTarmacCollected: "J-000001",
  priyaDomaneReady: "J-000002",
  hafizBromptonCompleted: "J-000003",
  chloeGiantInProgress: "J-000004",
  chloeSurlyAwaitingParts: "J-000005",
  danielCannondaleAwaitingCustomer: "J-000006",
  nurulBianchiReceived: "J-000007",
  tanBromptonCancelled: "J-000008",
  priyaTernDiagnosing: "J-000009",
};

/**
 * public.work_order_line_items.id (Phase 3), job in the key. All at the
 * 0.3000 Cult Commons rate. priyaTernBottomBracket (manual, 45.00, cost
 * 28.00) is voided; priyaDomaneTyres is the manual GP5000 line (2 x 95.00,
 * cost 62.00 each).
 */
export const LINE = {
  tanTarmacFullService: "f2000000-0000-4000-8000-000000000001",
  tanTarmacBrakeBleed: "f2000000-0000-4000-8000-000000000002",
  priyaDomaneBasicService: "f2000000-0000-4000-8000-000000000003",
  priyaDomaneTyreInstallation: "f2000000-0000-4000-8000-000000000004",
  priyaDomaneTyres: "f2000000-0000-4000-8000-000000000005",
  hafizBromptonDrivetrain: "f2000000-0000-4000-8000-000000000006",
  chloeGiantWheelTrue: "f2000000-0000-4000-8000-000000000007",
  chloeSurlyLabour: "f2000000-0000-4000-8000-000000000008",
  priyaTernBasicService: "f2000000-0000-4000-8000-000000000009",
  priyaTernBottomBracket: "f2000000-0000-4000-8000-000000000010",
} as const;

/**
 * public.locations.id (Phase 4). shopFloor is the inventory migration's
 * one-shop bootstrap (sort 10, so the default location); workshopStore is
 * seeded (sort 20).
 */
export const LOCATION = {
  shopFloor: "1c000000-0000-4000-8000-000000000001",
  workshopStore: "1c000000-0000-4000-8000-000000000002",
} as const;

/** public.categories.id (Phase 4): the seven product categories, sort_order 1..7. */
export const PRODUCT_CATEGORY = {
  brakes: "ca000000-0000-4000-8000-000000000006",
  tyresAndTubes: "ca000000-0000-4000-8000-000000000007",
  drivetrain: "ca000000-0000-4000-8000-000000000008",
  cablesAndHoses: "ca000000-0000-4000-8000-000000000009",
  care: "ca000000-0000-4000-8000-000000000010",
  cockpit: "ca000000-0000-4000-8000-000000000011",
  bikes: "ca000000-0000-4000-8000-000000000012",
} as const;

/**
 * public.products.id (Phase 4), inserted in this order (PRODUCT_SHORT_ID),
 * with their opening stock and units dated 30 days before the reset day.
 * SGD price / default direct cost, reorder point; internal_only except
 * cassette (draft); chainX10Archived is archived with no stock. colnago,
 * brompton and surly are unique-tracked (one unit each, UNIT); the rest are
 * counted.
 *
 * On-hand after the seed (reporting.stock_levels; SF = Shop floor, WS =
 * Workshop store):
 *   brakePads 34 SF; gp5000Tyre 12 SF; roadTube 40 SF + 20 WS;
 *   marathonRacer 6 SF (one consumed by INVENTORY_JOB, then reversed);
 *   bromptonTube 12 SF (15 opening, one on INVENTORY_JOB, two sold on
 *   Phase 6's S-000002); chainX11 26 SF (8 opening + 18 received on
 *   PO-000002, Phase 7); cassette 7 SF (3 + 4 received on PO-000001);
 *   cableKit 2 SF (low, reorder 4); hydraulicHose 1 SF (low, reorder 5);
 *   chainLube 28 SF (18 + 10 received on PO-000002); barTape 7 SF;
 *   sealant 1 SF + 1 WS (low,
 *   reorder 3); colnago, brompton, surly 1 SF each (their units);
 *   chainX10Archived none.
 * reporting.low_stock lists exactly cableKit, hydraulicHose and sealant.
 */
export const PRODUCT = {
  brakePads: "9a000000-0000-4000-8000-000000000001",
  gp5000Tyre: "9a000000-0000-4000-8000-000000000002",
  roadTube: "9a000000-0000-4000-8000-000000000003",
  marathonRacer: "9a000000-0000-4000-8000-000000000004",
  bromptonTube: "9a000000-0000-4000-8000-000000000005",
  chainX11: "9a000000-0000-4000-8000-000000000006",
  cassette: "9a000000-0000-4000-8000-000000000007",
  cableKit: "9a000000-0000-4000-8000-000000000008",
  hydraulicHose: "9a000000-0000-4000-8000-000000000009",
  chainLube: "9a000000-0000-4000-8000-000000000010",
  barTape: "9a000000-0000-4000-8000-000000000011",
  sealant: "9a000000-0000-4000-8000-000000000012",
  colnago: "9a000000-0000-4000-8000-000000000013",
  brompton: "9a000000-0000-4000-8000-000000000014",
  surly: "9a000000-0000-4000-8000-000000000015",
  chainX10Archived: "9a000000-0000-4000-8000-000000000016",
} as const;

export type SeedProduct = keyof typeof PRODUCT;

/** Short IDs the database assigned to the seeded products, in insert order. */
export const PRODUCT_SHORT_ID: Record<SeedProduct, string> = {
  brakePads: "P-000001",
  gp5000Tyre: "P-000002",
  roadTube: "P-000003",
  marathonRacer: "P-000004",
  bromptonTube: "P-000005",
  chainX11: "P-000006",
  cassette: "P-000007",
  cableKit: "P-000008",
  hydraulicHose: "P-000009",
  chainLube: "P-000010",
  barTape: "P-000011",
  sealant: "P-000012",
  colnago: "P-000013",
  brompton: "P-000014",
  surly: "P-000015",
  chainX10Archived: "P-000016",
};

/**
 * public.inventory_units.id (Phase 4): one available unit per unique
 * product, at the Shop floor, linked to its shop bike (BIKE.shopColnago,
 * shopBrompton, shopSurly); direct costs 4200.00 / 1400.00 / 1100.00.
 */
export const UNIT = {
  colnago: "9b000000-0000-4000-8000-000000000001",
  brompton: "9b000000-0000-4000-8000-000000000002",
  surly: "9b000000-0000-4000-8000-000000000003",
} as const;

export const UNIT_SHORT_ID: Record<keyof typeof UNIT, string> = {
  colnago: "U-000001",
  brompton: "U-000002",
  surly: "U-000003",
};

/**
 * The open inventory job (Phase 4): Hafiz's Brompton (BIKE.hafizBrompton),
 * lead Asha Admin, status received. Kept out of WORK_ORDER / JOB_NUMBER,
 * which list Phase 3's nine jobs exactly.
 */
export const INVENTORY_JOB = {
  id: "9e000000-0000-4000-8000-000000000001",
  jobNumber: "J-000010",
} as const;

/**
 * Its lines: bromptonTube is live (1 x 14.00 from the Shop floor);
 * marathonRacerVoided was voided ("Customer brought their own tyre"), so
 * its job_consumption movement has a linked reversal.
 */
export const SEED_LINE = {
  bromptonTube: "9d000000-0000-4000-8000-000000000001",
  marathonRacerVoided: "9d000000-0000-4000-8000-000000000002",
} as const;

/**
 * public.work_orders.id (Phase 5): the reporting cases, inserted in this
 * order (REPORT_JOB_NUMBER). Every time is relative to the shop day the
 * seed ran (the anchor, day 0; DATA-MODEL §18 "Phase 5 part"); the figures
 * they produce are in tests/fixtures/reporting.ts. Kept out of WORK_ORDER /
 * JOB_NUMBER, which list Phase 3's nine jobs exactly.
 *
 *   serviceOnly      H1  Tan's Brompton, Full Service 200.00; completed and
 *                        ready day 6, collected day 5 (SPEC §10 example 1).
 *   partsOnly        H2  Chloe's Diverge, wheelset 800.00 / 400.00; completed
 *                        day 4, collected day 3 (example 2).
 *   combined         H3  Daniel's Endurace, Full Service + wheelset;
 *                        completed day 3, collected day 2 (example 3).
 *   lossLine         H4  Tan's Tarmac, Wheel True 40.00 + tyre 20.00 at a
 *                        35.00 cost; completed day 2, collected day 1 (D1).
 *   rounding         H5  Tan's Brompton, manual 3 x 33.33 / 10.00 and
 *                        1 x 12.05 / 12.00; completed day 1, ready, not
 *                        collected.
 *   uncollected      H6  Priya's Tern, ready since day 9 (uncollected_job).
 *   overdue          H7  Priya's Cervelo, checked in day 11, awaiting parts
 *                        (overdue_job, D20); never recognised.
 *   cancelled        H8  Hafiz's Dahon, cancelled day 2, no lines.
 *   todayInProgress  T1  Daniel's Endurace, in progress today (open).
 *   todayCollected   T2  Chloe's Diverge, checked in day 1, collected today.
 *   todayReceived    T3  Chloe's Diverge again after T2's collection,
 *                        received today: its checked_in_at is the seed's
 *                        anchor day (seedToday()).
 *
 * Leads: Marcus (mechanic1) on H1, H3, H4, H7, T1, T2; Nur (mechanic2) on
 * H2, H5, H6, H8, T3.
 */
export const REPORT_JOB = {
  serviceOnly: "d5000000-0000-4000-8000-000000000001",
  partsOnly: "d5000000-0000-4000-8000-000000000002",
  combined: "d5000000-0000-4000-8000-000000000003",
  lossLine: "d5000000-0000-4000-8000-000000000004",
  rounding: "d5000000-0000-4000-8000-000000000005",
  uncollected: "d5000000-0000-4000-8000-000000000006",
  overdue: "d5000000-0000-4000-8000-000000000007",
  cancelled: "d5000000-0000-4000-8000-000000000008",
  todayInProgress: "d5000000-0000-4000-8000-000000000009",
  todayCollected: "d5000000-0000-4000-8000-000000000010",
  todayReceived: "d5000000-0000-4000-8000-000000000011",
} as const;

export type ReportJob = keyof typeof REPORT_JOB;

/** Job numbers of the Phase 5 jobs, in insert order after J-000010. */
export const REPORT_JOB_NUMBER: Record<ReportJob, string> = {
  serviceOnly: "J-000011",
  partsOnly: "J-000012",
  combined: "J-000013",
  lossLine: "J-000014",
  rounding: "J-000015",
  uncollected: "J-000016",
  overdue: "J-000017",
  cancelled: "J-000018",
  todayInProgress: "J-000019",
  todayCollected: "J-000020",
  todayReceived: "J-000021",
};

/**
 * public.work_order_line_items.id (Phase 5), job in the key; all at the
 * 0.3000 rate, sale / cost per unit. Inventory lines (wheelset, tyre,
 * chain) each have exactly one job_consumption movement at their time.
 */
export const REPORT_LINE = {
  serviceOnlyFullService: "d5100000-0000-4000-8000-000000000001", // 1 x 200.00 / 0.00
  partsOnlyWheelset: "d5100000-0000-4000-8000-000000000002", // 1 x 800.00 / 400.00
  combinedFullService: "d5100000-0000-4000-8000-000000000003", // 1 x 200.00 / 0.00
  combinedWheelset: "d5100000-0000-4000-8000-000000000004", // 1 x 800.00 / 400.00
  lossLineWheelTrue: "d5100000-0000-4000-8000-000000000005", // 1 x 40.00 / 0.00
  lossLineTyre: "d5100000-0000-4000-8000-000000000006", // 1 x 20.00 / 35.00 (loss)
  roundingRackKit: "d5100000-0000-4000-8000-000000000007", // manual 3 x 33.33 / 10.00
  roundingBell: "d5100000-0000-4000-8000-000000000008", // manual 1 x 12.05 / 12.00
  uncollectedLabour: "d5100000-0000-4000-8000-000000000009", // 1 x 120.00 / 0.00
  overdueBuild: "d5100000-0000-4000-8000-000000000010", // 1 x 150.00 / 0.00
  todayInProgressDrivetrain: "d5100000-0000-4000-8000-000000000011", // 1 x 90.00 / 10.00
  todayCollectedDrivetrain: "d5100000-0000-4000-8000-000000000012", // 1 x 120.00 / 0.00
  todayCollectedChain: "d5100000-0000-4000-8000-000000000013", // 1 x 45.00 / 22.00
} as const;

/**
 * public.products.id (Phase 5): quantity products at the Shop floor, so
 * Phase 4's on-hand figures are untouched. Opening stock 30 days back;
 * price / default direct cost, reorder point, on-hand after the seed:
 *   wheelset  849.00 / 400.00, reorder 1, 4 opening - H2 - H3 = 2
 *   tyre       95.00 /  35.00, reorder 2, 6 - H4 = 5
 *   chain      45.00 /  22.00, reorder 3, 10 - T2 = 9
 *   brakePads  32.00 /  15.00, reorder 5, 20 - A1 = 19
 *   innerTube  12.00 /   5.00, reorder 10, 30 - A2 (6, damaged) = 24
 *   co2        6.00 /   3.00, no reorder point, 10 + A3 = 12
 * None is low, so reporting.low_stock still lists exactly cableKit,
 * hydraulicHose and sealant.
 */
export const REPORT_PRODUCT = {
  wheelset: "d5300000-0000-4000-8000-000000000001",
  tyre: "d5300000-0000-4000-8000-000000000002",
  chain: "d5300000-0000-4000-8000-000000000003",
  brakePads: "d5300000-0000-4000-8000-000000000004",
  innerTube: "d5300000-0000-4000-8000-000000000005",
  co2: "d5300000-0000-4000-8000-000000000006",
} as const;

export type ReportProduct = keyof typeof REPORT_PRODUCT;

export const REPORT_PRODUCT_SHORT_ID: Record<ReportProduct, string> = {
  wheelset: "P-000017",
  tyre: "P-000018",
  chain: "P-000019",
  brakePads: "P-000020",
  innerTube: "P-000021",
  co2: "P-000022",
};

/** public.categories.id (Phase 5): the 'Wheels' product category, sort_order 8. */
export const REPORT_PRODUCT_CATEGORY = {
  wheels: "ca000000-0000-4000-8000-000000000013",
} as const;

// ---------------------------------------------------------------------------
// Phase 2: the schedule and appointments (supabase/seed.sql "Phase 2").
// Days are counted from the shop day the seed ran (the anchor, as in
// tests/fixtures/reporting.ts); "Tue-Fri >= n" is the first Tuesday-Friday
// at least n days ahead.
// ---------------------------------------------------------------------------

/**
 * public.shop_hours.id (0 = Sunday, as extract(dow)): Monday is one
 * INACTIVE row (closed, hours remembered); Tuesday-Friday 10:00-19:00; a
 * split Saturday (09:00-12:30 and 13:30-18:00); Sunday 09:00-13:00.
 */
export const SHOP_HOURS = {
  mondayInactive: "e3000000-0000-4000-8000-000000000001",
  tuesday: "e3000000-0000-4000-8000-000000000002",
  wednesday: "e3000000-0000-4000-8000-000000000003",
  thursday: "e3000000-0000-4000-8000-000000000004",
  friday: "e3000000-0000-4000-8000-000000000005",
  saturdayMorning: "e3000000-0000-4000-8000-000000000006",
  saturdayAfternoon: "e3000000-0000-4000-8000-000000000007",
  sunday: "e3000000-0000-4000-8000-000000000008",
} as const;

/**
 * public.appointment_types.id: serviceDropOff (30 min, 1 unit, public, sort
 * 1), repairAssessment (30 min, 1 unit, public, 2), buildConsultation
 * ("Custom build consultation", 60 min, 2 units, public, 3) and
 * warrantyInspection (30 min, 1 unit, staff-only, 4). All active.
 */
export const APPOINTMENT_TYPE = {
  serviceDropOff: "e1000000-0000-4000-8000-000000000001",
  repairAssessment: "e1000000-0000-4000-8000-000000000002",
  buildConsultation: "e1000000-0000-4000-8000-000000000003",
  warrantyInspection: "e1000000-0000-4000-8000-000000000004",
} as const;

/**
 * public.closure_overrides.id: taipeiShow = closed the whole first
 * Wednesday at least 7 days ahead ("Team at the Taipei Cycle show");
 * stocktake = custom hours 12:00-16:00 on the first Thursday at least 8 days
 * ahead ("Short day for stocktake"). Both within 14 days.
 */
export const CLOSURE = {
  taipeiShow: "e4000000-0000-4000-8000-000000000001",
  stocktake: "e4000000-0000-4000-8000-000000000002",
} as const;

/**
 * public.appointments.id (D41 counts by scheduled day and current status):
 *   tanTarmacCompleted   day -3 10:00 Repair assessment, Tan's Tarmac;
 *                        checked in at J-000014's check-in, linked to it
 *                        (REPORT_JOB.lossLine, D40) and completed at its
 *                        completed_at (D36).
 *   danielNoShow         day -1 11:00 Service drop-off, Daniel's Cannondale;
 *                        no_show (11:20).
 *   priyaArrived         today 10:00 Service drop-off, Priya's Domane;
 *                        arrived, not checked in.
 *   hafizConfirmed       today 10:30 Repair assessment, Hafiz's Brompton;
 *                        confirmed (J-000010 is open on that bike).
 *   chloeGiantOnline     today 15:00 Service drop-off, Chloe's Giant;
 *                        booked online (source customer), with a note.
 *   nurulBooked          today 16:00 Repair assessment, Nurul's Bianchi;
 *                        booked.
 *   tanBromptonConfirmed Tue-Fri >= 1 day ahead 11:00 Service drop-off,
 *                        Tan's Brompton; confirmed.
 *   priyaTernCancelled   Tue-Fri >= 3 days ahead 10:00 Repair assessment,
 *                        Priya's Tern; cancelled by staff ("Customer
 *                        travelling").
 *   chloeSurlyOnline     Tue-Fri >= 5 days ahead 14:00 Custom build
 *                        consultation, Chloe's Surly; booked online.
 * Every other one was booked by Asha Admin. Daniel has no upcoming booked
 * or confirmed appointment.
 */
export const APPOINTMENT = {
  tanTarmacCompleted: "e2000000-0000-4000-8000-000000000001",
  danielNoShow: "e2000000-0000-4000-8000-000000000002",
  priyaArrived: "e2000000-0000-4000-8000-000000000003",
  hafizConfirmed: "e2000000-0000-4000-8000-000000000004",
  chloeGiantOnline: "e2000000-0000-4000-8000-000000000005",
  nurulBooked: "e2000000-0000-4000-8000-000000000006",
  tanBromptonConfirmed: "e2000000-0000-4000-8000-000000000007",
  priyaTernCancelled: "e2000000-0000-4000-8000-000000000008",
  chloeSurlyOnline: "e2000000-0000-4000-8000-000000000009",
} as const;

export type SeedAppointment = keyof typeof APPOINTMENT;

/**
 * The one seeded customer login (Phase 2): Chloe Lim, linked to
 * CUSTOMER.chloe (E2E journey 2, customer-access tests). Like the staff
 * logins she has no usable password (PLAN D10): tests sign her in with an
 * email code (tests/e2e/api.ts signInApi). Tests must not link another login to CUSTOMER.chloe.
 */
export const CUSTOMER_LOGIN = {
  chloe: {
    authUserId: "a0000000-0000-4000-8000-000000000101",
    email: "chloe.lim@example.com",
  },
} as const;

// ---------------------------------------------------------------------------
// Phase 6: consignment and sales (supabase/seed.sql "Phase 6"). Written
// through the RPCs as the admin; days are counted from the seed's anchor as
// in tests/fixtures/reporting.ts. Short IDs are those of a freshly built
// database (C-000001 .. C-000004, S-000001 .. S-000004; the intake products
// P-000023 .. P-000026 and units U-000004 .. U-000006).
// ---------------------------------------------------------------------------

/**
 * public.consignors.id: kelvin (no customer record, phone +65 9876 5432,
 * payout "PayNow +65 9876 5432"), daniel (CUSTOMER.daniel, his email and
 * phone, payout "PayNow +65 9567 8901"), chloe (CUSTOMER.chloe, payout
 * "Bank transfer, details on the signed agreement", internal notes).
 */
export const CONSIGNOR = {
  kelvin: "6a000000-0000-4000-8000-000000000001",
  daniel: "6a000000-0000-4000-8000-000000000002",
  chloe: "6a000000-0000-4000-8000-000000000003",
} as const;

export type SeedConsignor = keyof typeof CONSIGNOR;

/**
 * public.consignment_items.id, in intake order:
 *   colnago   C-000001 Kelvin, unique, agreed 2400.00, asking 4200.00, a
 *             120.00 shop-borne charge; active (available at the Shop floor).
 *   cervelo   C-000002 Daniel, unique, agreed 500.00, asking 1000.00, a
 *             45.00 consignor-borne charge; sold on S-000003.
 *   jerseys   C-000003 Chloe, quantity 6, agreed 35.00, asking 70.00; 3 sold
 *             (S-000001, S-000004), 3 left; active.
 *   crankset  C-000004 Kelvin, unique, agreed 300.00, asking 520.00;
 *             returned to him (CONSIGNMENT_RETURN.crankset).
 */
export const CONSIGNMENT_ITEM = {
  colnago: "6b000000-0000-4000-8000-000000000001",
  cervelo: "6b000000-0000-4000-8000-000000000002",
  jerseys: "6b000000-0000-4000-8000-000000000003",
  crankset: "6b000000-0000-4000-8000-000000000004",
} as const;

export type SeedConsignmentItem = keyof typeof CONSIGNMENT_ITEM;

export const CONSIGNMENT_ITEM_SHORT_ID: Record<SeedConsignmentItem, string> = {
  colnago: "C-000001",
  cervelo: "C-000002",
  jerseys: "C-000003",
  crankset: "C-000004",
};

/**
 * public.products.id of the intake products (new draft consignment-owned
 * products, D45): colnago "Colnago C64 Disc (2019), 54 cm" (Bikes), cervelo
 * "Cervélo R3 (2017), 56 cm" (Bikes), jersey "Rapha Pro Team jersey, size M
 * (as new)" (quantity), crankset "Shimano Dura-Ace R9100 crankset, 172.5
 * mm" (Drivetrain; archived publication after the return).
 */
export const CONSIGNMENT_PRODUCT = {
  colnago: "6c000000-0000-4000-8000-000000000001",
  cervelo: "6c000000-0000-4000-8000-000000000002",
  jersey: "6c000000-0000-4000-8000-000000000003",
  crankset: "6c000000-0000-4000-8000-000000000004",
} as const;

/**
 * public.inventory_units.id of the consigned units: colnago (serial
 * C64D-19-0412, available), cervelo (serial CV-R3-17-5521, sold),
 * crankset (returned_to_consignor).
 */
export const CONSIGNMENT_UNIT = {
  colnago: "6d000000-0000-4000-8000-000000000001",
  cervelo: "6d000000-0000-4000-8000-000000000002",
  crankset: "6d000000-0000-4000-8000-000000000004",
} as const;

/** public.consignment_item_charges.id (D4: explicit bearer). */
export const CONSIGNMENT_CHARGE = {
  /** C-000001, "Full service and new bar tape before listing", 120.00, shop. */
  colnagoService: "6e000000-0000-4000-8000-000000000001",
  /** C-000002, "Tubeless conversion requested by the consignor", 45.00, consignor. */
  cerveloTubeless: "6e000000-0000-4000-8000-000000000002",
} as const;

/**
 * public.sales.id (record_retail_sale, source retail):
 *   jerseys      S-000001 day 5 11:20, Priya, 2 x jersey from C-000003.
 *   tubes        S-000002 day 4 15:05, walk-in, 2 x PRODUCT.bromptonTube
 *                (shop-owned, 14.00 / 6.00); one tube refunded (14.00).
 *   cervelo      S-000003 day 3 16:40, Hafiz, CONSIGNMENT_UNIT.cervelo at its
 *                selling price.
 *   jerseyToday  S-000004 day 0 10:30, walk-in, 1 x jersey (FIFO: C-000003).
 */
export const SALE = {
  jerseys: "6f000000-0000-4000-8000-000000000001",
  tubes: "6f000000-0000-4000-8000-000000000002",
  cervelo: "6f000000-0000-4000-8000-000000000003",
  jerseyToday: "6f000000-0000-4000-8000-000000000004",
} as const;

export type SeedSale = keyof typeof SALE;

export const SALE_NUMBER: Record<SeedSale, string> = {
  jerseys: "S-000001",
  tubes: "S-000002",
  cervelo: "S-000003",
  jerseyToday: "S-000004",
};

/** public.sale_refunds.id: one tube of S-000002, 14.00 (D49). */
export const SALE_REFUND = {
  tube: "7a000000-0000-4000-8000-000000000001",
} as const;

/**
 * public.consignment_settlements.id, both Chloe's, to C-000003:
 * reversed (30.00, paid day 3 18:00, "PayNow 2991", reversed by
 * SETTLEMENT_REVERSAL.wrongAmount) and chloe (40.00, paid day 2 12:00,
 * "PayNow 3002").
 */
export const SETTLEMENT = {
  reversed: "7b000000-0000-4000-8000-000000000001",
  chloe: "7b000000-0000-4000-8000-000000000002",
} as const;

/** public.consignment_settlement_reversals.id ("Wrong amount; the transfer was $40."). */
export const SETTLEMENT_REVERSAL = {
  wrongAmount: "7c000000-0000-4000-8000-000000000001",
} as const;

/** return_consignment_item's return id (the movement's request_id). */
export const CONSIGNMENT_RETURN = {
  crankset: "7e000000-0000-4000-8000-000000000001",
} as const;

export type LedgerExpectation = {
  items_total: number;
  active_items: number;
  awaiting_settlement_items: number;
  returned_items: number;
  /** Items whose status is sold (D48: the count staff without money access see). */
  sold_items: number;
  liability: string;
  consignor_charges: string;
  owed: string;
  paid: string;
  outstanding: string;
};

/**
 * reporting.consignor_ledger per seeded consignor (D46, D47), worked out by
 * hand: owed = liability - consignor charges; paid excludes the reversed
 * 30.00; outstanding = owed - paid. Money is fixed-2.
 */
export const EXPECTED_CONSIGNOR_LEDGER: Record<SeedConsignor, LedgerExpectation> = {
  // C-000001 unsold (its 120.00 charge is the shop's), C-000004 returned.
  kelvin: {
    items_total: 2,
    active_items: 1,
    awaiting_settlement_items: 0,
    returned_items: 1,
    sold_items: 0,
    liability: "0.00",
    consignor_charges: "0.00",
    owed: "0.00",
    paid: "0.00",
    outstanding: "0.00",
  },
  // C-000002 sold at 1000.00 against 500.00; his 45.00 charge is deducted.
  daniel: {
    items_total: 1,
    active_items: 0,
    awaiting_settlement_items: 1,
    returned_items: 0,
    sold_items: 1,
    liability: "500.00",
    consignor_charges: "45.00",
    owed: "455.00",
    paid: "0.00",
    outstanding: "455.00",
  },
  // C-000003: 3 of 6 sold at 35.00 each, 3 left; paid 40.00.
  chloe: {
    items_total: 1,
    active_items: 1,
    awaiting_settlement_items: 1,
    returned_items: 0,
    sold_items: 0,
    liability: "105.00",
    consignor_charges: "0.00",
    owed: "105.00",
    paid: "40.00",
    outstanding: "65.00",
  },
};

/** C-000003's quantities after the seed. */
export const EXPECTED_JERSEYS_POSITION = {
  quantity: 6,
  sold_qty: 3,
  restocked_qty: 0,
  remaining_qty: 3,
} as const;

export type SaleExpectation = {
  id: string;
  sale_number: string;
  /** Shop days before the anchor of its recognized_at. */
  daysAgo: 0 | 3 | 4 | 5;
  status: "recorded" | "partially_refunded";
  customer_id: string | null;
  /** The line's consignment item, null for shop-owned stock. */
  consignment_item_id: string | null;
  ownership_type: "consignment" | "shop_owned";
  quantity: number;
  unit_sale_price: string;
  unit_direct_cost: string;
  consignor_payout: string | null;
  sale_total: string;
  cost_total: string;
  yield_total: string;
  cult_commons_share: string;
  bicii_yield_after_cc: string;
  refunded_total: string;
};

/**
 * Each seeded sale has one line, at the 0.3000 Cult Commons rate (D1).
 * Cult Commons is 30% of the positive yield after the consignor payout:
 * S-000003 is SPEC §10's consignment example (1000.00 against 500.00 owed).
 */
export const EXPECTED_SALE: Record<SeedSale, SaleExpectation> = {
  jerseys: {
    id: SALE.jerseys,
    sale_number: "S-000001",
    daysAgo: 5,
    status: "recorded",
    customer_id: CUSTOMER.priya,
    consignment_item_id: CONSIGNMENT_ITEM.jerseys,
    ownership_type: "consignment",
    quantity: 2,
    unit_sale_price: "70.00",
    unit_direct_cost: "35.00",
    consignor_payout: "35.00",
    sale_total: "140.00",
    cost_total: "70.00",
    yield_total: "70.00",
    cult_commons_share: "21.00",
    bicii_yield_after_cc: "49.00",
    refunded_total: "0.00",
  },
  tubes: {
    id: SALE.tubes,
    sale_number: "S-000002",
    daysAgo: 4,
    status: "partially_refunded",
    customer_id: null,
    consignment_item_id: null,
    ownership_type: "shop_owned",
    quantity: 2,
    unit_sale_price: "14.00",
    unit_direct_cost: "6.00",
    consignor_payout: null,
    sale_total: "28.00",
    cost_total: "12.00",
    yield_total: "16.00",
    cult_commons_share: "4.80",
    bicii_yield_after_cc: "11.20",
    refunded_total: "14.00",
  },
  cervelo: {
    id: SALE.cervelo,
    sale_number: "S-000003",
    daysAgo: 3,
    status: "recorded",
    customer_id: CUSTOMER.hafiz,
    consignment_item_id: CONSIGNMENT_ITEM.cervelo,
    ownership_type: "consignment",
    quantity: 1,
    unit_sale_price: "1000.00",
    unit_direct_cost: "500.00",
    consignor_payout: "500.00",
    sale_total: "1000.00",
    cost_total: "500.00",
    yield_total: "500.00",
    cult_commons_share: "150.00",
    bicii_yield_after_cc: "350.00",
    refunded_total: "0.00",
  },
  jerseyToday: {
    id: SALE.jerseyToday,
    sale_number: "S-000004",
    daysAgo: 0,
    status: "recorded",
    customer_id: null,
    consignment_item_id: CONSIGNMENT_ITEM.jerseys,
    ownership_type: "consignment",
    quantity: 1,
    unit_sale_price: "70.00",
    unit_direct_cost: "35.00",
    consignor_payout: "35.00",
    sale_total: "70.00",
    cost_total: "35.00",
    yield_total: "35.00",
    cult_commons_share: "10.50",
    bicii_yield_after_cc: "24.50",
    refunded_total: "0.00",
  },
};

// ---------------------------------------------------------------------------
// Phase 8: labels (DATA-MODEL §12, §18 "Phase 8 part").
// ---------------------------------------------------------------------------

/**
 * The seeded shop_settings.public_site_url: the DATABASE QR base
 * (private.qr_payload, D9). Every printed payload is exactly
 * `${SHOP.publicSiteUrl}/q/${shortId}`. Distinct from E2E_PUBLIC_SITE_URL in
 * tests/fixtures/public-site.ts, the environment's scan-only base
 * (NEXT_PUBLIC_PUBLIC_SITE_URL, an extra accepted base in scanBases()).
 */
export const SHOP = { publicSiteUrl: "http://localhost:4000" } as const;

/**
 * public.label_templates.id: the built-in 58 x 40 mm defaults, one per kind,
 * inserted by the labels migration (production needs them), not the seed.
 */
export const LABEL_TEMPLATE = {
  product: "1ab00000-0000-4000-8000-000000000001",
  unit: "1ab00000-0000-4000-8000-000000000002",
  bike: "1ab00000-0000-4000-8000-000000000003",
} as const;

/**
 * public.printer_profiles.id, inserted by the labels migration: browser
 * ("This device (browser print)", the default, sort 0) and pdf ("PDF
 * download", sort 1).
 */
export const PRINTER_PROFILE = {
  browser: "a8000000-0000-4000-8000-000000000001",
  pdf: "a8000000-0000-4000-8000-000000000002",
} as const;

/**
 * public.print_jobs.id (seed "Phase 8"), on the default templates:
 *   productPrinted   PRODUCT.barTape (P-000011) x 10, browser, printed by
 *                    mechanic1, 2 days ago.
 *   unitFailed       UNIT.colnago (U-000001, bike B-000011) x 1, pdf, failed
 *                    "Label roll ran out halfway through", admin, yesterday.
 *   unitReprint      reprint of unitFailed, same unit x 1, pdf, printed, admin.
 *   bikeUnconfirmed  BIKE.tanTarmac (B-000001) x 1, browser, rendered (not
 *                    confirmed), mechanic2, today.
 *   productQueued    PRODUCT.barTape x 10, pdf, queued, mechanic1, today
 *                    (E2E renders and downloads it; nothing changes its status).
 */
export const PRINT_JOB = {
  productPrinted: "a9000000-0000-4000-8000-000000000001",
  unitFailed: "a9000000-0000-4000-8000-000000000002",
  unitReprint: "a9000000-0000-4000-8000-000000000003",
  bikeUnconfirmed: "a9000000-0000-4000-8000-000000000004",
  productQueued: "a9000000-0000-4000-8000-000000000005",
} as const;

/**
 * Purchasing (Phase 7): public.suppliers.id. The seed links them to Phase 4
 * products with set_supplier_product (supplier SKU, lead days, preferred):
 *   veloParts   Velo Parts Asia Pte Ltd (Kenneth Lim, sales@veloparts.test,
 *               +65 6123 4501, account BICII-0042): cassette, chainX11,
 *               chainLube, cableKit, hydraulicHose (preferred) and
 *               gp5000Tyre (not preferred).
 *   tropicTyre  Tropic Tyre & Tube Co (Siti Rahman, orders@tropictyre.test,
 *               +65 6234 5502, account TT-1187): gp5000Tyre and roadTube
 *               (preferred).
 *   oldSpoke    Old Spoke Trading: archived 15 days ago; no links, no POs.
 * sealant (low stock) has no supplier.
 */
export const SUPPLIER = {
  veloParts: "d7000000-0000-4000-8000-000000000001",
  tropicTyre: "d7000000-0000-4000-8000-000000000002",
  oldSpoke: "d7000000-0000-4000-8000-000000000003",
} as const;

/**
 * public.purchase_orders.id (Phase 7), created in this order through the
 * RPCs by Asha Admin (SGD), so PO_NUMBER is PO-000001 .. PO-000005:
 *   receivedInFull    veloParts, ref SO-7702, expected 9 days ago; created
 *                     12 days ago, submitted 11, received in full 9 days ago
 *                     at 14:00 (delivery note DN-5402): received.
 *   partial           veloParts, ref SO-7781, SPEC §14's example: expected
 *                     yesterday; created 6 days ago, submitted 5, one
 *                     delivery 3 days ago at 11:30 (DN-5531):
 *                     partially_received, 2 chains outstanding, overdue.
 *   awaitingDelivery  tropicTyre, created and submitted 2 days ago, expected
 *                     in 3 days, nothing received: submitted.
 *   draft             veloParts, created yesterday, a draft for the
 *                     low-stock cableKit and hydraulicHose.
 *   cancelled         tropicTyre, created and submitted yesterday, cancelled
 *                     at seed time: 'Supplier out of stock until next
 *                     quarter'.
 * On order (reporting.product_on_order): gp5000Tyre 6, chainX11 2.
 */
export const PURCHASE_ORDER = {
  receivedInFull: "d7100000-0000-4000-8000-000000000001",
  partial: "d7100000-0000-4000-8000-000000000002",
  awaitingDelivery: "d7100000-0000-4000-8000-000000000003",
  draft: "d7100000-0000-4000-8000-000000000004",
  cancelled: "d7100000-0000-4000-8000-000000000005",
} as const;

export type SeedPurchaseOrder = keyof typeof PURCHASE_ORDER;

export const PO_NUMBER: Record<SeedPurchaseOrder, string> = {
  receivedInFull: "PO-000001",
  partial: "PO-000002",
  awaitingDelivery: "PO-000003",
  draft: "PO-000004",
  cancelled: "PO-000005",
};

/**
 * public.purchase_order_lines.id (Phase 7): product, ordered x unit cost
 * (each the product's default_direct_cost), received at the Shop floor.
 */
export const PURCHASE_ORDER_LINE = {
  receivedInFullCassette: "d7200000-0000-4000-8000-000000000001", // cassette 4 x 68.00, received 4 (3 -> 7 on hand)
  partialChain: "d7200000-0000-4000-8000-000000000002", // chainX11 20 x 24.00, received 18 (8 -> 26)
  partialLube: "d7200000-0000-4000-8000-000000000003", // chainLube 10 x 7.00, received 10 (18 -> 28)
  awaitingTyres: "d7200000-0000-4000-8000-000000000004", // gp5000Tyre 6 x 52.00, received 0 (12 on hand)
  draftCableKit: "d7200000-0000-4000-8000-000000000005", // cableKit 6 x 16.00 (its D66 suggestion; 2 on hand)
  draftHose: "d7200000-0000-4000-8000-000000000006", // hydraulicHose 9 x 12.00 (its D66 suggestion; 1 on hand)
  cancelledTubes: "d7200000-0000-4000-8000-000000000007", // roadTube 20 x 3.80, cancelled (60 on hand)
} as const;

/**
 * purchase_receipts.idempotency_key (Phase 7): receivedInFull is PO-000001's
 * one receipt (line receivedInFullCassette x 4); partial is PO-000002's
 * (partialChain x 18 and partialLube x 10, in that order, DN-5531). Both at
 * the Shop floor with the PO lines' costs.
 */
export const RECEIPT_KEY = {
  receivedInFull: "d7300000-0000-4000-8000-000000000001",
  partial: "d7300000-0000-4000-8000-000000000002",
} as const;
