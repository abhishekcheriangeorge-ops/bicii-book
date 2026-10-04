#!/usr/bin/env node
// Starts Supabase Auth, PostgREST, Supabase Storage and the gateway as
// detached processes (pid files and logs in .devstack/). Idempotent: a
// service that is already running and healthy is left alone. Waits until
// every service reports healthy.
//
//   npm run devstack:start
//
// If the database does not exist yet (first run), it is built first, as
// `npm run db:reset` would. An existing database is never touched: if it is
// not built, start stops and asks for `npm run db:reset`.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";

import { GATEWAY_URL, STATE_DIR, databaseUrl, fail, log, redact, requireCache } from "./config.mjs";
import { buildDatabase } from "./database.mjs";
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
    if (err.code === "3D000") {
      // invalid_catalog_name: the database does not exist yet.
      log(`${redact(url)} does not exist; building it (npm run db:reset does the same)`);
      await buildDatabase(url, { onStep: (step) => log(step) });
      return;
    }
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

  // Services already running against another database (say, a different
  // PGPORT or DATABASE_URL than last time) would pass the health checks
  // below while serving the wrong data: restart them all.
  const target = redact(url);
  const previous = readTarget();
  if (previous && previous !== target) {
    log(`services were started for ${previous}; restarting them for ${target}`);
    for (const service of services().reverse()) await stopService(service.name);
  }

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
  writeFileSync(TARGET_FILE, `${target}\n`);
  log(`ready: ${GATEWAY_URL} (auth/v1, rest/v1, storage/v1; GET /health)`);
}

const TARGET_FILE = path.join(STATE_DIR, "database");

function readTarget() {
  try {
    return readFileSync(TARGET_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

main().catch((err) => fail(err.stack ?? String(err)));
