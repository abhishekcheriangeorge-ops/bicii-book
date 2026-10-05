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

/**
 * Functions anonymous visitors may call: the public booking reads (Phase 2,
 * D37): bookable times, the online-bookable appointment types (no capacity
 * units) and the weekly hours. Phase 11's public site consumes them and
 * must not revoke anon.
 */
export const ANON_FUNCTIONS: readonly string[] = [
  "public.available_slots(date, uuid)",
  "public.public_appointment_types()",
  "public.public_shop_hours()",
];

/**
 * Relations (tables, views, sequences) anonymous visitors may touch, with
 * privileges. reporting.public_items (Phase 4) is the only anonymous
 * inventory surface: published products and units, public columns and
 * public photos only (DATA-MODEL §11, §15); Phase 11's /q page reads it.
 */
export const ANON_RELATIONS: Readonly<Record<string, readonly string[]>> = {
  "reporting.public_items": ["SELECT"],
};

/**
 * Functions in `private` that anon may execute. Only private.selling_price:
 * reporting.public_items calls it, and a view's functions run as the
 * caller. anon has no USAGE on `private`, so it cannot call it directly
 * (tests/db/meta.test.ts checks both).
 */
export const ANON_PRIVATE_FUNCTIONS: readonly string[] = ["private.selling_price(uuid,uuid)"];

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
  "public.add_work_order_note(uuid, uuid, work_order_note_kind, text)",
  "public.assign_staff(uuid, uuid, assignment_role)",
  "public.cancel_cult_commons_rate(uuid)",
  "public.create_service(uuid, text, money_amount, text, uuid, money_amount, boolean, boolean)",
  "public.create_work_order(uuid, uuid, uuid, text, text, uuid, uuid[], jsonb)",
  "public.schedule_cult_commons_rate(uuid, rate_fraction, timestamp with time zone)",
  "public.set_approval_flag(uuid, boolean, text)",
  "public.set_service_archived(uuid, boolean)",
  "public.set_work_order_status(uuid, work_order_status, text)",
  "public.unassign_staff(uuid, uuid)",
  "public.update_service(uuid, text, money_amount, text, uuid, boolean, boolean, money_amount)",
  "public.update_work_order(uuid, text, text, text, text)",
  "public.void_line(uuid, text)",
  "public.work_order_timeline(uuid, integer)",
  // Inventory (Phase 4): active staff add and void parts; adjust_stock and
  // write_off_unit need adjust_stock; transfers, units and publication
  // manage_inventory (a unit cost also view_costs); a split needs both
  // adjust_stock and manage_inventory
  "public.add_inventory_line(uuid, uuid, uuid, integer, uuid, uuid, money_amount)",
  "public.adjust_stock(uuid, uuid, uuid, integer, movement_type, text, money_amount)",
  "public.create_unique_unit(uuid, uuid, uuid, text, text, money_amount, money_amount, uuid, text)",
  "public.set_publication_status(uuid, publication_status, text)",
  "public.split_unit_from_stock(uuid, uuid, uuid, uuid, text, text, text, text, money_amount)",
  "public.transfer_stock(uuid, uuid, uuid, uuid, integer, text, uuid)",
  "public.write_off_unit(uuid, uuid, text)",
  // Reporting and Today (Phase 5): active staff; money gated by FIN-ACCESS
  // (D30): financial_lines needs view_financial_reports, work_order_yield
  // view_costs, and cost-derived figures come back NULL without view_costs
  "public.daily_summary(date, date)",
  "public.financial_lines(date, date)",
  "public.operational_exceptions(integer)",
  "public.stock_adjustments_on(date)",
  "public.today_dashboard(date)",
  "public.work_order_activity_on(date)",
  "public.work_order_yield(uuid)",
  // Appointments (Phase 2): active staff; schedule settings admin only.
  // The three public booking reads are callable by everyone (D37).
  "public.available_slots(date, uuid)",
  "public.book_appointment(uuid, uuid, uuid, timestamp with time zone, uuid, text, text)",
  "public.cancel_appointment(uuid, text)",
  "public.delete_closure_override(uuid, text)",
  "public.mark_appointment_status(uuid, appointment_status, text)",
  "public.public_appointment_types()",
  "public.public_shop_hours()",
  "public.save_appointment_type(uuid, boolean, text, text, integer, integer, boolean, boolean, integer)",
  "public.save_closure_override(uuid, boolean, closure_kind, date, date, text, time without time zone, time without time zone)",
  "public.set_shop_hours(smallint, jsonb, boolean)",
  "public.update_appointment(uuid, uuid, boolean, text, text)",
  "public.update_shop_settings(integer, integer, integer, integer, integer, integer, text)",
  // Customer self-service (Phase 1): the caller's own rows only
  "public.my_bike_attachments(uuid)",
  "public.my_bikes()",
  "public.my_customer_profile()",
  "public.update_my_profile(text, text, text, text)",
  // Customer job projection (Phase 3, shown in Phase 11): own jobs only,
  // customer-safe columns (D17)
  "public.my_work_order_attachments(uuid)",
  "public.my_work_order_lines(uuid)",
  "public.my_work_order_timeline(uuid)",
  "public.my_work_orders()",
  // Customer appointments (Phase 2, consumed by Phase 11): own rows only,
  // the D42 projection; booking and cancelling under D37
  "public.book_my_appointment(uuid, uuid, timestamp with time zone, uuid, text)",
  "public.cancel_my_appointment(uuid, text)",
  "public.my_appointments(boolean)",
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
  // Inventory (Phase 4): staff read; manage_inventory writes locations and
  // products (no cost without view_costs: the invoker cost-write guards);
  // units are created and moved only by RPCs (UPDATE is a column grant for
  // details, prices and archiving); the ledger and the histories are
  // read-only. SELECT on products, units and movements excludes the cost
  // columns, which only the cost views return (view_costs).
  "public.inventory_movement_costs": ["SELECT"],
  "public.inventory_movements": ["SELECT"],
  "public.inventory_unit_costs": ["SELECT"],
  "public.inventory_unit_events": ["SELECT"],
  "public.inventory_units": ["SELECT", "UPDATE"],
  "public.locations": ["INSERT", "SELECT", "UPDATE"],
  "public.product_costs": ["SELECT"],
  "public.product_events": ["SELECT"],
  "public.products": ["INSERT", "SELECT", "UPDATE"],
  "public.selling_prices": ["SELECT"],
  "reporting.low_stock": ["SELECT"],
  "reporting.product_stock": ["SELECT"],
  // The anonymous projection, readable by signed-in users (customers) too
  "reporting.public_items": ["SELECT"],
  "reporting.stock_levels": ["SELECT"],
  // Appointments (Phase 2): staff read (RLS is_staff); every write is an
  // RPC; customers read none of them (zero rows), only the my_* RPCs
  "public.appointment_events": ["SELECT"],
  "public.appointment_types": ["SELECT"],
  "public.appointments": ["SELECT"],
  "public.closure_overrides": ["SELECT"],
  "public.schedule_events": ["SELECT"],
  "public.shop_hours": ["SELECT"],
  "public.shop_settings": ["SELECT"],
};

/**
 * Views that run with their owner's rights (security_invoker off) and are
 * still granted to an API role. Each must filter rows itself. The Phase 3
 * *_staff views read cost columns authenticated has no grant on, and return
 * rows only when private.has_permission('view_costs') (security_barrier);
 * so do Phase 4's three cost views, and public.selling_prices returns rows
 * to active staff only. reporting.public_items is the first public one: it
 * reads the staff-only tables as its owner and filters to published rows
 * and public columns itself (security_barrier).
 */
export const DEFINER_VIEWS: readonly string[] = [
  // Inventory (Phase 4): costs for view_costs only; selling prices for
  // active staff (private.selling_price, the single price source)
  "public.inventory_movement_costs",
  "public.inventory_unit_costs",
  "public.product_costs",
  "public.selling_prices",
  "public.services_staff",
  "public.work_order_line_items_staff",
  "public.work_order_totals_staff",
  // Inventory (Phase 4): the anonymous /q projection
  "reporting.public_items",
];
