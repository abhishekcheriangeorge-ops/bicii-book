/**
 * Turns database and PostgREST errors into messages that are safe to show a
 * user (ADR-001 A2; DATA-MODEL §16 error convention). Raw Postgres messages
 * can leak table, column and constraint names, so nothing from the error is
 * echoed: known cases map to fixed text, everything else is generic.
 *
 * Pure (no server imports) so it is unit-tested directly.
 */

/** The shape PostgREST (supabase-js PostgrestError) and node-postgres share. */
export type DbErrorLike = {
  code?: string;
  message?: string;
  details?: string | null;
  /** node-postgres */
  detail?: string;
  hint?: string | null;
  /** node-postgres */
  constraint?: string;
};

export type MappedError = {
  /** Safe to show. */
  message: string;
  /** Stable category for logs and tests. */
  kind:
    | "forbidden"
    | "business"
    | "not_found"
    | "duplicate"
    | "invalid"
    | "conflict"
    | "unavailable"
    | "unknown";
  /** SQLSTATE or PostgREST code when there was one. */
  code?: string;
  /** P0001 message code or violated constraint, when known. */
  reason?: string;
};

export const GENERIC_ERROR =
  "Something went wrong. Try again, and tell an admin if it keeps happening.";
export const FORBIDDEN_ERROR = "You don't have permission to do that.";

/**
 * P0001 business-error codes raised by our RPCs (MESSAGE = code). Add the
 * code here when a migration introduces one.
 */
