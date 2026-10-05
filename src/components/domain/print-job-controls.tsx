"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { setPrintJobStatusAction } from "@/app/(staff)/labels/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { PrinterIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useArmed } from "@/components/ui/use-armed";
import type { PrintStatus } from "@/lib/printing/types";

import { ReasonConfirm } from "./reason-confirm";

/**
 * The print view's controls for an OPEN job (queued or rendered; D59).
 * They never create a job ("Print again" is always a link to the record).
 *
 * - Browser printer: "Print" calls window.print() synchronously inside the
 *   click (iOS Safari drops the user gesture after an await), then marks
 *   the job rendered without waiting (skipped when it already is) and
 *   shows the confirmation.
 * - PDF printer: "Open PDF" opens the job's PDF in a new tab (Share ->
 *   Print on an iPad), marks the job rendered and shows the confirmation.
 * - A job already rendered (sent earlier, not confirmed) shows the
 *   confirmation straight away.
 */
export function PrintJobControls({
  jobId,
  status,
  adapter,
  quantity,
  pdfHref,
  widthMm,
  heightMm,
  shortId,
  recordHref,
}: {
  jobId: string;
  status: Extract<PrintStatus, "queued" | "rendered">;
  adapter: "browser" | "pdf";
  quantity: number;
  pdfHref: string;
  widthMm: number;
  heightMm: number;
  shortId: string;
  recordHref: string;
}) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(status === "rendered");
  const sent = useRef(status === "rendered");

  const markRendered = () => {
    if (sent.current) return;
    sent.current = true;
    void setPrintJobStatusAction({ id: jobId, status: "rendered" }).then((result) => {
      if (!result.ok) {
        sent.current = false;
        toast({ title: "Not recorded as sent", description: result.error, tone: "error" });
      }
    });
  };

  const print = () => {
    // Synchronous, first: the print dialog needs the click's user gesture.
    window.print();
    markRendered();
    setConfirming(true);
  };

  const size = `${widthMm} × ${heightMm} mm`;

  return (
    <div className="flex flex-col gap-4">
      {adapter === "browser" ? (
        <div className="flex flex-col gap-2">
          <div>
            <Button size="lg" icon={<PrinterIcon className="size-5" />} onClick={print}>
              Print
            </Button>
          </div>
          <p className="text-sm text-dust-700">
            In the print dialog choose the label printer, paper {size}, scale 100%, no margins.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div>
            <a
              href={pdfHref}
              target="_blank"
              rel="noopener"
              className={buttonClasses({ size: "lg" })}
              onClick={() => {
                markRendered();
                setConfirming(true);
              }}
            >
              <PrinterIcon className="size-5" />
              Open PDF
            </a>
          </div>
          <p className="text-sm text-dust-700">
            Open the PDF, then Share → Print. Set the paper to {size}, scale 100%.
          </p>
        </div>
      )}
      {confirming ? (
        <PrintJobConfirm
          jobId={jobId}
          quantity={quantity}
          shortId={shortId}
          recordHref={recordHref}
        />
      ) : null}
    </div>
  );
}

/**
 * "Did all N labels print correctly?" (D59): staff confirm the job printed,
 * or say what went wrong (two steps with a required reason, DESIGN.md
 * "Forms"). Focus moves here when it appears. Used on the print view and on
 * an open job's history page.
 */
export function PrintJobConfirm({
  jobId,
  quantity,
  shortId,
  recordHref,
  autoFocus = true,
}: {
  jobId: string;
  quantity: number;
  shortId: string;
  recordHref: string;
  /** Move focus here when it appears (it appears after Print); not on page load. */
  autoFocus?: boolean;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<"printed" | "failed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const armed = useArmed(true);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const printed = () =>
    start(async () => {
      setError(null);
      const result = await setPrintJobStatusAction({ id: jobId, status: "printed" });
      if (!result.ok) {
        setError(result.error);
        toast({ title: "Not marked as printed", description: result.error, tone: "error" });
        return;
      }
      setDone("printed");
      toast({ title: "Marked as printed", tone: "success" });
    });

  const links = (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
      <Link href={recordHref} className="underline underline-offset-4">
        Back to {shortId}
      </Link>
      <Link href="/labels" className="underline underline-offset-4">
        Print history
      </Link>
    </p>
  );

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-labelledby={`confirm-${jobId}`}
      className="flex flex-col gap-3 rounded-2xl border border-hairline bg-card p-4 focus:outline-none"
    >
      <h2 id={`confirm-${jobId}`} className="text-lg">
        {done === "printed"
          ? "Marked as printed"
          : done === "failed"
            ? "Marked as failed"
            : `Did all ${quantity} ${quantity === 1 ? "label" : "labels"} print correctly?`}
      </h2>
      {done ? (
        links
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-3">
            <Button disabled={!armed} pending={pending} pendingLabel="Saving…" onClick={printed}>
              Yes, all printed
            </Button>
          </div>
          <ReasonConfirm
            startLabel="Something went wrong…"
            startVariant="ghost"
            question="What went wrong?"
            hint="For example: the roll ran out, the labels came out blank or misaligned."
            confirmLabel="Mark as failed"
            pendingLabel="Saving…"
            failureTitle="Not marked as failed"
            successTitle="Marked as failed"
            dismissLabel="Back"
            onConfirm={async (reason) => {
              const result = await setPrintJobStatusAction({
                id: jobId,
                status: "failed",
                error: reason,
              });
              return result.ok || !result.fieldErrors?.error
                ? result
                : { ...result, fieldErrors: { reason: result.fieldErrors.error } };
            }}
            onDone={() => setDone("failed")}
          >
            Nothing is reprinted automatically: use Print again on the record for a new job.
          </ReasonConfirm>
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-deep">
              {error}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
