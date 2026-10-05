/**
 * Staff history and the staff write rules (DATA-MODEL §1, §15, §16; SPEC §2
 * "History over overwrites", §22 "Destructive actions require reason"):
 *
 *   * every grant, revoke, deactivation, reactivation, creation, role change
 *     and rename appends exactly one staff_events row with its actor;
 *     replays append nothing;
 *   * deactivation needs a reason; staff_events is append-only;
 *   * staff rows change only through RPCs (no direct writes for API roles),
 *     and every writer keeps staff.email equal to the login's email and
 *     cannot deactivate their own row;
 *   * the manage_staff delegation ceiling (PLAN D11).
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, STAFF } from "../fixtures/ids";
import {
  actAs,
  asAnon,
  asStaff,
  connect,
  inTransaction,
  scalar,
  staffClaims,
  withClaims,
} from "./harness";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

type EventRow = {
  staff_id: string;
  event_type: string;
  permission: string | null;
  actor_staff_id: string | null;
  payload: Record<string, unknown>;
  reason: string | null;
  correlation_id: string | null;
};

/** Events written since `since` (a clock_timestamp), read as the owner. */
async function eventsSince(tx: pg.Client, since: string): Promise<EventRow[]> {
  const { rows } = await tx.query<EventRow>(
    `select staff_id, event_type::text, permission::text, actor_staff_id, payload, reason, correlation_id
       from public.staff_events where created_at > $1 order by created_at`,
    [since],
  );
  return rows;
}

/**
 * Runs `fn` as the given login inside one transaction, then returns its
 * result plus the events it wrote (read back as the owner).
 */
async function recording<T>(
  authUserId: string,
  fn: (tx: pg.Client) => Promise<T>,
  setup: (tx: pg.Client) => Promise<void> = async () => {},
): Promise<{ result: T; events: EventRow[] }> {
  return inTransaction(conn, async (tx) => {
    await setup(tx);
    const since = await scalar<string>(tx, "select clock_timestamp()::text");
    await actAs(tx, staffClaims(authUserId));
    const result = await fn(tx);
    await tx.query("reset role");
    return { result, events: await eventsSince(tx, since) };
  });
}

const grantManageStaff =
  (staffId: string, ...extra: string[]) =>
  async (tx: pg.Client) => {
    for (const p of ["manage_staff", ...extra]) {
      await tx.query(
        "insert into public.staff_permissions (staff_id, permission) values ($1, $2)",
        [staffId, p],
      );
    }
  };

