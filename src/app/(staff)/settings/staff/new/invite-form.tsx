"use client";

import { useActionState, useState } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { CheckIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-invalid";
import type { ActionResult } from "@/lib/actions";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type StaffRole } from "@/lib/auth/permissions";
import { roleWithArticle } from "@/lib/auth/role-change";
import { cn } from "@/lib/cn";

import { inviteStaff, type InviteResult } from "../actions";

type State = ActionResult<InviteResult> | null;

/** The invite went through: their role, how the colleague signs in, and what next. */
function Invited({ result, onAnother }: { result: InviteResult; onAnother: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="flex items-center gap-2 font-medium break-all">
        <CheckIcon className="size-5 shrink-0 text-done-deep" />
        {result.email} can now sign in.
      </p>
      <p className="text-dust-700">They join as {roleWithArticle(result.role)}.</p>
      <p className="text-dust-700">
        They open BICII Admin, enter this email and type the 6-digit code we email them. No password
        needed.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onAnother}>
          Invite another
        </Button>
        <ButtonLink href={`/settings/staff/${result.staffId}`} variant="solid">
          {result.role === "admin" ? "Open their page" : "Set extra access"}
        </ButtonLink>
      </div>
    </div>
  );
}

/**
 * `roles` is what the inviter may invite (invitableRoles, mirroring
 * create_staff, D93): an admin picks Admin, Manager or Mechanic (Mechanic
 * chosen first); anyone else invites a Mechanic, with no picker.
 */
function Form({ roles, onDone }: { roles: readonly StaffRole[]; onDone: () => void }) {
  const [state, formAction] = useActionState<State, FormData>(inviteStaff, null);
  const [role, setRole] = useState<StaffRole>("mechanic");
  const formRef = useFocusFirstInvalid(state);

  if (state?.ok) return <Invited result={state.data} onAnother={onDone} />;

  const errors = state && !state.ok ? state.fieldErrors : undefined;
  // React resets the fields after every submission; render what was typed
  // as their defaults again (DESIGN.md "Forms").
  const values = state && !state.ok ? state.values : undefined;
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5" noValidate>
      {state && !state.ok ? (
        <p role="alert" className="text-sm font-medium text-danger-deep">
          {state.error}
        </p>
      ) : null}
      <Field label="Name" error={errors?.displayName?.[0]} required>
        <Input name="displayName" autoComplete="off" defaultValue={values?.displayName ?? ""} />
      </Field>
      <Field label="Email" hint="They sign in with this" error={errors?.email?.[0]} required>
        <Input
          type="email"
          name="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="off"
          defaultValue={values?.email ?? ""}
        />
      </Field>
      {roles.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <span
            aria-hidden="true"
            className="font-display text-xs font-bold tracking-wide uppercase"
          >
            Role
          </span>
          <SegmentedControl<StaffRole>
            label="Role"
            value={role}
            onValueChange={setRole}
            options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          />
          {errors?.role?.[0] ? (
            <p className="text-sm font-medium text-danger-deep">{errors.role[0]}</p>
          ) : null}
          <ul aria-label="Roles" className="mt-1 flex flex-col gap-1 text-sm">
            {roles.map((r) => (
              <li key={r} className={cn(r === role ? "text-ink" : "text-dust-500")}>
                <span className="font-medium">{ROLE_LABELS[r]}</span>: {ROLE_DESCRIPTIONS[r]}.
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-dust-700">
          They join as a Mechanic. Only an admin invites an admin or a manager.
          {errors?.role?.[0] ? (
            <span className="mt-1 block text-sm font-medium text-danger-deep">
              {errors.role[0]}
            </span>
          ) : null}
        </p>
      )}
      <input type="hidden" name="role" value={roles.length > 1 ? role : "mechanic"} />
      <div>
        <SubmitButton pendingLabel="Inviting…">Invite</SubmitButton>
      </div>
    </form>
  );
}

/** Remounts the form for "Invite another", starting clean. */
export function InviteForm({ roles }: { roles: readonly StaffRole[] }) {
  const [round, setRound] = useState(0);
  return <Form key={round} roles={roles} onDone={() => setRound((r) => r + 1)} />;
}
