"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { staffAction } from "@/lib/actions";
import { setConsignmentSettlementAlertDays } from "@/lib/domain/reconciliation";

/**
 * Admin: when an unsettled consignment becomes an exception (D107). The
 * RPC checks the admin again and records the change in the schedule
 * history; the same value again changes nothing.
 */
export const setSettlementAlertDays = staffAction(
  z.object({
    days: z.coerce
      .number({ error: "Enter a number of days from 1 to 365." })
      .int({ error: "Enter a whole number of days." })
      .min(1, { error: "Choose between 1 and 365 days." })
      .max(365, { error: "Choose between 1 and 365 days." }),
  }),
  { name: "reports.set_settlement_alert_days", admin: true },
  async ({ days }, { supabase }) => {
    const value = await setConsignmentSettlementAlertDays(supabase, days);
    refresh();
    return { days: value };
  },
);
