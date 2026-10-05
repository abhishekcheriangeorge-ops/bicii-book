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

/**
 * Functions signed-in users may call (each one checks the caller itself).
 * Staff and customers share the `authenticated` role: the my_* functions
 * are the customer side (own rows, customer-safe columns only); every
 * other one requires active staff (DATA-MODEL §15 "Customer access").
 */
export const AUTHENTICATED_FUNCTIONS: readonly string[] = [
  // Staff (Phase 0)
  "public.create_staff(uuid, text, text, staff_role)",
  "public.grant_permission(uuid, permission_key)",
  "public.my_staff_profile()",
  "public.revoke_permission(uuid, permission_key)",
  "public.set_staff_active(uuid, boolean, text)",
  "public.staff_directory()",
  "public.staff_history(uuid, integer)",
  "public.staff_roster()",
  "public.update_staff(uuid, text, staff_role, text)",
  // Customers, bikes, attachments, search (Phase 1): active staff
  "public.attachment_stray_objects(attachment_entity, uuid)",
  "public.delete_attachment(uuid, text)",
  "public.record_attachment(uuid, attachment_entity, uuid, text, text, text, integer, integer, integer, text, attachment_visibility)",
  "public.set_attachment_visibility(uuid, attachment_visibility, text, text)",
  "public.staff_search(text, text[], integer, boolean)",
  "public.transfer_bike_ownership(uuid, uuid, text)",
  // Customer self-service (Phase 1): the caller's own rows only
  "public.my_bike_attachments(uuid)",
  "public.my_bikes()",
  "public.my_customer_profile()",
  "public.update_my_profile(text, text, text, text)",
];

/**
 * Relations signed-in users may touch, with privileges. Every table here
 * also has RLS policies (meta test "RLS is enabled on every table"). The
 * Phase 1 tables' policies admit active staff only; INSERT and UPDATE are
 * column grants (no short_id, customer_id after insert, Auth or Shopify
 * links; attachments: caption only).
 */
export const AUTHENTICATED_RELATIONS: Readonly<Record<string, readonly string[]>> = {
  "public.attachment_events": ["SELECT"],
  "public.attachments": ["SELECT", "UPDATE"],
  "public.bike_ownership_events": ["SELECT"],
  "public.bikes": ["INSERT", "SELECT", "UPDATE"],
  "public.customers": ["INSERT", "SELECT", "UPDATE"],
  "public.staff": ["SELECT"],
  "public.staff_permissions": ["SELECT"],
};

/**
 * Views that run with their owner's rights (security_invoker off) and are
 * still granted to an API role. Each must filter rows itself; reporting's
 * public_items (Phase 8) will be the first.
 */
export const DEFINER_VIEWS: readonly string[] = [];
