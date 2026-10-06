#!/usr/bin/env node
// Prints a table of devstack services: pid, port, process state and health.
// Exit code 0 when everything is up, 1 otherwise.
//
//   npm run devstack:status

import { GATEWAY_URL, MAIL_URL, databaseUrl, redact } from "./config.mjs";
import { isAlive, probe, readPid, services } from "./services.mjs";

async function main() {
  const rows = [];
  for (const service of services()) {
    const pid = readPid(service.name);
    const alive = isAlive(pid);
    const health = await probe(service.port, service.health);
    rows.push({
      service: service.name,
      port: String(service.port),
      pid: pid ? String(pid) : "-",
      process: alive ? "running" : pid ? "dead" : "stopped",
      health: health.ok ? `ok (${health.status})` : (health.error ?? `http ${health.status}`),
    });
  }
  const columns = ["service", "port", "pid", "process", "health"];
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => r[c].length)));
  const line = (values) => values.map((v, i) => v.padEnd(widths[i])).join("  ");
  console.log(line(columns));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const r of rows) console.log(line(columns.map((c) => r[c])));
  console.log(`\ngateway:  ${GATEWAY_URL}`);
  console.log(`mail:     ${MAIL_URL}`);
  console.log(`database: ${redact(databaseUrl())}`);
  process.exitCode = rows.every((r) => r.health.startsWith("ok")) ? 0 : 1;
}

void main();