export const BUSINESS_ERRORS: Record<string, string> = {
  staff_email_mismatch: "That email does not match the login it belongs to.",
  reason_required: "Give a reason for this change.",
  reason_too_long: "Keep the reason under 500 characters.",
  staff_history_append_only: "Staff history cannot be changed.",
  staff_permission_immutable: "Remove the permission and grant the new one instead.",
  // Customers and bikes (Phase 1)
  customer_archived: "That customer is archived. Unarchive them first.",
  bike_archived: "That bike is archived. Unarchive it before changing its owner or stocking it.",
  bike_short_id_immutable: "A bike keeps its ID for life.",
  bike_history_append_only: "Bike ownership history cannot be changed.",
  // Attachments (Phase 1)
  attachment_object_missing: "The photo did not finish uploading. Try again.",
  attachment_path_mismatch: "The photo was uploaded to the wrong place. Try again.",
  attachment_bucket_mismatch: "The photo was uploaded to the wrong place. Try again.",
  attachment_media_type_unsupported: "Photos must be JPEG, PNG, WebP or HEIC.",
  attachment_media_type_mismatch: "That file is not the type of photo it claims to be.",
  attachment_entity_unsupported: "Photos cannot be added to that kind of record yet.",
  attachment_conflict: "That photo clashes with another one. Upload it again.",
  attachment_deleted: "That photo was deleted. Upload it again.",
  attachment_immutable: "A photo stays on the record it was taken for.",
  attachment_customer_never_public: "Photos on a customer record cannot be made public.",
  attachment_original_never_public:
    "This photo was stored as its original file, which may carry where it was taken. Add it again as a JPEG to make it public.",
  attachment_history_append_only: "Photo history cannot be changed.",
  // Workshop (Phase 3)
  work_order_transition_invalid: "A job can't move to that status from where it is now.",
  work_order_locked: "This job is completed or closed. Reopen it to change its lines.",
  work_order_closed: "This job is collected or cancelled and can no longer change.",
  work_order_has_lines:
    "Void the job's lines before cancelling it. Voiding a part returns it to stock.",
  work_order_conflict: "That job clashes with another one. Start the check-in again.",
  work_order_immutable: "A job keeps its number, customer, bike and timestamps.",
  work_order_history_append_only: "A job's timeline cannot be changed.",
  work_order_customer_archived:
    "That customer is archived. Unarchive them before checking in a bike.",
  work_order_bike_archived: "That bike is archived. Unarchive it before checking it in.",
  requested_work_required: "Say what the customer wants done.",
  note_required: "Write the note first.",
  note_too_long: "Keep the note under 5,000 characters.",
  bike_owner_mismatch: "That bike belongs to someone else. Transfer it to this customer first.",
  staff_inactive: "Only active staff can be assigned to a job.",
  assignment_immutable: "Assignments are closed, never edited. Assign again instead.",
  line_conflict: "That line clashes with another one. Add it again.",
  line_immutable: "Lines can't be edited or deleted. Void the line and add a new one.",
  service_unavailable: "That service is inactive or archived.",
  service_conflict: "That service clashes with another one. Save it again.",
  category_kind_mismatch:
    "Choose a category of the right kind: service categories for services, product categories for products.",
  cult_commons_rate_missing: "No Cult Commons rate is set. Ask an admin to set one.",
  cult_commons_rates_append_only:
    "Cult Commons rates can't be changed. Schedule a new rate instead.",
  cult_commons_rate_in_effect: "That rate is already in effect and can't be cancelled.",
  rate_backdated: "A new rate can start now or later, never in the past.",
  rate_conflict: "That rate clashes with another one. Schedule it again.",
  note_conflict: "That note clashes with another one. Add it again.",
  attachment_work_order_never_public: "Photos on a job can't be made public.",
  // Inventory (Phase 4)
  product_inactive: "That product is inactive.",
  product_archived: "That product is archived. Unarchive it first.",
  product_not_unique: "Only a unique item has individual units.",
  product_not_quantity: "Only stock counted by quantity can be split into a unique item.",
  product_unit_tracked: "This item is counted unit by unit. Change its units instead.",
  product_tracking_type_immutable:
    "A product stays counted or unique. Create a new product instead.",
  product_short_id_immutable: "A product keeps its ID for life.",
  product_slug_immutable: "A published product keeps its public address.",
  product_published: "Unpublish the product before archiving it.",
  product_has_stock: "The product still has stock. Adjust it to zero or write off its units first.",
  unit_required: "Choose which unit to use.",
  unit_product_mismatch: "That unit belongs to another product.",
  unit_not_available: "That unit is not available.",
  unit_status_transition_invalid: "A unit can't move to that status from where it is now.",
  unit_in_stock: "Only a sold, written-off or returned unit can be archived.",
  unit_location_mismatch: "That unit is somewhere else. Refresh and try again.",
  unit_ledger_inconsistent:
    "That unit's stock record doesn't add up. Tell an admin before changing it.",
  unit_conflict: "That unit clashes with another one. Save it again.",
  unit_short_id_immutable: "A unit keeps its ID for life.",
  location_inactive: "That location is inactive. Choose another or reactivate it.",
  location_has_stock: "That location still holds stock. Move or adjust it to zero first.",
  location_required: "There is no active stock location. Add one in Settings → Locations.",
  transfer_same_location: "Choose two different locations.",
  insufficient_stock: "There isn't that much stock at that location.",
  quantity_invalid: "Enter a quantity that's allowed here.",
  movement_type_not_manual: "Only a stock adjustment or damaged stock can be recorded by hand.",
  movement_append_only: "The stock record can't be changed. Record a correction instead.",
  movement_invalid: "That stock change is not consistent. Refresh and try again.",
  request_conflict: "That stock change clashes with another one. Start again.",
  part_price_missing: "This part has no sale price. Enter a price or ask someone to set one.",
  part_cost_missing:
    "This part has no cost yet, so its yield cannot be worked out. Ask someone with cost access to set it.",
  ownership_not_saleable:
    "This item is not shop stock, so it can't be used on a job or split into a unique item.",
  currency_mismatch: "That item is priced in another currency than the job.",
  publication_transition_invalid:
    "The item can't move to that publication status from where it is now.",
  publication_requires_photo: "Add a public photo before publishing.",
  publication_requires_price: "Set a selling price before publishing.",
  publication_requires_available_unit: "There is no available unit to publish.",
  publication_sold_by_sale:
    "A sold item changes status only through a sale or its reversal. By hand it can only be archived.",
  publication_initial_invalid: "A new product starts as a draft or internal only.",
  bike_has_owner: "That bike belongs to a customer. Only a shop bike can be stock.",
  bike_already_linked: "That bike is already in stock as another unit.",
  bike_in_stock: "This bike is in stock as a unit; sell or write off the unit first.",
  product_events_append_only: "Product history can't be changed.",
  inventory_unit_events_append_only: "Unit history can't be changed.",
  attachment_stock_never_customer: "Stock photos have no customer; choose Internal or Public.",
};

