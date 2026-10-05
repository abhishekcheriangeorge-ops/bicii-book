import { describe, expect, it } from "vitest";

import { bikeDetails, bikeSubtitle, bikeTitle } from "@/lib/bikes";
import {
  groupHits,
  hrefForHit,
  isSearchKind,
  SEARCH_KIND_LABELS,
  SEARCH_KINDS,
  shortIdJump,
  type SearchHit,
} from "@/lib/search";

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
    expect(isSearchKind("appointment")).toBe(false);
  });

  it("opens suppliers and purchase orders in Purchasing (Phase 7)", () => {
    expect(hrefForHit({ kind: "supplier", id: "s" })).toBe("/purchasing/suppliers/s");
    expect(hrefForHit({ kind: "purchase_order", id: "o" })).toBe("/purchasing/orders/o");
    expect(isSearchKind("supplier")).toBe(true);
    expect(isSearchKind("purchase_order")).toBe(true);
    expect(SEARCH_KINDS.slice(-2)).toEqual(["supplier", "purchase_order"]);
    expect(SEARCH_KIND_LABELS.supplier).toBe("Suppliers");
    expect(SEARCH_KIND_LABELS.purchase_order).toBe("Purchase orders");
  });

  it("puts an exact PO number's group first", () => {
    const groups = groupHits([
      hit("supplier", "s1", 0.9),
      hit("purchase_order", "o1", 1),
      hit("customer", "c1", 0.5),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["purchase_order", "supplier", "customer"]);
    expect(groups[0].label).toBe("Purchase orders");
  });

  it("opens consignors and consignment items in Consignment (Phase 6)", () => {
    expect(hrefForHit({ kind: "consignor", id: "k" })).toBe("/consignment/consignors/k");
    expect(hrefForHit({ kind: "consignment_item", id: "c" })).toBe("/consignment/items/c");
    expect(isSearchKind("consignor")).toBe(true);
    expect(isSearchKind("consignment_item")).toBe(true);
  });

  it("opens sales on their page and labels the group Sales (Phase 6)", () => {
    expect(isSearchKind("sale")).toBe(true);
    expect(hrefForHit({ kind: "sale", id: "s" })).toBe("/sales/s");
    const groups = groupHits([hit("sale", "s1", 1), hit("customer", "k1", 0.6)]);
    expect(groups.map((g) => g.label)).toEqual(["Sales", "Customers"]);
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
