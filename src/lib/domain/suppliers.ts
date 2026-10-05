import "server-only";

import type { StaffDTO } from "@/lib/auth/permissions";
import { DbError, constraintOf, mapDbError, unwrap } from "@/lib/db-errors";
import { toMoneyString } from "@/lib/money";
import { canSeePurchaseCosts } from "@/lib/purchasing";
import type { ServerSupabase } from "@/lib/supabase/server";

import { DomainError } from "./errors";
import type { ListPage } from "./list";
import { purchaseOrderItems, type PurchaseOrderListItem } from "./purchasing";
import { staffSearch } from "./search";

/**
 * Suppliers (SPEC §14, §21; DATA-MODEL §10; PLAN D60 D-PO-COSTS). Every
 * active staff member reads suppliers; manage_purchasing writes them
 * (insert and update are column grants under RLS, created idempotently with
 * the form's own id, as for customers). Soft delete only: archiving hides a
 * supplier from search and pickers and is refused while it has open orders
 * (supplier_has_open_orders). Product links go through set_supplier_product /
 * remove_supplier_product. Last costs (D63) come from supplier_products_staff
 * and only for cost-visible staff.
 */

type Money = string;

const NOT_FOUND = "That supplier no longer exists. Refresh and try again.";

export type SupplierListItem = {
  id: string;
  name: string;
  /** "contact · phone · email" */
  detail: string | null;
  archived: boolean;
};

export type SupplierProductLink = {
  product: { id: string; shortId: string; name: string; sku: string | null };
  supplierSku: string | null;
  leadDays: number | null;
  preferred: boolean;
  /** D60: present only for cost-visible staff. */
  costs?: { lastUnitCost: Money | null; currency: string; lastReceivedAt: string | null };
};

export type SupplierDetail = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  accountReference: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  products: SupplierProductLink[];
  /** Newest first, at most 30. */
  orders: ListPage<PurchaseOrderListItem>;
};

export type SupplierInput = {
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  /** Normalised (https:// added) by the form schema. */
  website: string | null;
  accountReference: string | null;
  notes: string | null;
};

const SUPPLIER_FIELDS: Record<string, string> = {
  suppliers_name_active_key: "name",
  suppliers_name_check: "name",
  suppliers_contact_name_check: "contactName",
  suppliers_email_check: "email",
  suppliers_phone_check: "phone",
  suppliers_website_check: "website",
  suppliers_account_reference_check: "accountReference",
  suppliers_notes_check: "notes",
};

/** A database refusal that belongs to one field, rethrown as a DomainError on it. */
function rethrowFields(err: unknown, fields: Record<string, string>): never {
  if (err instanceof DbError) {
    const mapped = mapDbError(err);
    const field = mapped.reason ? fields[mapped.reason] : undefined;
    if (field && mapped.kind !== "unknown" && mapped.kind !== "unavailable") {
      throw new DomainError(mapped.message, { [field]: [mapped.message] });
    }
  }
  throw err;
}

const contactLine = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ") || null;

const money = (v: number | string | null | undefined): Money | null =>
  v === null || v === undefined ? null : toMoneyString(v);

/**
 * Suppliers matching `q` (staff_search: name, contact, email, account
 * reference, phone digits), or all of them by name when `q` is empty.
 * `archived` lists archived suppliers instead, matched the same way.
 */
export async function listSuppliers(
  supabase: ServerSupabase,
  { q, archived = false, limit = 30 }: { q: string; archived?: boolean; limit?: number },
): Promise<ListPage<SupplierListItem>> {
  if (q) {
    const hits = await staffSearch(supabase, q, { kinds: ["supplier"], limit, archived });
    return {
      items: hits.items.map((h) => ({ id: h.id, name: h.title, detail: h.subtitle, archived })),
      more: hits.more,
    };
  }
  let query = supabase
    .from("suppliers")
    .select("id, name, contact_name, phone, email, archived_at");
  query = archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  const rows =
    unwrap(
      await (
        archived
          ? query.order("archived_at", { ascending: false })
          : query.order("name", { ascending: true })
      )
        .order("id", { ascending: true })
        .limit(limit + 1),
    ) ?? [];
  return {
    items: rows.slice(0, limit).map((r) => ({
      id: r.id,
      name: r.name,
      detail: contactLine(r.contact_name, r.phone, r.email),
      archived: r.archived_at !== null,
    })),
    more: rows.length > limit,
  };
}

