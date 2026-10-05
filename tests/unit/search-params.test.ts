import { describe, expect, it } from "vitest";

import { MAX_QUERY_LENGTH, readFlag, readQuery, withParam } from "@/lib/search-params";

describe("readQuery", () => {
  it("trims, collapses inner whitespace and takes the first value", () => {
    expect(readQuery("  tan   wei  ")).toBe("tan wei");
    expect(readQuery(["B-000001", "other"])).toBe("B-000001");
    expect(readQuery(undefined)).toBe("");
    expect(readQuery(null)).toBe("");
    expect(readQuery([])).toBe("");
  });

  it("caps the query at 200 characters, like staff_search", () => {
    const long = `${"a".repeat(199)} ${"b".repeat(50)}`;
    expect(readQuery(long)).toHaveLength(199);
    expect(readQuery("x".repeat(500))).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe("readFlag", () => {
  it("is true only for an explicit yes", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on", [" 1 "]]) expect(readFlag(v)).toBe(true);
    for (const v of ["0", "false", "", "archived", undefined, null])
      expect(readFlag(v)).toBe(false);
  });
});

describe("withParam", () => {
  it("sets a parameter and keeps the others", () => {
    expect(withParam("archived=1", "q", "tan")).toBe("?archived=1&q=tan");
    expect(withParam(new URLSearchParams({ q: "old" }), "q", "new")).toBe("?q=new");
  });

  it("removes a blank parameter, and returns nothing when none is left", () => {
    expect(withParam("q=tan&archived=1", "q", "  ")).toBe("?archived=1");
    expect(withParam("q=tan", "q", "")).toBe("");
    expect(withParam("", "q", null)).toBe("");
  });

  it("encodes what staff typed", () => {
    expect(withParam("", "q", "S/N 12&3")).toBe("?q=S%2FN+12%263");
  });
});
