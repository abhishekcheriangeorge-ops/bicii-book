import Link from "next/link";

import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDateTime } from "@/lib/dates";
import type { LabelContext, PrintJobListItem } from "@/lib/domain/labels";
import { composeLabel } from "@/lib/printing/compose";
import { printStatusLabel, printStatusTone } from "@/lib/printing/job";
import { LabelSvg } from "@/lib/printing/label-svg";
import { printHistoryPath } from "@/lib/printing/links";
import { describeLabelPrice, priceChanged } from "@/lib/printing/print-sheet";
import type { LabelKind } from "@/lib/printing/types";

import { CopyText } from "./copy-text";
import { PrintLabelButton, type PrintLabelPreset, type PrintLabelSetup } from "./print-label";
import { ShortId } from "./short-id";

/**
 * A record page's label context (getLabelContext) as PrintLabelButton
 * takes it: the setup when a label can print now, else null and the reason.
 */
export function labelSetup(ctx: LabelContext): {
  setup: PrintLabelSetup | null;
  unavailable: string | null;
} {
  if (!ctx.ok) return { setup: null, unavailable: ctx.message };
  return {
    setup: {
      content: ctx.content,
      templates: ctx.templates,
      profiles: ctx.profiles,
      defaultTemplateId: ctx.defaultTemplateId,
      defaultProfileId: ctx.defaultProfileId,
      isPublic: ctx.publication?.isPublic ?? null,
    },
    unavailable: null,
  };
}

/**
 * The record page's "Print label" in its header actions (product, unit,
 * bike). It carries the page's deep-link preset (`?print=1…`), so the
 * sheet opens once, from here.
 */
export function HeaderPrintLabel({
  kind,
  entityId,
  shortId,
  ctx,
  preset,
}: {
  kind: LabelKind;
  entityId: string;
  shortId: string;
  ctx: LabelContext;
  preset: PrintLabelPreset | null;
}) {
  const { setup, unavailable } = labelSetup(ctx);
  return (
    <PrintLabelButton
      kind={kind}
      entityId={entityId}
      shortId={shortId}
      setup={setup}
      unavailable={unavailable}
      preset={preset}
    />
  );
}

/**
 * The "Labels" card of a product, unit or bike page (SPEC §15, §16; PLAN
 * D9, D56–D59; ADR-017). It renders whatever the label state is:
 *
 * - printable: the label as it prints now (default template, from
 *   label_preview), the exact URL its QR encodes (the database's payload),
 *   Print label, for products and units a jump to "What the public sees",
 *   and a warning when the price changed since the last printed label
 *   (D58);
 * - not printable: why (archived, the QR address not set, no template), a
 *   way to fix it for admins, and the disabled button; a unique product
 *   lists its units, which carry the labels (D57);
 * - always: the last three print jobs and "All label jobs".
 */
