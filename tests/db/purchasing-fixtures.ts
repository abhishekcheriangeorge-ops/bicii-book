/**
 * The shared purchasing DB fixture module (Phase 7), built on
 * tests/db/inventory-fixtures.ts. Later steps (search, reorder, seed) extend
 * it rather than recreate it.
 *
 *   * `make*` helpers insert as the connection's owner (superuser): call them
 *     before actAs(), or after ownerMode().
 *   * The RPC helpers (createPO, setLine, submitPO, receive, cancelPO, ...)
 *     call the public RPCs as whoever `tx` currently is.
 *   * openPO() builds a supplier, a product and a submitted PO: owner rows,
 *     then the RPCs as `claims` (the admin by default). It leaves `tx` acting
 *     as `claims`.
 *
 * Creating a product or a PO consumes a short-ID sequence, so tests that use
 * these skip in existing-database mode (isolatedDatabase()).
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";

import { LOCATION, STAFF } from "../fixtures/ids";
import { actAs, scalar, type Claims } from "./harness";
import { ADMIN, makeProduct, readAsOwner, type ProductOptions } from "./inventory-fixtures";
import { ownerMode } from "./workshop-fixtures";

/** A new supplier (owner insert); returns its id. */
export async function makeSupplier(
  tx: pg.Client,
  {
    id = randomUUID(),
    name = `Supplier ${randomUUID().slice(0, 8)}`,
    archived = false,
  }: { id?: string; name?: string; archived?: boolean } = {},
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.suppliers (id, name, archived_at)
     values ($1, $2, case when $3 then now() end) returning id`,
    [id, name, archived],
  );
  return rows[0].id;
}

/** Grants manage_purchasing to a staff member (owner insert, rolled back with the test). */
export async function grantPurchasing(tx: pg.Client, staffId: string = STAFF.mechanic2) {
  await tx.query(
    "insert into public.staff_permissions (staff_id, permission) values ($1, 'manage_purchasing') on conflict do nothing",
    [staffId],
  );
}

export type PurchaseOrderRow = {
  id: string;
  po_number: string;
  supplier_id: string;
  status: string;
  expected_at: string | null;
  supplier_reference: string | null;
  currency: string;
  notes: string | null;
  created_by: string | null;
  created_at: Date;
  submitted_at: Date | null;
  submitted_by: string | null;
  received_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
};

const PO_COLUMNS = `id, po_number, supplier_id, status::text, expected_at::text, supplier_reference,
  currency, notes, created_by, created_at, submitted_at, submitted_by, received_at, cancelled_at,
  cancelled_by, cancellation_reason`;

/** public.create_purchase_order as whoever `tx` is. */
export async function createPO(
  tx: pg.Client,
  a: {
    id?: string;
    supplierId: string;
    expectedAt?: string | null;
    reference?: string | null;
    notes?: string | null;
  },
): Promise<PurchaseOrderRow> {
  const { rows } = await tx.query<PurchaseOrderRow>(
    `select ${PO_COLUMNS} from public.create_purchase_order($1, $2, $3, $4, $5)`,
    [
      a.id ?? randomUUID(),
      a.supplierId,
      a.expectedAt ?? null,
      a.reference ?? null,
      a.notes ?? null,
    ],
  );
  return rows[0];
}

/** public.update_purchase_order as whoever `tx` is. */
export async function updatePO(
  tx: pg.Client,
  a: {
    poId: string;
    supplierId: string;
    expectedAt?: string | null;
    reference?: string | null;
    notes?: string | null;
  },
): Promise<PurchaseOrderRow> {
  const { rows } = await tx.query<PurchaseOrderRow>(
    `select ${PO_COLUMNS} from public.update_purchase_order($1, $2, $3, $4, $5)`,
    [a.poId, a.supplierId, a.expectedAt ?? null, a.reference ?? null, a.notes ?? null],
  );
  return rows[0];
}

/** public.submit_purchase_order as whoever `tx` is. */
export async function submitPO(tx: pg.Client, poId: string): Promise<PurchaseOrderRow> {
  const { rows } = await tx.query<PurchaseOrderRow>(
    `select ${PO_COLUMNS} from public.submit_purchase_order($1)`,
    [poId],
  );
  return rows[0];
}

/** public.cancel_purchase_order as whoever `tx` is. */
export async function cancelPO(
  tx: pg.Client,
  poId: string,
  reason: string | null = "Supplier discontinued it",
): Promise<PurchaseOrderRow> {
  const { rows } = await tx.query<PurchaseOrderRow>(
    `select ${PO_COLUMNS} from public.cancel_purchase_order($1, $2)`,
    [poId, reason],
  );
  return rows[0];
}

/** The PO as the owner reads it. */
export async function purchaseOrder(tx: pg.Client, poId: string): Promise<PurchaseOrderRow> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<PurchaseOrderRow>(`select ${PO_COLUMNS} from public.purchase_orders where id = $1`, [
      poId,
    ]),
  );
  return rows[0];
}

export type LineRow = {
  id: string;
  purchase_order_id: string;
  product_id: string;
  quantity_ordered: number;
  unit_cost: string;
  currency: string;
  ordered_total: string;
  expected_at: string | null;
  notes: string | null;
};

/** public.set_purchase_order_line as whoever `tx` is. */
export async function setLine(
  tx: pg.Client,
  a: {
    id?: string;
    poId: string;
    productId: string;
    quantity: number;
    cost?: string;
    expectedAt?: string | null;
    notes?: string | null;
    reason?: string | null;
  },
): Promise<LineRow> {
  const { rows } = await tx.query<LineRow>(
    `select id, purchase_order_id, product_id, quantity_ordered, unit_cost::text, currency,
            ordered_total::text, expected_at::text, notes
       from public.set_purchase_order_line($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      a.id ?? randomUUID(),
      a.poId,
      a.productId,
      a.quantity,
      a.cost ?? "7.50",
      a.expectedAt ?? null,
      a.notes ?? null,
      a.reason ?? null,
    ],
  );
  return rows[0];
}

