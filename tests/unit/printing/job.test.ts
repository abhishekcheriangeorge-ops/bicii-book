import { describe, expect, it } from "vitest";

import { labelUnavailable } from "@/lib/printing/availability";
import {
  canTransition,
  isPrintable,
  maxLabelQuantity,
  printStatusLabel,
  printStatusTone,
} from "@/lib/printing/job";
import { pdfPath, printViewPath, recordPath, reprintPath } from "@/lib/printing/links";

import { PRINT_STATUSES, PRINT_TRANSITIONS } from "../../fixtures/print-transitions";

describe("canTransition (parity with private.print_job_transition_allowed, D59)", () => {
  for (const t of PRINT_TRANSITIONS) {
    it(`${t.from} -> ${t.to}: ${t.allowed ? "allowed" : "refused"}`, () => {
      expect(canTransition(t.from, t.to)).toBe(t.allowed);
    });
  }
});

describe("job status helpers", () => {
  it("prints only open jobs", () => {
    expect(PRINT_STATUSES.filter(isPrintable)).toEqual(["queued", "rendered"]);
  });

  it("labels and tones every status", () => {
    expect(PRINT_STATUSES.map(printStatusLabel)).toEqual([
      "Not printed yet",
      "Sent — confirm",
      "Printed",
      "Failed",
    ]);
    expect(PRINT_STATUSES.map(printStatusTone)).toEqual(["waiting", "progress", "done", "danger"]);
  });

  it("caps a job at 500 product labels or 10 unit or bike labels (D56)", () => {
    expect(maxLabelQuantity("product")).toBe(500);
    expect(maxLabelQuantity("unit")).toBe(10);
    expect(maxLabelQuantity("bike")).toBe(10);
  });
});

describe("labelUnavailable", () => {
  it("maps exactly the four printing-unavailable codes", () => {
    expect(labelUnavailable("label_entity_archived")).toEqual({
      reason: "archived",
      message: "That record is archived. Unarchive it before printing labels.",
    });
    expect(labelUnavailable("label_unique_product_needs_unit")?.reason).toBe("unique_product");
    expect(labelUnavailable("public_site_url_invalid")).toEqual({
      reason: "site_url_invalid",
      message:
        "Labels are off until an admin sets the public website address in Labels and printers settings.",
    });
    expect(labelUnavailable("label_template_missing")?.reason).toBe("no_template");
    expect(labelUnavailable("print_job_conflict")).toBeNull();
    expect(labelUnavailable("toString")).toBeNull();
    expect(labelUnavailable(undefined)).toBeNull();
  });
});

describe("links", () => {
  const id = "a9000000-0000-4000-8000-000000000001";
  const entity = "9a000000-0000-4000-8000-000000000011";
  it("builds record, reprint, print view and PDF paths", () => {
    expect(recordPath("product", entity)).toBe(`/products/${entity}`);
    expect(recordPath("unit", entity)).toBe(`/units/${entity}`);
    expect(recordPath("bike", entity)).toBe(`/bikes/${entity}`);
    expect(reprintPath({ id, kind: "product", entityId: entity, quantity: 10 })).toBe(
      `/products/${entity}?print=1&qty=10&reprint=${id}`,
    );
    expect(printViewPath(id)).toBe(`/print/labels/${id}`);
    expect(pdfPath(id)).toBe(`/api/labels/${id}/pdf`);
  });
});
