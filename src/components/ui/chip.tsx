"use client";

import { useRef, type KeyboardEvent, type ReactNode, type Ref } from "react";

import { cn } from "@/lib/cn";

/**
 * A 48px choice chip: a toggle button (`aria-pressed`) for several choices
 * (additional staff, statuses). For one choice (the lead, who to assign),
 * use ChipRadioGroup, which makes its chips radios with the keyboard
 * behaviour a radio group announces.
 */
export function Chip({
  pressed,
  onClick,
  children,
  role,
  label,
  tabIndex,
  onKeyDown,
  ref,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  /** "radio" inside ChipRadioGroup; a toggle button otherwise. */
  role?: "radio";
  label?: string;
  tabIndex?: number;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      role={role}
      aria-checked={role === "radio" ? pressed : undefined}
      aria-pressed={role === "radio" ? undefined : pressed}
      aria-label={label}
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border-2 px-4 text-sm font-semibold transition-colors",
        pressed ? "border-ink bg-ink text-paper" : "border-hairline bg-card hover:border-ink",
      )}
    >
      {children}
    </button>
  );
}

export type ChipRadioOption<T> = {
  value: T;
  children: ReactNode;
  /** Accessible name when the visible text is shorter ("Me"). */
  label?: string;
};

/**
 * One choice among chips, as an ARIA radio group (the pattern
 * SegmentedControl follows, DESIGN.md): one Tab stop (the chosen chip, or
 * the first when none is), Arrow keys move and choose, Home and End jump
 * to the ends, wrapping round. Space and Enter choose the focused chip.
 */
export function ChipRadioGroup<T extends string | null>({
  value,
  options,
  onChange,
  labelledBy,
}: {
  value: T | undefined;
  options: readonly ChipRadioOption<T>[];
  onChange: (value: T) => void;
  /** The id of the group's visible label. */
  labelledBy: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = options.findIndex((o) => o.value === value);
  const focusable = checkedIndex === -1 ? 0 : checkedIndex;

  const choose = (index: number) => {
    onChange(options[index].value);
    refs.current[index]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
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
    choose(next);
  };

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {options.map((option, i) => (
        <Chip
          key={option.value ?? "\u0000none"}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="radio"
          pressed={i === checkedIndex}
          label={option.label}
          tabIndex={i === focusable ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {option.children}
        </Chip>
      ))}
    </div>
  );
}
