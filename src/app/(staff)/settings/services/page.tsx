import type { Metadata } from "next";

import { CategoriesEditor } from "@/components/domain/categories-card";
import { ArchivedFilter } from "@/components/domain/list-filter";
import { CancelRateButton, ScheduleRateButton } from "@/components/domain/rate-controls";
import { EditServiceButton, NewServiceButton } from "@/components/domain/service-sheet";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { WrenchIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";
import { formatRate } from "@/lib/cult-commons";
import { formatDateTime } from "@/lib/dates";
import {
  listCategories,
  listCultCommonsRates,
  listServicesForSettings,
  type CultCommonsRate,
} from "@/lib/domain/services";
import { formatMoney } from "@/lib/money";
import { readFlag } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Services" };

const STATE_LABEL: Record<CultCommonsRate["state"], string> = {
  current: "In force",
  scheduled: "Scheduled",
  past: "Past",
  cancelled: "Cancelled",
};

/**
 * Services settings (SPEC §9, §10): every staff member sees the services
 * and prices; costs only with view_costs; manage_inventory adds, edits and
 * archives services and categories. The Cult Commons card (view_costs)
 * shows the rate in force, scheduled and past rates; admins schedule a new
 * one or cancel one that has not started (D21).
 */
export default async function ServicesSettingsPage({
  searchParams,
}: PageProps<"/settings/services">) {
  const staff = await requireStaff();
  const archived = readFlag((await searchParams).archived);
  const viewCosts = hasPermission(staff, "view_costs");
  const manage = hasPermission(staff, "manage_inventory");
  // Admin-only on purpose (D91): the Cult Commons rate is an admin setting;
  // a manager sees it through view_costs but does not change it
  // (private.require_admin()).
  const admin = staff.role === "admin";
  const supabase = await createClient();
  const now = new Date();
  const [groups, categories, rates] = await Promise.all([
    listServicesForSettings(supabase, { viewCosts, archived }),
    listCategories(supabase, { includeArchived: manage }),
    viewCosts ? listCultCommonsRates(supabase, now) : Promise.resolve(null),
  ]);
  const current = rates?.find((r) => r.state === "current") ?? null;
  const upcoming = rates?.filter((r) => r.state === "scheduled").reverse() ?? [];
  const history = rates?.filter((r) => r.state === "past" || r.state === "cancelled") ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Services"
        description="What the workshop sells, by category, with each service's default price."
        actions={
          manage && !archived ? (
            <NewServiceButton categories={categories} viewCosts={viewCosts} />
          ) : null
        }
      />

      <ArchivedFilter
        basePath="/settings/services"
        q=""
        archived={archived}
        label="Show services"
      />

      {groups.length === 0 ? (
        <EmptyState
          icon={<WrenchIcon />}
          title={archived ? "No archived services" : "No services yet"}
          description={
            archived
              ? "Archived services appear here and can be brought back."
              : manage
                ? "Add the services the workshop sells: name, category and price."
                : "Ask someone who manages inventory to add the workshop's services."
          }
        />
      ) : (
        groups.map((group) => (
          <section
            key={group.categoryId ?? "other"}
            aria-labelledby={`category-${group.categoryId ?? "other"}`}
            className="flex flex-col gap-2"
          >
            <h2 id={`category-${group.categoryId ?? "other"}`} className="eyebrow text-dust-500">
              {group.categoryName}
            </h2>
            <ul
              aria-label={group.categoryName}
              className="divide-y divide-hairline rounded-2xl border border-hairline bg-card"
            >
              {group.services.map((s) => (
                <li key={s.id} className="flex min-h-16 items-center gap-3 px-4 py-3">
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      {s.archived ? <Badge tone="waiting">Archived</Badge> : null}
                      {!s.active ? <Badge>Inactive</Badge> : null}
                      {!s.public ? <Badge tone="info">Not public</Badge> : null}
                    </span>
                    {s.description ? (
                      <span className="line-clamp-2 text-sm text-dust-500">{s.description}</span>
                    ) : null}
                  </span>
                  <dl className="flex shrink-0 flex-col items-end text-right tabular-nums">
                    <div className="flex gap-2">
                      <dt className="sr-only">Price</dt>
                      <dd className="font-semibold">{formatMoney(s.salePrice, s.currency)}</dd>
                    </div>
                    {s.cost !== undefined ? (
                      <div className="flex gap-1 text-sm text-dust-500">
                        <dt>Cost</dt>
                        <dd>{formatMoney(s.cost, s.currency)}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {manage ? (
                    <EditServiceButton service={s} categories={categories} viewCosts={viewCosts} />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <p className="text-sm text-dust-700">
        Changing a price or cost affects new job lines only; existing lines keep their snapshot.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        {rates ? (
          <Card
            title="Cult Commons"
            eyebrow="Staff with cost access"
            actions={admin ? <ScheduleRateButton currentRate={current?.rate ?? null} /> : null}
          >
            <div className="flex flex-col gap-4">
              <div>
                <p className="eyebrow text-dust-500">Rate in force</p>
                <p className="text-3xl font-bold tabular-nums">
                  {current ? formatRate(current.rate) : "None"}
                </p>
                <p className="text-sm text-dust-700">
                  Of each job line&rsquo;s positive yield, after its direct costs. Every line keeps
                  the rate in force when it was added.
                </p>
              </div>
              {upcoming.length > 0 ? (
                <RateList title="Scheduled" rates={upcoming} cancellable={admin} />
              ) : null}
              {history.length > 0 ? <RateList title="Earlier rates" rates={history} /> : null}
              {admin ? null : (
                <p className="text-sm text-dust-500">Only an admin can change the rate.</p>
              )}
            </div>
          </Card>
        ) : null}

        {manage ? (
          <Card title="Categories">
            <CategoriesEditor categories={categories} />
          </Card>
        ) : null}
      </div>
    </>
  );
}

function rateLabel(r: CultCommonsRate): string {
  return `${formatRate(r.rate)} from ${formatDateTime(r.effectiveFrom)}`;
}

function RateList({
  title,
  rates,
  cancellable = false,
}: {
  title: string;
  rates: CultCommonsRate[];
  cancellable?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="eyebrow text-dust-500">{title}</h3>
      <ul aria-label={title} className="flex flex-col divide-y divide-hairline">
        {rates.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="flex min-w-0 flex-col">
              <span className="flex flex-wrap items-center gap-2 font-medium tabular-nums">
                {formatRate(r.rate)}
                {r.state === "cancelled" ? (
                  <Badge tone="danger">Cancelled</Badge>
                ) : r.state === "scheduled" ? (
                  <Badge tone="info">{STATE_LABEL[r.state]}</Badge>
                ) : null}
              </span>
              <span className="text-sm text-dust-500">
                From <time dateTime={r.effectiveFrom}>{formatDateTime(r.effectiveFrom)}</time>
                {" · "}
                {r.createdByName ? `set by ${r.createdByName}` : "the starting rate"}
                {r.createdByName ? ` on ${formatDateTime(r.createdAt)}` : ""}
              </span>
              {r.cancelledAt ? (
                <span className="text-sm text-dust-500">
                  Cancelled {formatDateTime(r.cancelledAt)}
                  {r.cancelledByName ? ` by ${r.cancelledByName}` : ""}
                </span>
              ) : null}
            </span>
            {cancellable && r.state === "scheduled" ? (
              <CancelRateButton rateId={r.id} label={rateLabel(r)} />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
