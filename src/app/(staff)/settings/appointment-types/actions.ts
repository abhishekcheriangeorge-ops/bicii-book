"use server";

import { refresh } from "next/cache";

import { ActionError, staffAction } from "@/lib/actions";
import { getShopSettings, saveAppointmentType as storeType } from "@/lib/domain/schedule";
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
    if (input.active) {
      const settings = await getShopSettings(supabase);
      if (input.capacityUnits > settings.capacityUnits) {
        const message = `The shop takes ${settings.capacityUnits} ${settings.capacityUnits === 1 ? "unit" : "units"} per slot. Raise the capacity first, or use fewer units.`;
        throw new ActionError(message, { capacityUnits: [message] });
      }
    }
    const saved = await storeType(supabase, input);
    refresh();
    return saved;
  },
);
