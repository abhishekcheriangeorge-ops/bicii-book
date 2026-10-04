"use client";

import { voidLine } from "@/app/(staff)/jobs/actions";

import { ReasonConfirm } from "./reason-confirm";

/**
 * Void one line, with a required reason (two steps, ReasonConfirm). The
 * line stays on the job, struck through, with who voided it, when and why;
 * nothing is deleted (D15: only while the job is open). On a part line it
 * says what goes back to stock: void_line writes the linked reversal (D16)
 * and a unit returns to available (D25).
 */
export function VoidLineControl({
  lineId,
  description,
  stockReturn,
}: {
  lineId: string;
  description: string;
  /**
   * A part line: what voiding puts back ("2 to Shop floor"), so the
   * confirmation says it before it happens (void_line writes the reversal).
   */
  stockReturn?: string | null;
}) {
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
      successTitle={stockReturn !== undefined ? "Returned to stock" : `${description} voided`}
      onConfirm={(reason) => voidLine({ lineId, reason })}
    >
      {stockReturn
        ? `Voiding returns ${stockReturn} (a reversal is recorded; nothing is deleted).`
        : stockReturn === null
          ? "Voiding returns the part to stock (a reversal is recorded; nothing is deleted)."
          : undefined}
    </ReasonConfirm>
  );
}
