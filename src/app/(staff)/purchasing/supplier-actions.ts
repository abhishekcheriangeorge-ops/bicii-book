"use server";

import { refresh } from "next/cache";

import { staffAction } from "@/lib/actions";
import {
  createSupplier as create,
  removeSupplierProduct as removeLink,
  setSupplierArchived as setArchived,
  setSupplierProduct as setLink,
  updateSupplier as update,
} from "@/lib/domain/suppliers";
import {
  removeSupplierProductSchema,
  setSupplierArchivedSchema,
  supplierProductSchema,
  supplierSchema,
} from "@/lib/purchasing-forms";

/**
 * Supplier Server Actions (SPEC §14). Every write needs manage_purchasing;
 * RLS and the RPCs check it again.
 */

/** New supplier; the id is the sheet's idempotency key. */
export const createSupplier = staffAction(
  supplierSchema,
  { name: "suppliers.create", permission: "manage_purchasing" },
  async ({ id, ...input }, { supabase }) => create(supabase, id, input),
);

export const updateSupplier = staffAction(
  supplierSchema,
  { name: "suppliers.update", permission: "manage_purchasing" },
  async ({ id, ...input }, { supabase }) => {
    await update(supabase, id, input);
    refresh();
    return null;
  },
);

export const setSupplierArchived = staffAction(
  setSupplierArchivedSchema,
  { name: "suppliers.set_archived", permission: "manage_purchasing" },
  async ({ supplierId, archived }, { supabase }) => {
    await setArchived(supabase, supplierId, archived);
    refresh();
    return null;
  },
);

/** Link a product (supplier SKU, lead days, preferred). */
export const setSupplierProduct = staffAction(
  supplierProductSchema,
  { name: "suppliers.set_product", permission: "manage_purchasing" },
  async (input, { supabase }) => {
    await setLink(supabase, input);
    refresh();
    return null;
  },
);

export const removeSupplierProduct = staffAction(
  removeSupplierProductSchema,
  { name: "suppliers.remove_product", permission: "manage_purchasing" },
  async ({ supplierId, productId }, { supabase }) => {
    await removeLink(supabase, supplierId, productId);
    refresh();
    return null;
  },
);
