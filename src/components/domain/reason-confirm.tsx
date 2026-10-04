"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/actions";
import { REASON_MAX_LENGTH } from "@/lib/reasons";

/** How long the confirm button ignores presses after the confirmation opens (a double tap). */
export const CONFIRM_GUARD_MS = 400;

/**
 * A destructive step with a required reason (SPEC §22; DESIGN.md "Forms"):
 * the first button opens a confirmation that asks why and puts focus in the
 * reason field; the confirm button sits in a different place with a
 * different React key, and ignores presses for 400 ms after opening, so a
 * double tap cannot confirm. Cancel hands focus back to the first button.
 * Used to void a line and to cancel or reopen a job.
 */
export function ReasonConfirm({
  startLabel,
  startVariant = "outline",
  startSize = "md",
  question,
  hint,
  confirmLabel,
  pendingLabel,
  failureTitle,
  successTitle,
  onConfirm,
  onDone,
  disabled = false,
  children,
}: {
  startLabel: string;
  startVariant?: ButtonVariant;
  startSize?: ButtonSize;
  /** The reason field's label, e.g. "Why are you voiding this line?" */
  question: string;
  hint?: string;
  confirmLabel: string;
  pendingLabel: string;
  failureTitle: string;
  successTitle: string;
  /** Runs the action with the trimmed reason. Field errors on `reason` or `note` show on the field. */
  onConfirm: (reason: string) => Promise<ActionResult<unknown>>;
  onDone?: () => void;
  disabled?: boolean;
  /** What confirming does, in a sentence, shown in the confirmation. */
  children?: ReactNode;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const openedAt = useRef(0);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    const cancelled = wasConfirming.current && !confirming;
    wasConfirming.current = confirming;
    if (confirming) reasonRef.current?.focus();
    else if (cancelled) startRef.current?.focus();
  }, [confirming]);

  const open = () => {
    openedAt.current = Date.now();
    setReason("");
    setError(undefined);
    setConfirming(true);
  };

  const confirm = () => {
    if (Date.now() - openedAt.current < CONFIRM_GUARD_MS) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Give a reason.");
      reasonRef.current?.focus();
      return;
    }
    startTransition(async () => {
      const result = await onConfirm(trimmed);
      if (!result.ok) {
        const fieldError = result.fieldErrors?.reason?.[0] ?? result.fieldErrors?.note?.[0];
        if (fieldError) {
          setError(fieldError);
          reasonRef.current?.focus();
        } else {
          toast({ title: failureTitle, description: result.error, tone: "error" });
        }
        return;
      }
      wasConfirming.current = false;
      setConfirming(false);
      toast({ title: successTitle, tone: "success" });
      onDone?.();
    });
  };

  if (!confirming) {
    return (
      <div key="start">
        <Button
          key="start"
          ref={startRef}
          variant={startVariant}
          size={startSize}
          disabled={disabled}
          onClick={open}
        >
          {startLabel}
        </Button>
      </div>
    );
  }

  return (
    <div key="confirm" className="flex flex-col gap-3 rounded-xl bg-danger-soft p-4">
      {children ? <p className="text-sm text-danger-deep">{children}</p> : null}
      <Field label={question} hint={hint} error={error} required>
        <Textarea
          ref={reasonRef}
          name="reason"
          rows={2}
          maxLength={REASON_MAX_LENGTH}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (error) setError(undefined);
          }}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          key="cancel"
          variant="outline"
          size={startSize}
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
        <Button
          key="confirm"
          variant="danger"
          size={startSize}
          pending={pending}
          pendingLabel={pendingLabel}
          onClick={confirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
