import { create } from "qrcode";

/**
 * The QR matrix of a payload (SPEC §15, PLAN D9): error correction M, the
 * same for the on-screen sheet, the PDF and the tests that decode them.
 * The payload is always the job's database-computed qr_payload; nothing
 * here builds one.
 */

/** Light modules around the code, inside the QR square (the label margin adds more). */
export const QUIET_ZONE_MODULES = 2;

export type QrMatrix = {
  /** Modules per side, without the quiet zone. */
  size: number;
  /** Whether the module at column x, row y is dark. */
  dark: (x: number, y: number) => boolean;
};

export function qrMatrix(payload: string): QrMatrix {
  const { modules } = create(payload, { errorCorrectionLevel: "M" });
  return { size: modules.size, dark: (x, y) => Boolean(modules.get(y, x)) };
}

/**
 * The dark modules as horizontal runs per row ({x, y, length} in modules),
 * so a renderer draws one rectangle per run instead of one per module.
 */
export function qrRuns(matrix: QrMatrix): { x: number; y: number; length: number }[] {
  const runs: { x: number; y: number; length: number }[] = [];
  for (let y = 0; y < matrix.size; y++) {
    let x = 0;
    while (x < matrix.size) {
      if (!matrix.dark(x, y)) {
        x++;
        continue;
      }
      const start = x;
      while (x < matrix.size && matrix.dark(x, y)) x++;
      runs.push({ x: start, y, length: x - start });
    }
  }
  return runs;
}
