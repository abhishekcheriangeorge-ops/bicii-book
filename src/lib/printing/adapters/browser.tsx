import type { ReactElement } from "react";

import type { LabelDocument } from "../document";
import { LabelSvg, LabelSvgCopy } from "../label-svg";
import type { PrinterAdapter } from "./types";

/** On screen, the sheet shows this many copies; the rest print but stay hidden. */
export const SCREEN_COPIES = 20;

/**
 * The browser adapter's output: `copies` labels, each a `[data-label]` box
 * of exactly the template's width x height in millimetres carrying the
 * job's QR payload (data-qr-payload) and the label, page-broken after each
 * but the last, so window.print() puts one label on each page (the print
 * view sets `@page` to the label size). On screen they sit in a grid with
 * "1 of 10" captions; above 20 copies only the first 20 show, with how many
 * more will print.
 */
export function LabelSheet({ document }: { document: LabelDocument }) {
  const { drawing, copies, job } = document;
  const contentId = `label-${job.id}`;
  const hiddenCount = Math.max(copies - SCREEN_COPIES, 0);
  return (
    <div data-label-sheet="" className="flex flex-wrap gap-4 print:block print:gap-0">
      {Array.from({ length: copies }, (_, i) => (
        <figure
          key={i}
          className={
            i >= SCREEN_COPIES
              ? "hidden print:m-0 print:block"
              : "flex flex-col items-center gap-1 print:m-0 print:block"
          }
        >
          <div
            data-label=""
            data-qr-payload={job.qrPayload}
            data-label-index={i}
            className="overflow-hidden bg-white shadow-sm ring-1 ring-hairline print:shadow-none print:ring-0"
            style={{
              width: `${drawing.widthMm}mm`,
              height: `${drawing.heightMm}mm`,
              breakAfter: i < copies - 1 ? "page" : "auto",
              breakInside: "avoid",
            }}
          >
            {i === 0 ? (
              <LabelSvg drawing={drawing} contentId={contentId} className="block size-full" />
            ) : (
              <LabelSvgCopy drawing={drawing} contentId={contentId} className="block size-full" />
            )}
          </div>
          <figcaption className="text-dense text-dust-500 tabular-nums print:hidden">
            {i + 1} of {copies}
          </figcaption>
        </figure>
      ))}
      {hiddenCount > 0 ? (
        <p className="self-center text-sm font-medium text-dust-700 print:hidden">
          + {hiddenCount} more identical {hiddenCount === 1 ? "label" : "labels"}
        </p>
      ) : null}
    </div>
  );
}

export const browserAdapter: PrinterAdapter<ReactElement> = {
  id: "browser",
  name: "Browser print",
  delivery: "print-dialog",
  available: true,
  render: (document) => <LabelSheet document={document} />,
};
