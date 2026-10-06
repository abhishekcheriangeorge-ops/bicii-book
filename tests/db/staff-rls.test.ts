/**
 * Staff tables under RLS and the staff RPCs (DATA-MODEL §1, §15, §16).
 *
 *   staff:             S own row + names of others (staff_directory); A full.
 *                      Writes only via RPCs (create_staff, update_staff, set_staff_active).
 *   staff_permissions: A, own. Writes only via grant/revoke RPCs (A or manage_staff).
 *   anon:              nothing.
 *
 * History, the delegation ceiling and the write rules every writer obeys are
 * in staff-history.test.ts.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, STAFF } from "../fixtures/ids";
import {
  actAs,
  asAnon,
  asAuthUser,
  asServiceRole,
  asStaff,
  connect,
  inTransaction,
  scalar,
  staffClaims,
} from "./harness";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe("anonymous", () => {
  it("cannot read staff or staff_permissions at all", async () => {
    await expect(
      asAnon(conn, (tx) => tx.query("select * from public.staff")),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asAnon(conn, (tx) => tx.query("select * from public.staff_permissions")),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot call the staff RPCs", async () => {
    for (const sql of [
      "select * from public.staff_directory()",
      `select public.grant_permission('${STAFF.mechanic2}', 'view_costs')`,
      `select public.set_staff_active('${STAFF.mechanic2}', false)`,
    ]) {
      await expect(asAnon(conn, (tx) => tx.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });
});

describe("select", () => {
  it("staff see only their own staff row", async () => {
    const rows = await asStaff(conn, STAFF.mechanic2, (tx) =>
      tx.query("select id from public.staff").then((r) => r.rows),
    );
    expect(ids(rows)).toEqual([STAFF.mechanic2]);
  });

  it("staff see colleagues' names through staff_directory()", async () => {
    const rows = await asStaff(conn, STAFF.mechanic2, (tx) =>
      tx.query("select * from public.staff_directory()").then((r) => r.rows),
    );
    expect(ids(rows)).toEqual(
      [STAFF.admin, STAFF.manager, STAFF.mechanic1, STAFF.mechanic2].sort(),
    );
    expect(Object.keys(rows[0]).sort()).toEqual(["active", "display_name", "id", "role"]);
  });

  it("admins see every staff row and every permission row", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      expect(ids((await tx.query("select id from public.staff")).rows)).toEqual(
        [STAFF.admin, STAFF.manager, STAFF.mechanic1, STAFF.mechanic2].sort(),
      );
      const perms = await tx.query("select staff_id, permission from public.staff_permissions");
      expect(perms.rows).toEqual([{ staff_id: STAFF.mechanic1, permission: "view_costs" }]);
    });
  });

  it("staff see only their own permission rows", async () => {
    await asStaff(conn, STAFF.mechanic1, async (tx) => {
      const perms = await tx.query("select staff_id, permission from public.staff_permissions");
      expect(perms.rows).toEqual([{ staff_id: STAFF.mechanic1, permission: "view_costs" }]);
    });
    await asStaff(conn, STAFF.mechanic2, async (tx) => {
      expect((await tx.query("select * from public.staff_permissions")).rowCount).toBe(0);
    });
  });

  it("inactive staff see nothing, not even their own row", async () => {
    await inTransaction(conn, async (tx) => {
      await tx.query("update public.staff set active = false where id = $1", [STAFF.mechanic1]);
      await actAs(tx, staffClaims(AUTH_USER.mechanic1));
      expect((await tx.query("select * from public.staff")).rowCount).toBe(0);
      expect((await tx.query("select * from public.staff_permissions")).rowCount).toBe(0);
      await expect(tx.query("select * from public.staff_directory()")).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  it("signed-in non-staff (future customers) see nothing", async () => {
    const customer = "c0000000-0000-4000-8000-00000000ffff";
    await asAuthUser(conn, customer, async (tx) => {
      expect((await tx.query("select * from public.staff")).rowCount).toBe(0);
      expect((await tx.query("select * from public.staff_permissions")).rowCount).toBe(0);
    });
  });

  it("service role sees everything (bypasses RLS)", async () => {
    const n = await asServiceRole(conn, (tx) =>
      scalar<number>(tx, "select count(*)::int from public.staff"),
    );
    expect(n).toBe(4);
  });
});

describe("writes by non-admins", () => {
  it("cannot update any staff row, including their own", async () => {
    for (const sql of [
      `update public.staff set display_name = 'Hacked' where id = '${STAFF.mechanic1}'`,
      `update public.staff set role = 'admin' where id = '${STAFF.mechanic2}'`,
    ]) {
      await expect(asStaff(conn, STAFF.mechanic1, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "42501",
      });
    }
    const names = await conn.query("select display_name, role from public.staff where id = $1", [
      STAFF.mechanic1,
    ]);
    expect(names.rows[0]).toEqual({ display_name: "Marcus Tan", role: "mechanic" });
  });

  it("cannot insert staff", async () => {
    await expect(
      asStaff(conn, STAFF.mechanic1, (tx) =>
        tx.query(
          `insert into public.staff (auth_user_id, display_name, email, role)
           values ($1, 'X', 'x@bicii.test', 'admin')`,
          [AUTH_USER.mechanic2],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot write staff_permissions directly or delete staff", async () => {
    for (const sql of [
      `insert into public.staff_permissions (staff_id, permission) values ('${STAFF.mechanic2}', 'view_costs')`,
      `delete from public.staff_permissions`,
      `update public.staff_permissions set permission = 'manage_staff'`,
      `delete from public.staff where id = '${STAFF.mechanic2}'`,
    ]) {
      await expect(asStaff(conn, STAFF.admin, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("cannot grant, revoke or change active state without manage_staff", async () => {
    for (const sql of [
      `select public.grant_permission('${STAFF.mechanic1}', 'adjust_stock')`,
      `select public.grant_permission('${STAFF.mechanic2}', 'manage_staff')`,
      `select public.revoke_permission('${STAFF.mechanic1}', 'view_costs')`,
      `select public.set_staff_active('${STAFF.mechanic2}', false, 'No reason')`,
      `select public.update_staff('${STAFF.mechanic2}', 'Renamed')`,
    ]) {
      await expect(asStaff(conn, STAFF.mechanic1, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "42501",
      });
    }
  });
});

describe("admin writes", () => {
  it("rename and change roles through update_staff, not by writing the table", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      const r = await tx.query(
        "select (s).display_name, (s).role from (select public.update_staff($1, 'Marcus T.', 'admin') s) x",
        [STAFF.mechanic1],
      );
      expect(r.rows).toEqual([{ display_name: "Marcus T.", role: "admin" }]);
    });
    await expect(
      asStaff(conn, STAFF.admin, (tx) =>
        tx.query("update public.staff set display_name = 'Marcus T.' where id = $1", [
          STAFF.mechanic1,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("grant_permission records the grantor and is idempotent", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      const first = await tx.query(
        "select (g).* from (select public.grant_permission($1, 'adjust_stock') g) s",
        [STAFF.mechanic2],
      );
      expect(first.rows[0]).toMatchObject({
        staff_id: STAFF.mechanic2,
        permission: "adjust_stock",
        granted_by: STAFF.admin,
      });
      const again = await tx.query(
        "select (g).* from (select public.grant_permission($1, 'adjust_stock') g) s",
        [STAFF.mechanic2],
      );
      expect(again.rows[0]).toEqual(first.rows[0]);
      expect(
        await scalar(tx, "select count(*)::int from public.staff_permissions where staff_id = $1", [
          STAFF.mechanic2,
        ]),
      ).toBe(1);
    });
  });

  it("revoke_permission removes the row and is replay-safe", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      const removed = await tx.query(
        "select (r).permission from (select public.revoke_permission($1, 'view_costs') r) s",
        [STAFF.mechanic1],
      );
      expect(removed.rows[0].permission).toBe("view_costs");
      const replay = await tx.query(
        "select (r).permission from (select public.revoke_permission($1, 'view_costs') r) s",
        [STAFF.mechanic1],
      );
      expect(replay.rows[0].permission).toBeNull();
    });
  });

  it("unknown staff id raises no_data_found", async () => {
    await expect(
      asStaff(conn, STAFF.admin, (tx) =>
        tx.query(
          "select public.grant_permission('00000000-0000-4000-8000-000000000000', 'view_costs')",
        ),
      ),
    ).rejects.toMatchObject({ code: "P0002" });
  });

  it("set_staff_active deactivates at once: the member loses every permission", async () => {
    await inTransaction(conn, async (tx) => {
      await actAs(tx, staffClaims(AUTH_USER.admin));
      const r = await tx.query(
        "select (s).active from (select public.set_staff_active($1, false, 'Left the shop') s) x",
        [STAFF.mechanic1],
      );
      expect(r.rows[0].active).toBe(false);
      // Now act as the deactivated mechanic within the same transaction.
      await actAs(tx, staffClaims(AUTH_USER.mechanic1));
      expect(await scalar(tx, "select permissions::text[] from public.my_staff_profile()")).toEqual(
        [],
      );
    });
  });

  it("nobody can deactivate themselves", async () => {
    await expect(
      asStaff(conn, STAFF.admin, (tx) =>
        tx.query("select public.set_staff_active($1, false, 'Testing')", [STAFF.admin]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("the last active admin cannot be demoted or deactivated", async () => {
    await expect(
      inTransaction(conn, (tx) =>
        tx.query("update public.staff set role = 'mechanic' where id = $1", [STAFF.admin]),
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      inTransaction(conn, (tx) =>
        tx.query("update public.staff set active = false where id = $1", [STAFF.admin]),
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });
});

describe("manage_staff holders", () => {
  /** mechanic2 holds manage_staff and manage_inventory (the delegation ceiling allows granting it). */
  async function withManageStaff<T>(fn: (tx: pg.Client) => Promise<T>): Promise<T> {
    return inTransaction(conn, async (tx) => {
      await tx.query(
        `insert into public.staff_permissions (staff_id, permission)
         values ($1, 'manage_staff'), ($1, 'manage_inventory')`,
        [STAFF.mechanic2],
      );
      await actAs(tx, staffClaims(AUTH_USER.mechanic2));
      return fn(tx);
    });
  }

  it("can grant and revoke permissions they hold, recorded as the grantor", async () => {
    await withManageStaff(async (tx) => {
      const g = await tx.query(
        "select (g).granted_by from (select public.grant_permission($1, 'manage_inventory') g) s",
        [STAFF.mechanic1],
      );
      expect(g.rows[0].granted_by).toBe(STAFF.mechanic2);
      const r = await tx.query(
        "select (r).permission from (select public.revoke_permission($1, 'manage_inventory') r) s",
        [STAFF.mechanic1],
      );
      expect(r.rows[0].permission).toBe("manage_inventory");
    });
  });

  it("can deactivate staff but not an admin", async () => {
    await withManageStaff(async (tx) => {
      const r = await tx.query(
        "select (s).active from (select public.set_staff_active($1, false, 'Left the shop') s) x",
        [STAFF.mechanic1],
      );
      expect(r.rows[0].active).toBe(false);
      await expect(
        tx.query("select public.set_staff_active($1, false, 'Testing')", [STAFF.admin]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("still cannot update staff rows directly", async () => {
    await expect(
      withManageStaff((tx) =>
        tx.query("update public.staff set display_name = 'X' where id = $1", [STAFF.mechanic1]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
