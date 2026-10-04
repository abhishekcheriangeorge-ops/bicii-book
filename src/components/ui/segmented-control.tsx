"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SegmentOption<V extends string = string> = {
  value: V;
  label: ReactNode;
  /** Optional count, e.g. jobs in that status. */
  count?: number;
};

export type SegmentedControlProps<V extends string = string> = {
  /** Accessible name for the group, e.g. "Status filter". */
  label: string;
  options: readonly SegmentOption<V>[];
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  /** Submits the chosen value under this name inside a form. */
  name?: string;
  className?: string;
};

/**
 * One-of-few choice shown inline (filters, view switches). ARIA radiogroup
 * with roving tabindex: Tab enters at the checked option, arrows move and
 * select, Home/End jump. Scrolls horizontally on narrow screens rather than
 * wrapping.
 */
export function SegmentedControl<V extends string = string>({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  className,
}: SegmentedControlProps<V>) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState<V | undefined>(defaultValue ?? options[0]?.value);
  const current = controlled ? value : inner;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (!controlled) setInner(option.value);
    onValueChange?.(option.value);
    refs.current[index]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const last = options.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? index === last
          ? 0
          : index + 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? index === 0
            ? last
            : index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    select(next);
  };

  const checkedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === current),
  );

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex max-w-full [scrollbar-width:none] gap-1 overflow-x-auto rounded-full border-2 border-ink bg-card p-1",
        className,
      )}
    >
      {options.map((option, i) => {
        const checked = i === checkedIndex;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex min-h-tap shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 font-display text-xs font-bold tracking-wide whitespace-nowrap uppercase",
              "transition-colors duration-150",
              checked ? "bg-ink text-paper" : "text-ink hover:bg-dust-100",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[0.6875rem] tabular-nums",
                  checked ? "bg-paper/20" : "bg-dust-100",
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
      {name ? <input type="hidden" name={name} value={current ?? ""} /> : null}
    </div>
  );
}
