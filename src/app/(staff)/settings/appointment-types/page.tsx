import type { Metadata } from "next";

import {
  EditAppointmentTypeButton,
  NewAppointmentTypeButton,
} from "@/components/domain/appointment-type-sheet";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";
import { getShopSettings, listAppointmentTypes } from "@/lib/domain/schedule";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Appointment types" };

/**
 * Appointment types (SPEC §6; PLAN D2, D37, D38): what can be booked, how
 * long it takes and how many capacity units it holds in each slot it
 * overlaps; Public types can be booked by customers online (D37), staff
 * book every active one. Every staff member may read them (requireStaff()
 * only, so it has its own loading.tsx); admins add and edit (the RPC
 * checks the role again). Types are never deleted: deactivate them;
 * inactive ones are listed last.
 */
export default async function AppointmentTypesPage() {
  const staff = await requireStaff();
  // Admin-only on purpose (D91): appointment types are shop settings, which
  // no role but admin and no exception changes (private.require_admin()).
  const admin = staff.role === "admin";
  const supabase = await createClient();
  const [types, settings] = await Promise.all([
    listAppointmentTypes(supabase, { includeInactive: true }),
    getShopSettings(supabase),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Appointment types"
        description="What customers and staff can book. Types are never deleted: switch one off to stop new bookings."
        actions={admin ? <NewAppointmentTypeButton shopCapacity={settings.capacityUnits} /> : null}
      />
      {types.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon />}
          title="No appointment types yet"
          description={
            admin
              ? "Add what can be booked: a service drop-off, a bike fit."
              : "Ask an admin to add one."
          }
        />
      ) : (
        <ul
          aria-label="Appointment types"
          className="divide-y divide-hairline rounded-2xl border border-hairline bg-card"
        >
          {types.map((t) => (
            <li
              key={t.id}
              aria-label={t.name}
              className="flex min-h-16 flex-wrap items-center gap-3 px-4 py-3"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={t.active ? "font-medium" : "font-medium text-dust-500"}>
                    {t.name}
                  </span>
                  {t.public ? (
                    <Badge tone="info">Public</Badge>
                  ) : (
                    <Badge tone="neutral">Staff only</Badge>
                  )}
                  {!t.active ? <Badge tone="waiting">Inactive</Badge> : null}
                </span>
                <span className="text-sm text-dust-500">
                  {t.durationMinutes} min · {t.capacityUnits}{" "}
                  {t.capacityUnits === 1 ? "unit" : "units"} · Sort order {t.sortOrder}
                </span>
                {t.description ? (
                  <span className="text-sm text-dust-700">{t.description}</span>
                ) : null}
              </span>
              {admin ? (
                <EditAppointmentTypeButton type={t} shopCapacity={settings.capacityUnits} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-dust-700">
        A type takes its capacity units in every {settings.slotMinutes}-minute slot it overlaps; the
        shop takes {settings.capacityUnits} per slot. Changing a type never changes appointments
        already booked.
      </p>
    </>
  );
}
