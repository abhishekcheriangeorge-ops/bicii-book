"use client";

import { useOptimistic, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { PERMISSIONS, PERMISSION_LABELS, type PermissionKey } from "@/lib/auth/permissions";

import { setStaffActive, setStaffPermission } from "../actions";

/**
 * One switch per permission. Each change applies immediately through the
 * grant/revoke RPCs; the switch moves optimistically and snaps back with an
 * error toast if the server refuses.
 */
export function PermissionSwitches({
  staffId,
  granted,
  disabled,
}: {
  staffId: string;
  granted: PermissionKey[];
  disabled: boolean;
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
          description={PERMISSION_LABELS[p].description}
          checked={optimistic.includes(p)}
          onCheckedChange={(on) => toggle(p, on)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

export function AccessControl({
  staffId,
  name,
  active,
  canChange,
  reason,
}: {
  staffId: string;
  name: string;
  active: boolean;
  canChange: boolean;
  reason?: string;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const change = (next: boolean) => {
    setConfirming(false);
    startTransition(async () => {
      const result = await setStaffActive({ staffId, active: next });
      if (!result.ok) {
        toast({ title: "Access not changed", description: result.error, tone: "error" });
      } else {
        toast({ title: next ? `${name} reactivated` : `${name} deactivated`, tone: "success" });
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-dust-700">
        {active
          ? "Deactivating removes all of their access at once. Their name stays on past work."
          : "Reactivating restores their login and the permissions they had."}
      </p>
      {reason ? <p className="text-sm text-dust-500">{reason}</p> : null}
      <div className="flex flex-wrap gap-2">
        {active && confirming ? (
          <>
            <Button variant="danger" onClick={() => change(false)}>
              Yes, deactivate {name}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : active ? (
          <Button
            variant="danger"
            disabled={!canChange}
            pending={pending}
            pendingLabel="Deactivating…"
            onClick={() => setConfirming(true)}
          >
            Deactivate
          </Button>
        ) : (
          <Button
            variant="solid"
            disabled={!canChange}
            pending={pending}
            pendingLabel="Reactivating…"
            onClick={() => change(true)}
          >
            Reactivate
          </Button>
        )}
      </div>
    </div>
  );
}
