import { afterEach, describe, expect, it, vi } from "vitest";

import { UUID_RE, isUuid, newId } from "@/lib/uuid";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("newId", () => {
  it("makes distinct version-4 UUIDs", () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(UUID_RE);
    expect(a).not.toBe(b);
    expect(a[14]).toBe("4");
  });

  it("works without crypto.randomUUID (plain-http LAN address)", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("recognises UUIDs", () => {
    expect(isUuid("c1000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("B-000001")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
