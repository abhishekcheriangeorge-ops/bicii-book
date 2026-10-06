/**
 * Deactivation ends the person's Supabase Auth sessions (PLAN D71;
 * DATA-MODEL §15, §16 set_staff_active):
 *
 *   * staff.active true -> false, through set_staff_active (an admin, or a
 *     manage_staff holder within D11) or any other writer, deletes that
 *     person's auth.sessions rows (their refresh tokens cascade) and their
 *     refresh tokens without a session, in the same transaction;
 *   * nobody else's sessions are touched;
 *   * replaying a deactivation, reactivating and a refused deactivation
 *     (reason_required) delete nothing;
 *   * the migration's guard refuses a role that cannot delete Auth sessions
 *     (RUNBOOK "Applying migrations to a hosted project").
 *
 * Sessions are inserted as the superuser, minimal but valid for Auth's
 * schema; the live revocation (refresh fails, session_not_found) is
 * staff-sessions.stack.test.ts.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { PATHS } from "../../scripts/devstack/config.mjs";
import { splitStatements } from "../../scripts/devstack/database.mjs";
import { AUTH_USER, STAFF } from "../fixtures/ids";
import { actAs, connect, inTransaction, staffClaims } from "./harness";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

type Counts = { sessions: number; tokens: number };

/** As the superuser: one session with a refresh token, plus a refresh token without a session. */
async function signIn(tx: pg.Client, authUserId: string): Promise<void> {
  const sessionId = randomUUID();
  await tx.query(
    `insert into auth.sessions (id, user_id, created_at, updated_at, aal)
     values ($1, $2, now(), now(), 'aal1')`,
    [sessionId, authUserId],
  );
  await tx.query(
    `insert into auth.refresh_tokens
       (instance_id, token, user_id, revoked, created_at, updated_at, session_id)
     values
       ('00000000-0000-0000-0000-000000000000', $1, $3, false, now(), now(), $2),
       ('00000000-0000-0000-0000-000000000000', $4, $3, false, now(), now(), null)`,
    [randomUUID(), sessionId, authUserId, randomUUID()],
  );
}

/** Counts a login's sessions and refresh tokens, as the superuser (resets the role). */
async function counts(tx: pg.Client, authUserId: string): Promise<Counts> {
  await tx.query("reset role");
  const { rows } = await tx.query<Counts>(
    `select (select count(*)::int from auth.sessions where user_id = $1) as sessions,
            (select count(*)::int from auth.refresh_tokens where user_id = $1::text) as tokens`,
    [authUserId],
  );
  return rows[0];
}

const SIGNED_IN: Counts = { sessions: 1, tokens: 2 };
const SIGNED_OUT: Counts = { sessions: 0, tokens: 0 };

/** Both mechanics signed in, as the superuser. */
async function signInBoth(tx: pg.Client): Promise<void> {
  await signIn(tx, AUTH_USER.mechanic1);
  await signIn(tx, AUTH_USER.mechanic2);
}

const setActive = (tx: pg.Client, staffId: string, active: boolean, reason?: string | null) =>
  tx.query("select active from public.set_staff_active($1, $2, $3)", [
    staffId,
    active,
    reason ?? null,
  ]);