describe("staff_events: one event per change, with the actor", () => {
  it("a grant writes one permission_granted event; a replay writes none", async () => {
    const { events } = await recording(AUTH_USER.admin, async (tx) => {
      await tx.query("select public.grant_permission($1, 'adjust_stock')", [STAFF.mechanic2]);
      await tx.query("select public.grant_permission($1, 'adjust_stock')", [STAFF.mechanic2]);
    });
    expect(events).toEqual([
      expect.objectContaining({
        staff_id: STAFF.mechanic2,
        event_type: "permission_granted",
        permission: "adjust_stock",
        actor_staff_id: STAFF.admin,
      }),
    ]);
  });

  it("a revoke writes one permission_revoked event that keeps who granted it and when", async () => {
    const { events } = await recording(AUTH_USER.admin, async (tx) => {
      await tx.query("select public.revoke_permission($1, 'view_costs')", [STAFF.mechanic1]);
      await tx.query("select public.revoke_permission($1, 'view_costs')", [STAFF.mechanic1]);
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      staff_id: STAFF.mechanic1,
      event_type: "permission_revoked",
      permission: "view_costs",
      actor_staff_id: STAFF.admin,
      payload: { granted_by: STAFF.admin, granted_at: expect.any(String) },
    });
  });

  it("deactivation requires a reason and writes one deactivated event with it", async () => {
    await expect(
      asStaff(conn, STAFF.admin, (tx) =>
        tx.query("select public.set_staff_active($1, false)", [STAFF.mechanic2]),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "reason_required" });
    await expect(
      asStaff(conn, STAFF.admin, (tx) =>
        tx.query("select public.set_staff_active($1, false, '   ')", [STAFF.mechanic2]),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "reason_required" });

    const { events } = await recording(AUTH_USER.admin, async (tx) => {
      await tx.query("select public.set_staff_active($1, false, $2)", [
        STAFF.mechanic2,
        "  Left the shop  ",
      ]);
      // Replaying the same state is a no-op.
      await tx.query("select public.set_staff_active($1, false, 'again')", [STAFF.mechanic2]);
    });
    expect(events).toEqual([
      expect.objectContaining({
        staff_id: STAFF.mechanic2,
        event_type: "deactivated",
        actor_staff_id: STAFF.admin,
        reason: "Left the shop",
      }),
    ]);
  });

  it("reactivation writes one reactivated event; the reason is optional", async () => {
    const { events } = await recording(
      AUTH_USER.admin,
      (tx) => tx.query("select public.set_staff_active($1, true)", [STAFF.mechanic2]),
      (tx) =>
        tx.query("update public.staff set active = false where id = $1", [STAFF.mechanic2]).then(),
    );
    expect(events).toEqual([
      expect.objectContaining({
        staff_id: STAFF.mechanic2,
        event_type: "reactivated",
        actor_staff_id: STAFF.admin,
        reason: null,
      }),
    ]);
  });

  it("the reason does not leak into a later change in the same transaction", async () => {
    const { events } = await recording(AUTH_USER.admin, async (tx) => {
      await tx.query("select public.set_staff_active($1, false, 'Seasonal')", [STAFF.mechanic2]);
      await tx.query("select public.grant_permission($1, 'adjust_stock')", [STAFF.mechanic1]);
    });
    expect(events.map((e) => [e.event_type, e.reason])).toEqual([
      ["deactivated", "Seasonal"],
      ["permission_granted", null],
    ]);
  });

  it("create_staff writes one created event with the inviter as actor", async () => {
    let login = "";
    const { events } = await recording(
      AUTH_USER.admin,
      (tx) =>
        tx.query("select public.create_staff($1, 'Eddie', 'eddie@bicii.test')", [login]).then(),
      async (tx) => {
        login = randomUUID();
        await tx.query(
          `insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
           values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', 'eddie@bicii.test', now(), now())`,
          [login],
        );
      },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: "created",
      actor_staff_id: STAFF.admin,
      payload: { display_name: "Eddie", email: "eddie@bicii.test", role: "staff", active: true },
    });
  });

  it("update_staff records role changes and renames", async () => {
    const { events } = await recording(AUTH_USER.admin, async (tx) => {
      await tx.query(
        "select public.update_staff($1, role => 'admin', reason => 'Runs the shop on Sundays')",
        [STAFF.mechanic1],
      );
      await tx.query("select public.update_staff($1, display_name => '  Marcus T. ')", [
        STAFF.mechanic1,
      ]);
      // Nothing changes: no event.
      await tx.query("select public.update_staff($1, role => 'admin')", [STAFF.mechanic1]);
    });
    expect(events).toEqual([
      expect.objectContaining({
        event_type: "role_changed",
        actor_staff_id: STAFF.admin,
        payload: { role: { from: "staff", to: "admin" } },
        reason: "Runs the shop on Sundays",
      }),
      expect.objectContaining({
        event_type: "details_changed",
        payload: { display_name: { from: "Marcus Tan", to: "Marcus T." } },
      }),
    ]);
  });

  it("records the request's correlation ID from PostgREST's headers, ignoring malformed ones", async () => {
    const correlated = async (header: string) =>
      (
        await recording(AUTH_USER.admin, async (tx) => {
          await tx.query("select set_config('request.headers', $1, true)", [
            JSON.stringify({ "x-correlation-id": header }),
          ]);
          await tx.query("select public.grant_permission($1, 'adjust_stock')", [STAFF.mechanic2]);
        })
      ).events[0].correlation_id;
    expect(await correlated("req-1234abcd")).toBe("req-1234abcd");
    expect(await correlated("bad id; drop table")).toBeNull();
  });

  it("the seed's history exists: every seeded staff member has a created event", async () => {
    const { rows } = await conn.query<{ staff_id: string }>(
      "select distinct staff_id from public.staff_events where event_type = 'created' and staff_id = any($1)",
      [Object.values(STAFF)],
    );
    expect(rows.map((r) => r.staff_id).sort()).toEqual(Object.values(STAFF).sort());
  });
});

