// Process management for the devstack services: detached children with pid
// files and logs under .devstack/ (git-ignored).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

import {
  ANON_KEY,
  GATEWAY_URL,
  JWT_SECRET,
  MAIL_URL,
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

/**
 * Service definitions in start order: the mail catcher first (Auth sends
 * through it and fetches its email templates from it), the gateway last.
 * `extraPorts` are further ports a service listens on (not HTTP); start
 * refuses to run when one is taken.
 */
export function services() {
  const url = databaseUrl();
  return [
    {
      name: "mail",
      port: PORTS.mailHttp,
      extraPorts: [PORTS.smtp],
      health: "/health",
      command: () => [
        process.execPath,
        [path.join(ROOT, "scripts", "devstack", "mailcatcher.mjs")],
      ],
      cwd: ROOT,
      env: () => ({
        BICII_SMTP_PORT: String(PORTS.smtp),
        BICII_MAIL_HTTP_PORT: String(PORTS.mailHttp),
      }),
    },
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
        // Email sign-in codes (PLAN D10, D70). Auth sends through the
        // devstack's mail catcher (mailcatcher.mjs) on 127.0.0.1, which
        // accepts any or no credentials, so GOTRUE_SMTP_USER and
        // GOTRUE_SMTP_PASS stay unset (no AUTH is attempted) and no STARTTLS
        // is offered. The sender is a .test address: nothing leaves the box.
        GOTRUE_SMTP_HOST: "127.0.0.1",
        GOTRUE_SMTP_PORT: String(PORTS.smtp),
        GOTRUE_SMTP_ADMIN_EMAIL: "no-reply@bicii.test",
        GOTRUE_SMTP_SENDER_NAME: "BICII",
        // Minimum gap between two emails to one address: config.toml's
        // [auth.email] max_frequency. Hosted projects use 60 s (RUNBOOK).
        GOTRUE_SMTP_MAX_FREQUENCY: "1s",
        // D70: 6-digit codes valid for 10 minutes (config.toml otp_length,
        // otp_expiry).
        GOTRUE_MAILER_OTP_LENGTH: "6",
        GOTRUE_MAILER_OTP_EXP: "600",
        // Our templates (supabase/templates), served by the catcher because
        // Auth fetches templates by URL. Codes only: they carry
        // {{ .Token }} and no link (D70). signInWithOtp for a confirmed user
        // sends magic_link; an unconfirmed one gets confirmation.
        GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: "Your BICII sign-in code",
        GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: `${MAIL_URL}/templates/magic_link.html`,
        GOTRUE_MAILER_SUBJECTS_CONFIRMATION: "Your BICII code",
        GOTRUE_MAILER_TEMPLATES_CONFIRMATION: `${MAIL_URL}/templates/confirmation.html`,
        // Local only: generous rate limits so the E2E suite and the stack
        // tests can ask for and verify hundreds of codes from 127.0.0.1
        // (emails sent per hour; OTP requests, verifications and token
        // refreshes per 5 minutes per IP). Hosted limits are set in the
        // dashboard (RUNBOOK); config.toml raises its own for `supabase start`.
        GOTRUE_RATE_LIMIT_EMAIL_SENT: "100000",
        GOTRUE_RATE_LIMIT_VERIFY: "100000",
        GOTRUE_RATE_LIMIT_OTP: "100000",
        GOTRUE_RATE_LIMIT_TOKEN_REFRESH: "100000",
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

/**
 * True when something accepts TCP connections on 127.0.0.1:port.
 * @param {number} port
 */
export function portOpen(port, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (/** @type {boolean} */ open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
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
