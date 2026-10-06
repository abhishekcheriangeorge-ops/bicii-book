import { describe, expect, it } from "vitest";

import {
  exceptionCopy,
  exceptionHref,
  exceptionLabel,
  type OperationalException,
} from "@/lib/reports";

/**
 * Phase 9 step 4's additions to Phase 5's exception helpers (PLAN D34,
 * D104, D106–D108): a label for every kind the views emit, the sentences
 * of the new kinds and the links of their records. Phase 5's own cases are
 * in tests/unit/reports.test.ts and stay as they were.
 */

const row = (patch: Partial<OperationalException>): OperationalException => ({
  kind: "unit_state_mismatch",
  severity: "danger",
  entityType: "inventory_unit",
  entityId: "c3000000-0000-4000-8000-000000000001",
  entityLabel: "U-000001",
  subjectLabel: "Canyon Grizl",
  days: 4,
  quantity: null,
  since: "2026-10-02T02:00:00Z",
  issue: "location_mismatch",
  shortId: "U-000001",
  title: "U-000001",
  detail: "The unit is recorded at Shop floor; the ledger has it at Workshop store.",
  amount: null,
  currency: null,
  ...patch,
});

/** Every kind public.operational_exceptions can emit (Phase 5's five, then Phase 9's three). */
const KINDS = [
  "overdue_job",
  "uncollected_job",
  "negative_stock",
  "unit_hold_stale",
  "currency_mismatch",
  "unit_state_mismatch",
  "unsettled_consignment",
  "integration_failed",
] as const;

describe("exception kinds (D34, D106–D108)", () => {
  it("has a pill label for every kind the database emits", () => {
    for (const kind of KINDS) expect(exceptionLabel(kind), kind).not.toBe("Needs attention");
    expect(exceptionLabel("unit_state_mismatch")).toBe("Impossible state");
    expect(exceptionLabel("unsettled_consignment")).toBe("Unsettled consignment");
    // Phase 10's wording, so the later merge is the same line.
    expect(exceptionLabel("integration_failed")).toBe("Shopify needs attention");
  });

  it("still renders a kind this build does not know", () => {
    expect(exceptionLabel("purchase_overdue")).toBe("Needs attention");
    expect(exceptionCopy("purchase_overdue", row({ severity: "warning" }))).toEqual({
      text: "Check U-000001 · Canyon Grizl",
      tone: "waiting",
    });
  });

  it("words an impossible state by its reconciliation issue", () => {
    expect(exceptionCopy("unit_state_mismatch", row({}))).toEqual({
      text: "The item's location does not match where the ledger last moved it.",
      tone: "danger",
    });
    expect(exceptionCopy("unit_state_mismatch", row({ issue: "unit_count_mismatch" })).text).toBe(
      "The number of items in stock here differs from the ledger.",
    );
    expect(exceptionCopy("unit_state_mismatch", row({ issue: "new_issue" })).text).toBe(
      "The records and the stock ledger disagree",
    );
  });

  it("words an unsettled consignment with the database's outstanding amount", () => {
    const consignment = row({
      kind: "unsettled_consignment",
      severity: "warning",
      entityType: "consignment_item",
      entityLabel: "C-000007",
      subjectLabel: "Lee Wen · Brompton C Line",
      days: 45,
      issue: "unsettled_consignment",
      shortId: "C-000007",
      title: "C-000007 · Lee Wen",
      amount: "2000.00",
      currency: "SGD",
    });
    expect(exceptionCopy("unsettled_consignment", consignment)).toEqual({
      text: "Sold 45 days ago; $2,000.00 outstanding to Lee Wen",
      tone: "waiting",
    });
    // Without an amount it never shows $0.00.
    expect(exceptionCopy("unsettled_consignment", { ...consignment, amount: null }).text).toBe(
      "Sold 45 days ago and not fully paid to the consignor.",
    );
  });

  it("opens consignment items and sales, and leaves Phase 10's queue unlinked on this branch", () => {
    const id = "c4000000-0000-4000-8000-000000000001";
    expect(exceptionHref(row({ entityType: "consignment_item", entityId: id }))).toBe(
      `/consignment/items/${id}`,
    );
    expect(exceptionHref(row({ entityType: "sale", entityId: id }))).toBe(`/sales/${id}`);
    expect(exceptionHref(row({ entityType: "inventory_unit", entityId: id }))).toBe(`/units/${id}`);
    expect(exceptionHref(row({ entityType: "integration_job", entityId: id }))).toBeNull();
  });
});
