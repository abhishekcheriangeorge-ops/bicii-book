import { describe, expect, it } from "vitest";

import { fitLines, textWidthMm, toWinAnsi } from "@/lib/printing/metrics";

describe("toWinAnsi", () => {
  it("keeps Latin-1 text and replaces what the standard fonts cannot draw", () => {
    expect(toWinAnsi("Café 自転車 🚲")).toBe("Café ??? ?");
    expect(toWinAnsi("a\n\tb")).toBe("a b");
    expect(toWinAnsi("× · …")).toBe("× · …");
  });
});

describe("textWidthMm", () => {
  it("measures with the font's metrics", () => {
    // Courier is fixed pitch: 600 units per character.
    expect(textWidthMm("P-000011", "mono", 3)).toBeCloseTo(8 * 0.6 * 3, 6);
    expect(textWidthMm("WWW", "bold", 3)).toBeGreaterThan(textWidthMm("iii", "bold", 3));
  });
});

describe("fitLines", () => {
  it("wraps words onto lines that fit", () => {
    const lines = fitLines("Road inner tube 700 x 25", "bold", 3, 20, 3);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidthMm(line, "bold", 3)).toBeLessThanOrEqual(20);
    expect(lines.join(" ")).toBe("Road inner tube 700 x 25");
  });

  it("ends truncated text with an ellipsis", () => {
    const lines = fitLines("A ".repeat(100), "regular", 3, 20, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    for (const line of lines) expect(textWidthMm(line, "regular", 3)).toBeLessThanOrEqual(20);
  });

  it("cuts a word longer than the line by characters", () => {
    const lines = fitLines("Supercalifragilisticexpialidocious", "bold", 3, 15, 2);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(textWidthMm(line, "bold", 3)).toBeLessThanOrEqual(15);
  });

  it("returns nothing for empty text", () => {
    expect(fitLines("   ", "regular", 3, 20, 2)).toEqual([]);
  });
});
