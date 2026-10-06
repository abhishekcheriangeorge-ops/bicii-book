/**
 * The Admin's own sign-in limits (PLAN D72): public.note_sign_in_attempt
 * counts one attempt per bucket and fixed window, atomically, for the
 * service role only.
 *
 *   * each call adds one to every bucket it names (a bucket named twice
 *     counts once) and returns the counts in the current window;
 *   * windows are fixed: a counter from an earlier window is not added to,
 *     and counters older than a day are deleted as it goes;
 *   * concurrent calls on separate connections are all counted;
 *   * anon and authenticated (staff included) cannot call it, and nobody
 *     but the function reaches private.sign_in_attempts;
 *   * malformed arguments are refused (22023).
 *
 * The app side (buckets per client and per email, the limits, the screens)
 * is tests/unit/sign-in-limits.test.ts and sign-in-throttle.stack.test.ts.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { STAFF } from "../fixtures/ids";
import { asAnon, asServiceRole, asStaff, connect, inTransaction, openConnections } from "./harness";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

type Hit = { bucket_key: string; hit_count: number };

async function note(tx: pg.Client, buckets: string[], windowSeconds = 300): Promise<Hit[]> {
  const { rows } = await tx.query<Hit>(
    "select * from public.note_sign_in_attempt($1, $2) order by bucket_key",
    [buckets, windowSeconds],
  );
  return rows;
}

describe("note_sign_in_attempt", () => {
  it("counts each bucket once per call within the window and returns the counts", async () => {
    await asServiceRole(conn, async (tx) => {
      expect(await note(tx, ["request:client:a", "request:email:b"])).toEqual([
        { bucket_key: "request:client:a", hit_count: 1 },
        { bucket_key: "request:email:b", hit_count: 1 },
      ]);
      expect(await note(tx, ["request:client:a", "request:email:c"])).toEqual([
        { bucket_key: "request:client:a", hit_count: 2 },
        { bucket_key: "request:email:c", hit_count: 1 },
      ]);
      // The same bucket twice in one call is one attempt.
      expect(await note(tx, ["verify:client:a", "verify:client:a"])).toEqual([
        { bucket_key: "verify:client:a", hit_count: 1 },
      ]);
    });
  });

  it("starts a new count in a new window and deletes counters older than a day", async () => {
    await inTransaction(conn, async (tx) => {
      // As the superuser: an earlier window's counter and a stale one.
      await tx.query(
        `insert into private.sign_in_attempts (bucket, window_start, hits) values
           ('request:client:old', now() - interval '10 minutes', 9),
           ('request:client:stale', now() - interval '25 hours', 9)`,
      );
      await tx.query("set local role service_role");
      expect(await note(tx, ["request:client:old"])).toEqual([
        { bucket_key: "request:client:old", hit_count: 1 },
      ]);
      await tx.query("reset role");
      const { rows } = await tx.query<{ bucket: string; hits: number }>(
        "select bucket, hits from private.sign_in_attempts order by bucket, window_start",
      );
      expect(rows).toEqual([
        { bucket: "request:client:old", hits: 9 },
        { bucket: "request:client:old", hits: 1 },
      ]);
      // Windows are aligned to multiples of window_seconds.
      const { rows: aligned } = await tx.query<{ ok: boolean }>(
        `select bool_and(extract(epoch from window_start)::bigint % 300 = 0) as ok
         from private.sign_in_attempts where hits = 1`,
      );
      expect(aligned[0].ok).toBe(true);
    });
  });

  it("counts every one of concurrent attempts", async () => {
    const bucket = `request:client:concurrent-${Date.now()}`;
    const conns = await openConnections(6);
    try {
      await Promise.all(
        conns.map((c) => asServiceRole(c, (tx) => note(tx, [bucket]), { commit: true })),
      );
      const { rows } = await conn.query<{ hits: number }>(
        "select hits from private.sign_in_attempts where bucket = $1",
        [bucket],
      );
      expect(rows).toEqual([{ hits: 6 }]);
    } finally {
      await Promise.all(conns.map((c) => c.end()));
      await conn.query("delete from private.sign_in_attempts where bucket = $1", [bucket]);
    }
  });

  it("is the service role's only: anon and staff cannot call it or reach the table", async () => {
    for (const as of [
      (fn: (tx: pg.Client) => Promise<unknown>) => asAnon(conn, fn),
      (fn: (tx: pg.Client) => Promise<unknown>) => asStaff(conn, STAFF.admin, fn),
    ]) {
      await expect(as((tx) => note(tx, ["request:client:x"]))).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        as((tx) => tx.query("select * from private.sign_in_attempts")),
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      asServiceRole(conn, (tx) => tx.query("select * from private.sign_in_attempts")),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("refuses malformed arguments", async () => {
    const bad: [string[] | null, number | null][] = [
      [null, 300],
      [[], 300],
      [Array.from({ length: 9 }, (_, i) => `b${i}`), 300],
      [["ok", ""], 300],
      [["x".repeat(201)], 300],
      [["ok"], 59],
      [["ok"], 3601],
      [["ok"], null],
    ];
    for (const [buckets, windowSeconds] of bad) {
      await expect(
        asServiceRole(conn, (tx) =>
          tx.query("select * from public.note_sign_in_attempt($1, $2)", [buckets, windowSeconds]),
        ),
      ).rejects.toMatchObject({ code: "22023" });
    }
    await expect(
      asServiceRole(conn, (tx) =>
        tx.query("select * from public.note_sign_in_attempt(array['ok', null], 300)"),
      ),
    ).rejects.toMatchObject({ code: "22023" });
  });
});