/** 23505 unique violations by constraint name. */
export const UNIQUE_ERRORS: Record<string, string> = {
  staff_email_key: "A staff member with that email already exists.",
  staff_auth_user_id_key: "That login is already linked to a staff member.",
  staff_permissions_pkey: "That permission is already granted.",
  customers_pkey: "That customer has already been saved.",
  customers_auth_user_id_key: "That login is already linked to a customer.",
  customers_shopify_customer_id_key: "That Shopify customer is already linked to someone else.",
  bikes_pkey: "That bike has already been saved.",
  attachments_pkey: "That photo has already been saved.",
  attachments_storage_path_key: "That photo has already been saved.",
  // Workshop (Phase 3)
  work_orders_pkey: "That job has already been saved.",
  work_orders_job_number_key: "That job number is already taken. Try again.",
  work_order_line_items_pkey: "That line has already been saved.",
  services_pkey: "That service has already been saved.",
  services_active_name_key: "A service with that name already exists.",
  categories_pkey: "That category has already been saved.",
  categories_active_name_key: "A category with that name already exists.",
  cult_commons_rates_effective_from_key: "Another rate already starts at that time.",
  work_order_assignments_active_staff_key:
    "Someone else changed the assignments at the same time. Try again.",
  work_order_assignments_one_lead_key:
    "Someone else changed the assignments at the same time. Try again.",
  work_order_events_note_id_key: "That note has already been added.",
  // Inventory (Phase 4)
  products_pkey: "That product has already been saved.",
  products_short_id_key: "That product ID is already taken. Try again.",
  products_sku_key_unique: "Another product already uses that SKU.",
  products_public_slug_key: "Another product already uses that public address.",
  products_shopify_product_id_key: "That Shopify product is already linked to another product.",
  products_shopify_variant_id_key: "That Shopify variant is already linked to another product.",
  inventory_units_pkey: "That unit has already been saved.",
  inventory_units_short_id_key: "That unit ID is already taken. Try again.",
  inventory_units_bike_id_key: "That bike is already in stock as another unit.",
  inventory_units_sold_sale_line_id_key: "That sale is already recorded against another unit.",
  bikes_inventory_unit_id_key: "That unit is already linked to another bike.",
  locations_pkey: "That location has already been saved.",
  locations_name_key: "A location with that name already exists.",
  work_order_line_items_unit_once: "That unit is already on a job.",
  inventory_movements_request_once: "That stock change has already been recorded.",
  inventory_movements_job_consumption_once: "That part has already taken its stock.",
  inventory_movements_sale_line_once: "That sale has already taken its stock.",
  inventory_movements_receipt_line_once: "That delivery has already been received.",
  inventory_movements_reversal_of_id_key: "That stock change has already been reversed.",
};

