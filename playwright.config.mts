import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

import {
  ANON_KEY,
  DEFAULT_DB_NAME,
  GATEWAY_URL,
  SERVICE_ROLE_KEY,
  databaseUrl,
  withDatabase,
} from "./scripts/devstack/config.mjs";

/**
 * End-to-end tests (TESTING.md): Chromium only, an iPhone 13 and an iPad
 * viewport, against a production build (`next build && next start`) on
 * port 3100 wired to the local devstack (real Supabase Auth + PostgREST on
 * bicii_dev, reset and seeded by global-setup.ts unless E2E_RESET=0).
 *
 *   npm run test:e2e
 *   E2E_REUSE_SERVER=1 npm run test:e2e   # use an app already on E2E_PORT
 *   E2E_RESET=0 npm run test:e2e          # keep bicii_dev as it is
 *   E2E_EXTERNAL_STACK=1 npm run test:e2e # `supabase start` instead of the devstack
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

// The container's preinstalled Chromium may be an older build than the one
// this @playwright/test wants; never download browsers here.
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.mts",
  // One shared seeded database: run serially so permission changes made by
  // one test are not seen by another mid-flight.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "phone", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    { name: "tablet", use: { ...devices["iPad (gen 7)"], browserName: "chromium" } },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
    // Explicit devstack wiring (wins over .env.local, which Next would
    // otherwise load), so E2E never depends on a developer's local env.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: GATEWAY_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      NEXT_PUBLIC_PUBLIC_SITE_URL:
        process.env.NEXT_PUBLIC_PUBLIC_SITE_URL ?? "http://localhost:4000",
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
      DATABASE_URL: withDatabase(databaseUrl(), DEFAULT_DB_NAME),
      LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
    },
  },
});
