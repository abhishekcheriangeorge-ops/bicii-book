"use client";

import { useActionState, useState } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { CheckIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/lib/actions";

import { inviteStaff, type InviteResult } from "../actions";

type State = ActionResult<InviteResult> | null;

function TemporaryPassword({ result, onAnother }: { result: InviteResult; onAnother: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="flex items-center gap-2 font-medium">
        <CheckIcon className="size-5 text-done-deep" />
        {result.email} can now sign in.
      </p>
      <div className="flex flex-col gap-2 rounded-xl bg-waiting-soft p-4">
        <p className="eyebrow text-waiting-deep">Temporary password: shown once</p>
        <p
          className="font-mono text-xl font-bold tracking-wide break-all select-all"
          data-testid="temporary-password"
        >
          {result.temporaryPassword}
        </p>
        <p className="text-sm text-waiting-deep">
          Give it to them in person. It is not stored and cannot be shown again. They should change
          it after signing in.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard?.writeText(result.temporaryPassword);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy password"}
        </Button>
        <Button variant="ghost" onClick={onAnother}>
          Invite another
        </Button>
        <ButtonLink href={`/settings/staff/${result.staffId}`} variant="solid">
          Set permissions
        </ButtonLink>
      </div>
    </div>
  );
}

function Form({ canInviteAdmin, onDone }: { canInviteAdmin: boolean; onDone: () => void }) {
  const [state, formAction] = useActionState<State, FormData>(inviteStaff, null);
  const [role, setRole] = useState<"staff" | "admin">("staff");

  if (state?.ok) return <TemporaryPassword result={state.data} onAnother={onDone} />;

  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state && !state.ok ? (
        <p role="alert" className="text-sm font-medium text-danger-deep">
          {state.error}
        </p>
      ) : null}
      <Field label="Name" error={errors?.displayName?.[0]} required>
        <Input name="displayName" autoComplete="off" />
      </Field>
      <Field label="Email" hint="They sign in with this" error={errors?.email?.[0]} required>
        <Input
          type="email"
          name="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="off"
        />
      </Field>
      {canInviteAdmin ? (
        <div className="flex flex-col gap-1.5">
          <span
            aria-hidden="true"
            className="font-display text-xs font-bold tracking-wide uppercase"
          >
            Role
          </span>
          <SegmentedControl
            label="Role"
            value={role}
            onValueChange={(v) => setRole(v as "staff" | "admin")}
            options={[
              { value: "staff", label: "Staff" },
              { value: "admin", label: "Admin" },
            ]}
          />
          {errors?.role?.[0] ? (
            <p className="text-sm font-medium text-danger-deep">{errors.role[0]}</p>
          ) : null}
          <p className="text-sm text-dust-500">
            {role === "admin"
              ? "Admins have every permission, including staff and money."
              : "Staff start with workshop access; add permissions afterwards."}
          </p>
        </div>
      ) : null}
      <input type="hidden" name="role" value={role} />
      <div>
        <SubmitButton pendingLabel="Inviting…">Invite</SubmitButton>
      </div>
    </form>
  );
}

/** Remounts the form for "Invite another", clearing the shown password. */
export function InviteForm({ canInviteAdmin }: { canInviteAdmin: boolean }) {
  const [round, setRound] = useState(0);
  return <Form key={round} canInviteAdmin={canInviteAdmin} onDone={() => setRound((r) => r + 1)} />;
}
