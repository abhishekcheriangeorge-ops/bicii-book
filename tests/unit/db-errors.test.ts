import { describe, expect, it } from "vitest";

import {
  BUSINESS_ERRORS,
  DbError,
  FORBIDDEN_ERROR,
  GENERIC_ERROR,
  constraintOf,
  mapDbError,
  unwrap,
} from "@/lib/db-errors";

// Shapes as PostgREST (supabase-js) returns them.
const pgrst = (code: string, message: string, details: string | null = null) => ({
  code,
  message,
  details,
  hint: null,
});

describe("mapDbError", () => {
  it("maps insufficient_privilege (42501) to a permission message", () => {
    expect(mapDbError(pgrst("42501", "permission manage_staff required"))).toEqual({
      message: FORBIDDEN_ERROR,
      kind: "forbidden",
      code: "42501",
    });
  });

  it("maps our P0001 message codes to their user-facing text", () => {
    expect(
      mapDbError(
        pgrst(
          "P0001",
          "staff_email_mismatch",
          "The staff email must be the email of the Auth login it is linked to.",
        ),
      ),
    ).toEqual({
      message: BUSINESS_ERRORS.staff_email_mismatch,
      kind: "business",
      code: "P0001",
      reason: "staff_email_mismatch",
    });
  });

  it("never echoes an unknown P0001 message", () => {
    const mapped = mapDbError(pgrst("P0001", "secret internal detail about table x"));
    expect(mapped.message).toBe(GENERIC_ERROR);
    expect(mapped.kind).toBe("unknown");
  });

  it("maps unique violations (23505) by constraint, parsed from the message", () => {
    const mapped = mapDbError(
      pgrst(
        "23505",
        'duplicate key value violates unique constraint "staff_email_key"',
        "Key (email)=(a@b.c) already exists.",
      ),
    );
    expect(mapped).toEqual({
      message: "A staff member with that email already exists.",
      kind: "duplicate",
      code: "23505",
      reason: "staff_email_key",
    });
  });

  it("uses node-postgres's constraint field when present", () => {
    expect(
      mapDbError({ code: "23505", message: "dup", constraint: "staff_auth_user_id_key" }).message,
    ).toBe("That login is already linked to a staff member.");
  });

  it("falls back to a neutral message for unknown unique constraints", () => {
    expect(
      mapDbError(pgrst("23505", 'duplicate key value violates unique constraint "other_key"')),
    ).toMatchObject({ message: "That already exists.", kind: "duplicate", reason: "other_key" });
  });

  it("maps check violations (23514) by constraint", () => {
    expect(
      mapDbError(
        pgrst(
          "23514",
          'new row for relation "staff" violates check constraint "staff_display_name_check"',
        ),
      ),
    ).toMatchObject({
      message: "Enter a name.",
      kind: "invalid",
      reason: "staff_display_name_check",
    });
    expect(mapDbError(pgrst("23514", 'violates check constraint "mystery_check"')).message).toBe(
      "Some values are not allowed.",
    );
  });

  it("maps the last-admin guard (55000) and not-found (P0002)", () => {
    expect(mapDbError(pgrst("55000", "cannot remove the last active admin"))).toMatchObject({
      kind: "conflict",
      message: "The shop must keep at least one active admin.",
    });
    expect(mapDbError(pgrst("P0002", "staff 123 not found"))).toMatchObject({ kind: "not_found" });
  });

  it("maps expired JWTs and connection loss", () => {
    expect(mapDbError(pgrst("PGRST301", "JWT expired")).kind).toBe("forbidden");
    expect(mapDbError(pgrst("08006", "connection failure")).kind).toBe("unavailable");
  });

  it("treats anything else, including non-database errors, as generic", () => {
    for (const err of [
      new Error("boom"),
      "string",
      null,
      undefined,
      { message: "no code" },
      pgrst("XX000", "internal_error in relation staff"),
    ]) {
      expect(mapDbError(err).message).toBe(GENERIC_ERROR);
    }
  });
});

describe("constraintOf", () => {
  it("reads the quoted constraint name", () => {
    expect(constraintOf({ message: 'violates unique constraint "a_b_key"' })).toBe("a_b_key");
    expect(constraintOf({ message: "no constraint here" })).toBeUndefined();
  });
});

describe("unwrap / DbError", () => {
  it("returns data or throws a DbError that maps like the original", () => {
    expect(unwrap({ data: 1, error: null })).toBe(1);
    let thrown: unknown;
    try {
      unwrap({ data: null, error: pgrst("42501", "nope") });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DbError);
    expect(mapDbError(thrown).kind).toBe("forbidden");
  });
});
