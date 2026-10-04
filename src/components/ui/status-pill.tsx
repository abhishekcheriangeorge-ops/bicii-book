import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { toneClasses, type Tone } from "./badge";

/**
 * Operational status → tone. Domain code maps its own enums onto these five
 * (e.g. work order `waiting_parts` → waiting, `in_progress` → progress,
 * `ready` → done, `overdue` → danger). Colour is never the only signal: the
 * pill always carries its text label.
 */
export type Status = Exclude<Tone, "neutral"> | "neutral";

export type StatusPillProps = {
  status: Status;
  children: ReactNode;
  emphasis?: "solid" | "soft";
  className?: string;
};

const dot: Record<Status, string> = {
  neutral: "bg-dust-500",
  waiting: "bg-yellow-deep",
  progress: "bg-sky-deep",
  done: "bg-green-deep",
  danger: "bg-red-deep",
  info: "bg-indigo",
};

export function StatusPill({ status, children, emphasis = "soft", className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full px-3 text-dense font-semibold whitespace-nowrap",
        toneClasses(status, emphasis),
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          emphasis === "solid" ? "bg-current" : dot[status],
        )}
      />
      {children}
    </span>
  );
}
