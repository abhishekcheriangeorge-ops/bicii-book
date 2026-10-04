/**
 * Human short IDs (DATA-MODEL §17, PLAN D9): prefix + "-" + six digits from a
 * per-prefix sequence; never reused, never truncated, unknown prefix raises.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { parseShortId, SHORT_ID_KINDS } from "@/lib/ids";

import { STAFF } from "../fixtures/ids";
import {
  asStaff,
  connect,
  inTransaction,
  isolatedDatabase,
  openConnections,
  scalar,
} from "./harness";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const next = (c: pg.Client, prefix: string | null) =>
  scalar<string>(c, "select private.next_short_id($1)", [prefix]);

const seq = (id: string) => Number(id.split("-")[1]);

describe("private.next_short_id", () => {
  it("formats every prefix as PREFIX-000000 and agrees with src/lib/ids.ts", async () => {
    for (const prefix of Object.keys(SHORT_ID_KINDS)) {
      const id = await next(conn, prefix);
      expect(id).toMatch(new RegExp(`^${prefix}-\\d{6}$`));
      expect(parseShortId(id)).toEqual({
        kind: SHORT_ID_KINDS[prefix as keyof typeof SHORT_ID_KINDS],
        shortId: id,
      });
    }
  });

  it("is strictly increasing per prefix and independent across prefixes", async () => {
    const b = [];
    for (let i = 0; i < 25; i++) b.push(seq(await next(conn, "B")));
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1]);
    const po1 = seq(await next(conn, "PO"));
    const po2 = seq(await next(conn, "PO"));
    expect(po2).toBe(po1 + 1);
  });

  it("never reuses a value, even when the transaction rolls back", async () => {
    const rolledBack = await inTransaction(conn, (tx) => next(tx, "J"));
    const after = await next(conn, "J");
    expect(seq(after)).toBeGreaterThan(seq(rolledBack));
  });

  it("hands out unique values to concurrent connections", async () => {
    const conns = await openConnections(4);
    const results = await Promise.all(
      conns.map(async (c) => {
        const out: string[] = [];
        for (let i = 0; i < 20; i++) out.push(await next(c, "U"));
        return out;
      }),
    );
    const all = results.flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("raises 22023 for an unknown, lowercase or null prefix", async () => {
    for (const bad of ["X", "b", "", null]) {
      await expect(inTransaction(conn, (tx) => next(tx, bad))).rejects.toMatchObject({
        code: "22023",
      });
    }
  });

  // setval is not transactional: only on a per-file clone.
  it.skipIf(!isolatedDatabase())(
    "raises instead of truncating or wrapping past 999999",
    async () => {
      await inTransaction(conn, async (tx) => {
        await tx.query("select setval('private.seq_short_id_s', 999998)");
        expect(await next(tx, "S")).toBe("S-999999");
        await expect(next(tx, "S")).rejects.toMatchObject({ code: "2200H" });
      });
    },
  );

  it("is not callable by API roles", async () => {
    await expect(asStaff(conn, STAFF.admin, (tx) => next(tx, "B"))).rejects.toMatchObject({
      code: "42501",
    });
  });
});
