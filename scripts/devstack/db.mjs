#!/usr/bin/env node
// Database commands for the devstack.
//
//   node scripts/devstack/db.mjs reset           npm run db:reset
//   node scripts/devstack/db.mjs migrate         npm run db:migrate
//   node scripts/devstack/db.mjs types [--fresh] npm run db:types
//
// Connection: DATABASE_URL, else PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE,
// else postgres://postgres:postgres@127.0.0.1:5432/bicii_dev. The user must
// be a superuser (it creates databases and the Supabase platform roles).

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { ROOT, databaseUrl, fail, log, redact, withDatabase } from "./config.mjs";
import { applyMigrations, buildDatabase, dropDatabase } from "./database.mjs";

const SUPABASE_CLI = "supabase@2.119.0";
const TYPES_FILE = path.join(ROOT, "src", "lib", "database.types.ts");

async function reset() {
  const url = databaseUrl();
  log(`resetting ${redact(url)}`);
  const started = Date.now();
  await buildDatabase(url, { onStep: (s) => log(s) });
  log(`database ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  log("seeded logins (password bicii-dev-password): admin@, mechanic1@, mechanic2@bicii.test");
}

async function migrate() {
  const url = databaseUrl();
  log(`migrating ${redact(url)}`);
  const applied = await applyMigrations(url, {
    onApply: (m) => log(`applied ${m.version}_${m.name}`),
  });
  log(applied.length === 0 ? "already up to date" : `${applied.length} migration(s) applied`);
}

/**
 * Generates src/lib/database.types.ts with the Supabase CLI's own generator.
 * `supabase gen types typescript --db-url` runs without Docker. With
 * --fresh, generates from a throwaway database built from the migrations
 * (what CI diffs against) instead of the dev database.
 */
async function types(args) {
  const fresh = args.includes("--fresh");
  let url = databaseUrl();
  if (fresh) {
    url = withDatabase(url, "bicii_typegen");
    log(`building throwaway database ${redact(url)}`);
    await buildDatabase(url, { seed: false, onStep: () => {} });
  }
  try {
    log(`generating types from ${redact(url)}`);
    const result = spawnSync(
      "npx",
      ["-y", SUPABASE_CLI, "gen", "types", "typescript", "--db-url", url, "--schema", "public"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.status !== 0 || !result.stdout.includes("export type Database")) {
      throw new Error(`supabase gen types failed:\n${result.stderr}\n${result.stdout}`);
    }
    writeFileSync(TYPES_FILE, result.stdout);
    execFileSync(path.join(ROOT, "node_modules", ".bin", "prettier"), ["--write", TYPES_FILE], {
      cwd: ROOT,
      stdio: "ignore",
    });
    log(`wrote ${path.relative(ROOT, TYPES_FILE)}`);
  } finally {
    if (fresh) await dropDatabase(url);
  }
}

const [command, ...args] = process.argv.slice(2);
const commands = { reset, migrate, types };
if (!commands[command]) fail(`usage: db.mjs <${Object.keys(commands).join("|")}> [--fresh]`);
commands[command](args).catch((err) => fail(err.message));
