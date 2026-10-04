"use client";

import { useActionState } from "react";

import { Field } from "@/components/ui/field";
import { AlertIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";

import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, null);
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state?.error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-deep"
        >
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}
      <Field label="Email" error={state?.fieldErrors?.email?.[0]} required>
        <Input
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={state?.email ?? ""}
          key={state?.email ?? ""}
        />
      </Field>
      <Field label="Password" error={state?.fieldErrors?.password?.[0]} required>
        <Input type="password" name="password" autoComplete="current-password" />
      </Field>
      <SubmitButton fullWidth size="lg" pending={pending} pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
