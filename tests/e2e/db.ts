import pg from "pg";

/**
 * Direct SQL on the E2E database (the one global-setup resets: PGDATABASE,
 * default bicii_dev), for the few assertions no screen can make: that an
 * unknown email got no Auth user, ageing a sign-in code past its expiry,
 * holding Auth's per-address interval open, and deactivating someone
 * without ending their sessions (the hosted window of PLAN D71).
 * Superuser connection; never use it to set up data a screen
 * should create. (config.mjs is an ES module; Playwright compiles specs to
 * CommonJS, hence the dynamic import.)
 */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const { devDatabaseUrl } = await import("../../scripts/devstack/config.mjs");
  const client = new pg.Client({ connectionString: devDatabaseUrl() });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/**
 * Runs `fn` in one transaction on the E2E database (committed if it
 * returns, rolled back if it throws), for statements that must not be seen
 * apart, such as disabling a trigger for one update.
 */
export async function sqlTransaction(
  fn: (
    query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
      text: string,
      values?: unknown[],
    ) => Promise<T[]>,
  ) => Promise<void>,
): Promise<void> {
  const { devDatabaseUrl } = await import("../../scripts/devstack/config.mjs");
  const client = new pg.Client({ connectionString: devDatabaseUrl() });
  await client.connect();
  try {
    await client.query("begin");
    await fn(async (text, values = []) => (await client.query(text, values)).rows);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
