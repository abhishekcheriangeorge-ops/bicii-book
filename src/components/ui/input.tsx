"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useFieldControlProps } from "./field";

/** Shared look for text-like controls: 2px ink border, white card fill. */
export const controlClasses = cn(
  "w-full rounded-xl border-2 border-ink bg-card px-4 text-base text-ink placeholder:text-dust-500",
  "transition-[border-color,box-shadow] duration-150",
  "disabled:cursor-not-allowed disabled:border-dust-300 disabled:bg-dust-100 disabled:text-dust-500",
  "aria-invalid:border-danger aria-invalid:shadow-[0_0_0_1px_var(--color-danger)]",
);

export type InputProps = Omit<ComponentPropsWithRef<"input">, "size" | "prefix"> & {
  /** Fixed text before the value (e.g. "$"), not part of the value. */
  prefix?: ReactNode;
  /** Fixed text after the value (e.g. "pcs"). */
  suffix?: ReactNode;
};

export function Input({ className, prefix, suffix, ref, ...props }: InputProps) {
  const wiring = useFieldControlProps(props);
  const input = (
    <input
      ref={ref}
      {...props}
      {...wiring}
      className={cn(
        controlClasses,
        "min-h-12",
        prefix ? "pl-9" : undefined,
        suffix ? "pr-14" : undefined,
        className,
      )}
    />
  );
  if (!prefix && !suffix) return input;
  return (
    <div className="relative">
      {prefix ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-dust-500"
        >
          {prefix}
        </span>
      ) : null}
      {input}
      {suffix ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-dust-500"
        >
          {suffix}
        </span>
      ) : null}
    </div>
  );
}
