// @vitest-environment node
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

import { buildLabelDocument } from "@/lib/printing/document";
import { SAMPLE_CONTENT } from "@/lib/printing/samples";

import { sampleJob } from "./fixture";

vi.mock("server-only", () => ({}));

const { renderLabelPdf } = await import("@/lib/printing/adapters/pdf");
const { AdapterUnavailableError, getAdapter } = await import("@/lib/printing/adapters");

const MM = 72 / 25.4;

/** Every page's link annotation URIs. */
function linkUris(pdf: PDFDocument): string[][] {
  return pdf.getPages().map((page) => {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return [];
    return annots.asArray().map((ref) => {
      const annot = pdf.context.lookup(ref, PDFDict);
      const action = annot.lookup(PDFName.of("A"), PDFDict);
      return action.lookup(PDFName.of("URI"), PDFString).decodeText();
    });
  });
}

describe("renderLabelPdf", () => {
  it("makes one 58 x 40 mm page per copy, each linking exactly the payload", async () => {
    const job = sampleJob({ quantity: 10 });
    const bytes = await renderLabelPdf(buildLabelDocument(job));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(pdf.getPageCount()).toBe(10);
    for (const page of pdf.getPages()) {
      const { width, height } = page.getMediaBox();
      expect(Math.abs(width - 58 * MM)).toBeLessThan(0.01);
      expect(Math.abs(height - 40 * MM)).toBeLessThan(0.01);
      const crop = page.getCropBox();
      expect(crop.width).toBeCloseTo(width, 6);
      expect(crop.height).toBeCloseTo(height, 6);
    }
    expect(linkUris(pdf)).toEqual(Array.from({ length: 10 }, () => [job.qrPayload]));
    expect(pdf.getTitle()).toBe("Labels P-000011 × 10");
    expect(pdf.getCreator()).toBe("BICII Admin");
    expect(pdf.getProducer()).toBeUndefined();
    expect(pdf.getAuthor()).toBeUndefined();
  });

  it("never throws on characters outside the standard fonts", async () => {
    const job = sampleJob({
      quantity: 1,
      content: {
        ...SAMPLE_CONTENT.unit,
        name: "Café 自転車 🚲",
        identity: ["Größe 54 · Rot", "中古"],
      },
    });
    const pdf = await PDFDocument.load(await renderLabelPdf(buildLabelDocument(job)));
    expect(pdf.getPageCount()).toBe(1);
    expect(linkUris(pdf)).toEqual([[job.qrPayload]]);
  });

  it("uses the job's printer offsets and still links the payload", async () => {
    const job = sampleJob({
      quantity: 2,
      profile: { id: "p", name: "Shifted", config: { offsetXMm: 2, offsetYMm: -1.5 } },
    });
    const pdf = await PDFDocument.load(await renderLabelPdf(buildLabelDocument(job)));
    expect(linkUris(pdf)).toEqual([[job.qrPayload], [job.qrPayload]]);
  });
});

describe("getAdapter", () => {
  it("returns browser and pdf, and refuses the hardware adapters", () => {
    expect(getAdapter("browser").delivery).toBe("print-dialog");
    expect(getAdapter("pdf").delivery).toBe("download");
    expect(() => getAdapter("network_raw")).toThrow(AdapterUnavailableError);
    expect(() => getAdapter("bluetooth")).toThrow("needs the hardware adapter, Phase 12");
  });
});
