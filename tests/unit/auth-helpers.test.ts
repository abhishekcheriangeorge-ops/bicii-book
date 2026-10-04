import { describe, expect, it } from "vitest";

import { MORE_ITEMS, TABS, isActive, isMoreActive } from "@/components/shell/nav";
import {
  PERMISSIONS,
  effectivePermissions,
  hasPermission,
  isPermissionKey,
} from "@/lib/auth/permissions";
import { isPublicPath } from "@/lib/auth/routes";
import { greetingFor } from "@/lib/dates";
import { formDataToObject } from "@/lib/form-data";
import { requestIdFrom } from "@/lib/request-id";

describe("permission resolution (mirrors private.has_permission)", () => {
  it("admin implies every permission", () => {
    expect(effectivePermissions("admin", true, [])).toEqual([...PERMISSIONS]);
    expect(hasPermission({ role: "admin", active: true, permissions: [] }, "manage_staff")).toBe(
      true,
    );
  });

  it("staff have exactly what was granted", () => {
    expect(effectivePermissions("staff", true, ["view_costs"])).toEqual(["view_costs"]);
    expect(
      hasPermission({ role: "staff", active: true, permissions: ["view_costs"] }, "adjust_stock"),
    ).toBe(false);
  });

  it("inactive staff have none, admins included", () => {
    expect(effectivePermissions("admin", false, [])).toEqual([]);
    expect(effectivePermissions("staff", false, ["view_costs"])).toEqual([]);
    expect(
      hasPermission({ role: "admin", active: false, permissions: [...PERMISSIONS] }, "view_costs"),
    ).toBe(false);
  });

  it("recognises only the seven permission keys", () => {
    expect(PERMISSIONS).toHaveLength(7);
    expect(isPermissionKey("view_costs")).toBe(true);
    expect(isPermissionKey("superuser")).toBe(false);
    expect(isPermissionKey(1)).toBe(false);
  });
});

describe("isPublicPath", () => {
  it("opens only the login page, the dev gallery and health checks", () => {
    for (const p of ["/login", "/dev/ui", "/api/health"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/", "/loginx", "/settings", "/dev", "/api/healthz", "/jobs/login"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});

describe("requestIdFrom", () => {
  it("keeps a well-formed incoming id", () => {
    expect(requestIdFrom("abc12345-req")).toBe("abc12345-req");
  });

  it("replaces missing, short, long or odd ids with a UUID", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "short",
      "a".repeat(200),
      "evil\nheader-injection",
      "<script>x</script>",
    ]) {
      expect(requestIdFrom(bad)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe("formDataToObject", () => {
  it("flattens fields, collects repeats, drops React action keys", () => {
    const fd = new FormData();
    fd.append("email", "a@b.c");
    fd.append("tag", "x");
    fd.append("tag", "y");
    fd.append("$ACTION_ID_abc", "");
    expect(formDataToObject(fd)).toEqual({ email: "a@b.c", tag: ["x", "y"] });
  });
});

describe("navigation", () => {
  it("puts Scan in the middle of five tabs", () => {
    expect(TABS.map((t) => t.label)).toEqual(["Today", "Jobs", "Scan", "Inventory", "More"]);
  });

  it("lists the eight More destinations", () => {
    expect(MORE_ITEMS.map((i) => i.label)).toEqual([
      "Customers",
      "Bikes",
      "Appointments",
      "Consignment",
      "Purchasing",
      "Labels",
      "Reports",
      "Settings",
    ]);
  });

  it("matches sections by prefix, and Today only exactly", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/jobs", "/")).toBe(false);
    expect(isActive("/jobs/123", "/jobs")).toBe(true);
    expect(isActive("/jobsx", "/jobs")).toBe(false);
    expect(isMoreActive("/settings/staff")).toBe(true);
    expect(isMoreActive("/inventory")).toBe(false);
  });
});

describe("greetingFor", () => {
  it("uses the shop's time zone (Asia/Singapore, UTC+8)", () => {
    expect(greetingFor("2026-10-04T01:00:00Z")).toBe("Good morning"); // 09:00 SGT
    expect(greetingFor("2026-10-04T05:00:00Z")).toBe("Good afternoon"); // 13:00 SGT
    expect(greetingFor("2026-10-04T12:00:00Z")).toBe("Good evening"); // 20:00 SGT
  });
});
