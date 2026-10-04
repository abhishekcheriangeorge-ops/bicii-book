"use client";

import { voidLine } from "@/app/(staff)/jobs/actions";

import { ReasonConfirm } from "./reason-confirm";

/**
 * Void one line, with a required reason (two steps, ReasonConfirm). The
 * line stays on the job, struck through, with who voided it, when and why;
 * nothing is deleted (D15: only while the job is open).
 */
export function VoidLineControl({ lineId, description }: { lineId: string; description: string }) {
  return (
    <ReasonConfirm
      startLabel="Void…"
      startVariant="ghost"
      startSize="sm"
      question={`Why are you voiding ${description}?`}
      hint="Kept on the line and the job's timeline."
      confirmLabel="Void line"
      dismissLabel="Keep line"
      pendingLabel="Voiding…"
      failureTitle="Line not voided"
      successTitle={`${description} voided`}
      onConfirm={(reason) => voidLine({ lineId, reason })}
    />
  );
}
