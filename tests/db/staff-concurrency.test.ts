/**
 * Concurrency: two admins demoting each other at the same moment must not
 * leave the shop without an active admin. Uses two real connections and
 * committed transactions (this file has its own database).
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
