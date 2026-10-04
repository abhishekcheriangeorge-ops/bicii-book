#!/usr/bin/env node
// Prints a cache key naming every pinned devstack component version, for
// CI's actions/cache (the workflow adds a hash of setup.mjs, which decides
// how the components are built). Bumping a version in config.mjs changes
// the key, so a stale cache is never restored.
//
//   node scripts/devstack/cache-key.mjs
//   -> devstack-linux-x64-postgrest12.2.3-auth2.178.0-storage1.79.31-node24.21.0-npm11

import { VERSIONS } from "./config.mjs";

const parts = Object.entries(VERSIONS).map(([name, version]) => `${name}${version}`);
process.stdout.write(`devstack-${process.platform}-${process.arch}-${parts.join("-")}\n`);
