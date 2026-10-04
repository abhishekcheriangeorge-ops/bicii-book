"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A 48px choice chip: a toggle button (`aria-pressed`) for several choices
 * (additional staff, statuses), or `role="radio"` inside a
 * `role="radiogroup"` for one (the lead, who to assign).
 */
export function Chip({
  pressed,
  onClick,
  children,
  role,
  label,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  /** "radio" for a single choice; a toggle button otherwise. */
  role?: "radio";
  label?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "radio" ? pressed : undefined}
      aria-pressed={role === "radio" ? undefined : pressed}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border-2 px-4 text-sm font-semibold transition-colors",
        pressed ? "border-ink bg-ink text-paper" : "border-hairline bg-card hover:border-ink",
      )}
    >
      {children}
    </button>
  );
}
