/**
 * Catalogue-wide invariants. These query the system catalogs, so they cover
 * every future migration automatically: a new table without RLS, a function
 * left executable by PUBLIC, or a float money column fails here.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { connect } from "./harness";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const APP_SCHEMAS = ["public", "private", "reporting"];

// Column names that hold (or will hold) money or money rates.
const MONEY_NAME =
  "(price|cost|amount|total|subtotal|yield|share|owed|paid|outstanding|balance|fee|charge|tax|discount|refund|payout|value|rate|money)";

describe("RLS", () => {
  it("is enabled on every table in public", async () => {
    const { rows } = await conn.query<{ table: string; rls: boolean }>(
      `select c.relname as table, c.relrowsecurity as rls
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
        order by 1`,
    );
    expect(rows.map((r) => r.table)).toContain("staff");
    expect(rows.filter((r) => !r.rls).map((r) => r.table)).toEqual([]);
  });

  it("API roles have no privileges on any table in private", async () => {
    const { rows } = await conn.query(
      `select table_schema, table_name, privilege_type, grantee
         from information_schema.role_table_grants
        where table_schema in ('private')
          and grantee in ('PUBLIC', 'anon', 'authenticated')`,
    );
    expect(rows).toEqual([]);
  });
});

describe("functions", () => {
  it("no function in public or private is executable by PUBLIC", async () => {
    const { rows } = await conn.query<{ fn: string }>(
      `select p.oid::regprocedure::text as fn
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and not exists (
            select 1 from pg_depend d
             where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
          )
          and (
            p.proacl is null  -- null ACL = default privileges = EXECUTE for PUBLIC
            or exists (
              select 1 from aclexplode(p.proacl) a
               where a.grantee = 0 and a.privilege_type = 'EXECUTE'
            )
          )
        order by 1`,
    );
    expect(rows.map((r) => r.fn)).toEqual([]);
  });

  it("anon can execute nothing in private", async () => {
    const { rows } = await conn.query<{ fn: string }>(
      `select p.oid::regprocedure::text as fn
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
          and has_function_privilege('anon', p.oid, 'EXECUTE')`,
    );
    expect(rows).toEqual([]);
  });

  it("every security definer function pins search_path", async () => {
    const { rows } = await conn.query<{ fn: string }>(
      `select p.oid::regprocedure::text as fn
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = any($1)
          and p.prosecdef
          and not exists (
            select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
          )`,
      [APP_SCHEMAS],
    );
    expect(rows).toEqual([]);
  });
});

describe("money", () => {
  it("no money-like column is real or double precision", async () => {
    const { rows } = await conn.query<{ col: string; type: string }>(
      `select table_schema || '.' || table_name || '.' || column_name as col, data_type as type
         from information_schema.columns
        where table_schema = any($1)
          and column_name ~* $2
          and data_type in ('real', 'double precision')`,
      [APP_SCHEMAS, MONEY_NAME],
    );
    expect(rows).toEqual([]);
  });

  it("money_amount is numeric(12,2)", async () => {
    const { rows } = await conn.query(
      `select data_type, numeric_precision, numeric_scale
         from information_schema.domains
        where domain_schema = 'public' and domain_name = 'money_amount'`,
    );
    expect(rows).toEqual([{ data_type: "numeric", numeric_precision: 12, numeric_scale: 2 }]);
  });
});

describe("schemas", () => {
  it("private and reporting grant nothing to anon or PUBLIC", async () => {
    const { rows } = await conn.query(
      `select n.nspname, r.rolname, has_schema_privilege(r.oid, n.oid, 'USAGE') as usage,
              has_schema_privilege(r.oid, n.oid, 'CREATE') as create
         from pg_namespace n
         cross join pg_roles r
        where n.nspname in ('private', 'reporting') and r.rolname = 'anon'`,
    );
    for (const r of rows) {
      expect(r).toMatchObject({ usage: false, create: false });
    }
    const pub = await conn.query(
      `select nspname from pg_namespace n, aclexplode(n.nspacl) a
        where n.nspname in ('private', 'reporting') and a.grantee = 0`,
    );
    expect(pub.rows).toEqual([]);
  });

  it("extensions live in the extensions schema", async () => {
    const { rows } = await conn.query(
      `select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
        where e.extname in ('pgcrypto', 'citext') order by 1`,
    );
    expect(rows).toEqual([
      { extname: "citext", nspname: "extensions" },
      { extname: "pgcrypto", nspname: "extensions" },
    ]);
  });
});
