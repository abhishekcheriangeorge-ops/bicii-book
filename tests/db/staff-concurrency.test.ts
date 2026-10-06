/**
 * Concurrency, with two real connections and committed transactions (this
 * file has its own database):
 *
 *   * two admins demoting each other at the same moment must not leave the
 *     shop without an active admin;
 *   * D92: an exception row the role implies cannot survive a race between
 *     a direct insert (seed, SQL editor, service role: no grant_permission
 *     lock) and a role change, in either order. The refusal trigger's
 *     FOR SHARE read waits for the role change; the role change's clean-up
 *     sees the insert once it commits.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, STAFF } from "../fixtures/ids";
import {
  actAs,
  connect,
  isolatedDatabase,
  openConnections,
  scalar,
  staffClaims,
  type Connection,
} from "./harness";

let setup: Connection;

// Commits, so it only runs on a per-file clone, never on a shared database.
describe.skipIf(!isolatedDatabase())("last active admin guard under concurrency", () => {
  beforeAll(async () => {
    setup = await connect();
    await setup.query("update public.staff set role = 'admin' where id = $1", [STAFF.mechanic2]);
  });

  it("only one of two simultaneous cross-demotions commits", async () => {
    const [a, b] = await openConnections(2);

    await a.query("begin");
    await actAs(a, staffClaims(AUTH_USER.admin));
    await a.query("select public.update_staff($1, role => 'mechanic')", [STAFF.mechanic2]);

    await b.query("begin");
    await actAs(b, staffClaims(AUTH_USER.mechanic2));
    // Blocks on the guard's advisory lock until A commits, then sees that
    // A's demotion left Asha as the only admin.
    const bResult = b
      .query("select public.update_staff($1, role => 'mechanic')", [STAFF.admin])
      .then(
        () => "updated",
        (err: { code?: string }) => err.code,
      );

    // Give B time to reach the lock before A commits.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await a.query("commit");
    expect(await bResult).toBe("55000");
    await b.query("rollback");

    const admins = await scalar<number>(
      setup,
      "select count(*)::int from public.staff where role = 'admin' and active",
    );
    expect(admins).toBe(1);
  });
});

/** The events appended for `staffId` after `since`, oldest first. */
async function eventsSince(staffId: string, since: string) {
  const { rows } = await setup.query<{ event_type: string; permission: string | null }>(
    `select event_type::text, permission::text from public.staff_events
      where staff_id = $1 and created_at > $2::timestamptz order by created_at, id`,
    [staffId, since],
  );
  return rows;
}

describe.skipIf(!isolatedDatabase())("implied exceptions under concurrency (D92)", () => {
  it("an insert that waits on a promotion is refused once the promotion commits", async () => {
    const [a, b] = await openConnections(2);

    // A promotes Marcus (a mechanic) to manager and holds the row.
    await a.query("begin");
    await a.query("update public.staff set role = 'manager' where id = $1", [STAFF.mechanic1]);

    // B writes an exception straight into the table (no RPC): the refusal
    // trigger's FOR SHARE read waits for A, then reads "manager".
    await b.query("begin");
    const bResult = b
      .query(
        "insert into public.staff_permissions (staff_id, permission) values ($1, 'adjust_stock')",
        [STAFF.mechanic1],
      )
      .then(
        () => "inserted",
        (err: { code?: string; message?: string }) => `${err.code} ${err.message}`,
      );

    await new Promise((resolve) => setTimeout(resolve, 300));
    await a.query("commit");
    expect(await bResult).toBe("P0001 permission_implied_by_role");
    await b.query("rollback");

    expect(
      await scalar<number>(
        setup,
        "select count(*)::int from public.staff_permissions where staff_id = $1",
        [STAFF.mechanic1],
      ),
    ).toBe(0);
  });

  it("a promotion that waits on an insert drops the row once the insert commits, with history", async () => {
    // Nur is a mechanic again after the last-admin test; say so, not assume it.
    await setup.query("update public.staff set role = 'mechanic' where id = $1", [STAFF.mechanic2]);
    const since = await scalar<string>(setup, "select clock_timestamp()::text");
    const [a, b] = await openConnections(2);

    // B writes an exception for Nur (a mechanic) and holds its FOR SHARE lock.
    await b.query("begin");
    await b.query(
      "insert into public.staff_permissions (staff_id, permission) values ($1, 'view_costs')",
      [STAFF.mechanic2],
    );

    // A's promotion waits for B; its clean-up then sees the committed row.
    await a.query("begin");
    const aResult = a
      .query("update public.staff set role = 'manager' where id = $1", [STAFF.mechanic2])
      .then(
        () => "updated",
        (err: { code?: string }) => err.code,
      );

    await new Promise((resolve) => setTimeout(resolve, 300));
    await b.query("commit");
    expect(await aResult).toBe("updated");
    await a.query("commit");

    expect(
      await scalar<number>(
        setup,
        `select count(*)::int from public.staff_permissions sp
           join public.staff s on s.id = sp.staff_id
          where private.role_implies(s.role, sp.permission)`,
      ),
    ).toBe(0);
    expect(await eventsSince(STAFF.mechanic2, since)).toEqual([
      { event_type: "permission_granted", permission: "view_costs" },
      { event_type: "role_changed", permission: null },
      { event_type: "permission_revoked", permission: "view_costs" },
    ]);
  });
});
