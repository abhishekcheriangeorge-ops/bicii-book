import type { Metadata } from "next";

import { IntakeWizard } from "@/components/domain/intake-wizard";
import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";
import { currentCultCommonsRate, listActiveServices } from "@/lib/domain/services";
import { intakePreset, listActiveStaff } from "@/lib/domain/workshop";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "New job" };

const one = (v: string | string[] | undefined) => {
  const first = Array.isArray(v) ? v[0] : v;
  return isUuid(first) ? first : null;
};

/**
 * New intake / walk-in (SPEC §7.1, §21). `?customer=` and `?bike=` preset
 * the first steps (from a customer's or a bike's page). The wizard runs in
 * the browser; this page loads who can be assigned (active staff, D22),
 * the active services (with costs only for view_costs) and, for a
 * view_costs holder, the Cult Commons rate for the preview.
 */
export default async function NewJobPage({ searchParams }: PageProps<"/jobs/new">) {
  const staff = await requireStaff();
  const params = await searchParams;
  const viewCosts = hasPermission(staff, "view_costs");
  const supabase = await createClient();
  const [preset, people, services, ccRate] = await Promise.all([
    intakePreset(supabase, { customerId: one(params.customer), bikeId: one(params.bike) }),
    listActiveStaff(supabase),
    listActiveServices(supabase, { viewCosts }),
    viewCosts ? currentCultCommonsRate(supabase) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader eyebrow="Intake" title="New job" />
      <IntakeWizard
        me={{ id: staff.staffId, name: staff.displayName }}
        staff={people}
        services={services}
        viewCosts={viewCosts}
        ccRate={ccRate}
        preset={preset}
        currency={DEFAULT_CURRENCY}
      />
    </>
  );
}
