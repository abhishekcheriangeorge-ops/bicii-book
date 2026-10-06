#!/usr/bin/env node
// Writes the devstack connection settings into .env.local (git-ignored),
// keeping any other variables already there. Only what the APP reads: the
// scripts and tests take DATABASE_URL / PG* from the shell, never from
// .env.local, so writing them here would only suggest otherwise.
//
//   npm run devstack:env

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ANON_KEY, GATEWAY_URL, ROOT, SERVICE_ROLE_KEY, log } from "./config.mjs";

const FILE = path.join(ROOT, ".env.local");

const values = {
  NEXT_PUBLIC_SUPABASE_URL: GATEWAY_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  // An extra accepted scan base (src/lib/qr.ts scanBases). The QR base itself
  // is shop_settings.public_site_url (PLAN D9; the seed sets
  // http://localhost:4000).
  NEXT_PUBLIC_PUBLIC_SITE_URL: "http://localhost:4000",
};

const existing = existsSync(FILE) ? readFileSync(FILE, "utf8").split("\n") : [];
const seen = new Set();
const lines = existing.map((line) => {
  const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
  if (m && m[1] in values) {
    seen.add(m[1]);
    return `${m[1]}=${values[m[1]]}`;
  }
  return line;
});
const missing = Object.keys(values).filter((k) => !seen.has(k));
if (missing.length > 0) {
  if (lines.length === 0) {
    lines.push("# Local devstack settings (npm run devstack:env). Never commit this file.");
  } else if (lines.at(-1) !== "") {
    lines.push("");
  }
  for (const k of missing) lines.push(`${k}=${values[k]}`);
}
const text = `${lines.join("\n").replace(/\n+$/, "")}\n`;
writeFileSync(FILE, text, { mode: 0o600 });
log(`wrote ${path.relative(ROOT, FILE)} (${Object.keys(values).join(", ")})`);
