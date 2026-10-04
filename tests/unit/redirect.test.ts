import { describe, expect, it } from "vitest";

import { DEFAULT_AFTER_LOGIN, loginUrlFor, safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it.each([
    ["/settings/profile", "/settings/profile"],
    ["/jobs?status=ready#top", "/jobs?status=ready#top"],
    ["/a/../settings", "/settings"],
    ["  /jobs  ", "/jobs"],
  ])("keeps same-origin path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    42,
    "",
    "https://evil.example/phish",
    "http://localhost:3000/",
    "//evil.example/phish",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "evil.example",
    "/jobs\u0000",
    "/\tevil",
    "/login",
    "/login?next=/jobs",
    `/${"a".repeat(3000)}`,
  ])("falls back to Today for %j", (input) => {
    expect(safeNextPath(input)).toBe(DEFAULT_AFTER_LOGIN);
  });
});

describe("loginUrlFor", () => {
  it("adds an encoded next only when it is not Today", () => {
    expect(loginUrlFor("/")).toBe("/login");
    expect(loginUrlFor("/settings/staff?x=1")).toBe("/login?next=%2Fsettings%2Fstaff%3Fx%3D1");
    expect(loginUrlFor("//evil.example")).toBe("/login");
  });
});
