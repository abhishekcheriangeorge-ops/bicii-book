"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SwitchProps = {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Submits "on" under this name when checked, like a checkbox. */
  name?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * On/off setting that takes effect immediately (role="switch"). Use Checkbox
 * for choices that are submitted with a form.
 */
export function Switch({
  label,
  description,
  checked,
  defaultChecked = false,
  onCheckedChange,
  name,
  disabled = false,
  className,
}: SwitchProps) {
  const id = useId();
  const controlled = checked !== undefined;
  const [inner, setInner] = useState(defaultChecked);
  const on = controlled ? checked : inner;

  const toggle = () => {
    if (disabled) return;
    if (!controlled) setInner(!on);
    onCheckedChange?.(!on);
  };

  return (
    <div className={cn("flex min-h-tap items-center justify-between gap-4 py-2", className)}>
      <span className="flex flex-col gap-0.5">
        <span id={`${id}-label`} className="text-base font-medium">
          {label}
        </span>
        {description ? (
          <span id={`${id}-desc`} className="text-sm text-dust-500">
            {description}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={toggle}
        className={cn(
          // 44px tall hit area around a 28px track
          "relative inline-flex h-tap w-16 shrink-0 cursor-pointer items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-x-0 h-7 rounded-full border-2 border-ink transition-colors duration-200",
            on ? "bg-ink" : "bg-card",
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-1/2 size-5 -translate-y-1/2 rounded-full transition-[left,background-color] duration-300 ease-[var(--ease-spring)]",
            on ? "left-[calc(100%-1.5rem)] bg-yellow" : "left-1 bg-ink",
          )}
        />
      </button>
      {name && on ? <input type="hidden" name={name} value="on" /> : null}
    </div>
  );
}
