#!/usr/bin/env node
// Stops every devstack service started by start.mjs (reverse order).
//
//   npm run devstack:stop

import { fail, log } from "./config.mjs";
import { services, stopService } from "./services.mjs";

async function main() {
  for (const service of services().reverse()) {
    log(`${service.name}: ${await stopService(service.name)}`);
  }
}

main().catch((err) => fail(err.stack ?? String(err)));
