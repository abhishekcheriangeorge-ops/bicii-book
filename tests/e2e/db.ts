import pg from "pg";

/**
 * Direct SQL on the E2E database (the one global-setup resets: PGDATABASE,
 * default bicii_dev), for the few assertions no screen can make: that an
 * unknown email got no Auth user, and ageing a sign-in code past its
 * expiry. Superuser connection; never use it to set up data a screen
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
