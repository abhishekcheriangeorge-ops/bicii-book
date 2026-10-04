import { describe, expect, it } from "vitest";

import { MORE_ITEMS, TABS, isActive, isItemActive, isMoreActive } from "@/components/shell/nav";
import {
  PERMISSIONS,
  accessChangeBlocker,
  effectivePermissions,
  hasPermission,
  isPermissionKey,
  permissionChangeBlocker,
  type StaffDTO,
} from "@/lib/auth/permissions";
import { isPublicPath } from "@/lib/auth/routes";
import { greetingFor } from "@/lib/dates";
import { echoValues, formDataToObject } from "@/lib/form-data";
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

  it("keeps the Inventory tab active on products, units and movements", () => {
    const inventory = TABS.find((t) => t.label === "Inventory")!;
    for (const path of ["/inventory", "/inventory/movements", "/products/p1", "/units/u1"]) {
      expect(isItemActive(path, inventory)).toBe(true);
      expect(isMoreActive(path)).toBe(false);
    }
    expect(isItemActive("/productsx", inventory)).toBe(false);
    expect(isItemActive("/jobs", inventory)).toBe(false);
    const jobs = TABS.find((t) => t.label === "Jobs")!;
    expect(isItemActive("/jobs/1", jobs)).toBe(true);
  });
});

describe("greetingFor", () => {
  it("uses the shop's time zone (Asia/Singapore, UTC+8)", () => {
    expect(greetingFor("2026-10-04T01:00:00Z")).toBe("Good morning"); // 09:00 SGT
    expect(greetingFor("2026-10-04T05:00:00Z")).toBe("Good afternoon"); // 13:00 SGT
    expect(greetingFor("2026-10-04T12:00:00Z")).toBe("Good evening"); // 20:00 SGT
  });
});

describe("delegation ceiling (mirrors private.authorize_permission_change, PLAN D11)", () => {
  const actor = (role: "admin" | "staff", permissions: StaffDTO["permissions"]) => ({
    staffId: "me",
    role,
    active: true,
    permissions,
  });
  const colleague = { staffId: "them", role: "staff" as const };

  it("admins may change anything", () => {
    for (const p of PERMISSIONS) {
      expect(permissionChangeBlocker(actor("admin", [...PERMISSIONS]), colleague, p)).toBeNull();
    }
  });

  it("a manager grants only what they hold, never manage_staff, never to themselves or admins", () => {
    const manager = actor("staff", ["manage_staff", "adjust_stock"]);
    expect(permissionChangeBlocker(manager, colleague, "adjust_stock")).toBeNull();
    expect(permissionChangeBlocker(manager, colleague, "view_costs")).toMatch(/you have yourself/);
    expect(permissionChangeBlocker(manager, colleague, "manage_staff")).toMatch(/Only an admin/);
    expect(
      permissionChangeBlocker(manager, { staffId: "me", role: "staff" }, "adjust_stock"),
    ).toMatch(/your permissions/);
    expect(
      permissionChangeBlocker(manager, { staffId: "x", role: "admin" }, "adjust_stock"),
    ).toMatch(/Admins/);
  });

  it("staff without manage_staff change nothing", () => {
    expect(
      permissionChangeBlocker(actor("staff", ["view_costs"]), colleague, "view_costs"),
    ).toMatch(/Manage staff/);
  });

  it("access: nobody deactivates themselves; only admins change an admin's access", () => {
    const manager = actor("staff", ["manage_staff"]);
    expect(accessChangeBlocker(manager, colleague)).toBeNull();
    expect(accessChangeBlocker(manager, { staffId: "me", role: "staff" })).toMatch(/yourself/);
    expect(accessChangeBlocker(manager, { staffId: "x", role: "admin" })).toMatch(/Only an admin/);
    expect(
      accessChangeBlocker(actor("admin", [...PERMISSIONS]), { staffId: "x", role: "admin" }),
    ).toBeNull();
  });
});

describe("echoValues", () => {
  it("returns text fields to refill a form, never secrets or React's action keys", () => {
    const fd = new FormData();
    fd.set("displayName", "Priya Ramesh");
    fd.set("email", "priya-at-bicii");
    fd.set("password", "hunter2hunter2");
    fd.set("confirm", "hunter2hunter2");
    fd.set("currentPassword", "old");
    fd.set("pin", "1234");
    fd.set("$ACTION_ID_abc", "");
    fd.set("photo", new File(["x"], "x.jpg"));
    expect(echoValues(fd)).toEqual({
      displayName: "Priya Ramesh",
      email: "priya-at-bicii",
    });
  });
});
