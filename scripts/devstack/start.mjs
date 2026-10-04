#!/usr/bin/env node
// Starts Supabase Auth, PostgREST, Supabase Storage and the gateway as
// detached processes (pid files and logs in .devstack/). Idempotent: a
// service that is already running and healthy is left alone. Waits until
// every service reports healthy.
//
//   npm run devstack:start
//
// The database must exist first: npm run db:reset.

import pg from "pg";

import { GATEWAY_URL, STATE_DIR, databaseUrl, fail, log, redact, requireCache } from "./config.mjs";
import {
  isAlive,
  logFile,
  probe,
  readPid,
  services,
  startDetached,
  stopService,
  waitHealthy,
} from "./services.mjs";

async function checkDatabase(url) {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    fail(
      `cannot connect to ${redact(url)} (${err.message}). Is Postgres running? Run npm run db:reset.`,
    );
  }
  try {
    const r = await client.query(
      "select to_regclass('auth.users') is not null as auth, to_regclass('storage.objects') is not null as storage, to_regclass('public.staff') is not null as app",
    );
    const { auth, storage, app } = r.rows[0];
    if (!auth || !storage || !app) {
      fail(
        `${redact(url)} is not built (auth=${auth}, storage=${storage}, app=${app}). Run npm run db:reset.`,
      );
    }
  } finally {
    await client.end();
  }
}

async function main() {
  try {
    requireCache("postgrest", "auth", "node24", "storage");
  } catch (err) {
    fail(err.message);
  }
  const url = databaseUrl();
  await checkDatabase(url);
  log(`database ${redact(url)}`);
  log(`state and logs in ${STATE_DIR}`);

  for (const service of services()) {
    const pid = readPid(service.name);
    if (pid && isAlive(pid)) {
      if ((await probe(service.port, service.health)).ok) {
        log(`${service.name}: already running (pid ${pid}, port ${service.port})`);
        continue;
      }
      log(`${service.name}: pid ${pid} is not healthy; restarting`);
      await stopService(service.name);
    } else if (
      (await probe(service.port, service.health)).ok ||
      (await probe(service.port, "/")).status
    ) {
      fail(
        `${service.name}: port ${service.port} is already in use by another process. ` +
          "Stop it, or override the port (BICII_AUTH_PORT, BICII_REST_PORT, BICII_STORAGE_PORT, BICII_GATEWAY_PORT).",
      );
    }
    const newPid = startDetached(service);
    if (!(await waitHealthy(service))) {
      fail(`${service.name} did not become healthy. See ${logFile(service.name)}`);
    }
    log(`${service.name}: started (pid ${newPid}, port ${service.port})`);
  }
  log(`ready: ${GATEWAY_URL} (auth/v1, rest/v1, storage/v1; GET /health)`);
}

main().catch((err) => fail(err.stack ?? String(err)));