/** A supplier with the products it supplies and its orders, or null. */
export async function getSupplier(
  supabase: ServerSupabase,
  id: string,
  staff: StaffDTO,
): Promise<SupplierDetail | null> {
  const seeCosts = canSeePurchaseCosts(staff);
  const [supplierResult, linksResult, costsResult, poResult] = await Promise.all([
    supabase
      .from("suppliers")
      .select(
        "id, name, contact_name, email, phone, website, account_reference, notes, archived_at, created_at",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("supplier_products")
      .select("product_id, supplier_sku, lead_days, preferred, products(id, short_id, name, sku)")
      .eq("supplier_id", id),
    seeCosts
      ? supabase
          .from("supplier_products_staff")
          .select("product_id, last_unit_cost, currency, last_received_at")
          .eq("supplier_id", id)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, expected_at, created_at, supplier_id, suppliers(id, name)")
      .eq("supplier_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(31),
  ]);
  const s = unwrap(supplierResult);
  if (!s) return null;
  const costs = new Map(
    (
      (unwrap(costsResult) ?? []) as {
        product_id: string | null;
        last_unit_cost: number | null;
        currency: string | null;
        last_received_at: string | null;
      }[]
    ).map((c) => [c.product_id, c]),
  );
  const links = (unwrap(linksResult) ?? []) as {
    product_id: string;
    supplier_sku: string | null;
    lead_days: number | null;
    preferred: boolean;
    products: { id: string; short_id: string; name: string; sku: string | null } | null;
  }[];
  const poRows = (unwrap(poResult) ?? []) as Parameters<typeof purchaseOrderItems>[1][number][];
  return {
    id: s.id,
    name: s.name,
    contactName: s.contact_name,
    email: s.email,
    phone: s.phone,
    website: s.website,
    accountReference: s.account_reference,
    notes: s.notes,
    archivedAt: s.archived_at,
    createdAt: s.created_at,
    products: links
      .map((l) => {
        const c = costs.get(l.product_id);
        return {
          product: {
            id: l.product_id,
            shortId: l.products?.short_id ?? "",
            name: l.products?.name ?? "Product",
            sku: l.products?.sku ?? null,
          },
          supplierSku: l.supplier_sku,
          leadDays: l.lead_days,
          preferred: l.preferred,
          ...(seeCosts && c
            ? {
                costs: {
                  lastUnitCost: money(c.last_unit_cost),
                  currency: c.currency ?? "SGD",
                  lastReceivedAt: c.last_received_at,
                },
              }
            : {}),
        };
      })
      .sort((a, b) => a.product.name.localeCompare(b.product.name)),
    orders: {
      items: await purchaseOrderItems(supabase, poRows.slice(0, 30)),
      more: poRows.length > 30,
    },
  };
}

const toRow = (input: SupplierInput) => ({
  name: input.name,
  contact_name: input.contactName,
  email: input.email,
  phone: input.phone,
  website: input.website,
  account_reference: input.accountReference,
  notes: input.notes,
});

/**
 * Creates a supplier with the id the form chose (its idempotency key): a
 * repeated submit finds the row it already made (suppliers_pkey) instead of
 * creating a second one.
 */
export async function createSupplier(
  supabase: ServerSupabase,
  id: string,
  input: SupplierInput,
): Promise<{ id: string }> {
  const { error } = await supabase.from("suppliers").insert({ id, ...toRow(input) });
  if (error) {
    if (error.code === "23505" && constraintOf(error) === "suppliers_pkey") return { id };
    rethrowFields(new DbError(error), SUPPLIER_FIELDS);
  }
  return { id };
}

export async function updateSupplier(
  supabase: ServerSupabase,
  id: string,
  input: SupplierInput,
): Promise<void> {
  let row: { id: string } | null;
  try {
    row = unwrap(
      await supabase.from("suppliers").update(toRow(input)).eq("id", id).select("id").maybeSingle(),
    );
  } catch (err) {
    rethrowFields(err, SUPPLIER_FIELDS);
  }
  if (!row) throw new DomainError(NOT_FOUND);
}

/**
 * Archive (hidden from search and pickers; refused while it has open
 * orders) or unarchive. Replaying the current state changes nothing.
 */
export async function setSupplierArchived(
  supabase: ServerSupabase,
  id: string,
  archived: boolean,
): Promise<void> {
  const update = supabase
    .from("suppliers")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  let row: { id: string } | null;
  try {
    row = unwrap(
      await (archived ? update.is("archived_at", null) : update.not("archived_at", "is", null))
        .select("id")
        .maybeSingle(),
    );
  } catch (err) {
    // Unarchiving into a name an active supplier now uses.
    rethrowFields(err, {});
  }
  if (row) return;
  const exists = unwrap(await supabase.from("suppliers").select("id").eq("id", id).maybeSingle());
  if (!exists) throw new DomainError(NOT_FOUND);
}

export type SupplierProductInput = {
  supplierId: string;
  productId: string;
  supplierSku: string | null;
  leadDays: number | null;
  /** At most one preferred supplier per product: this replaces another. */
  preferred: boolean;
};

/** Links a supplier to a product, or changes the link (never its last cost). */
export async function setSupplierProduct(
  supabase: ServerSupabase,
  input: SupplierProductInput,
): Promise<void> {
  try {
    unwrap(
      await supabase.rpc("set_supplier_product", {
        supplier_id: input.supplierId,
        product_id: input.productId,
        supplier_sku: input.supplierSku ?? undefined,
        lead_days: input.leadDays ?? undefined,
        preferred: input.preferred,
      }),
    );
  } catch (err) {
    rethrowFields(err, {
      supplier_archived: "supplierId",
      supplier_products_supplier_sku_check: "supplierSku",
      supplier_products_lead_days_check: "leadDays",
    });
  }
}

/** Removes a link (a replay is a no-op). */
export async function removeSupplierProduct(
  supabase: ServerSupabase,
  supplierId: string,
  productId: string,
): Promise<void> {
  unwrap(
    await supabase.rpc("remove_supplier_product", {
      supplier_id: supplierId,
      product_id: productId,
    }),
  );
}

/** Options for a supplier picker: active suppliers matching `q` (staff_search). */
export async function searchSupplierOptions(
  supabase: ServerSupabase,
  q: string,
): Promise<{ id: string; label: string; description?: string }[]> {
  const hits = await staffSearch(supabase, q, { kinds: ["supplier"], limit: 8 });
  return hits.items.map((h) => ({
    id: h.id,
    label: h.title,
    description: h.subtitle ?? undefined,
  }));
}
