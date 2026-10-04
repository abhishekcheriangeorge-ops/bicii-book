"use client";

import { useActionState, useEffect, useRef } from "react";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/actions";

import { changePassword } from "./actions";

export function PasswordForm() {
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(
    changePassword,
    null,
  );
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      toast({ title: "Password changed", tone: "success" });
    }
  }, [state, toast]);

  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4" noValidate>
      {state && !state.ok && !state.fieldErrors ? (
        <p role="alert" className="text-sm font-medium text-danger-deep">
          {state.error}
        </p>
      ) : null}
      <Field
        label="New password"
        hint="At least 12 characters"
        error={errors?.password?.[0]}
        required
      >
        <Input type="password" name="password" autoComplete="new-password" />
      </Field>
      <Field label="Repeat new password" error={errors?.confirm?.[0]} required>
        <Input type="password" name="confirm" autoComplete="new-password" />
      </Field>
      <div>
        <SubmitButton variant="outline" pendingLabel="Saving…">
          Change password
        </SubmitButton>
      </div>
    </form>
  );
}
