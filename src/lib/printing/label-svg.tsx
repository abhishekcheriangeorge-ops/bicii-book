import { useId } from "react";

import type { LabelDrawing } from "./compose";
import { QUIET_ZONE_MODULES, qrRuns } from "./qr";

/**
 * One label as SVG (server or client): the LabelDrawing of ./compose.ts in
 * millimetres (viewBox), white background, the QR as ONE path of merged
 * horizontal runs, text in Helvetica/Arial (monospace for the short ID).
 * The printer offsets translate the content inside a clip of the label
 * rectangle; the clip sits OUTSIDE the translate, so an offset never draws
 * past the label. No HTML is injected (no dangerouslySetInnerHTML).
 */

const FONT_FAMILY = {
  regular: "Helvetica, Arial, sans-serif",
  bold: "Helvetica, Arial, sans-serif",
  mono: "Courier New, Courier, monospace",
} as const;

const n = (v: number) => Number(v.toFixed(4));

/** The QR modules as one SVG path in millimetres. */
export function qrPathData(drawing: LabelDrawing): string {
  const { matrix, xMm, yMm, sideMm } = drawing.qr;
  const moduleMm = sideMm / (matrix.size + 2 * QUIET_ZONE_MODULES);
  const x0 = xMm + QUIET_ZONE_MODULES * moduleMm;
  const y0 = yMm + QUIET_ZONE_MODULES * moduleMm;
  return qrRuns(matrix)
    .map(
      (r) =>
        `M${n(x0 + r.x * moduleMm)} ${n(y0 + r.y * moduleMm)}h${n(r.length * moduleMm)}v${n(moduleMm)}h${n(-r.length * moduleMm)}z`,
    )
    .join("");
}

export function LabelSvg({
  drawing,
  pxPerMm,
  title,
  className,
  contentId,
}: {
  drawing: LabelDrawing;
  /** Fixed pixel size (tests, previews); without it the SVG is w x h mm. */
  pxPerMm?: number;
  title?: string;
  className?: string;
  /** An id on the clipped content, so identical copies can reuse it (LabelSvgCopy). */
  contentId?: string;
}) {
  const clipId = `label-clip-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const { widthMm: w, heightMm: h } = drawing;
  const size = pxPerMm
    ? { width: n(w * pxPerMm), height: n(h * pxPerMm) }
    : { width: `${w}mm`, height: `${h}mm` };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w} ${h}`}
      {...size}
      role="img"
      aria-label={drawing.accessibleName}
      className={className}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={w} height={h} />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={w} height={h} fill="#ffffff" />
      <g id={contentId} clipPath={`url(#${clipId})`}>
        <g transform={`translate(${n(drawing.offsetXMm)} ${n(drawing.offsetYMm)})`}>
          <path d={qrPathData(drawing)} fill="#000000" shapeRendering="crispEdges" />
          {drawing.texts.map((t, i) => (
            <text
              key={`${t.field}-${i}`}
              x={n(t.xMm)}
              y={n(t.baselineMm)}
              fontSize={n(t.sizeMm)}
              fontFamily={FONT_FAMILY[t.font]}
              fontWeight={t.font === "regular" ? 400 : 700}
              fill="#000000"
              data-field={t.field}
            >
              {t.text}
            </text>
          ))}
        </g>
      </g>
    </svg>
  );
}

/**
 * Another copy of a label already on the page (LabelSvg with `contentId`):
 * the same size and accessible name, drawing the original through <use>,
 * so a sheet of 500 labels carries the QR path once.
 */
export function LabelSvgCopy({
  drawing,
  contentId,
  className,
}: {
  drawing: LabelDrawing;
  contentId: string;
  className?: string;
}) {
  const { widthMm: w, heightMm: h } = drawing;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w} ${h}`}
      width={`${w}mm`}
      height={`${h}mm`}
      role="img"
      aria-label={drawing.accessibleName}
      className={className}
    >
      <rect x={0} y={0} width={w} height={h} fill="#ffffff" />
      <use href={`#${contentId}`} />
    </svg>
  );
}
