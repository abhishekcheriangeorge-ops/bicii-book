import { describe, expect, it } from "vitest";

import { bikeDetails, bikeSubtitle, bikeTitle } from "@/lib/bikes";
import { groupHits, hrefForHit, isSearchKind, type SearchHit } from "@/lib/search";

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

  it("leaves out empty groups", () => {
    expect(groupHits([])).toEqual([]);
    expect(groupHits([hit("bike", "b1", 1)]).map((g) => g.kind)).toEqual(["bike"]);
  });
});

describe("hrefForHit", () => {
  it("opens the staff record", () => {
    expect(hrefForHit({ kind: "customer", id: "x" })).toBe("/customers/x");
    expect(hrefForHit({ kind: "bike", id: "y" })).toBe("/bikes/y");
    expect(isSearchKind("work_order")).toBe(false);
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
