#!/usr/bin/env node
// Downloads and builds the devstack's Supabase services into the cache
// (~/.cache/bicii-devstack, or $BICII_DEVSTACK_CACHE). Idempotent: anything
// already cached at the pinned version is reused. `--force` rebuilds all.
//
//   npm run devstack:setup [-- --force]
//
// Needs curl, tar (with xz), git and network access to GitHub releases and
// the npm registry. No Docker.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CACHE_DIR, PATHS, VERSIONS, fail, log } from "./config.mjs";

const FORCE = process.argv.includes("--force");

const URLS = {
  postgrest: `https://github.com/PostgREST/postgrest/releases/download/v${VERSIONS.postgrest}/postgrest-v${VERSIONS.postgrest}-linux-static-x64.tar.xz`,
  auth: `https://github.com/supabase/auth/releases/download/v${VERSIONS.auth}/auth-v${VERSIONS.auth}-x86.tar.gz`,
  storage: "https://github.com/supabase/storage.git",
};

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function shLoud(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

function tryVersion(cmd, args) {
  try {
    return sh(cmd, args).trim();
  } catch {
    return "";
  }
}

function download(url, dest) {
  log(`  downloading ${url}`);
  sh("curl", ["-fsSL", "--retry", "3", "-o", dest, url]);
}

function requireTools() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail(
      `the devstack binaries are linux-x64 builds; this is ${process.platform}-${process.arch}. ` +
        "On other platforms use `supabase start` (Docker) instead.",
    );
  }
  for (const tool of ["curl", "tar", "git"]) {
    if (!tryVersion(tool, ["--version"])) fail(`${tool} is required but not on PATH`);
  }
}

function setupPostgrest() {
  const have = tryVersion(PATHS.postgrest, ["--version"]);
  if (!FORCE && have.includes(VERSIONS.postgrest)) {
    log(`PostgREST ${VERSIONS.postgrest}: cached`);
    return;
  }
  log(`PostgREST ${VERSIONS.postgrest}: installing`);
  mkdirSync(path.dirname(PATHS.postgrest), { recursive: true });
  const archive = path.join(CACHE_DIR, "postgrest.tar.xz");
  download(URLS.postgrest, archive);
  sh("tar", ["-xJf", archive, "-C", path.dirname(PATHS.postgrest)]);
  rmSync(archive, { force: true });
  const got = tryVersion(PATHS.postgrest, ["--version"]);
  if (!got.includes(VERSIONS.postgrest)) fail(`PostgREST version check failed: "${got}"`);
  log(`  ${got}`);
}

function setupAuth() {
  const have = tryVersion(PATHS.auth, ["version"]);
  if (!FORCE && have.includes(VERSIONS.auth) && existsSync(PATHS.authMigrations)) {
    log(`Supabase Auth ${VERSIONS.auth}: cached`);
    return;
  }
  log(`Supabase Auth ${VERSIONS.auth}: installing`);
  rmSync(PATHS.authDir, { recursive: true, force: true });
  mkdirSync(PATHS.authDir, { recursive: true });
  const archive = path.join(CACHE_DIR, "auth.tar.gz");
  download(URLS.auth, archive);
  sh("tar", ["-xzf", archive, "-C", PATHS.authDir]);
  rmSync(archive, { force: true });
  const got = tryVersion(PATHS.auth, ["version"]);
  if (!got.includes(VERSIONS.auth)) fail(`Supabase Auth version check failed: "${got}"`);
  if (!existsSync(PATHS.authMigrations)) fail("Supabase Auth archive had no migrations/ folder");
  log(`  auth ${got}`);
}

function setupNode24() {
  const have = tryVersion(PATHS.node24, ["--version"]);
  if (!FORCE && have.startsWith("v24.")) {
    log(`Node ${have} (for Storage): cached`);
    return;
  }
  log(`Node ${VERSIONS.node} + npm ${VERSIONS.npm} (for Storage): installing from npm`);
  mkdirSync(PATHS.node24Dir, { recursive: true });
  if (!existsSync(path.join(PATHS.node24Dir, "package.json"))) {
    writeFileSync(
      path.join(PATHS.node24Dir, "package.json"),
      JSON.stringify({ name: "bicii-devstack-node24", private: true }, null, 2),
    );
  }
  shLoud(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--prefix",
      PATHS.node24Dir,
      `node@${VERSIONS.node}`,
      `npm@${VERSIONS.npm}`,
    ],
    { cwd: PATHS.node24Dir },
  );
  const got = tryVersion(PATHS.node24, ["--version"]);
  if (!got.startsWith("v24.")) fail(`Node 24 version check failed: "${got}"`);
  log(`  node ${got}`);
}

function storageTag() {
  return tryVersion("git", ["-C", PATHS.storageDir, "describe", "--tags", "--exact-match"]);
}

function setupStorage() {
  const tag = `v${VERSIONS.storage}`;
  const built = path.join(PATHS.storageDir, ".bicii-built");
  const builtBefore = existsSync(built) || existsSync(PATHS.storageServer);
  if (!FORCE && storageTag() === tag && builtBefore && existsSync(PATHS.storageMigrate)) {
    log(`Supabase Storage ${VERSIONS.storage}: cached`);
    return;
  }
  log(`Supabase Storage ${VERSIONS.storage}: cloning and building (a few minutes)`);
  if (FORCE || storageTag() !== tag) {
    rmSync(PATHS.storageDir, { recursive: true, force: true });
    shLoud("git", [
      "-c",
      "advice.detachedHead=false",
      "clone",
      "--depth",
      "1",
      "--branch",
      tag,
      URLS.storage,
      PATHS.storageDir,
    ]);
  }
  // Storage requires Node 24 / npm 11: put the cached toolchain first.
  const env = { ...process.env, PATH: `${PATHS.node24Bin}${path.delimiter}${process.env.PATH}` };
  const npm = path.join(PATHS.node24Bin, "npm");
  shLoud(npm, ["ci", "--no-audit", "--no-fund"], { cwd: PATHS.storageDir, env });
  shLoud(npm, ["run", "build"], { cwd: PATHS.storageDir, env });
  if (!existsSync(PATHS.storageServer) || !existsSync(PATHS.storageMigrate)) {
    fail(
      "Storage build finished but dist/start/server.js or dist/scripts/migrate-call.js is missing",
    );
  }
  writeFileSync(built, `${tag}\n`);
  log(`  storage ${storageTag()}`);
}

requireTools();
mkdirSync(CACHE_DIR, { recursive: true });
log(`cache: ${CACHE_DIR}`);
setupPostgrest();
setupAuth();
setupNode24();
setupStorage();
log("devstack components ready. Next: npm run db:reset && npm run devstack:start");
