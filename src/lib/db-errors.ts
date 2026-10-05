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
};

/** 23505 unique violations by constraint name. */
export const UNIQUE_ERRORS: Record<string, string> = {
  staff_email_key: "A staff member with that email already exists.",
  staff_auth_user_id_key: "That login is already linked to a staff member.",
  staff_permissions_pkey: "That permission is already granted.",
};

/** 23514 check violations by constraint name. */
export const CHECK_ERRORS: Record<string, string> = {
  staff_display_name_check: "Enter a name.",
  staff_events_reason_check: "Keep the reason under 500 characters.",
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
