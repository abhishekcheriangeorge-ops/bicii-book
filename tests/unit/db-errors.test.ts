import { describe, expect, it } from "vitest";

import {
  BUSINESS_ERRORS,
  CHECK_ERRORS,
  DbError,
  FORBIDDEN_ERROR,
  GENERIC_ERROR,
  UNIQUE_ERRORS,
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

  it("maps the workshop's business errors, unique indexes and checks (Phase 3)", () => {
    expect(mapDbError(pgrst("P0001", "work_order_transition_invalid"))).toMatchObject({
      kind: "business",
      message: "A job can't move to that status from where it is now.",
    });
    expect(mapDbError(pgrst("P0001", "bike_owner_mismatch")).message).toBe(
      "That bike belongs to someone else. Transfer it to this customer first.",
    );
    expect(mapDbError(pgrst("P0001", "attachment_work_order_never_public")).message).toBe(
      "Photos on a job can't be made public.",
    );
    expect(
      mapDbError({
        code: "23505",
        message: "dup",
        constraint: "work_order_assignments_one_lead_key",
      }),
    ).toMatchObject({
      kind: "duplicate",
      message: "Someone else changed the assignments at the same time. Try again.",
    });
    expect(
      mapDbError(
        pgrst(
          "23514",
          'new row for relation "work_order_line_items" violates check constraint "work_order_line_items_quantity_check"',
        ),
      ).message,
    ).toBe("Quantity must be more than 0 and at most 9,999.");
    expect(
      mapDbError(
        pgrst(
          "23514",
          'value for domain line_quantity violates check constraint "line_quantity_not_nan"',
        ),
      ).message,
    ).toBe("Enter a quantity.");
    expect(
      mapDbError({
        code: "23514",
        message: "check",
        constraint: "attachments_work_order_never_public",
      }).message,
    ).toBe("Photos on a job can't be made public.");
  });

  it("maps the inventory's business errors, unique indexes and checks (Phase 4)", () => {
    expect(mapDbError(pgrst("P0001", "part_cost_missing"))).toMatchObject({
      kind: "business",
      message:
        "This part has no cost yet, so its yield cannot be worked out. Ask someone with cost access to set it.",
    });
    expect(mapDbError(pgrst("P0001", "location_required")).message).toBe(
      "There is no active stock location. Add one in Settings → Locations.",
    );
    expect(mapDbError(pgrst("P0001", "line_type_unsupported")).message).toBe(GENERIC_ERROR);
    expect(
      mapDbError({ code: "23505", message: "dup", constraint: "products_sku_key_unique" }).message,
    ).toBe("Another product already uses that SKU.");
    expect(
      mapDbError({ code: "23505", message: "dup", constraint: "work_order_line_items_unit_once" })
        .message,
    ).toBe("That unit is already on a job.");
    expect(
      mapDbError({
        code: "23514",
        message: "check",
        constraint: "attachments_stock_never_customer",
      }).message,
    ).toBe("Stock photos have no customer; choose Internal or Public.");
  });

  it("maps numeric overflow (22003) to a plain message", () => {
    expect(mapDbError(pgrst("22003", "numeric field overflow"))).toEqual({
      message: "That amount is too large.",
      kind: "invalid",
      code: "22003",
    });
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

/**
 * Codes that a merged migration still contains but that nothing raises any
 * more, because a later migration replaced the function that raised them
 * (merged migrations are never edited). Each maps to the migration that
 * retired it; no migration from that one on may raise it again.
 */
const RETIRED_CODES: Record<string, string> = {
  // Phase 3's void_line refused part lines until Phase 4 replaced it with
  // the stock-reversal branch.
  line_type_unsupported: "20261004001900_inventory_jobs.sql",
};

describe("BUSINESS_ERRORS covers every code the migrations raise", () => {
  it("has a message for each P0001 MESSAGE code in supabase/migrations", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const codes = new Set<string>();
    const raisedFrom = new Map<string, string[]>();
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = readFileSync(path.join(dir, file), "utf8");
      for (const m of sql.matchAll(/message\s*=\s*'([a-z0-9_]+)'/g)) {
        codes.add(m[1]);
        raisedFrom.set(m[1], [...(raisedFrom.get(m[1]) ?? []), file]);
      }
    }
    expect(codes.size).toBeGreaterThan(0);
    expect([...codes].filter((c) => !(c in BUSINESS_ERRORS) && !(c in RETIRED_CODES))).toEqual([]);
    for (const [code, retiredBy] of Object.entries(RETIRED_CODES)) {
      expect(files).toContain(retiredBy);
      expect((raisedFrom.get(code) ?? []).filter((f) => f >= retiredBy)).toEqual([]);
      expect(code in BUSINESS_ERRORS).toBe(false);
    }
  });
});

describe("CHECK_ERRORS and UNIQUE_ERRORS cover every named constraint", () => {
  it("maps each `constraint <name> check` and `create unique index <name>` in supabase/migrations", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const checks = new Set<string>();
    const uniques = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(path.join(dir, file), "utf8");
      for (const m of sql.matchAll(/constraint\s+([a-z0-9_]+)\s+check\b/g)) checks.add(m[1]);
      for (const m of sql.matchAll(/create unique index\s+([a-z0-9_]+)/g)) uniques.add(m[1]);
    }
    expect(checks.size).toBeGreaterThan(0);
    expect(uniques.size).toBeGreaterThan(0);
    expect([...checks].filter((c) => !(c in CHECK_ERRORS))).toEqual([]);
    expect([...uniques].filter((c) => !(c in UNIQUE_ERRORS))).toEqual([]);
  });

  it("maps a check re-raised without its row (raise_without_row) by its constraint", () => {
    // What a security definer writer now returns through PostgREST: the
    // constraint in the message, no DETAIL.
    expect(
      mapDbError({
        code: "23514",
        message:
          'new row for relation "work_order_line_items" violates check constraint "work_order_line_items_quantity_check"',
        details: null,
        hint: null,
      }),
    ).toEqual({
      message: CHECK_ERRORS.work_order_line_items_quantity_check,
      kind: "invalid",
      code: "23514",
      reason: "work_order_line_items_quantity_check",
    });
  });
});
