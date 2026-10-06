/**
 * The staff guard (src/lib/auth/session.ts) refuses an inactive person
 * whose session is still valid (PLAN D71). On hosted projects that verify
 * JWTs locally, a deactivated person's access token keeps working until it
 * expires (at most jwt_expiry); requireStaff / authorizeStaff answer 403
 * for that window even where no permission is needed (Today, the profile).
 * tests/e2e/staff.spec.ts drives the same window through the real app.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class Forbidden extends Error {}
class Redirect extends Error {}
vi.mock("next/navigation", () => ({
  forbidden: () => {
    throw new Forbidden("forbidden");
  },
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

import { authorizeStaff, requireAdmin, requireStaff } from "@/lib/auth/session";
import type { ServerSupabase } from "@/lib/supabase/server";

const USER = "c0000000-0000-4000-8000-000000000001";
const STAFF_ID = "c0000000-0000-4000-8000-000000000002";

type ProfileRow = {
  id: string;
  auth_user_id: string;
  display_name: string;
  email: string;
  role: "admin" | "manager" | "mechanic";
  active: boolean;
  permissions: string[];
};

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: STAFF_ID,
    auth_user_id: USER,
    display_name: "Wendy Window",
    email: "wendy@example.test",
    role: "mechanic",
    active: true,
    permissions: [],
    ...overrides,
  };
}

/** A client whose JWT verifies (getClaims) and whose my_staff_profile returns `row`. */
function client(row: ProfileRow | null, signedIn = true): ServerSupabase {
  return {
    auth: {
      getClaims: vi.fn(async () =>
        signedIn
          ? { data: { claims: { sub: USER, email: "wendy@example.test" } }, error: null }
          : { data: null, error: null },
      ),
    },
    rpc: vi.fn(async (name: string) => {
      expect(name).toBe("my_staff_profile");
      return { data: row ? [row] : [], error: null };
    }),
  } as unknown as ServerSupabase;
}

beforeEach(() => {
  createClient.mockReset();
});

describe("authorizeStaff (Server Actions)", () => {
  it("admits active staff with a verified session", async () => {
    const { staff } = await authorizeStaff(client(profile()));
    expect(staff).toMatchObject({ staffId: STAFF_ID, active: true });
  });

  it("refuses an inactive person whose session is still valid, with no permission required", async () => {
    await expect(authorizeStaff(client(profile({ active: false })))).rejects.toBeInstanceOf(
      Forbidden,
    );
    // Even an inactive admin: the active check, not a permission, refuses it.
    await expect(
      authorizeStaff(client(profile({ role: "admin", active: false }))),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("refuses a login that is not staff, and sends a signed-out caller to /login", async () => {
    await expect(authorizeStaff(client(null))).rejects.toBeInstanceOf(Forbidden);
    await expect(authorizeStaff(client(profile(), false))).rejects.toThrow(new Redirect("/login"));
  });
});

describe("requireStaff and requireAdmin (pages)", () => {
  it("admit active staff and an active admin", async () => {
    createClient.mockResolvedValue(client(profile()));
    await expect(requireStaff()).resolves.toMatchObject({ staffId: STAFF_ID });
    createClient.mockResolvedValue(client(profile({ role: "admin" })));
    await expect(requireAdmin()).resolves.toMatchObject({ role: "admin" });
  });

  it("answer 403 to an inactive person whose session is still valid (D71's hosted window)", async () => {
    createClient.mockResolvedValue(client(profile({ active: false })));
    await expect(requireStaff()).rejects.toBeInstanceOf(Forbidden);
    createClient.mockResolvedValue(client(profile({ role: "admin", active: false })));
    await expect(requireAdmin()).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("role requirements (D94 refunds, admin-only settings)", () => {
  it("roles: a manager and an admin pass [admin, manager]; a mechanic gets 403", async () => {
    const refunders = { roles: ["admin", "manager"] as const };
    await expect(
      authorizeStaff(client(profile({ role: "manager" })), refunders),
    ).resolves.toMatchObject({ staff: { role: "manager" } });
    await expect(
      authorizeStaff(client(profile({ role: "admin" })), refunders),
    ).resolves.toMatchObject({ staff: { role: "admin" } });
    await expect(authorizeStaff(client(profile()), refunders)).rejects.toBeInstanceOf(Forbidden);
  });

  it("roles: no exception satisfies a role requirement", async () => {
    const everything = [
      "view_costs",
      "manage_inventory",
      "adjust_stock",
      "manage_consignments",
      "manage_purchasing",
      "manage_staff",
      "view_financial_reports",
    ];
    await expect(
      authorizeStaff(client(profile({ permissions: everything })), {
        roles: ["admin", "manager"],
      }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("roles: an inactive manager gets 403", async () => {
    await expect(
      authorizeStaff(client(profile({ role: "manager", active: false })), {
        roles: ["admin", "manager"],
      }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("admin: still refuses a manager (admin-only settings stay admin-only)", async () => {
    await expect(
      authorizeStaff(client(profile({ role: "manager" })), { admin: true }),
    ).rejects.toBeInstanceOf(Forbidden);
    createClient.mockResolvedValue(client(profile({ role: "manager" })));
    await expect(requireAdmin()).rejects.toBeInstanceOf(Forbidden);
  });

  it("permission: a manager holds what the role implies, not manage_staff", async () => {
    await expect(
      authorizeStaff(client(profile({ role: "manager" })), { permission: "view_costs" }),
    ).resolves.toMatchObject({ staff: { role: "manager" } });
    await expect(
      authorizeStaff(client(profile({ role: "manager" })), { permission: "manage_staff" }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      authorizeStaff(client(profile({ role: "manager", permissions: ["manage_staff"] })), {
        permission: "manage_staff",
      }),
    ).resolves.toMatchObject({ staff: { role: "manager" } });
  });
});
