/**
 * Database test harness (TESTING.md "Database test harness").
 *
 * Each test file runs against its own database cloned from a template built
 * once per run (see global-setup.ts and setup.ts). Connections are opened as
 * the server's superuser; the `as*` helpers then act as an API role exactly
 * the way PostgREST does, inside a transaction:
 *
 *   set local role <role>;
 *   select set_config('request.jwt.claims', '<json>', true);
 *
 * so RLS, column grants and auth.uid() behave as they do for real requests.
 * The transaction is ROLLED BACK by default, keeping tests independent; pass
 * `{ commit: true }` when a test needs the effect visible to other
 * connections (concurrency tests). Nothing here is specific to the devstack:
 * the helpers work unchanged against a real Supabase database.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

export type Connection = pg.Client;

/** JWT claims as Supabase Auth issues them; `role` picks the database role. */
export type Claims = {
  role: ApiRole;
  sub?: string;
  aud?: string;
  email?: string;
  [claim: string]: unknown;
};

export type ApiRole = "anon" | "authenticated" | "service_role";
export type TxOptions = { commit?: boolean };
type Body<T> = (tx: Connection) => Promise<T>;

const API_ROLES: readonly ApiRole[] = ["anon", "authenticated", "service_role"];

let current: { url: string; name: string; owned: boolean } | null = null;
const open = new Set<Connection>();

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function adminQuery(sql: string): Promise<void> {
  const admin = new pg.Client({ connectionString: inject("dbServerUrl") });
  await admin.connect();
  try {
    await admin.query(sql);
  } finally {
    await admin.end();
  }
}

/** Called by setup.ts before each file. */
export async function createTestDatabase(): Promise<string> {
  const existing = inject("dbExistingUrl");
  if (existing) {
    current = { url: existing, name: new URL(existing).pathname.slice(1), owned: false };
    return current.url;
  }
  const template = inject("dbTemplate");
  const name = `bicii_test_${process.pid}_${randomBytes(4).toString("hex")}`;
  await adminQuery(`create database "${name}" template "${template}"`);
  current = { url: withDatabase(inject("dbServerUrl"), name), name, owned: true };
  return current.url;
}

/** Called by setup.ts after each file. */
export async function dropTestDatabase(): Promise<void> {
  await Promise.all([...open].map((c) => c.end().catch(() => {})));
  open.clear();
  if (current?.owned) await adminQuery(`drop database if exists "${current.name}" with (force)`);
  current = null;
}

/**
 * False in existing-database mode (BICII_TEST_DATABASE_URL): tests that
 * commit, or change non-transactional state such as sequences, must skip.
 */
export function isolatedDatabase(): boolean {
  return inject("dbExistingUrl") === "";
}

export function testDatabaseUrl(): string {
  if (!current) throw new Error("No test database: is tests/db/setup.ts in setupFiles?");
  return current.url;
}

/** A new connection to this file's database (closed automatically after the file). */
export async function connect(): Promise<Connection> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  client.on("notice", () => {});
  open.add(client);
  return client;
}

/** n independent connections, for concurrency tests. */
export async function openConnections(n: number): Promise<Connection[]> {
  return Promise.all(Array.from({ length: n }, () => connect()));
}

/** Runs `fn` in a transaction: rolled back unless `commit`, always rolled back on error. */
export async function inTransaction<T>(
  conn: Connection,
  fn: Body<T>,
  options: TxOptions = {},
): Promise<T> {
  await conn.query("begin");
  try {
    const result = await fn(conn);
    await conn.query(options.commit ? "commit" : "rollback");
    return result;
  } catch (err) {
    await conn.query("rollback").catch(() => {});
    throw err;
  }
}

async function setClaims(tx: Connection, claims: Claims | null): Promise<void> {
  await tx.query("select set_config('request.jwt.claims', $1, true)", [
    claims ? JSON.stringify(claims) : "",
  ]);
}

/**
 * Inside an open transaction: become the API role in `claims.role` with these
 * claims (for switching identity mid-transaction, e.g. after superuser setup).
 */
export async function actAs(tx: Connection, claims: Claims): Promise<void> {
  if (!API_ROLES.includes(claims.role)) throw new Error(`Not an API role: ${claims.role}`);
  await tx.query(`set local role ${claims.role}`);
  await setClaims(tx, claims);
}

/** Acts as the API role in `claims.role` with these JWT claims (PostgREST semantics). */
export async function asUser<T>(
  conn: Connection,
  claims: Claims,
  fn: Body<T>,
  options?: TxOptions,
): Promise<T> {
  return inTransaction(
    conn,
    async (tx) => {
      await actAs(tx, claims);
      return fn(tx);
    },
    options,
  );
}

/** Anonymous visitor (anon key, no session). */
export function asAnon<T>(conn: Connection, fn: Body<T>, options?: TxOptions): Promise<T> {
  return asUser(conn, { role: "anon" }, fn, options);
}

/** Service-role key: bypasses RLS, subject to grants. */
export function asServiceRole<T>(conn: Connection, fn: Body<T>, options?: TxOptions): Promise<T> {
  return asUser(conn, { role: "service_role" }, fn, options);
}

/** Signed-in Supabase Auth user (customer or staff) by auth.users id. */
export function asAuthUser<T>(
  conn: Connection,
  authUserId: string,
  fn: Body<T>,
  options?: TxOptions,
): Promise<T> {
  return asUser(
    conn,
    { role: "authenticated", aud: "authenticated", sub: authUserId },
    fn,
    options,
  );
}

/**
 * Signed-in staff member by public.staff id (looked up in the same
 * transaction, so staff created earlier in the test work too).
 */
export async function asStaff<T>(
  conn: Connection,
  staffId: string,
  fn: Body<T>,
  options?: TxOptions,
): Promise<T> {
  return inTransaction(
    conn,
    async (tx) => {
      const { rows } = await tx.query<{ auth_user_id: string; email: string }>(
        "select auth_user_id, email::text from public.staff where id = $1",
        [staffId],
      );
      if (rows.length === 0) throw new Error(`No staff row ${staffId}`);
      await tx.query("set local role authenticated");
      await setClaims(tx, {
        role: "authenticated",
        aud: "authenticated",
        sub: rows[0].auth_user_id,
        email: rows[0].email,
      });
      return fn(tx);
    },
    options,
  );
}

/**
 * Sets JWT claims WITHOUT changing role: the connection stays the superuser
 * owner. For calling private helpers (which API roles cannot execute) as if
 * a given user were signed in. `null` claims = no session at all.
 */
export function withClaims<T>(
  conn: Connection,
  claims: Claims | null,
  fn: Body<T>,
  options?: TxOptions,
): Promise<T> {
  return inTransaction(
    conn,
    async (tx) => {
      await setClaims(tx, claims);
      return fn(tx);
    },
    options,
  );
}

/** Claims for a seeded staff member, for withClaims. */
export function staffClaims(authUserId: string): Claims {
  return { role: "authenticated", aud: "authenticated", sub: authUserId };
}

/** First column of the first row. */
export async function scalar<T>(tx: Connection, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await tx.query({ text: sql, values: params, rowMode: "array" });
  return rows[0]?.[0] as T;
}