/** 23514 check violations by constraint name. */
export const CHECK_ERRORS: Record<string, string> = {
  staff_display_name_check: "Enter a name.",
  staff_events_reason_check: "Keep the reason under 500 characters.",
  customers_identifies_someone: "Enter a name, an email or a phone number.",
  customers_email_check: "Enter a valid email address.",
  customers_first_name_check: "Keep the first name under 100 characters.",
  customers_last_name_check: "Keep the last name under 100 characters.",
  customers_display_name_check: "Keep the name under 200 characters.",
  customers_phone_check: "Keep the phone number under 40 characters.",
  customers_internal_notes_check: "Keep the notes under 10,000 characters.",
  bikes_brand_check: "Keep the brand under 100 characters.",
  bikes_model_check: "Keep the model under 100 characters.",
  bikes_variant_check: "Keep the variant under 100 characters.",
  bikes_frame_size_check: "Keep the frame size under 40 characters.",
  bikes_colour_check: "Keep the colour under 60 characters.",
  bikes_serial_number_check: "Keep the serial number under 100 characters.",
  bikes_description_check: "Keep the description under 2,000 characters.",
  bikes_internal_notes_check: "Keep the notes under 10,000 characters.",
  attachments_caption_check: "Keep the caption under 500 characters.",
  attachments_byte_size_check: "Photos must be under 20 MB.",
  attachments_customer_never_public: "Photos on a customer record cannot be made public.",
  attachments_work_order_never_public: "Photos on a job can't be made public.",
  // Shape checks the RPCs and triggers keep true; reaching one means a
  // writer outside them (an owner backfill, a new path) got something wrong.
  staff_events_permission_matches_type: "That staff history entry is not consistent.",
  bikes_short_id_format: "A bike ID looks like B-000123.",
  bike_ownership_events_registered_shape: "That ownership entry is not consistent.",
  bike_ownership_events_transfer_changes_owner: "A transfer must go to a different owner.",
  bike_ownership_events_transfer_has_reason: "Give a reason for the transfer.",
  bike_ownership_events_reason_check: "Keep the reason under 500 characters.",
  attachments_bucket_matches_visibility:
    "The photo was stored in the wrong place. Upload it again.",
  attachments_media_type_check: "Photos must be JPEG, PNG, WebP or HEIC.",
  attachments_path_shape: "The photo was uploaded to the wrong place. Try again.",
  attachments_extension_matches_media_type: "That file is not the type of photo it claims to be.",
  attachment_events_deleted_has_reason: "Give a reason for deleting the photo.",
  attachment_events_reason_check: "Keep the reason under 500 characters.",
  // Workshop (Phase 3)
  categories_name_check: "Enter a category name under 80 characters.",
  services_name_check: "Enter a service name under 120 characters.",
  services_description_check: "Keep the description under 2,000 characters.",
  services_default_sale_price_check: "Prices can't be negative.",
  services_default_direct_cost_check: "Costs can't be negative.",
  services_currency_check: "Use a three-letter currency code.",
  cult_commons_rates_rate_check: "The rate must be between 0% and 100%.",
  cult_commons_rates_cancelled_shape: "A cancelled rate needs the time it was cancelled.",
  work_orders_job_number_format: "A job number looks like J-000123.",
  work_orders_currency_check: "Use a three-letter currency code.",
  work_orders_collected_stamp: "The job's dates don't match its status. Refresh and try again.",
  work_orders_cancelled_stamp: "The job's dates don't match its status. Refresh and try again.",
  work_orders_completed_stamp: "The job's dates don't match its status. Refresh and try again.",
  work_orders_ready_stamp: "The job's dates don't match its status. Refresh and try again.",
  work_orders_ready_after_completed: "A job is ready for collection only after it is completed.",
  work_orders_completed_after_started: "A job is completed only after work has started.",
  work_orders_started_after_check_in: "Work can't start before the bike was checked in.",
  work_orders_completed_after_check_in: "A job can't be completed before the bike was checked in.",
  work_orders_collected_after_completed: "A job is collected only after it is completed.",
  work_orders_status_changed_after_check_in:
    "A job's status can't change before the bike was checked in.",
  work_order_assignments_unassigned_after_assigned:
    "Someone can't leave a job before they were assigned to it.",
  work_order_events_payload_object: "That timeline entry is not consistent.",
  work_orders_requested_work_check: "Say what the customer wants done, in under 2,000 characters.",
  work_orders_intake_notes_check: "Keep the condition notes under 5,000 characters.",
  work_orders_internal_notes_check: "Keep the internal notes under 10,000 characters.",
  work_orders_completion_notes_check: "Keep the completion notes under 5,000 characters.",
  work_orders_approval_note_check: "Keep the approval note under 500 characters.",
  work_orders_cancellation_reason_check: "Keep the reason under 500 characters.",
  work_order_line_items_description_check: "Enter a description under 300 characters.",
  work_order_line_items_quantity_check: "Quantity must be more than 0 and at most 9,999.",
  work_order_line_items_unit_sale_price_check: "Prices can't be negative.",
  work_order_line_items_unit_direct_cost_check: "Costs can't be negative.",
  work_order_line_items_void_reason_check: "Keep the reason under 500 characters.",
  work_order_line_items_inventory_source: "Parts are counted in whole units.",
  work_order_line_items_unit_quantity: "A unique item is added one at a time.",
  work_order_line_items_rate_check: "The rate must be between 0% and 100%.",
  work_order_line_items_currency_check: "Use a three-letter currency code.",
  work_order_line_items_void_shape: "A voided line needs a reason.",
  work_order_line_items_service_source: "A service line needs its service.",
  work_order_line_items_manual_source: "A manual line can't point at a service or a part.",
  work_order_line_items_cost_pending_shape:
    "Only a manual line without a cost can be cost pending.",
  money_amount_not_nan: "Enter an amount.",
  rate_fraction_not_nan: "Enter a rate.",
  line_quantity_not_nan: "Enter a quantity.",
  // Inventory (Phase 4)
  locations_name_check: "Enter a location name under 80 characters.",
  products_short_id_format: "A product ID looks like P-000123.",
  products_sku_check: "Keep the SKU under 64 characters.",
  products_name_check: "Enter a product name under 200 characters.",
  products_description_check: "Keep the description under 5,000 characters.",
  products_brand_check: "Keep the brand under 100 characters.",
  products_public_slug_format: "That public address is not valid.",
  products_default_sale_price_check: "Prices can't be negative.",
  products_default_direct_cost_check: "Costs can't be negative.",
  products_currency_check: "Use a three-letter currency code.",
  products_reorder_point_check: "The reorder point can't be negative.",
  inventory_units_short_id_format: "A unit ID looks like U-000123.",
  inventory_units_serial_number_check: "Keep the serial number under 100 characters.",
  inventory_units_condition_check: "Keep the condition under 500 characters.",
  inventory_units_internal_notes_check: "Keep the notes under 10,000 characters.",
  inventory_units_sale_price_check: "Prices can't be negative.",
  inventory_units_direct_cost_check: "Costs can't be negative.",
  inventory_units_consignment_shape: "A consigned unit needs its consignment record.",
  inventory_units_sold_shape:
    "The unit's sale date doesn't match its status. Refresh and try again.",
  inventory_movements_quantity_delta_check: "Enter a quantity other than zero, up to 100,000.",
  inventory_movements_unit_delta: "A unique item moves one at a time.",
  inventory_movements_reason_required: "Give a reason for this stock change.",
  inventory_movements_reason_check: "Keep the reason under 500 characters.",
  inventory_movements_reversal_shape: "That stock correction is not consistent.",
  inventory_movements_job_consumption_shape: "A part taken by a job needs its job and line.",
  inventory_movements_damaged_negative: "Damaged stock is removed: use a negative quantity.",
  inventory_movements_transfer_request: "A transfer needs its request.",
  inventory_movements_unit_cost_snapshot_check: "Costs can't be negative.",
  inventory_movements_currency_check: "Use a three-letter currency code.",
  product_events_payload_object: "That product history entry is not consistent.",
  inventory_unit_events_payload_object: "That unit history entry is not consistent.",
  attachments_stock_never_customer: "Stock photos have no customer; choose Internal or Public.",
};

