"use server";

import { refresh } from "next/cache";

import { staffAction } from "@/lib/actions";
import {
  cancelPurchaseOrder as cancel,
  createPurchaseOrder as create,
  getPurchaseCostDefaults,
  removePurchaseOrderLine as removeLine,
  searchPurchasableProducts as searchProducts,
  setPurchaseOrderLine as setLine,
  submitPurchaseOrder as submit,
  updatePurchaseOrder as update,
} from "@/lib/domain/purchasing";
import { searchSupplierOptions } from "@/lib/domain/suppliers";
import {
  cancelPurchaseOrderSchema,
  createPurchaseOrderSchema,
  purchaseCostDefaultsSchema,
  purchaseOrderIdSchema,
  purchaseOrderLineSchema,
  purchasingSearchSchema,
  removePurchaseOrderLineSchema,
  updatePurchaseOrderSchema,
} from "@/lib/purchasing-forms";

/**
 * Purchase order Server Actions (SPEC §14; DATA-MODEL §16). Thin: zod,
 * one domain call, refresh(). Every write needs manage_purchasing (the
 * RPCs check it again); money arrives as a fixed-point string
 * (purchaseUnitCostSchema) and goes to the RPC as one. The searches serve
 * every active staff member.
 */

/** New draft order; the id is the sheet's idempotency key. */
export const createPurchaseOrder = staffAction(
  createPurchaseOrderSchema,
  { name: "purchasing.create_order", permission: "manage_purchasing" },
  async ({ id, ...input }, { supabase }) => {
    const created = await create(supabase, id, input);
    return { id: created.id };
  },
);

export const updatePurchaseOrder = staffAction(
  updatePurchaseOrderSchema,
  { name: "purchasing.update_order", permission: "manage_purchasing" },
  async ({ purchaseOrderId, ...input }, { supabase }) => {
    await update(supabase, purchaseOrderId, input);
    refresh();
    return null;
  },
);

/** Add or change a line (upsert by the line id). */
export const setPurchaseOrderLine = staffAction(
  purchaseOrderLineSchema,
  { name: "purchasing.set_line", permission: "manage_purchasing" },
  async (input, { supabase }) => {
    await setLine(supabase, input);
    refresh();
    return null;
  },
);

export const removePurchaseOrderLine = staffAction(
  removePurchaseOrderLineSchema,
  { name: "purchasing.remove_line", permission: "manage_purchasing" },
  async ({ lineId, reason }, { supabase }) => {
    await removeLine(supabase, lineId, reason);
    refresh();
    return null;
  },
);

export const submitPurchaseOrder = staffAction(
  purchaseOrderIdSchema,
  { name: "purchasing.submit_order", permission: "manage_purchasing" },
  async ({ purchaseOrderId }, { supabase }) => {
    await submit(supabase, purchaseOrderId);
    refresh();
    return null;
  },
);

/** D61 D-PO-CANCEL: with a reason; received stock stays. */
export const cancelPurchaseOrder = staffAction(
  cancelPurchaseOrderSchema,
  { name: "purchasing.cancel_order", permission: "manage_purchasing" },
  async ({ purchaseOrderId, reason }, { supabase }) => {
    await cancel(supabase, purchaseOrderId, reason);
    refresh();
    return null;
  },
);

/** The line sheet's cost prefill (supplier's last cost, else product cost, else 0). */
export const purchaseCostDefaults = staffAction(
  purchaseCostDefaultsSchema,
  { name: "purchasing.cost_defaults", permission: "manage_purchasing" },
  async ({ supplierId, productIds }, { supabase }) =>
    getPurchaseCostDefaults(supabase, supplierId, productIds),
);

/** Products a PO may order, with on hand and on order (any active staff). */
export const searchPurchasableProducts = staffAction(
  purchasingSearchSchema,
  { name: "purchasing.search_products" },
  async ({ q }, { supabase }) => (q ? searchProducts(supabase, q) : []),
);

/** Active suppliers, for supplier pickers (any active staff). */
export const searchSuppliers = staffAction(
  purchasingSearchSchema,
  { name: "purchasing.search_suppliers" },
  async ({ q }, { supabase }) => (q ? searchSupplierOptions(supabase, q) : []),
);
