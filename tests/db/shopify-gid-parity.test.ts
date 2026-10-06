/**
 * The TypeScript toShopifyGid (src/lib/integrations/shopify/ids.ts) and
 * Postgres private.shopify_gid agree on every input of one shared table
 * (tests/fixtures/shopify-gids.ts; DATA-MODEL §13): the same gid, the same
 * null, and a refusal on both sides (P0001 shopify_gid_invalid / a thrown
 * ShopifyGidError). Read-only, as the database owner (no API role may
 * execute the private helper).
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ShopifyGidError, toShopifyGid } from "@/lib/integrations/shopify/ids";

import { SHOPIFY_GID_CASES } from "../fixtures/shopify-gids";
import { connect } from "./harness";

let db: pg.Client;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db?.end();
});

async function inPostgres(kind: string, value: string | null): Promise<string | null | "invalid"> {
  try {
    const { rows } = await db.query<{ gid: string | null }>(
      "select private.shopify_gid($1, $2) as gid",
      [kind, value],
    );
    return rows[0].gid;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "P0001" && err.message === "shopify_gid_invalid") return "invalid";
    throw e;
  }
}

function inTypeScript(kind: (typeof SHOPIFY_GID_CASES)[number]["kind"], value: string | null) {
  try {
    return toShopifyGid(kind, value);
  } catch (e) {
    if (e instanceof ShopifyGidError) return "invalid";
    throw e;
  }
}

describe("Shopify gid parity (TypeScript = private.shopify_gid)", () => {
  it.each(SHOPIFY_GID_CASES)("$kind $value", async ({ kind, value, expected }) => {
    const pgResult = await inPostgres(kind, value);
    expect(pgResult).toBe(expected);
    expect(inTypeScript(kind, value)).toBe(pgResult);
  });

  it("refuses an unknown kind on both sides", async () => {
    await expect(db.query("select private.shopify_gid('Collection', '1')")).rejects.toMatchObject({
      code: "22023",
    });
    expect(() => toShopifyGid("Collection", "1")).toThrow(RangeError);
  });

  it("builds the same handle as private.shopify_handle", async () => {
    const { shopifyHandle } = await import("@/lib/integrations/shopify/ids");
    for (const shortId of ["P-000027", "P-123456", "P-000001"]) {
      const { rows } = await db.query<{ h: string }>("select private.shopify_handle($1) as h", [
        shortId,
      ]);
      expect(shopifyHandle(shortId)).toBe(rows[0].h);
    }
  });
});
