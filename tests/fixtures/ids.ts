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
