import type { Metadata } from "next";

import { moreItemsFor } from "@/components/shell/nav";
import { ChevronRightIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink, RowList } from "@/components/ui/row-list";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "More" };

export default async function MorePage() {
  const staff = await requireStaff();
  return (
    <>
      <PageHeader title="More" />
      <nav aria-label="More sections">
        <RowList>
          {moreItemsFor(staff.role === "admin").map((item) => {
            const Icon = item.icon;
            return (
              <RowLink key={item.href} href={item.href}>
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
              </RowLink>
            );
          })}
        </RowList>
      </nav>
    </>
  );
}
