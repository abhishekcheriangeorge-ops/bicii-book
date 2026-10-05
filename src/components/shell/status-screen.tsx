import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Full-page message for 401/403/404/500. Lives outside the staff shell
 * (these render from the root), so it carries the BICII mark itself.
 */
export function StatusScreen({
  code,
  title,
  children,
  actions,
}: {
  code: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    // A div, not <main>: inside the staff shell (403 from a staff page) this
    // already sits in the shell's <main>.
    <div className="gutter flex flex-1 flex-col justify-center gap-8 py-[max(3rem,env(safe-area-inset-top))]">
      <Image
        src="/logo.svg"
        alt="BICII"
        width={2016}
        height={952}
        unoptimized
        className="h-8 w-auto self-start"
      />
      <div className="flex flex-col gap-3">
        <p className="eyebrow text-dust-500">{code}</p>
        <h1 className="text-5xl sm:text-6xl">{title}</h1>
        {children ? <div className="measure text-dust-700">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}
