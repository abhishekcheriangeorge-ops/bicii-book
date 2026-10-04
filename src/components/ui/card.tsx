import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type CardProps = ComponentPropsWithoutRef<"section"> & {
  title?: ReactNode;
  /** Small uppercase label above the title. */
  eyebrow?: ReactNode;
  actions?: ReactNode;
  /** Remove body padding (for tables and lists that run edge to edge). */
  flush?: boolean;
};

/** White panel lifted off paper by a hairline. Headings are h2. */
export function Card({
  title,
  eyebrow,
  actions,
  flush = false,
  className,
  children,
  ...props
}: CardProps) {
  const hasHeader = title || eyebrow || actions;
  return (
    <section
      className={cn("overflow-hidden rounded-2xl border border-hairline bg-card", className)}
      {...props}
    >
      {hasHeader ? (
        <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
          <div className="flex min-w-0 flex-col gap-1">
            {eyebrow ? <p className="eyebrow text-dust-500">{eyebrow}</p> : null}
            {title ? <h2 className="text-xl leading-tight">{title}</h2> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn(!flush && "px-4 pb-4 sm:px-5", !flush && !hasHeader && "pt-4")}>
        {children}
      </div>
    </section>
  );
}
