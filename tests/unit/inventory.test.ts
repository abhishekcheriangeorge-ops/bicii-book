import { describe, expect, it } from "vitest";

import {
  PUBLICATION_STATUSES,
  PUBLICATION_TRANSITIONS,
  UNIT_STATUSES,
  UNIT_STATUS_TRANSITIONS,
  canChangePublication,
  canChangeUnitStatus,
  manualPublicationTargets,
} from "@/lib/inventory";

describe("publication machine (D26)", () => {
  it("covers every status and never lists a same-status move", () => {
    expect(Object.keys(PUBLICATION_TRANSITIONS).sort()).toEqual([...PUBLICATION_STATUSES].sort());
    for (const s of PUBLICATION_STATUSES) expect(canChangePublication(s, s)).toBe(false);
  });

  it("allows exactly the documented moves", () => {
    const allowed = PUBLICATION_STATUSES.flatMap((from) =>
      PUBLICATION_STATUSES.filter((to) => canChangePublication(from, to)).map(
        (to) => `${from}->${to}`,
      ),
    ).sort();
    expect(allowed).toEqual(
      [
        "draft->internal_only",
        "draft->archived",
        "internal_only->public",
        "internal_only->archived",
        "public->internal_only",
        "public->sold",
        "public->archived",
        "sold->public",
        "sold->archived",
        "archived->internal_only",
      ].sort(),
    );
  });

  it("never offers sold by hand; from sold only archived; no public without an available unit", () => {
    expect(
      manualPublicationTargets("public", { trackingType: "unique", availableUnits: 1 }),
    ).toEqual(["internal_only", "archived"]);
    expect(manualPublicationTargets("sold", { trackingType: "unique", availableUnits: 3 })).toEqual(
      ["archived"],
    );
    expect(
      manualPublicationTargets("internal_only", { trackingType: "unique", availableUnits: 0 }),
    ).toEqual(["archived"]);
    expect(
      manualPublicationTargets("internal_only", { trackingType: "unique", availableUnits: 1 }),
    ).toEqual(["public", "archived"]);
    expect(
      manualPublicationTargets("internal_only", { trackingType: "quantity", availableUnits: 0 }),
    ).toEqual(["public", "archived"]);
    expect(
      manualPublicationTargets("draft", { trackingType: "quantity", availableUnits: 0 }),
    ).toEqual(["internal_only", "archived"]);
    expect(
      manualPublicationTargets("archived", { trackingType: "quantity", availableUnits: 0 }),
    ).toEqual(["internal_only"]);
  });
});

describe("unit status machine", () => {
  it("covers every status and never lists a same-status move", () => {
    expect(Object.keys(UNIT_STATUS_TRANSITIONS).sort()).toEqual([...UNIT_STATUSES].sort());
    for (const s of UNIT_STATUSES) expect(canChangeUnitStatus(s, s)).toBe(false);
  });

  it("returns a sold unit to held_for_customer only (the reopen rule, D25) or available", () => {
    expect(canChangeUnitStatus("sold", "held_for_customer")).toBe(true);
    expect(canChangeUnitStatus("sold", "available")).toBe(true);
    expect(canChangeUnitStatus("sold", "reserved")).toBe(false);
    expect(canChangeUnitStatus("held_for_customer", "sold")).toBe(true);
    expect(canChangeUnitStatus("held_for_customer", "written_off")).toBe(false);
    expect(UNIT_STATUS_TRANSITIONS.returned_to_consignor).toEqual([]);
    expect(canChangeUnitStatus("written_off", "available")).toBe(true);
  });
});
