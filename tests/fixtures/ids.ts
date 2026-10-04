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
 * unit (UNIT): shopColnago, shopBrompton, shopSurly.
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
 * this order (JOB_NUMBER). Every timeline is backdated to read true
 * (DATA-MODEL §18 "Phase 3 part"). danielCannondaleAwaitingCustomer is the
 * one overdue job (D20: open, checked in 8 days ago); nurulBianchiReceived
 * was checked in at seed time, after the Bianchi's sale to Nurul.
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
 * public.products.id (Phase 4), inserted in this order (PRODUCT_SHORT_ID).
 * SGD price / default direct cost, reorder point; internal_only except
 * cassette (draft); chainX10Archived is archived with no stock. colnago,
 * brompton and surly are unique-tracked (one unit each, UNIT); the rest are
 * counted.
 *
 * On-hand after the seed (reporting.stock_levels; SF = Shop floor, WS =
 * Workshop store):
 *   brakePads 34 SF; gp5000Tyre 12 SF; roadTube 40 SF + 20 WS;
 *   marathonRacer 6 SF (one consumed by INVENTORY_JOB, then reversed);
 *   bromptonTube 14 SF (15 opening, one on INVENTORY_JOB); chainX11 8 SF;
 *   cassette 3 SF; cableKit 2 SF (low, reorder 4); hydraulicHose 1 SF (low,
 *   reorder 5); chainLube 18 SF; barTape 7 SF; sealant 1 SF + 1 WS (low,
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
