/**
 * Per-file setup for the DB project: a fresh database cloned from the run's
 * template before the file's tests, dropped (with every connection the file
 * opened) after them.
 */
import { afterAll, beforeAll } from "vitest";

import { createTestDatabase, dropTestDatabase } from "./harness";

beforeAll(async () => {
  await createTestDatabase();
});

afterAll(async () => {
  await dropTestDatabase();
});