/** public.remove_purchase_order_line as whoever `tx` is; the removed rows' ids. */
export async function removeLine(
  tx: pg.Client,
  lineId: string,
  reason: string | null = null,
): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    "select id from public.remove_purchase_order_line($1, $2)",
    [lineId, reason],
  );
  return rows.map((r) => r.id);
}

export type ReceiveLine = {
  lineId: string;
  quantity: number | string;
  locationId?: string;
  /** Omitted: the PO line's cost. */
  cost?: string | null;
};

export type ReceiptRow = {
  id: string;
  purchase_order_id: string;
  idempotency_key: string;
  reference: string | null;
  received_at: Date;
  received_by: string;
  created_at: Date;
};

/** The JSON lines receive_purchase takes. */
export function receiptLines(lines: readonly ReceiveLine[]) {
  return lines.map((l) => ({
    purchase_order_line_id: l.lineId,
    quantity_received: l.quantity,
    location_id: l.locationId ?? LOCATION.shopFloor,
    ...(l.cost === undefined ? {} : { unit_cost_actual: l.cost }),
  }));
}

/** public.receive_purchase as whoever `tx` is. */
export async function receive(
  tx: pg.Client,
  a: {
    poId: string;
    key?: string;
    lines: readonly ReceiveLine[] | unknown;
    reference?: string | null;
    receivedAt?: string | Date | null;
    notes?: string | null;
  },
): Promise<ReceiptRow> {
  // ReceiveLine[] is converted; anything else is sent as given (malformed input tests).
  const json =
    Array.isArray(a.lines) && a.lines.every((l) => typeof l === "object" && l && "lineId" in l)
      ? receiptLines(a.lines as ReceiveLine[])
      : a.lines;
  const { rows } = await tx.query<ReceiptRow>(
    `select id, purchase_order_id, idempotency_key, reference, received_at, received_by, created_at
       from public.receive_purchase($1, $2, $3::jsonb, $4, $5, $6)`,
    [
      a.poId,
      a.key ?? randomUUID(),
      JSON.stringify(json),
      a.reference ?? null,
      a.receivedAt ?? null,
      a.notes ?? null,
    ],
  );
  return rows[0];
}

