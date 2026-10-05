"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { PERMISSIONS, PERMISSION_LABELS, type PermissionKey } from "@/lib/auth/permissions";

import { setStaffActive, setStaffPermission } from "../actions";

/**
 * One switch per permission. Each change applies immediately through the
 * grant/revoke RPCs; the switch moves optimistically and snaps back with an
 * error toast if the server refuses. A permission the viewer may not change
 * (delegation ceiling, PLAN D11) is disabled with the reason underneath.
 */
export function PermissionSwitches({
  staffId,
  granted,
  disabled,
  blockers,
}: {
  staffId: string;
  granted: PermissionKey[];
  disabled: boolean;
  blockers: Record<PermissionKey, string | null>;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [optimistic, apply] = useOptimistic(
    granted,
    (state: PermissionKey[], change: { permission: PermissionKey; on: boolean }) =>
      change.on
        ? [...new Set([...state, change.permission])]
        : state.filter((p) => p !== change.permission),
  );

  const toggle = (permission: PermissionKey, on: boolean) => {
    startTransition(async () => {
      apply({ permission, on });
      const result = await setStaffPermission({ staffId, permission, granted: on });
      if (!result.ok) {
        toast({ title: "Permission not changed", description: result.error, tone: "error" });
      } else {
        toast({
          title: `${PERMISSION_LABELS[permission].label} ${on ? "granted" : "removed"}`,
          tone: "success",
        });
      }
    });
  };

  return (
    <div className="flex flex-col divide-y divide-hairline" aria-busy={pending || undefined}>
      {PERMISSIONS.map((p) => (
        <Switch
          key={p}
          label={PERMISSION_LABELS[p].label}
          description={
            blockers[p] ? (
              <>
                {PERMISSION_LABELS[p].description}
                <span className="mt-0.5 block font-medium text-dust-700">{blockers[p]}</span>
              </>
            ) : (
              PERMISSION_LABELS[p].description
            )
          }
          checked={optimistic.includes(p)}
          onCheckedChange={(on) => toggle(p, on)}
          disabled={disabled || blockers[p] !== null}
        />
      ))}
    </div>
  );
}

/** Clicks this soon after the confirm step opens are ignored (a double tap on "Deactivate"). */
const CONFIRM_GUARD_MS = 400;

/**
 * Deactivate (two steps, with a required reason: SPEC §22) or reactivate.
 * The confirm step is a different element in a different place from the
 * first button, with focus moved to the reason field, so a double tap or a
 * repeated Enter on "Deactivate" cannot confirm by itself.
 */
export function AccessControl({
  staffId,
  name,
  active,
  blocker,
}: {
  staffId: string;
  name: string;
  active: boolean;
  /** Why the viewer may not change this person's access, or null. */
  blocker: string | null;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const openedAt = useRef(0);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (confirming) reasonRef.current?.focus();
  }, [confirming]);

  const openConfirm = () => {
    openedAt.current = Date.now();
    setReason("");
    setReasonError(undefined);
    setConfirming(true);
  };

  const change = (next: boolean) => {
    if (!next) {
      if (Date.now() - openedAt.current < CONFIRM_GUARD_MS) return;
      if (reason.trim() === "") {
        setReasonError("Say why you are deactivating them.");
        reasonRef.current?.focus();
        return;
      }
    }
    startTransition(async () => {
      const result = await setStaffActive({
        staffId,
        active: next,
        reason: next ? undefined : reason,
      });
      if (!result.ok) {
        const fieldError = result.fieldErrors?.reason?.[0];
        if (fieldError) {
          setReasonError(fieldError);
          reasonRef.current?.focus();
        } else {
          toast({ title: "Access not changed", description: result.error, tone: "error" });
        }
        return;
      }
      setConfirming(false);
      toast({ title: next ? `${name} reactivated` : `${name} deactivated`, tone: "success" });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-dust-700">
        {active
          ? "Deactivating removes all of their access at once. Their name stays on past work."
          : "Reactivating restores their login and the permissions they had."}
      </p>
      {blocker ? <p className="text-sm text-dust-500">{blocker}</p> : null}
      {active && confirming ? (
        <div key="confirm" className="flex flex-col gap-3">
          <Field
            label={`Why are you deactivating ${name}?`}
            hint="Kept in their history."
            error={reasonError}
            required
          >
            <Textarea
              ref={reasonRef}
              name="reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError(undefined);
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button key="cancel" variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              key="confirm-deactivate"
              variant="danger"
              pending={pending}
              pendingLabel="Deactivating…"
              onClick={() => change(false)}
            >
              Deactivate {name}
            </Button>
          </div>
        </div>
      ) : (
        <div key="start" className="flex flex-wrap gap-2">
          {active ? (
            <Button
              key="deactivate"
              variant="danger"
              disabled={blocker !== null}
              onClick={openConfirm}
            >
              Deactivate…
            </Button>
          ) : (
            <Button
              key="reactivate"
              variant="solid"
              disabled={blocker !== null}
              pending={pending}
              pendingLabel="Reactivating…"
              onClick={() => change(true)}
            >
              Reactivate
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
