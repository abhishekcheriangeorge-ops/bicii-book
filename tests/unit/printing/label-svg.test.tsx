// @vitest-environment node
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from "@zxing/library";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { composeLabel } from "@/lib/printing/compose";
import { LabelSvg } from "@/lib/printing/label-svg";
import { labelLayoutSchema } from "@/lib/printing/schemas";
import { SAMPLE_CONTENT } from "@/lib/printing/samples";
import type { LabelContent } from "@/lib/printing/types";

import { DEFAULT_LAYOUTS } from "../../fixtures/label-layouts";

const template = {
  widthMm: 58,
  heightMm: 40,
  layout: labelLayoutSchema.parse(DEFAULT_LAYOUTS.product),
};

/** Rasterises the SVG and decodes its QR with ZXing (what a phone camera does). */
async function decode(svg: string): Promise<string> {
  const { data, info } = await sharp(Buffer.from(svg))
    .flatten({ background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const luminance = new Uint8ClampedArray(info.width * info.height);
  for (let i = 0; i < luminance.length; i++) {
    const p = i * info.channels;
    luminance[i] = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
  }
  const bitmap = new BinaryBitmap(
    new HybridBinarizer(new RGBLuminanceSource(luminance, info.width, info.height)),
  );
  return new QRCodeReader().decode(bitmap).getText();
}

const content = (shortId: string, base: string): LabelContent => ({
  ...SAMPLE_CONTENT.product,
  shortId,
  qrPayload: `${base}/q/${shortId}`,
});

describe("LabelSvg QR", () => {
  for (const c of [
    content("P-000011", "http://localhost:4000"),
    content("U-000001", "https://bicii.sg"),
    content("B-000001", "https://bicii.sg"),
    content("P-000123", "https://bicii.sg/shop"),
  ]) {
    it(`decodes to exactly ${c.qrPayload}`, async () => {
      const svg = renderToStaticMarkup(
        <LabelSvg drawing={composeLabel(template, c)} pxPerMm={12} />,
      );
      expect(await decode(svg)).toBe(c.qrPayload);
    });
  }

  it("still decodes with a printer offset", async () => {
    const c = content("P-000011", "http://localhost:4000");
    const svg = renderToStaticMarkup(
      <LabelSvg
        drawing={composeLabel(template, c, { offsetXMm: 2, offsetYMm: -1 })}
        pxPerMm={12}
      />,
    );
    expect(await decode(svg)).toBe(c.qrPayload);
  });
});

describe("LabelSvg markup", () => {
  it("clips the translated content to the label, with an accessible name", () => {
    const c = content("P-000011", "http://localhost:4000");
    const svg = renderToStaticMarkup(
      <LabelSvg drawing={composeLabel(template, c, { offsetXMm: 1, offsetYMm: 2 })} />,
    );
    // The clip group wraps the translate group, never the other way round.
    expect(svg).toMatch(/<g clip-path="url\(#label-clip-[^"]+\)"><g transform="translate\(1 2\)">/);
    expect(svg).toMatch(/<clipPath id="label-clip-[^"]+"><rect x="0" y="0" width="58" height="40"/);
    expect(svg).toContain('role="img"');
    expect(svg).toContain(
      'aria-label="Label: Sample: Supacaz Super Sticky Kush bar tape, $39.90, P-000011"',
    );
    expect(svg).toContain('width="58mm"');
    // The QR is one path.
    expect(svg.match(/<path /g)).toHaveLength(1);
  });

  it("gives each instance its own clip id", () => {
    const d = composeLabel(template, content("P-000011", "http://localhost:4000"));
    const svg = renderToStaticMarkup(
      <>
        <LabelSvg drawing={d} />
        <LabelSvg drawing={d} />
      </>,
    );
    const ids = [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
