"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Wiring a Field hands to the control inside it. Controls (Input, Textarea,
 * NumberInput, SearchPicker…) read this and set id, aria-describedby,
 * aria-invalid and required themselves, so callers never thread IDs by hand.
 */
export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
  required?: boolean;
};

type FieldContextValue = {
  controlId: string;
  labelId: string;
  hintId?: string;
  errorId?: string;
  invalid: boolean;
  required: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

/**
 * Merges Field wiring with whatever the control was given directly. Explicit
 * props win for id; describedby lists are joined.
 */
export function useFieldControlProps(own: {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
  required?: boolean;
}): FieldControlProps {
  const ctx = useFieldContext();
  const fallbackId = useId();
  const describedBy =
    [ctx?.errorId, ctx?.hintId, own["aria-describedby"]].filter(Boolean).join(" ") || undefined;
  const invalid = ctx?.invalid || own["aria-invalid"] === true || own["aria-invalid"] === "true";
  const required = ctx?.required || own.required || false;
  return {
    id: own.id ?? ctx?.controlId ?? fallbackId,
    "aria-describedby": describedBy,
    "aria-invalid": invalid ? true : undefined,
    "aria-required": required ? true : undefined,
    required: required || undefined,
  };
}

export type FieldProps = {
  label: ReactNode;
  /** Persistent help below the label, e.g. "Whole numbers only". */
  hint?: ReactNode;
  /** Validation message. Its presence marks the control aria-invalid. */
  error?: ReactNode;
  required?: boolean;
  /** Visually hide the label (it stays the accessible name). */
  hideLabel?: boolean;
  /** Use a fixed id for the control (e.g. to target it from a test). */
  id?: string;
  className?: string;
  children: ReactNode;
};

export function Field({
  label,
  hint,
  error,
  required = false,
  hideLabel = false,
  id,
  className,
  children,
}: FieldProps) {
  const auto = useId();
  const controlId = id ?? `${auto}-control`;
  const value: FieldContextValue = {
    controlId,
    labelId: `${controlId}-label`,
    hintId: hint ? `${controlId}-hint` : undefined,
    errorId: error ? `${controlId}-error` : undefined,
    invalid: Boolean(error),
    required,
  };

  return (
    <FieldContext.Provider value={value}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label
          id={value.labelId}
          htmlFor={controlId}
          className={cn(
            "font-display text-xs font-bold tracking-wide text-ink uppercase",
            hideLabel && "sr-only",
          )}
        >
          {label}
          {required ? (
            <>
              <span aria-hidden="true" className="ml-1 text-danger-deep">
                *
              </span>{" "}
              <span className="sr-only">(required)</span>
            </>
          ) : null}
        </label>
        {hint ? (
          <p id={value.hintId} className="text-sm text-dust-500">
            {hint}
          </p>
        ) : null}
        {children}
        {error ? (
          <p
            id={value.errorId}
            className="flex items-start gap-1.5 text-sm font-medium text-danger-deep"
          >
            <span
              aria-hidden="true"
              className="mt-[0.4em] size-1.5 shrink-0 rounded-full bg-danger"
            />
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
