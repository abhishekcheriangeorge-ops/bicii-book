import { Encodings, Font, FontNames } from "@pdf-lib/standard-fonts";

/**
 * Text measurement for labels from the PDF standard fonts' own metrics
 * (Helvetica, Helvetica-Bold, Courier-Bold), so the on-screen SVG and the
 * PDF lay a label out identically (./compose.ts is the one layout engine).
 * Kerning is not applied: neither renderer kerns.
 */

export type LabelFont = "regular" | "bold" | "mono";

const FONT_NAMES: Record<LabelFont, FontNames> = {
  regular: FontNames.Helvetica,
  bold: FontNames.HelveticaBold,
  mono: FontNames.CourierBold,
};

/** The PDF base font each label font maps to (pdf-lib StandardFonts names). */
export const PDF_FONT_NAMES = FONT_NAMES;

const loaded = new Map<LabelFont, Font>();
function fontFor(font: LabelFont): Font {
  let f = loaded.get(font);
  if (!f) {
    f = Font.load(FONT_NAMES[font]);
    loaded.set(font, f);
  }
  return f;
}

/**
 * Text the standard fonts can draw: whitespace runs become one space and
 * every character outside WinAnsi (CJK, emoji, …) becomes "?", so the PDF
 * never throws and the SVG shows the same characters.
 */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text.replace(/\s+/g, " ")) {
    const cp = ch.codePointAt(0) ?? 0x3f;
    out += Encodings.WinAnsi.canEncodeUnicodeCodePoint(cp) ? ch : "?";
  }
  return out;
}

/** Width of already-WinAnsi text at `sizeMm`, in millimetres. */
export function textWidthMm(text: string, font: LabelFont, sizeMm: number): number {
  const f = fontFor(font);
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0x3f;
    const glyph = Encodings.WinAnsi.canEncodeUnicodeCodePoint(cp)
      ? Encodings.WinAnsi.encodeUnicodeCodePoint(cp).name
      : "question";
    units += f.getWidthOfGlyph(glyph) ?? 0;
  }
  return (units / 1000) * sizeMm;
}

const ELLIPSIS = "…";

/** The longest prefix of `text` (by characters) that, with `suffix`, fits `maxWidthMm`. */
function cutToFit(
  text: string,
  suffix: string,
  font: LabelFont,
  sizeMm: number,
  maxWidthMm: number,
): string {
  const chars = [...text];
  let n = chars.length;
  while (n > 0 && textWidthMm(chars.slice(0, n).join("") + suffix, font, sizeMm) > maxWidthMm) {
    n--;
  }
  return chars.slice(0, n).join("").trimEnd();
}

/**
 * Word-wraps `text` (converted with toWinAnsi) into at most `maxLines`
 * lines no wider than `maxWidthMm`. Text that does not fit ends with "…";
 * a word longer than a line is cut by characters. Empty text gives [].
 */
export function fitLines(
  text: string,
  font: LabelFont,
  sizeMm: number,
  maxWidthMm: number,
  maxLines: number,
): string[] {
  const clean = toWinAnsi(text).trim();
  if (clean === "" || maxLines < 1) return [];
  const fits = (s: string) => textWidthMm(s, font, sizeMm) <= maxWidthMm;
  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";
  let i = 0;
  while (i < words.length) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      i++;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
    } else {
      // One word wider than the line: cut it by characters.
      const head = cutToFit(word, "", font, sizeMm, maxWidthMm) || [...word][0];
      lines.push(head);
      words[i] = word.slice(head.length);
      if (words[i] === "") i++;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
    current = "";
  }
  const truncated = current !== "" || i < words.length;
  if (truncated && lines.length > 0) {
    const last = lines.length - 1;
    const rest = [lines[last], current, ...words.slice(i)].filter(Boolean).join(" ");
    lines[last] = `${cutToFit(rest, ELLIPSIS, font, sizeMm, maxWidthMm)}${ELLIPSIS}`;
  }
  return lines;
}
