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
  // Workshop (Phase 3): active staff; service writes need manage_inventory
  // (a cost also view_costs), Cult Commons rates are admin only
  "public.add_manual_line(uuid, uuid, text, money_amount, line_quantity, money_amount)",
  "public.add_service_line(uuid, uuid, uuid, line_quantity, money_amount, money_amount, text)",
  "public.add_work_order_note(uuid, work_order_note_kind, text)",
  "public.assign_staff(uuid, uuid, assignment_role)",
  "public.cancel_cult_commons_rate(uuid)",
  "public.create_service(uuid, text, money_amount, text, uuid, money_amount, boolean, boolean)",
  "public.create_work_order(uuid, uuid, uuid, text, text, uuid, uuid[], jsonb)",
  "public.schedule_cult_commons_rate(rate_fraction, timestamp with time zone)",
  "public.set_approval_flag(uuid, boolean, text)",
  "public.set_service_archived(uuid, boolean)",
  "public.set_work_order_status(uuid, work_order_status, text)",
  "public.unassign_staff(uuid, uuid)",
  "public.update_service(uuid, text, money_amount, text, uuid, boolean, boolean, money_amount)",
  "public.update_work_order(uuid, text, text, text, text)",
  "public.void_line(uuid, text)",
  "public.work_order_timeline(uuid, integer)",
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
 * links; attachments: caption only). Phase 3: the workshop tables are
 * read-only (every write is an RPC) and SELECT on services and
 * work_order_line_items is a column grant without the cost columns, which
 * only the *_staff views return (view_costs); cult_commons_rates rows are
 * visible to view_costs only; categories are written by manage_inventory.
 */
export const AUTHENTICATED_RELATIONS: Readonly<Record<string, readonly string[]>> = {
  "public.attachment_events": ["SELECT"],
  "public.attachments": ["SELECT", "UPDATE"],
  "public.bike_ownership_events": ["SELECT"],
  "public.bikes": ["INSERT", "SELECT", "UPDATE"],
  "public.customers": ["INSERT", "SELECT", "UPDATE"],
  "public.staff": ["SELECT"],
  "public.staff_permissions": ["SELECT"],
  // Workshop (Phase 3)
  "public.categories": ["INSERT", "SELECT", "UPDATE"],
  "public.cult_commons_rates": ["SELECT"],
  "public.services": ["SELECT"],
  "public.services_staff": ["SELECT"],
  "public.work_order_assignments": ["SELECT"],
  "public.work_order_events": ["SELECT"],
  "public.work_order_line_items": ["SELECT"],
  "public.work_order_line_items_staff": ["SELECT"],
  "public.work_order_totals": ["SELECT"],
  "public.work_order_totals_staff": ["SELECT"],
  "public.work_orders": ["SELECT"],
};

/**
 * Views that run with their owner's rights (security_invoker off) and are
 * still granted to an API role. Each must filter rows itself. The Phase 3
 * *_staff views read cost columns authenticated has no grant on, and return
 * rows only when private.has_permission('view_costs') (security_barrier);
 * reporting's public_items (Phase 8) will be the first public one.
 */
export const DEFINER_VIEWS: readonly string[] = [
  "public.services_staff",
  "public.work_order_line_items_staff",
  "public.work_order_totals_staff",
];
