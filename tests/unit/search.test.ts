import { describe, expect, it } from "vitest";

import { bikeDetails, bikeSubtitle, bikeTitle } from "@/lib/bikes";
import { groupHits, hrefForHit, isSearchKind, shortIdJump, type SearchHit } from "@/lib/search";

const hit = (kind: SearchHit["kind"], id: string, rank: number): SearchHit => ({
  kind,
  id,
  title: id,
  subtitle: null,
  shortId: null,
  rank,
});

describe("groupHits", () => {
  it("groups by kind and keeps the database order inside each group", () => {
    const groups = groupHits([
      hit("customer", "c1", 0.9),
      hit("bike", "b1", 0.8),
      hit("customer", "c2", 0.7),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Customers", "Bikes"]);
    expect(groups[0].hits.map((h) => h.id)).toEqual(["c1", "c2"]);
  });

  it("puts the group with the best hit first: an exact B- number or serial lists Bikes first", () => {
    const groups = groupHits([hit("customer", "c1", 0.6), hit("bike", "b1", 1)]);
    expect(groups.map((g) => g.kind)).toEqual(["bike", "customer"]);
  });

  it("puts Jobs first for an exact J- number", () => {
    const groups = groupHits([
      hit("customer", "c1", 0.6),
      hit("bike", "b1", 0.6),
      hit("work_order", "j1", 1),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Jobs", "Customers", "Bikes"]);
  });

  it("puts Products first for an exact P- number or SKU", () => {
    const groups = groupHits([
      hit("customer", "c1", 0.6),
      hit("bike", "b1", 0.7),
      hit("inventory_unit", "u1", 0.5),
      hit("product", "p1", 1),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Products", "Bikes", "Customers", "Units"]);
  });

  it("leaves out empty groups", () => {
    expect(groupHits([])).toEqual([]);
    expect(groupHits([hit("bike", "b1", 1)]).map((g) => g.kind)).toEqual(["bike"]);
  });
});

describe("hrefForHit", () => {
  it("opens the staff record", () => {
    expect(hrefForHit({ kind: "customer", id: "x" })).toBe("/customers/x");
    expect(hrefForHit({ kind: "bike", id: "y" })).toBe("/bikes/y");
    expect(hrefForHit({ kind: "work_order", id: "z" })).toBe("/jobs/z");
    expect(hrefForHit({ kind: "product", id: "p" })).toBe("/products/p");
    expect(hrefForHit({ kind: "inventory_unit", id: "u" })).toBe("/units/u");
    expect(isSearchKind("work_order")).toBe(true);
    expect(isSearchKind("product")).toBe(true);
    expect(isSearchKind("inventory_unit")).toBe(true);
    expect(isSearchKind("supplier")).toBe(false);
  });

  it("opens consignors and consignment items in Consignment (Phase 6)", () => {
    expect(hrefForHit({ kind: "consignor", id: "k" })).toBe("/consignment/consignors/k");
    expect(hrefForHit({ kind: "consignment_item", id: "c" })).toBe("/consignment/items/c");
    expect(isSearchKind("consignor")).toBe(true);
    expect(isSearchKind("consignment_item")).toBe(true);
    // Sales arrive with their page (Phase 6 step 4).
    expect(isSearchKind("sale")).toBe(false);
  });

  it("labels the consignment groups", () => {
    const groups = groupHits([hit("consignor", "k1", 0.6), hit("consignment_item", "c1", 1)]);
    expect(groups.map((g) => g.label)).toEqual(["Consignment items", "Consignors"]);
  });
});

describe("bike naming (mirrors private.search_bikes)", () => {
  it("titles a bike by brand, model and variant", () => {
    expect(bikeTitle({ brand: "Specialized", model: "Tarmac SL7", variant: "Expert" })).toBe(
      "Specialized Tarmac SL7 Expert",
    );
    expect(bikeTitle({ brand: "Surly", model: "Long Haul Trucker", variant: null })).toBe(
      "Surly Long Haul Trucker",
    );
  });

  it("describes owner, colour and serial number", () => {
    expect(
      bikeSubtitle({ ownerLabel: "Tan Wei Ming", colour: "Gloss Red Tint", serialNumber: "WSB1" }),
    ).toBe("Tan Wei Ming · Gloss Red Tint · S/N WSB1");
    expect(bikeSubtitle({ ownerLabel: null, colour: null, serialNumber: null })).toBe("Shop bike");
    expect(bikeDetails({ colour: " ", serialNumber: null })).toBeNull();
  });
});

describe("shortIdJump", () => {
  it("opens an exact short ID through /q, in any case", () => {
    expect(shortIdJump("P-000001")).toBe("/q/P-000001");
    expect(shortIdJump(" b-000011 ")).toBe("/q/B-000011");
    expect(shortIdJump("j-000004")).toBe("/q/J-000004");
  });

  it("leaves everything else to the results page", () => {
    for (const q of ["", "brompton", "P-0001", "J000004", "TT-123", "P-000001 tube"]) {
      expect(shortIdJump(q), q).toBeNull();
    }
  });
});
