import "server-only";

import { PDFDocument, PDFString, StandardFonts, rgb, type PDFPage } from "pdf-lib";

import type { LabelDocument } from "../document";
import { toWinAnsi, type LabelFont } from "../metrics";
import { QUIET_ZONE_MODULES, qrRuns } from "../qr";
import type { PrinterAdapter } from "./types";

/**
 * The PDF adapter (server only): one page per copy, each exactly the label
 * (MediaBox = CropBox = width x height), the QR as filled rectangles of
 * merged runs, text in the standard Helvetica / Helvetica-Bold /
 * Courier-Bold (through toWinAnsi, so no character can throw) and a link
 * annotation over the QR whose URI is the job's payload. The label is
 * drawn once and placed on every page. Metadata: the title "Labels
 * {shortId} × {copies}" and creator "BICII Admin", nothing else.
 */

const PT_PER_MM = 72 / 25.4;
const pt = (mm: number) => mm * PT_PER_MM;

const PDF_FONTS: Record<LabelFont, StandardFonts> = {
  regular: StandardFonts.Helvetica,
  bold: StandardFonts.HelveticaBold,
  mono: StandardFonts.CourierBold,
};

function addLink(pdf: PDFDocument, page: PDFPage, rect: number[], uri: string) {
  const annot = pdf.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: rect,
    Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(uri) },
  });
  page.node.addAnnot(pdf.context.register(annot));
}

export async function renderLabelPdf(document: LabelDocument): Promise<Uint8Array> {
  const { drawing, copies, job } = document;
  const wPt = pt(drawing.widthMm);
  const hPt = pt(drawing.heightMm);
  const ox = drawing.offsetXMm;
  const oy = drawing.offsetYMm;

  // The label once, in its own document; placed on every page below.
  const scratch = await PDFDocument.create({ updateMetadata: false });
  const label = scratch.addPage([wPt, hPt]);
  const fonts = {
    regular: await scratch.embedFont(PDF_FONTS.regular),
    bold: await scratch.embedFont(PDF_FONTS.bold),
    mono: await scratch.embedFont(PDF_FONTS.mono),
  };
  const { matrix, xMm, yMm, sideMm } = drawing.qr;
  const moduleMm = sideMm / (matrix.size + 2 * QUIET_ZONE_MODULES);
  const x0 = xMm + QUIET_ZONE_MODULES * moduleMm + ox;
  const y0 = yMm + QUIET_ZONE_MODULES * moduleMm + oy;
  for (const r of qrRuns(matrix)) {
    label.drawRectangle({
      x: pt(x0 + r.x * moduleMm),
      y: hPt - pt(y0 + (r.y + 1) * moduleMm),
      width: pt(r.length * moduleMm),
      height: pt(moduleMm),
      color: rgb(0, 0, 0),
      borderWidth: 0,
    });
  }
  for (const t of drawing.texts) {
    label.drawText(toWinAnsi(t.text), {
      x: pt(t.xMm + ox),
      y: hPt - pt(t.baselineMm + oy),
      size: pt(t.sizeMm),
      font: fonts[t.font],
      color: rgb(0, 0, 0),
    });
  }

  const pdf = await PDFDocument.create({ updateMetadata: false });
  const [form] = await pdf.embedPages([label]);
  const qrRect = [
    pt(xMm + ox),
    hPt - pt(yMm + sideMm + oy),
    pt(xMm + sideMm + ox),
    hPt - pt(yMm + oy),
  ];
  for (let i = 0; i < copies; i++) {
    const page = pdf.addPage([wPt, hPt]);
    page.setCropBox(0, 0, wPt, hPt);
    page.drawPage(form, { x: 0, y: 0, width: wPt, height: hPt });
    addLink(pdf, page, qrRect, drawing.linkUri);
  }
  pdf.setTitle(`Labels ${job.shortId} × ${copies}`);
  pdf.setCreator("BICII Admin");
  return pdf.save();
}

export const pdfAdapter: PrinterAdapter<Promise<Uint8Array>> = {
  id: "pdf",
  name: "PDF",
  delivery: "download",
  available: true,
  render: renderLabelPdf,
};