/** Other fixed SQLSTATEs our RPCs raise on purpose. */
const SQLSTATE_ERRORS: Record<string, Pick<MappedError, "message" | "kind">> = {
  "42501": { message: FORBIDDEN_ERROR, kind: "forbidden" },
  P0002: { message: "That record no longer exists. Refresh and try again.", kind: "not_found" },
  "55000": {
    // Raised by staff_keep_an_active_admin: the only 55000 we use so far.
    message: "The shop must keep at least one active admin.",
    kind: "conflict",
  },
  "40001": { message: "Someone else changed this at the same time. Try again.", kind: "conflict" },
  "40P01": { message: "Someone else changed this at the same time. Try again.", kind: "conflict" },
  "22004": { message: "Some required values are missing.", kind: "invalid" },
  "22023": { message: "Some values are not allowed.", kind: "invalid" },
  "22P02": { message: "Some values are not in the right format.", kind: "invalid" },
  "22003": { message: "That amount is too large.", kind: "invalid" },
};

/** Constraint name from the error, or parsed from Postgres's message. */
export function constraintOf(error: DbErrorLike): string | undefined {
  if (error.constraint) return error.constraint;
  const match = /constraint "([^"]+)"/.exec(error.message ?? "");
  return match?.[1];
}

function isDbErrorLike(error: unknown): error is DbErrorLike {
  return typeof error === "object" && error !== null && ("code" in error || "message" in error);
}

