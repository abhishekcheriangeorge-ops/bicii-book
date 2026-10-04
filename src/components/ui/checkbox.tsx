"use client";

import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type CheckboxProps = Omit<ComponentPropsWithRef<"input">, "type"> & {
  label: ReactNode;
  description?: ReactNode;
};

/**
 * Native checkbox (so forms, labels and keyboard behave natively), restyled.
 * The whole row is the label, so the tap target is the row, not the 24px box.
 */
export function Checkbox({ label, description, className, id, ...props }: CheckboxProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const descId = description ? `${inputId}-desc` : undefined;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        "flex min-h-tap cursor-pointer items-start gap-3 py-2.5 has-disabled:cursor-not-allowed has-disabled:opacity-50",
        className,
      )}
    >
      <input
        id={inputId}
        type="checkbox"
        aria-describedby={descId}
        className="peer sr-only"
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          "mt-px flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-ink bg-card text-paper",
          "transition-colors duration-150 peer-checked:bg-ink",
          "peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-indigo",
          "[&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-base leading-6 font-medium">{label}</span>
        {description ? (
          <span id={descId} className="text-sm text-dust-500">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
