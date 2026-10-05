import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CheckInForm } from "@/components/domain/appointments/check-in-form";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatAppointmentWhen } from "@/lib/appointments/format";
import { APPOINTMENT_STATUS_LABELS, availableActions } from "@/lib/appointments/status";
import { requireStaff } from "@/lib/auth/session";
import { getAppointment, openUnlinkedJobs } from "@/lib/domain/appointments";
import { customerBikesForIntake, listActiveStaff } from "@/lib/domain/workshop";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "Check in" };

/**
 * Check an appointment in (SPEC §6; PLAN D40): the customer's own bike and
 * a new or linked job. An appointment already checked in goes straight to
 * its job; one that can no longer be checked in (cancelled, completed, a
 * no-show not reinstated) says what to do instead.
 */
export default async function CheckInPage({ params }: PageProps<"/appointments/[id]/check-in">) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const appt = await getAppointment(supabase, id);
  if (!appt) notFound();
  if (appt.job) redirect(`/jobs/${appt.job.id}`);

  const when = formatAppointmentWhen(appt.startsAt, appt.endsAt);
  const header = (
    <PageHeader
      eyebrow={
        <Link href={`/appointments/${appt.id}`} className="underline-offset-4 hover:underline">
          {appt.type.name} · {when}
        </Link>
      }
      title="Check in"
      description={appt.customer.label}
    />
  );

  if (!availableActions(appt.status, appt.startsAt, new Date()).checkIn) {
    return (
      <>
        {header}
        <EmptyState
          title={`This appointment is ${APPOINTMENT_STATUS_LABELS[appt.status].toLowerCase()}`}
          description={
            appt.status === "no_show"
              ? "Reinstate it as arrived first (on the day of the appointment), or start a walk-in job."
              : "It can't be checked in. Start a walk-in job instead, or book a new appointment."
          }
          action={
            <Link
              href={`/jobs/new?customer=${appt.customer.id}`}
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              New job
            </Link>
          }
        />
      </>
    );
  }

  const [bikes, openJobs, people] = await Promise.all([
    customerBikesForIntake(supabase, appt.customer.id),
    openUnlinkedJobs(supabase, appt.customer.id),
    listActiveStaff(supabase),
  ]);

  return (
    <>
      {header}
      <CheckInForm
        appointmentId={appt.id}
        customer={{ id: appt.customer.id, label: appt.customer.label }}
        bikes={bikes.map((b) => ({
          id: b.id,
          shortId: b.shortId,
          title: b.title,
          colour: b.colour,
        }))}
        presetBikeId={appt.bike?.id ?? null}
        customerNote={appt.customerNote}
        openJobs={openJobs}
        me={{ id: staff.staffId, name: staff.displayName }}
        staff={people}
      />
    </>
  );
}
