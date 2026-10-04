import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type PageHeaderProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Primary actions; they wrap below the title on phones. */
  actions?: ReactNode;
  className?: string;
};

/** The one h1 on a screen, with the public site's eyebrow-over-title rhythm. */
export function PageHeader({ title, eyebrow, description, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 pt-6 pb-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-2">
        {eyebrow ? <p className="eyebrow text-dust-500">{eyebrow}</p> : null}
        <h1 className="text-4xl sm:text-5xl">{title}</h1>
        {description ? <p className="measure text-dust-700">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