describe("deactivation revokes Auth sessions (D71)", () => {
  it("an admin's deactivation deletes that person's sessions and refresh tokens, nobody else's", async () => {
    const result = await inTransaction(conn, async (tx) => {
      await signInBoth(tx);
      const before = await counts(tx, AUTH_USER.mechanic2);
      await actAs(tx, staffClaims(AUTH_USER.admin));
      const { rows } = await setActive(tx, STAFF.mechanic2, false, "Left the shop");
      return {
        before,
        active: rows[0].active,
        mechanic2: await counts(tx, AUTH_USER.mechanic2),
        mechanic1: await counts(tx, AUTH_USER.mechanic1),
        admin: await counts(tx, AUTH_USER.admin),
      };
    });
    expect(result.before).toEqual(SIGNED_IN);
    expect(result.active).toBe(false);
    expect(result.mechanic2).toEqual(SIGNED_OUT);
    expect(result.mechanic1).toEqual(SIGNED_IN);
    expect(result.admin).toEqual(SIGNED_OUT); // the admin never had any here
  });

  it("replaying the deactivation is a no-op: no error, nothing deleted", async () => {
    const result = await inTransaction(conn, async (tx) => {
      await actAs(tx, staffClaims(AUTH_USER.admin));
      await setActive(tx, STAFF.mechanic2, false, "Left the shop");
      // A session created after the deactivation (Auth still lets the person
      // verify a code; the Admin then signs them out, D70) is not touched by
      // the replay.
      await counts(tx, AUTH_USER.mechanic2);
      await signIn(tx, AUTH_USER.mechanic2);
      await actAs(tx, staffClaims(AUTH_USER.admin));
      const replay = await setActive(tx, STAFF.mechanic2, false, "Left the shop");
      const replayWithoutReason = await setActive(tx, STAFF.mechanic2, false, null);
      return {
        replay: replay.rows[0].active,
        replayWithoutReason: replayWithoutReason.rows[0].active,
        mechanic2: await counts(tx, AUTH_USER.mechanic2),
      };
    });
    expect(result.replay).toBe(false);
    expect(result.replayWithoutReason).toBe(false);
    expect(result.mechanic2).toEqual(SIGNED_IN);
  });

  it("reactivation deletes nothing", async () => {
    const result = await inTransaction(conn, async (tx) => {
      await actAs(tx, staffClaims(AUTH_USER.admin));
      await setActive(tx, STAFF.mechanic2, false, "On leave");
      await counts(tx, AUTH_USER.mechanic2);
      await signInBoth(tx);
      await actAs(tx, staffClaims(AUTH_USER.admin));
      const { rows } = await setActive(tx, STAFF.mechanic2, true, "Back from leave");
      return {
        active: rows[0].active,
        mechanic2: await counts(tx, AUTH_USER.mechanic2),
        mechanic1: await counts(tx, AUTH_USER.mechanic1),
      };
    });
    expect(result.active).toBe(true);
    expect(result.mechanic2).toEqual(SIGNED_IN);
    expect(result.mechanic1).toEqual(SIGNED_IN);
  });

  it("a manage_staff holder who is not an admin deactivating a non-admin has the same effect", async () => {
    const result = await inTransaction(conn, async (tx) => {
      await tx.query(
        "insert into public.staff_permissions (staff_id, permission) values ($1, 'manage_staff')",
        [STAFF.mechanic1],
      );
      await signInBoth(tx);
      await actAs(tx, staffClaims(AUTH_USER.mechanic1));
      const { rows } = await setActive(tx, STAFF.mechanic2, false, "Left the shop");
      return {
        active: rows[0].active,
        mechanic2: await counts(tx, AUTH_USER.mechanic2),
        mechanic1: await counts(tx, AUTH_USER.mechanic1),
      };
    });
    expect(result.active).toBe(false);
    expect(result.mechanic2).toEqual(SIGNED_OUT);
    expect(result.mechanic1).toEqual(SIGNED_IN);
  });

  it("a refused deactivation (reason_required) leaves the sessions intact", async () => {
    const result = await inTransaction(conn, async (tx) => {
      await signInBoth(tx);
      await actAs(tx, staffClaims(AUTH_USER.admin));
      await tx.query("savepoint refused");
      const error = await setActive(tx, STAFF.mechanic2, false, "   ").then(
        () => null,
        (err: pg.DatabaseError) => ({ code: err.code, message: err.message }),
      );
      await tx.query("rollback to savepoint refused");
      const { rows } = await tx.query<{ active: boolean }>(
        "select active from public.my_staff_profile()",
      );
      return {
        error,
        adminStillActive: rows[0]?.active,
        mechanic2: await counts(tx, AUTH_USER.mechanic2),
        mechanic2Active: (
          await tx.query<{ active: boolean }>("select active from public.staff where id = $1", [
            STAFF.mechanic2,
          ])
        ).rows[0].active,
      };
    });
    expect(result.error).toEqual({ code: "P0001", message: "reason_required" });
    expect(result.adminStillActive).toBe(true);
    expect(result.mechanic2Active).toBe(true);
    expect(result.mechanic2).toEqual(SIGNED_IN);
  });

  it("any writer's deactivation revokes: a direct superuser UPDATE of staff.active", async () => {
    const result = await inTransaction(conn, async (tx) => {
      await signInBoth(tx);
      // SQL run by hand (RUNBOOK), outside the app: no claims, no RPC.
      await tx.query("update public.staff set active = false where id = $1", [STAFF.mechanic2]);
      const afterDeactivation = await counts(tx, AUTH_USER.mechanic2);
      // Writing false over false does not fire (old.active is false).
      await signIn(tx, AUTH_USER.mechanic2);
      await tx.query("update public.staff set active = false where id = $1", [STAFF.mechanic2]);
      const afterReplay = await counts(tx, AUTH_USER.mechanic2);
      // An update that does not touch active does not fire either.
      await signIn(tx, AUTH_USER.mechanic1);
      await tx.query("update public.staff set display_name = display_name || '' where id = $1", [
        STAFF.mechanic1,
      ]);
      return {
        afterDeactivation,
        afterReplay,
        mechanic1: await counts(tx, AUTH_USER.mechanic1),
      };
    });
    expect(result.afterDeactivation).toEqual(SIGNED_OUT);
    expect(result.afterReplay).toEqual(SIGNED_IN);
    expect(result.mechanic1).toEqual({ sessions: 2, tokens: 4 });
  });
});

describe("the migration's guard", () => {
  // The migration's first statement refuses to apply when the migration role
  // cannot delete from auth.sessions / auth.refresh_tokens (RUNBOOK
  // "Applying migrations"). Run it as a role that cannot.
  const guard = splitStatements(
    readFileSync(
      path.join(PATHS.migrationsDir, "20261005005000_staff_session_revocation.sql"),
      "utf8",
    ),
  )[0];

  it("is the first statement and passes for the role that applies migrations here", async () => {
    expect(guard).toMatch(/^do \$\$/m);
    await expect(inTransaction(conn, (tx) => tx.query(guard))).resolves.toBeDefined();
  });

  it("fails loudly for a role that cannot delete Auth sessions", async () => {
    const error = await inTransaction(conn, async (tx) => {
      await tx.query("set local role authenticated");
      return tx.query(guard).then(
        () => null,
        (err: pg.DatabaseError) => ({ message: err.message, hint: err.hint }),
      );
    });
    expect(error?.message).toMatch(/cannot delete from auth\.sessions and auth\.refresh_tokens/);
    expect(error?.hint).toMatch(/RUNBOOK/);
  });
});