export type ProgressRow = {
  purchase_order_line_id: string;
  product_id: string;
  po_status: string;
  quantity_ordered: number;
  quantity_received: number;
  quantity_outstanding: number;
  quantity_cancelled: number;
  expected_at: string | null;
  last_received_at: Date | null;
  is_overdue: boolean;
};

/** reporting.purchase_order_progress rows of a PO, as whoever `tx` is. */
export async function progress(tx: pg.Client, poId: string): Promise<ProgressRow[]> {
  const { rows } = await tx.query<ProgressRow>(
    `select purchase_order_line_id, product_id, po_status::text, quantity_ordered, quantity_received,
            quantity_outstanding, quantity_cancelled, expected_at::text, last_received_at, is_overdue
       from reporting.purchase_order_progress where purchase_order_id = $1
      order by purchase_order_line_id`,
    [poId],
  );
  return rows;
}

export type PoEventRow = {
  event_type: string;
  purchase_order_line_id: string | null;
  purchase_receipt_id: string | null;
  payload: Record<string, unknown>;
  reason: string | null;
  actor_staff_id: string | null;
  correlation_id: string | null;
};

/** A PO's history, oldest first (read as the owner). */
export async function poEvents(tx: pg.Client, poId: string): Promise<PoEventRow[]> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<PoEventRow>(
      `select event_type::text, purchase_order_line_id, purchase_receipt_id, payload, reason,
              actor_staff_id, correlation_id
         from public.purchase_order_events where purchase_order_id = $1 order by created_at, id`,
      [poId],
    ),
  );
  return rows;
}

/** Product cost as the owner reads it. */
export async function productCost(tx: pg.Client, productId: string): Promise<string | null> {
  return readAsOwner(tx, () =>
    scalar<string | null>(
      tx,
      "select default_direct_cost::text from public.products where id = $1",
      [productId],
    ),
  );
}

/** The supplier link as the owner reads it (null when there is none). */
export async function supplierLink(tx: pg.Client, supplierId: string, productId: string) {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<{
      last_unit_cost: string | null;
      last_received_at: Date | null;
      currency: string;
      preferred: boolean;
    }>(
      `select last_unit_cost::text, last_received_at, currency, preferred
         from public.supplier_products where supplier_id = $1 and product_id = $2`,
      [supplierId, productId],
    ),
  );
  return rows[0] ?? null;
}

/** Moves a PO's submitted_at back (owner update; writes no event), so receipts can be back-dated. */
export async function backdateSubmission(tx: pg.Client, poId: string, interval = "40 days") {
  await readAsOwner(tx, () =>
    tx.query(
      `update public.purchase_orders set submitted_at = now() - $2::interval
        where id = $1 and submitted_at is not null`,
      [poId, interval],
    ),
  );
}

export type OpenPO = {
  supplierId: string;
  productId: string;
  poId: string;
  lineId: string;
  poNumber: string;
};

/**
 * A supplier, a product (owner rows) and a submitted PO with one line of
 * `quantity` at `cost`, created as `claims` (the admin by default); `tx`
 * is left acting as `claims`.
 */
export async function openPO(
  tx: pg.Client,
  {
    quantity = 20,
    cost = "7.50",
    product = {},
    supplierId,
    productId,
    claims = ADMIN,
    submit = true,
    backdate = true,
  }: {
    quantity?: number;
    cost?: string;
    product?: ProductOptions;
    supplierId?: string;
    productId?: string;
    claims?: Claims;
    submit?: boolean;
    /** Move submitted_at back 40 days, so back-dated receipts are allowed. */
    backdate?: boolean;
  } = {},
): Promise<OpenPO> {
  await ownerMode(tx);
  const sid = supplierId ?? (await makeSupplier(tx));
  const pid = productId ?? (await makeProduct(tx, product));
  await actAs(tx, claims);
  const po = await createPO(tx, { supplierId: sid });
  const line = await setLine(tx, { poId: po.id, productId: pid, quantity, cost });
  if (submit) {
    await submitPO(tx, po.id);
    if (backdate) await backdateSubmission(tx, po.id);
  }
  return { supplierId: sid, productId: pid, poId: po.id, lineId: line.id, poNumber: po.po_number };
}
