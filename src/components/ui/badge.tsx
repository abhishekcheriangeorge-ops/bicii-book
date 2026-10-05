import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "waiting" | "progress" | "done" | "danger" | "info";

const solid: Record<Tone, string> = {
  neutral: "bg-ink text-paper",
  waiting: "bg-waiting text-waiting-fg",
  progress: "bg-progress text-progress-fg",
  done: "bg-done text-done-fg",
  danger: "bg-danger text-danger-fg",
  info: "bg-info text-info-fg",
};

const soft: Record<Tone, string> = {
  neutral: "bg-dust-100 text-dust-700",
  waiting: "bg-waiting-soft text-waiting-deep",
  progress: "bg-progress-soft text-progress-deep",
  done: "bg-done-soft text-done-deep",
  danger: "bg-danger-soft text-danger-deep",
  info: "bg-info-soft text-info-deep",
};

export function toneClasses(tone: Tone, emphasis: "solid" | "soft" = "soft"): string {
  return emphasis === "solid" ? solid[tone] : soft[tone];
}

export type BadgeProps = {
  tone?: Tone;
  emphasis?: "solid" | "soft";
  children: ReactNode;
  className?: string;
};

/** Compact label: counts, flags ("Consigned", "Low stock"), short IDs. */
export function Badge({ tone = "neutral", emphasis = "soft", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-display text-[0.6875rem] leading-5 font-bold tracking-wider whitespace-nowrap uppercase tabular-nums",
        toneClasses(tone, emphasis),
        className,
      )}
    >
      {children}
    </span>
  );
}
