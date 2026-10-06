/**
 * The print job status machine (PLAN D59, DATA-MODEL §12): every
 * (from, to) pair of print_status and whether
 * private.print_job_transition_allowed accepts it. Shared by
 * tests/db/labels.test.ts (the function, the trigger and
 * set_print_job_status) and the Phase 8 step 2 unit test of the
 * TypeScript mirror. A pair with from = to is not a transition:
 * set_print_job_status treats it as a replay (no change).
 */
export const PRINT_STATUSES = ["queued", "rendered", "printed", "failed"] as const;

export type PrintStatus = (typeof PRINT_STATUSES)[number];

/** The only allowed moves: printed and failed are final; nothing returns to queued. */
const ALLOWED: ReadonlySet<string> = new Set([
  "queued>rendered",
  "queued>printed",
  "queued>failed",
  "rendered>printed",
  "rendered>failed",
]);

export const PRINT_TRANSITIONS: readonly {
  from: PrintStatus;
  to: PrintStatus;
  allowed: boolean;
}[] = PRINT_STATUSES.flatMap((from) =>
  PRINT_STATUSES.map((to) => ({ from, to, allowed: ALLOWED.has(`${from}>${to}`) })),
);
