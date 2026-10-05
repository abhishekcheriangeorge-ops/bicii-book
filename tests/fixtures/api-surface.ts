/**
 * The API surface fixture (PLAN §5 "RLS matrix"; DATA-MODEL §15, §16):
 * exactly what each API role may reach in the exposed and reporting
 * schemas. tests/db/meta.test.ts compares the live catalogue with these
 * lists, so a migration that forgets its explicit revoke (hosted Supabase
 * grants ALL on new `public` objects to anon/authenticated/service_role,
 * and the devstack now does too) fails, and so does a new grant nobody
 * added here on purpose.
 *
 * Adding an RPC, table or view to the API = adding it here in the same PR,
 * which is the moment to check its RLS policies and guard.
 */

/** Functions anonymous visitors may call. Phase 2+ adds the public booking RPCs. */
export const ANON_FUNCTIONS: readonly string[] = [];

/** Relations (tables, views, sequences) anonymous visitors may touch, with privileges. */
export const ANON_RELATIONS: Readonly<Record<string, readonly string[]>> = {};

/** Functions signed-in users may call (each one checks the caller itself). */
export const AUTHENTICATED_FUNCTIONS: readonly string[] = [
  "public.create_staff(uuid, text, text, staff_role)",
  "public.grant_permission(uuid, permission_key)",
  "public.my_staff_profile()",
  "public.revoke_permission(uuid, permission_key)",
  "public.set_staff_active(uuid, boolean, text)",
  "public.staff_directory()",
  "public.staff_history(uuid, integer)",
  "public.staff_roster()",
  "public.update_staff(uuid, text, staff_role, text)",
];

/**
 * Relations signed-in users may touch, with privileges. Every table here
 * also has RLS policies (meta test "RLS is enabled on every table").
 */
export const AUTHENTICATED_RELATIONS: Readonly<Record<string, readonly string[]>> = {
  "public.staff": ["SELECT"],
  "public.staff_permissions": ["SELECT"],
};

/**
 * Views that run with their owner's rights (security_invoker off) and are
 * still granted to an API role. Each must filter rows itself; reporting's
 * public_items (Phase 8) will be the first.
 */
export const DEFINER_VIEWS: readonly string[] = [];
