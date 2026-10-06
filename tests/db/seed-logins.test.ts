/**
 * The seed creates no login anyone can sign in to with a password (PLAN
 * D10; RISKS R-015, R-035). Staff, and the seeded customer Chloe Lim, sign
 * in with emailed codes only, so every seeded Auth user stores the bcrypt
 * hash of a random secret (what auth.admin.createUser stores for a login
 * created without a password), never the shared local password the seed
 * used before email codes, and no two seeded logins share a hash.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { AUTH_USER, CUSTOMER_LOGIN } from "../fixtures/ids";
import { connect } from "./harness";

/** The shared local password every seeded login had before email codes (published in the history). */
const FORMER_SEED_PASSWORD = "bicii-dev-password";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

describe("seeded logins have no usable password (D10)", () => {
  it("every seeded staff and customer login stores a random secret's hash, not the former shared password", async () => {
    const seeded = [...Object.values(AUTH_USER), CUSTOMER_LOGIN.chloe.authUserId];
    const { rows } = await conn.query<{
      id: string;
      bcrypt: boolean;
      former: boolean;
    }>(
      `select u.id::text,
              u.encrypted_password ~ '^\\$2[aby]\\$10\\$' as bcrypt,
              u.encrypted_password = extensions.crypt($2, u.encrypted_password) as former
         from auth.users u
        where u.id = any($1::uuid[])
        order by u.id`,
      [seeded, FORMER_SEED_PASSWORD],
    );
    expect(rows.map((r) => r.id).sort()).toEqual([...seeded].sort());
    for (const row of rows) {
      expect(row, row.id).toMatchObject({ bcrypt: true, former: false });
    }
  });

  it("no two seeded logins share a password hash (each secret is drawn on its own)", async () => {
    const seeded = [...Object.values(AUTH_USER), CUSTOMER_LOGIN.chloe.authUserId];
    const distinct = await conn.query<{ n: number }>(
      `select count(distinct encrypted_password)::int as n from auth.users where id = any($1::uuid[])`,
      [seeded],
    );
    expect(distinct.rows[0].n).toBe(seeded.length);
  });
});
