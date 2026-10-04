"use client";

import { useId, useState, useTransition } from "react";

import { setWorkOrderStatus } from "@/app/(staff)/jobs/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { REASON_MAX_LENGTH } from "@/lib/reasons";
import {
  STATUS_LABELS,
  allowedTransitions,
  primaryActions,
  type WorkOrderStatus,
} from "@/lib/workshop";

import { ReasonConfirm } from "./reason-confirm";

/**
 * A job's status controls (D15, D16): the usual next steps as large
 * one-tap buttons (primaryActions), and "Change status" for every other
 * allowed move, with an optional note. Cancelling and reopening are
 * destructive and need a reason, so they use the two-step ReasonConfirm.
 * The database checks every move again; the page refreshes after each.
 */
export function JobStatusActions({
  workOrderId,
  jobNumber,
  status,
}: {
  workOrderId: string;
  jobNumber: string;
  status: WorkOrderStatus;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [moving, setMoving] = useState<WorkOrderStatus | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const primary = primaryActions(status);
  const transitions = allowedTransitions(status);

  const move = (to: WorkOrderStatus) => {
    setMoving(to);
    startTransition(async () => {
      const result = await setWorkOrderStatus({ workOrderId, status: to });
      setMoving(null);
      if (!result.ok) {
        toast({ title: "Status not changed", description: result.error, tone: "error" });
        return;
      }
      toast({ title: `${jobNumber}: ${STATUS_LABELS[to]}`, tone: "success" });
    });
  };

  if (transitions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary.map((action, i) => (
        <Button
          key={action.to}
          size="lg"
          variant={i === 0 ? "solid" : "outline"}
          pending={pending && moving === action.to}
          disabled={pending}
          onClick={() => move(action.to)}
        >
          {action.label}
        </Button>
      ))}
      <Button variant="ghost" disabled={pending} onClick={() => setSheetOpen(true)}>
        Change status
      </Button>
      {sheetOpen ? (
        <ChangeStatusSheet
          workOrderId={workOrderId}
          jobNumber={jobNumber}
          status={status}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ChangeStatusSheet({
  workOrderId,
  jobNumber,
  status,
  onClose,
}: {
  workOrderId: string;
  jobNumber: string;
  status: WorkOrderStatus;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const formId = useId();
  const [pending, startTransition] = useTransition();
  const transitions = allowedTransitions(status);
  const forward = transitions.filter((t) => t.kind === "forward");
  const reopen = transitions.find((t) => t.kind === "reopen");
  const cancel = transitions.find((t) => t.kind === "cancel");
  const [to, setTo] = useState<WorkOrderStatus | null>(forward[0]?.to ?? null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();

  const submit = () => {
    if (!to) return;
    startTransition(async () => {
      const result = await setWorkOrderStatus({ workOrderId, status: to, note });
      if (!result.ok) {
        const fieldError = result.fieldErrors?.note?.[0];
        if (fieldError) setError(fieldError);
        else toast({ title: "Status not changed", description: result.error, tone: "error" });
        return;
      }
      toast({ title: `${jobNumber}: ${STATUS_LABELS[to]}`, tone: "success" });
      onClose();
    });
  };

  const withReason = (target: WorkOrderStatus) => (reason: string) =>
    setWorkOrderStatus({ workOrderId, status: target, note: reason });

  return (
    <Sheet
      open
      onOpenChange={(open) => (open ? null : onClose())}
      dismissible={!pending}
      title="Change status"
      description={`${jobNumber} is ${STATUS_LABELS[status].toLowerCase()}.`}
      footer={
        forward.length > 0 ? (
          <>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Close
            </Button>
            <Button
              type="submit"
              form={formId}
              pending={pending}
              pendingLabel="Saving…"
              disabled={!to}
            >
              Change status
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6">
        {forward.length > 0 ? (
          <form
            id={formId}
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 font-display text-xs font-bold tracking-wide uppercase">
                Move to
              </legend>
              {forward.map((t) => (
                <label
                  key={t.to}
                  className={cn(
                    "flex min-h-tap cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-2",
                    to === t.to ? "border-ink bg-dust-100" : "border-hairline",
                  )}
                >
                  <input
                    type="radio"
                    name="status"
                    value={t.to}
                    checked={to === t.to}
                    onChange={() => setTo(t.to)}
                    className="size-5 accent-ink"
                  />
                  <span className="font-medium">{STATUS_LABELS[t.to]}</span>
                </label>
              ))}
            </fieldset>
            <Field label="Note" hint="Optional. Shown on the job's timeline." error={error}>
              <Textarea
                name="note"
                rows={2}
                maxLength={REASON_MAX_LENGTH}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  if (error) setError(undefined);
                }}
              />
            </Field>
          </form>
        ) : null}
        {reopen ? (
          <section className="flex flex-col gap-2">
            <h3 className="font-display text-xs font-bold tracking-wide uppercase">Reopen</h3>
            <p className="text-sm text-dust-700">
              Back to in progress, to change its lines or do more work. The completion time is
              cleared and set again when it is completed; the timeline keeps both.
            </p>
            <ReasonConfirm
              startLabel="Reopen job…"
              question="Why are you reopening this job?"
              hint="Kept on the job's timeline."
              confirmLabel="Reopen job"
              pendingLabel="Reopening…"
              failureTitle="Job not reopened"
              successTitle={`${jobNumber} reopened`}
              onConfirm={withReason(reopen.to)}
              onDone={onClose}
            />
          </section>
        ) : null}
        {cancel ? (
          <section className="flex flex-col gap-2">
            <h3 className="font-display text-xs font-bold tracking-wide uppercase">Cancel</h3>
            <p className="text-sm text-dust-700">
              Cancelling is final. Void the job&apos;s lines first.
            </p>
            <ReasonConfirm
              startLabel="Cancel job…"
              question="Why is this job being cancelled?"
              hint="Kept on the job's timeline."
              confirmLabel="Cancel job"
              pendingLabel="Cancelling…"
              failureTitle="Job not cancelled"
              successTitle={`${jobNumber} cancelled`}
              onConfirm={withReason(cancel.to)}
              onDone={onClose}
            />
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
