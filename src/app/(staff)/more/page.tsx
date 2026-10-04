import type { Metadata } from "next";
import Link from "next/link";

import { MORE_ITEMS } from "@/components/shell/nav";
import { ChevronRightIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "More" };

export default async function MorePage() {
  await requireStaff();
  return (
    <>
      <PageHeader title="More" />
      <nav aria-label="More sections">
        <ul className="overflow-hidden rounded-2xl border border-hairline bg-card">
          {MORE_ITEMS.map((item, i) => {
            const Icon = item.icon;
            return (
              <li key={item.href} className={i > 0 ? "border-t border-hairline" : undefined}>
                <Link
                  href={item.href}
                  className="flex min-h-16 items-center gap-4 px-4 py-3 transition-colors hover:bg-dust-100"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken"
                  >
                    <Icon className="size-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-display text-base font-bold tracking-wide uppercase">
                      {item.label}
                    </span>
                    {item.description ? (
                      <span className="truncate text-sm text-dust-500">{item.description}</span>
                    ) : null}
                  </span>
                  <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
