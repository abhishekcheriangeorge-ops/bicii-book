"use server";

import { refresh } from "next/cache";

import { staffAction } from "@/lib/actions";
import { saveAppointmentType as storeType } from "@/lib/domain/schedule";
import { appointmentTypeSchema } from "@/lib/schedule";

/**
 * Appointment types (SPEC §6; Settings → Appointment types; PLAN D2, D37,
 * D38). Admin only (the RPC checks the role again). The sheet's id is the
 * idempotency key: New sends isNew, Edit does not; a late replay with other
 * values is appointment_type_conflict. Types are never deleted, only
 * deactivated; changing a duration or units never alters existing
 * appointments (D38).
 */
export const saveAppointmentType = staffAction(
  appointmentTypeSchema,
  { name: "appointment_types.save", admin: true },
  async (input, { supabase }) => {
    // More units than the shop's capacity (on an active type) is the RPC's
    // appointment_type_capacity_too_large, mapped to capacityUnits.
    const saved = await storeType(supabase, input);
    refresh();
    return saved;
  },
);
