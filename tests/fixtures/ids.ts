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
};

/** Serial numbers as entered in the seed (chloeSurly has none). */
export const BIKE_SERIAL = {
  tanTarmac: "WSBC604123456N",
  priyaDomane: "WTU291C1234K",
  priyaTern: "TRN-19-0045821",
  shopCervelo: "CV-CAL5-0921",
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
