import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** The next useful step, e.g. a "New intake" button. */
  action?: ReactNode;
  /** "done" for an all-clear (No exceptions): the icon in the done tone. */
  tone?: "neutral" | "done";
  className?: string;
};

/** Says what is missing and what to do next (SPEC §22: useful empty states). */
export function EmptyState({
  title,
  description,
  icon,
  action,
  tone = "neutral",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-dust-300 px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            "flex size-12 items-center justify-center rounded-full",
            tone === "done" ? "bg-done-soft text-done-deep" : "bg-dust-100 text-dust-700",
          )}
        >
          {icon}
        </div>
      ) : null}
      <h2 className="text-xl">{title}</h2>
      {description ? <p className="measure text-sm text-dust-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
