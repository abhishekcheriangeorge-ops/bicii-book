import type { Metadata } from "next";

import {
  ChevronRightIcon,
  ShareIcon,
  UserIcon,
  UsersIcon,
  WrenchIcon,
} from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink, RowList } from "@/components/ui/row-list";
import { hasPermission } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const staff = await requireStaff();
  const items = [
    {
      href: "/settings/profile",
      label: "Your profile",
      description: "Role, permissions, password and sign out",
      icon: UserIcon,
    },
    ...(hasPermission(staff, "manage_staff")
      ? [
          {
            href: "/settings/staff",
            label: "Staff",
            description: "Invite staff, permissions and access",
            icon: UsersIcon,
          },
        ]
      : []),
    {
      href: "/settings/services",
      label: "Services",
      description: hasPermission(staff, "view_costs")
        ? "Services, prices, categories and the Cult Commons rate"
        : "Services, prices and categories",
      icon: WrenchIcon,
    },
    {
      href: "/settings/install",
      label: "Install the app",
      description: "Add BICII Admin to your home screen",
      icon: ShareIcon,
    },
  ];
  return (
    <>
      <PageHeader title="Settings" />
      <RowList>
        {items.map((item) => {
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
                <span className="truncate text-sm text-dust-500">{item.description}</span>
              </span>
              <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
            </RowLink>
          );
        })}
      </RowList>
    </>
  );
}
