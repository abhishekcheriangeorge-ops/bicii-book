"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { staffAction } from "@/lib/actions";
import { canViewSaleCosts } from "@/lib/auth/permissions";
import {
  recordRetailSale,
  recordSaleRefund,
  restockUnit,
  searchSaleable,
} from "@/lib/domain/sales";
import { refundSchema, restockSchema, saleSchema } from "@/lib/sales-forms";

/**
 * Sales actions (SPEC §13, §22; src/lib/domain/sales.ts). Each goes through
 * one domain function; the RPCs check again:
 *
 *   searchSaleableAction  any active staff (costs only for view_costs)
 *   recordSaleAction      any active staff (D48)
 *   restockUnitAction     adjust_stock; a consigned unit also needs
 *                         manage_consignments, which the database checks
 *                         (D46)
 *   recordRefundAction    admins only (D49)
 *
 * Ids are made when a sheet or confirmation opens, so a retry has one effect.
 */

/** What the sale sheet can sell for `q`, with costs and the rate for view_costs. */
export const searchSaleableAction = staffAction(
  z.object({ q: z.string().trim().max(200) }),
  { name: "sales.search_saleable" },
  async ({ q }, { supabase, staff }) =>
    q
      ? searchSaleable(supabase, q, { viewCosts: canViewSaleCosts(staff) })
      : { rows: [], rate: null },
);

export const recordSaleAction = staffAction(
  saleSchema,
  { name: "sales.record_sale" },
  async (input, { supabase }) => {
    const result = await recordRetailSale(supabase, input);
    refresh();
    return result;
  },
);

export const restockUnitAction = staffAction(
  restockSchema,
  { name: "sales.restock_unit", permission: "adjust_stock" },
  async (input, { supabase }) => {
    await restockUnit(supabase, input);
    refresh();
    return null;
  },
);

export const recordRefundAction = staffAction(
  refundSchema,
  { name: "sales.record_refund", admin: true },
  async (input, { supabase }) => {
    await recordSaleRefund(supabase, input);
    refresh();
    return null;
  },
);
