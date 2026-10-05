"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

import { LinkPending } from "./link-pending";
import { MORE_ITEMS, TABS, isActive, type NavItem } from "./nav";

function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  const scan = item.href === "/scan";
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-tap items-center gap-3 rounded-xl px-3 font-display text-sm font-bold tracking-wide uppercase transition-colors",
          active
            ? "bg-ink text-paper"
            : scan
              ? "bg-yellow text-ink hover:brightness-105"
              : "text-dust-700 hover:bg-dust-100 hover:text-ink",
        )}
      >
        <LinkPending className="flex items-center" pendingClassName="animate-pulse">
          <Icon className="size-5 shrink-0" />
        </LinkPending>
        <span>{item.label}</span>
      </Link>
    </li>
  );
}

/** iPad and desktop navigation: a labelled rail on the left, from md up. */
export function SideRail() {
  const pathname = usePathname();
  const primary = TABS.filter((t) => t.href !== "/more");
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-6 overflow-y-auto border-r border-hairline bg-paper px-3 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6 md:flex lg:w-64"
    >
      <Link href="/" className="flex min-h-tap items-center px-3" aria-label="BICII Admin, Today">
        <Image
          src="/logo.svg"
          alt=""
          width={2016}
          height={952}
          unoptimized
          loading="eager"
          className="h-7 w-auto"
        />
      </Link>
      <ul className="flex flex-col gap-1">
        {primary.map((item) => (
          <RailLink key={item.href} item={item} pathname={pathname} />
        ))}
      </ul>
      <div className="flex flex-col gap-1">
        <p className="eyebrow px-3 text-dust-500">More</p>
        <ul className="flex flex-col gap-1">
          {MORE_ITEMS.map((item) => (
            <RailLink key={item.href} item={item} pathname={pathname} />
          ))}
        </ul>
      </div>
    </nav>
  );
}