export function LabelsCard({
  kind,
  entityId,
  shortId,
  ctx,
  isAdmin,
  publicPreviewId = null,
  units = [],
}: {
  kind: LabelKind;
  entityId: string;
  shortId: string;
  ctx: LabelContext;
  isAdmin: boolean;
  /** Products and units: the anchor of the page's PublicPreviewPanel. */
  publicPreviewId?: string | null;
  /** A unique product's units (its labels are theirs). */
  units?: { id: string; shortId: string }[];
}) {
  const { setup, unavailable } = labelSetup(ctx);

  return (
    <Card title="Labels" id="labels" className="scroll-mt-24">
      <div className="flex flex-col gap-4">
        {ctx.ok ? (
          <PrintableLabel
            ctx={ctx}
            kind={kind}
            entityId={entityId}
            shortId={shortId}
            publicPreviewId={publicPreviewId}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {ctx.reason === "unique_product" ? (
              <>
                <p className="text-dust-700">{ctx.message}</p>
                {units.length === 0 ? (
                  <p className="text-sm text-dust-500">No units yet.</p>
                ) : (
                  <ul aria-label="Unit labels" className="flex flex-wrap gap-2">
                    {units.map((u) => (
                      <li key={u.id}>
                        <Link
                          href={`/units/${u.id}#labels`}
                          className="inline-flex min-h-tap items-center rounded-xl px-1 hover:bg-dust-100"
                          aria-label={`Print labels for ${u.shortId}`}
                        >
                          <ShortId value={u.shortId} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <PrintLabelButton
                kind={kind}
                entityId={entityId}
                shortId={shortId}
                setup={setup}
                unavailable={unavailable}
              />
            )}
            {ctx.reason === "site_url_invalid" ? (
              <p className="text-sm text-dust-700">
                {isAdmin ? (
                  <Link href="/settings/labels" className="font-medium underline">
                    Set the public website address in Labels and printers
                  </Link>
                ) : (
                  "Ask an admin to set the public website address."
                )}
              </p>
            ) : null}
            {ctx.reason === "no_template" && isAdmin ? (
              <p className="text-sm">
                <Link href="/settings/labels" className="font-medium underline">
                  Add a template in Labels and printers
                </Link>
              </p>
            ) : null}
          </div>
        )}

        <RecentJobs jobs={ctx.recentJobs} shortId={shortId} />
      </div>
    </Card>
  );
}

function PrintableLabel({
  ctx,
  kind,
  entityId,
  shortId,
  publicPreviewId,
}: {
  ctx: Extract<LabelContext, { ok: true }>;
  kind: LabelKind;
  entityId: string;
  shortId: string;
  publicPreviewId: string | null;
}) {
  const { setup } = labelSetup(ctx);
  const template = ctx.templates.find((t) => t.id === ctx.defaultTemplateId) ?? ctx.templates[0];
  const profile = ctx.profiles.find((p) => p.id === ctx.defaultProfileId) ?? null;
  const drawing = composeLabel(template, ctx.content, profile?.config ?? {});
  const last = ctx.lastPrintedPrice;
  const changed = last !== null && priceChanged(last.price, ctx.content.price);

  return (
    <>
      <figure className="flex flex-col items-start gap-2">
        <div className="w-full max-w-80 rounded-lg ring-1 ring-hairline">
          <LabelSvg drawing={drawing} className="block h-auto w-full" />
        </div>
        <figcaption className="text-sm text-dust-700 tabular-nums">
          {template.widthMm} × {template.heightMm} mm · {template.name}
        </figcaption>
      </figure>
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-xs font-bold tracking-wide uppercase">The QR opens</h3>
        <CopyText value={ctx.content.qrPayload} label="QR URL on the label" />
      </div>
      {changed && last ? (
        <p role="status" className="rounded-xl bg-waiting-soft px-3 py-2 text-sm text-waiting-deep">
          The price changed since the last printed label (
          {describeLabelPrice(last.price, ctx.content.currency)} →{" "}
          {describeLabelPrice(ctx.content.price, ctx.content.currency)}). Reprint the labels on the
          shelf.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <PrintLabelButton kind={kind} entityId={entityId} shortId={shortId} setup={setup} />
        {publicPreviewId ? (
          <a
            href={`#${publicPreviewId}`}
            className="inline-flex min-h-tap items-center text-sm font-semibold underline underline-offset-4"
          >
            What the public sees
          </a>
        ) : null}
      </div>
    </>
  );
}

function RecentJobs({ jobs, shortId }: { jobs: PrintJobListItem[]; shortId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-display text-xs font-bold tracking-wide uppercase">Recent prints</h3>
      {jobs.length === 0 ? (
        <p className="text-sm text-dust-500">No labels printed yet.</p>
      ) : (
        <ul aria-label="Recent prints" className="-mx-2 flex flex-col">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link
                href={printHistoryPath(j.id)}
                className="flex min-h-tap flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-2 py-2 hover:bg-dust-100"
              >
                <StatusPill status={printStatusTone(j.status)}>
                  {printStatusLabel(j.status)}
                </StatusPill>
                <span className="text-sm text-dust-700">
                  {j.quantity} × · {j.printerName} · {j.requestedBy} ·{" "}
                  <time dateTime={j.createdAt}>{formatDateTime(j.createdAt)}</time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link
          href={`/labels?q=${encodeURIComponent(shortId)}`}
          className="inline-flex min-h-tap items-center text-sm font-semibold underline underline-offset-4"
        >
          All label jobs
        </Link>
      </p>
    </div>
  );
}
