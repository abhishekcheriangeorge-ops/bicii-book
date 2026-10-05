// Process management for the devstack services: detached children with pid
// files and logs under .devstack/ (git-ignored).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

import {
  ANON_KEY,
  GATEWAY_URL,
  JWT_SECRET,
  PATHS,
  PORTS,
  ROOT,
  SERVICE_ROLE_KEY,
  STATE_DIR,
  databaseUrl,
  withLogin,
} from "./config.mjs";
import { authEnv, storageEnv } from "./database.mjs";

export const LOG_DIR = path.join(STATE_DIR, "logs");
export const PID_DIR = path.join(STATE_DIR, "pids");

function postgrestConfig(url) {
  const file = path.join(STATE_DIR, "postgrest.conf");
  const lines = [
    `db-uri = "${withLogin(url, "authenticator")}"`,
    'db-schemas = "public, reporting"',
    'db-anon-role = "anon"',
    'db-extra-search-path = "public, extensions"',
    "db-max-rows = 1000",
    "db-pool = 10",
    `jwt-secret = "${JWT_SECRET}"`,
    'server-host = "127.0.0.1"',
    `server-port = ${PORTS.rest}`,
    'log-level = "error"',
  ];
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

/** Service definitions in start order; the gateway goes last. */
export function services() {
  const url = databaseUrl();
  return [
    {
      name: "auth",
      port: PORTS.auth,
      health: "/health",
      command: () => [PATHS.auth, []],
      cwd: PATHS.authDir,
      env: () => ({
        ...authEnv(url),
        GOTRUE_API_HOST: "127.0.0.1",
        PORT: String(PORTS.auth),
        API_EXTERNAL_URL: `${GATEWAY_URL}/auth/v1`,
        GOTRUE_SITE_URL: "http://localhost:3000",
        GOTRUE_URI_ALLOW_LIST: "http://localhost:3000/**,http://127.0.0.1:3000/**",
        GOTRUE_DISABLE_SIGNUP: "false",
        GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
        GOTRUE_EXTERNAL_PHONE_ENABLED: "false",
        GOTRUE_MAILER_AUTOCONFIRM: "true",
        GOTRUE_LOG_LEVEL: "info",
        // The [auth] settings of supabase/config.toml, which `supabase start`
        // passes to Auth the same way. Set explicitly so the devstack never
        // falls back to a binary default the CLI stack and hosted projects
        // do not use (GOTRUE_JWT_EXP = jwt_expiry is in authEnv). Without the
        // reuse interval (no default in the binary: 0s) two requests racing
        // to refresh an expired session could trip reuse detection.
        // password_requirements = "" is the binary's default (no env).
        GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: "true",
        GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: "10",
        GOTRUE_PASSWORD_MIN_LENGTH: "6",
        GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION: "false",
      }),
    },
    {
      name: "rest",
      port: PORTS.rest,
      health: "/",
      command: () => [PATHS.postgrest, [postgrestConfig(url)]],
      cwd: STATE_DIR,
      env: () => ({}),
    },
    {
      name: "storage",
      port: PORTS.storage,
      health: "/status",
      command: () => [PATHS.node24, [PATHS.storageServer]],
      cwd: PATHS.storageDir,
      env: () => ({
        ...storageEnv(url),
        NODE_ENV: "production",
        ANON_KEY,
        SERVICE_KEY: SERVICE_ROLE_KEY,
        SERVER_HOST: "127.0.0.1",
        SERVER_PORT: String(PORTS.storage),
        FILE_SIZE_LIMIT: "52428800",
        REQUEST_ALLOW_X_FORWARDED_PATH: "true",
        LOG_LEVEL: "warn",
      }),
    },
    {
      name: "gateway",
      port: PORTS.gateway,
      health: "/health",
      command: () => [process.execPath, [path.join(ROOT, "scripts", "devstack", "gateway.mjs")]],
      cwd: ROOT,
      env: () => ({}),
    },
  ];
}

export function pidFile(name) {
  return path.join(PID_DIR, `${name}.pid`);
}

export function logFile(name) {
  return path.join(LOG_DIR, `${name}.log`);
}

export function readPid(name) {
  try {
    const pid = Number(readFileSync(pidFile(name), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

export function probe(port, pathname, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname, timeout }, (res) => {
      res.resume();
      resolve({ ok: (res.statusCode ?? 500) < 500, status: res.statusCode });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (err) => resolve({ ok: false, error: err.code ?? err.message }));
  });
}

export function startDetached(service) {
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(PID_DIR, { recursive: true });
  const [command, args] = service.command();
  if (!existsSync(command)) throw new Error(`${service.name}: ${command} not found`);
  const out = openSync(logFile(service.name), "a");
  const child = spawn(command, args, {
    cwd: service.cwd,
    env: { ...process.env, ...service.env() },
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  writeFileSync(pidFile(service.name), `${child.pid}\n`);
  return child.pid;
}

export async function waitHealthy(service, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await probe(service.port, service.health);
    if (r.ok) return true;
    const pid = readPid(service.name);
    if (pid && !isAlive(pid)) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

export async function stopService(name, timeoutMs = 8000) {
  const pid = readPid(name);
  if (!pid || !isAlive(pid)) {
    rmSync(pidFile(name), { force: true });
    return "not running";
  }
  // Each service is its own process group leader (detached), so signal the
  // group to take any workers down with it.
  const signal = (sig) => {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        /* already gone */
      }
    }
  };
  signal("SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (isAlive(pid)) signal("SIGKILL");
  rmSync(pidFile(name), { force: true });
  return "stopped";
}
