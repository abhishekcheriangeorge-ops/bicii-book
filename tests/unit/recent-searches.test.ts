import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_RECENT_SEARCHES,
  RECENT_SEARCHES_EVENT,
  RECENT_SEARCHES_KEY,
  clearRecentSearches,
  parseRecentSearches,
  readRecentSearches,
  rememberSearch,
  subscribeRecentSearches,
} from "@/lib/recent-searches";

afterEach(() => {
  window.localStorage.clear();
});

describe("recent searches (per device, localStorage)", () => {
  it("keeps the newest first, without case-insensitive duplicates", () => {
    rememberSearch("tan");
    rememberSearch("B-000001");
    expect(rememberSearch("  TAN ")).toEqual(["TAN", "B-000001"]);
    expect(readRecentSearches()).toEqual(["TAN", "B-000001"]);
  });

  it("keeps at most eight and ignores blank queries", () => {
    for (let i = 0; i < 12; i++) rememberSearch(`q${i}`);
    expect(rememberSearch("   ")).toHaveLength(MAX_RECENT_SEARCHES);
    expect(readRecentSearches()[0]).toBe("q11");
  });

  it("survives malformed stored data", () => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, "{not json");
    expect(readRecentSearches()).toEqual([]);
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify({ q: "x" }));
    expect(readRecentSearches()).toEqual([]);
    expect(parseRecentSearches(JSON.stringify(["a", 3, "", "b"]))).toEqual(["a", "b"]);
  });

  it("never throws when storage is unavailable or refuses", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readRecentSearches(broken)).toEqual([]);
    expect(rememberSearch("tan", broken)).toEqual(["tan"]);
    expect(() => clearRecentSearches(broken)).not.toThrow();
    expect(readRecentSearches(null)).toEqual([]);
  });

  it("tells subscribers in this tab when the list changes", () => {
    let calls = 0;
    const stop = subscribeRecentSearches(() => calls++);
    rememberSearch("tan");
    clearRecentSearches();
    window.dispatchEvent(new Event(RECENT_SEARCHES_EVENT));
    stop();
    rememberSearch("after");
    expect(calls).toBe(3);
    expect(readRecentSearches()).toEqual(["after"]);
  });
});