export function mapDbError(error: unknown): MappedError {
  if (!isDbErrorLike(error) || typeof error.code !== "string" || error.code === "") {
    return { message: GENERIC_ERROR, kind: "unknown" };
  }
  const code = error.code;

  if (code === "P0001") {
    const reason = (error.message ?? "").trim();
    const known = BUSINESS_ERRORS[reason];
    return known
      ? { message: known, kind: "business", code, reason }
      : { message: GENERIC_ERROR, kind: "unknown", code, reason: reason || undefined };
  }

  if (code === "23505") {
    const constraint = constraintOf(error);
    return {
      message: (constraint && UNIQUE_ERRORS[constraint]) ?? "That already exists.",
      kind: "duplicate",
      code,
      reason: constraint,
    };
  }

  if (code === "23514") {
    const constraint = constraintOf(error);
    return {
      message: (constraint && CHECK_ERRORS[constraint]) ?? "Some values are not allowed.",
      kind: "invalid",
      code,
      reason: constraint,
    };
  }

  if (code === "23503") {
    return { message: "That refers to something that no longer exists.", kind: "invalid", code };
  }
  if (code === "23502") {
    return { message: "Some required values are missing.", kind: "invalid", code };
  }

  const fixed = SQLSTATE_ERRORS[code];
  if (fixed) return { ...fixed, code };

  // PostgREST's own errors: PGRST301 (JWT expired/invalid) and friends.
  if (code === "PGRST301" || code === "PGRST302") {
    return { message: "Your session has expired. Sign in again.", kind: "forbidden", code };
  }
  // Connection problems surface as fetch errors without a SQLSTATE; 08xxx
  // and 57P0x when the database itself is going away.
  if (code.startsWith("08") || code.startsWith("57P")) {
    return {
      message: "The database is unavailable. Try again shortly.",
      kind: "unavailable",
      code,
    };
  }

  return { message: GENERIC_ERROR, kind: "unknown", code };
}

/** A PostgREST error rethrown with its fields intact (`throw new DbError(error)`). */
export class DbError extends Error implements DbErrorLike {
  code?: string;
  details?: string | null;
  hint?: string | null;
  constructor(error: DbErrorLike) {
    super(error.message ?? "database error");
    this.name = "DbError";
    this.code = error.code;
    this.details = error.details ?? error.detail ?? null;
    this.hint = error.hint ?? null;
  }
}

/** `{ data, error }` -> data, or throw DbError. */
export function unwrap<T>(result: { data: T; error: DbErrorLike | null }): T {
  if (result.error) throw new DbError(result.error);
  return result.data;
}