describe("staff_events is append-only and private", () => {
  it("cannot be updated or deleted, even by the owner", async () => {
    for (const sql of [
      "update public.staff_events set reason = 'rewritten'",
      "delete from public.staff_events",
    ]) {
      await expect(inTransaction(conn, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "P0001",
        message: "staff_history_append_only",
      });
    }
  });

  it("API roles cannot read or write it directly", async () => {
    for (const sql of [
      "select * from public.staff_events",
      `insert into public.staff_events (staff_id, event_type) values ('${STAFF.admin}', 'created')`,
    ]) {
      await expect(asStaff(conn, STAFF.admin, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "42501",
      });
      await expect(asAnon(conn, (tx) => tx.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("staff_history() gives admins and manage_staff holders the history with actor names", async () => {
    const rows = await recording(
      AUTH_USER.mechanic2,
      async (tx) => {
        await tx.query("select public.grant_permission($1, 'adjust_stock')", [STAFF.mechanic1]);
        return (
          await tx.query(
            "select event_type::text, permission::text, actor_display_name from public.staff_history($1)",
            [STAFF.mechanic1],
          )
        ).rows;
      },
      grantManageStaff(STAFF.mechanic2, "adjust_stock"),
    );
    expect(rows.result[0]).toEqual({
      event_type: "permission_granted",
      permission: "adjust_stock",
      actor_display_name: "Nur Aisyah",
    });
    expect(rows.result.at(-1)).toMatchObject({ event_type: "created", actor_display_name: null });
  });

  it("staff_history() refuses other staff and anonymous callers", async () => {
    const sql = `select * from public.staff_history('${STAFF.mechanic1}')`;
    await expect(asStaff(conn, STAFF.mechanic1, (tx) => tx.query(sql))).rejects.toMatchObject({
      code: "42501",
    });
    await expect(asAnon(conn, (tx) => tx.query(sql))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("staff rows change only through the RPCs", () => {
  it("admins cannot insert or update staff directly", async () => {
    for (const sql of [
      `update public.staff set active = false where id = '${STAFF.admin}'`,
      `update public.staff set email = 'someone-else@example.com' where id = '${STAFF.mechanic1}'`,
      `insert into public.staff (auth_user_id, display_name, email) values ('${randomUUID()}', 'X', 'x@bicii.test')`,
    ]) {
      await expect(asStaff(conn, STAFF.admin, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("even the owner cannot make staff.email differ from the login's email", async () => {
    await expect(
      inTransaction(conn, (tx) =>
        tx.query("update public.staff set email = 'someone-else@example.com' where id = $1", [
          STAFF.mechanic1,
        ]),
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "staff_email_mismatch" });
    await expect(
      inTransaction(conn, async (tx) => {
        const login = randomUUID();
        await tx.query(
          `insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
           values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', 'real@bicii.test', now(), now())`,
          [login],
        );
        await tx.query(
          "insert into public.staff (auth_user_id, display_name, email) values ($1, 'X', 'fake@bicii.test')",
          [login],
        );
      }),
    ).rejects.toMatchObject({ code: "P0001", message: "staff_email_mismatch" });
  });

  it("nobody signed in deactivates their own row, whatever the path", async () => {
    // A second admin exists, so the last-admin guard is not what stops it.
    await expect(
      withClaims(conn, staffClaims(AUTH_USER.admin), async (tx) => {
        await tx.query("update public.staff set role = 'admin' where id = $1", [STAFF.mechanic1]);
        await tx.query("update public.staff set active = false where id = $1", [STAFF.admin]);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("update_staff", () => {
  it("only admins change roles, and nobody changes their own", async () => {
    await expect(
      recording(
        AUTH_USER.mechanic2,
        (tx) => tx.query("select public.update_staff($1, role => 'admin')", [STAFF.mechanic1]),
        grantManageStaff(STAFF.mechanic2),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asStaff(conn, STAFF.admin, (tx) =>
        tx.query("select public.update_staff($1, role => 'staff')", [STAFF.admin]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("manage_staff holders rename staff but not admins", async () => {
    const { result } = await recording(
      AUTH_USER.mechanic2,
      (tx) =>
        tx
          .query("select (s).display_name from (select public.update_staff($1, 'Marc') s) x", [
            STAFF.mechanic1,
          ])
          .then((r) => r.rows[0].display_name),
      grantManageStaff(STAFF.mechanic2),
    );
    expect(result).toBe("Marc");
    await expect(
      recording(
        AUTH_USER.mechanic2,
        (tx) => tx.query("select public.update_staff($1, 'Boss')", [STAFF.admin]),
        grantManageStaff(STAFF.mechanic2),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("staff without manage_staff cannot call it", async () => {
    await expect(
      asStaff(conn, STAFF.mechanic1, (tx) =>
        tx.query("select public.update_staff($1, 'X')", [STAFF.mechanic2]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("an admin can demote another admin (the guard keeps at least one)", async () => {
    const { result } = await recording(
      AUTH_USER.mechanic1,
      (tx) =>
        scalar<string>(
          tx,
          "select (s).role::text from (select public.update_staff($1, role => 'staff') s) x",
          [STAFF.admin],
        ),
      (tx) =>
        tx.query("update public.staff set role = 'admin' where id = $1", [STAFF.mechanic1]).then(),
    );
    expect(result).toBe("staff");
  });
});

describe("manage_staff delegation ceiling (PLAN D11)", () => {
  const asManager = <T>(fn: (tx: pg.Client) => Promise<T>, ...holds: string[]) =>
    recording(AUTH_USER.mechanic2, fn, grantManageStaff(STAFF.mechanic2, ...holds));

  it("cannot change their own permissions", async () => {
    for (const sql of [
      `select public.grant_permission('${STAFF.mechanic2}', 'view_financial_reports')`,
      `select public.grant_permission('${STAFF.mechanic2}', 'adjust_stock')`,
      `select public.revoke_permission('${STAFF.mechanic2}', 'adjust_stock')`,
    ]) {
      await expect(asManager((tx) => tx.query(sql), "adjust_stock")).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("cannot grant a permission they do not hold", async () => {
    for (const permission of ["view_costs", "view_financial_reports", "manage_consignments"]) {
      await expect(
        asManager((tx) =>
          tx.query("select public.grant_permission($1, $2)", [STAFF.mechanic1, permission]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
    // ...nor revoke one: mechanic1's view_costs is above this manager.
    await expect(
      asManager((tx) =>
        tx.query("select public.revoke_permission($1, 'view_costs')", [STAFF.mechanic1]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("can grant and revoke what they hold, recorded as the grantor", async () => {
    const { result, events } = await asManager(async (tx) => {
      const g = await tx.query(
        "select (g).granted_by from (select public.grant_permission($1, 'manage_inventory') g) s",
        [STAFF.mechanic1],
      );
      await tx.query("select public.revoke_permission($1, 'manage_inventory')", [STAFF.mechanic1]);
      return g.rows[0].granted_by;
    }, "manage_inventory");
    expect(result).toBe(STAFF.mechanic2);
    expect(events.map((e) => [e.event_type, e.actor_staff_id])).toEqual([
      ["permission_granted", STAFF.mechanic2],
      ["permission_revoked", STAFF.mechanic2],
    ]);
  });

  it("only admins grant or revoke manage_staff", async () => {
    await expect(
      asManager((tx) =>
        tx.query("select public.grant_permission($1, 'manage_staff')", [STAFF.mechanic1]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    const granted = await asStaff(conn, STAFF.admin, (tx) =>
      scalar<string>(
        tx,
        "select (g).permission::text from (select public.grant_permission($1, 'manage_staff') g) s",
        [STAFF.mechanic1],
      ),
    );
    expect(granted).toBe("manage_staff");
  });

  it("cannot touch an admin's permission rows", async () => {
    await expect(
      asManager(
        (tx) => tx.query("select public.grant_permission($1, 'adjust_stock')", [STAFF.admin]),
        "adjust_stock",
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
