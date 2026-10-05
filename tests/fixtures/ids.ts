/**
 * Fixed IDs from supabase/seed.sql. Tests reference seeded rows by these
 * IDs, never by name (TESTING.md "Seed data"). Keep in sync with the seed.
 */

/** Local-only password shared by every seeded login. */
export const SEED_PASSWORD = "bicii-dev-password";

/** auth.users.id of each seeded login. */
export const AUTH_USER = {
  admin: "a0000000-0000-4000-8000-000000000001",
  mechanic1: "a0000000-0000-4000-8000-000000000002",
  mechanic2: "a0000000-0000-4000-8000-000000000003",
} as const;

/** public.staff.id. admin: role admin. mechanic1: view_costs. mechanic2: no permissions. */
export const STAFF = {
  admin: "5a000000-0000-4000-8000-000000000001",
  mechanic1: "5a000000-0000-4000-8000-000000000002",
  mechanic2: "5a000000-0000-4000-8000-000000000003",
} as const;

export const STAFF_EMAIL = {
  admin: "admin@bicii.test",
  mechanic1: "mechanic1@bicii.test",
  mechanic2: "mechanic2@bicii.test",
} as const;

export type SeedStaff = keyof typeof STAFF;

/**
 * public.customers.id (Phase 1). None has a login: tests that act as a
 * customer create an Auth user and link it (tests/db/customer-fixtures.ts).
 * tan and daniel have internal_notes; nurul has no email.
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
 *   bromptonTube 14 SF (15 opening, one on INVENTORY_JOB); chainX11 26 SF
 *   (8 opening + 18 received on PO-000002, Phase 7); cassette 7 SF (3 + 4
 *   received on PO-000001); cableKit 2 SF (low, reorder 4); hydraulicHose
 *   1 SF (low, reorder 5); chainLube 28 SF (18 + 10 received on
 *   PO-000002); barTape 7 SF; sealant 1 SF + 1 WS (low,
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
