/**
 * The shared consignment DB fixture module (Phase 6), built on
 * tests/db/inventory-fixtures.ts (onHand, newJob, addPart, completeJob,
 * reopenJob, movements, unit, publishProduct, publicItems come from there).
 * Later Phase 6 steps (sales, settlements) extend it rather than recreate it.
 *
 *   * createConsignor inserts as whoever `tx` is (a consignors INSERT is a
 *     column grant for manage_consignments; the owner may insert too).
 *   * The RPC helpers (intakeUnique, intakeQuantity, updateTerms, addCharge,
 *     voidCharge, returnItem) call the public RPCs as whoever `tx` is, the
 *     admin unless a test switched identity.
 *   * itemPosition, itemRow and itemEvents read as the owner (the position
 *     view has no API grant; the agreed amount and the history are
 *     consignment money).
 *   * staffWith creates a staff member holding exactly the given permissions
 *     (owner inserts), for tests of one permission at a time.
 *
 *   * Step 2 (sales and settlements): recordSale, restock, refund, settle and
 *     reverse call the public RPCs as whoever `tx` is; saleLines,
 *     itemLedger and consignorLedger read as the owner (costs, payouts and
 *     the ledger views have no API grant).
 *
 * Intake consumes the C, P and U short-ID sequences and a sale the S
 * sequence, so tests that use these skip in existing-database mode
 * (isolatedDatabase()).
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";

import { LOCATION } from "../fixtures/ids";
import { createAuthUser } from "./customer-fixtures";
import { scalar, staffClaims, type Claims } from "./harness";
import { readAsOwner } from "./inventory-fixtures";

export type ItemResult = {
  item_id: string;
  short_id: string;
  status: string;
  product_id: string;
  inventory_unit_id: string | null;
};

const ITEM_RESULT = `(r).item_id, (r).short_id, (r).status::text, (r).product_id, (r).inventory_unit_id`;

/** A consignor, inserted as whoever `tx` is; returns its id. */
export async function createConsignor(
  tx: pg.Client,
  overrides: {
    id?: string;
    displayName?: string;
    customerId?: string | null;
    email?: string | null;
    phone?: string | null;
    payoutDetails?: string | null;
  } = {},
): Promise<string> {
  const id = overrides.id ?? randomUUID();
  await tx.query(
    `insert into public.consignors (id, display_name, customer_id, email, phone, payout_details)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      overrides.displayName ?? `Consignor ${id.slice(0, 8)}`,
      overrides.customerId ?? null,
      overrides.email ?? null,
      overrides.phone ?? null,
      overrides.payoutDetails ?? null,
    ],
  );
  return id;
}

export type UniqueIntake = {
  itemId?: string;
  consignorId: string;
  agreed: string;
  asking?: string | null;
  productId?: string | null;
  productName?: string | null;
  locationId?: string;
  serial?: string | null;
  condition?: string | null;
  receivedAt?: string | null;
  newProductId?: string | null;
  newUnitId?: string | null;
  bikeId?: string | null;
  quantity?: number;
};

/** public.create_consignment_item for a unique item, as whoever `tx` is. */
export async function intakeUnique(tx: pg.Client, a: UniqueIntake): Promise<ItemResult> {
  const { rows } = await tx.query<ItemResult>(
    `select ${ITEM_RESULT} from (
       select public.create_consignment_item(
         item_id => $1, consignor_id => $2, location_id => $3, agreed_amount_owed => $4,
         asking_price => $5, product_id => $6, product_name => $7, tracking_type => 'unique',
         quantity => $8, serial_number => $9, condition => $10, received_at => $11,
         new_product_id => $12, new_unit_id => $13, bike_id => $14
       ) r
     ) s`,
    [
      a.itemId ?? randomUUID(),
      a.consignorId,
      a.locationId ?? LOCATION.shopFloor,
      a.agreed,
      a.asking === undefined ? "1000.00" : a.asking,
      a.productId ?? null,
      a.productId ? null : (a.productName ?? `Consigned bike ${randomUUID().slice(0, 8)}`),
      a.quantity ?? 1,
      a.serial ?? null,
      a.condition ?? null,
      a.receivedAt ?? null,
      a.newProductId ?? null,
      a.newUnitId ?? null,
      a.bikeId ?? null,
    ],
  );
  return rows[0];
}

export type QuantityIntake = {
  itemId?: string;
  consignorId: string;
  agreed: string;
  asking?: string | null;
  quantity: number;
  productId?: string | null;
  productName?: string | null;
  locationId?: string;
  receivedAt?: string | null;
  newProductId?: string | null;
};

/** public.create_consignment_item for a quantity, as whoever `tx` is. */
export async function intakeQuantity(tx: pg.Client, a: QuantityIntake): Promise<ItemResult> {
  const { rows } = await tx.query<ItemResult>(
    `select ${ITEM_RESULT} from (
       select public.create_consignment_item(
         item_id => $1, consignor_id => $2, location_id => $3, agreed_amount_owed => $4,
         asking_price => $5, product_id => $6, product_name => $7, tracking_type => 'quantity',
         quantity => $8, received_at => $9, new_product_id => $10
       ) r
     ) s`,
    [
      a.itemId ?? randomUUID(),
      a.consignorId,
      a.locationId ?? LOCATION.shopFloor,
      a.agreed,
      a.asking === undefined ? "30.00" : a.asking,
      a.productId ?? null,
      a.productId ? null : (a.productName ?? `Consigned jersey ${randomUUID().slice(0, 8)}`),
      a.quantity,
      a.receivedAt ?? null,
      a.newProductId ?? null,
    ],
  );
  return rows[0];
}

/** public.update_consignment_terms as whoever `tx` is. */
export async function updateTerms(
  tx: pg.Client,
  itemId: string,
  terms: { agreed?: string | null; asking?: string | null; reason?: string | null },
): Promise<ItemResult> {
  const { rows } = await tx.query<ItemResult>(
    `select ${ITEM_RESULT} from (select public.update_consignment_terms($1, $2, $3, $4) r) s`,
    [itemId, terms.agreed ?? null, terms.asking ?? null, terms.reason ?? null],
  );
  return rows[0];
}

export type ChargeRow = {
  id: string;
  consignment_item_id: string;
  description: string;
  amount: string;
  bearer: string;
  work_order_id: string | null;
  voided_at: Date | null;
  void_reason: string | null;
};

/** public.add_consignment_charge as whoever `tx` is. */
export async function addCharge(
  tx: pg.Client,
  a: {
    chargeId?: string;
    itemId: string;
    description?: string;
    amount: string;
    bearer: "consignor" | "shop" | null;
    workOrderId?: string | null;
  },
): Promise<ChargeRow> {
  const { rows } = await tx.query<ChargeRow>(
    `select (c).id, (c).consignment_item_id, (c).description, (c).amount::text, (c).bearer::text,
            (c).work_order_id, (c).voided_at, (c).void_reason
       from (select public.add_consignment_charge($1, $2, $3, $4, $5, $6) c) s`,
    [
      a.chargeId ?? randomUUID(),
      a.itemId,
      a.description ?? "New tyres",
      a.amount,
      a.bearer,
      a.workOrderId ?? null,
    ],
  );
  return rows[0];
}

/** public.void_consignment_charge as whoever `tx` is. */
export async function voidCharge(
  tx: pg.Client,
  chargeId: string,
  reason: string | null = "Entered twice",
): Promise<ChargeRow> {
  const { rows } = await tx.query<ChargeRow>(
    `select (c).id, (c).consignment_item_id, (c).description, (c).amount::text, (c).bearer::text,
            (c).work_order_id, (c).voided_at, (c).void_reason
       from (select public.void_consignment_charge($1, $2) c) s`,
    [chargeId, reason],
  );
  return rows[0];
}

/** public.return_consignment_item as whoever `tx` is. */
export async function returnItem(
  tx: pg.Client,
  a: {
    returnId?: string;
    itemId: string;
    reason?: string | null;
    quantity?: number | null;
    locationId?: string | null;
  },
): Promise<ItemResult> {
  const { rows } = await tx.query<ItemResult>(
    `select ${ITEM_RESULT} from (select public.return_consignment_item($1, $2, $3, $4, $5) r) s`,
    [
      a.returnId ?? randomUUID(),
      a.itemId,
      a.reason === undefined ? "Consignor collected it" : a.reason,
      a.quantity ?? null,
      a.locationId ?? null,
    ],
  );
  return rows[0];
}

export type Position = {
  quantity: number;
  sold_qty: number;
  restocked_qty: number;
  job_held_qty: number;
  job_sold_qty: number;
  returned_qty: number;
  remaining_qty: number;
  owed_qty: number;
  liability: string;
  consignor_charges: string;
  shop_charges: string;
  last_sale_at: Date | null;
  last_returned_at: Date | null;
};

/** The item's row of reporting.consignment_item_position (read as the owner). */
export async function itemPosition(tx: pg.Client, itemId: string): Promise<Position> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<Position>(
      `select quantity, sold_qty, restocked_qty, job_held_qty, job_sold_qty, returned_qty, remaining_qty,
              owed_qty, liability::text, consignor_charges::text, shop_charges::text, last_sale_at,
              last_returned_at
         from reporting.consignment_item_position where consignment_item_id = $1`,
      [itemId],
    ),
  );
  return rows[0];
}

export type ItemRow = {
  id: string;
  short_id: string;
  consignor_id: string;
  product_id: string;
  inventory_unit_id: string | null;
  quantity: number;
  agreed_amount_owed: string;
  asking_price: string | null;
  status: string;
  sold_at: Date | null;
  returned_at: Date | null;
  return_reason: string | null;
};

/** The item row, agreed amount included (read as the owner). */
export async function itemRow(tx: pg.Client, itemId: string): Promise<ItemRow> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<ItemRow>(
      `select id, short_id, consignor_id, product_id, inventory_unit_id, quantity,
              agreed_amount_owed::text, asking_price::text, status::text, sold_at, returned_at, return_reason
         from public.consignment_items where id = $1`,
      [itemId],
    ),
  );
  return rows[0];
}

/** The item's status (read as the owner). */
export const itemStatus = async (tx: pg.Client, itemId: string) =>
  (await itemRow(tx, itemId)).status;

/** The item's history, oldest first (read as the owner). */
export async function itemEvents(tx: pg.Client, itemId: string) {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<{
      event_type: string;
      payload: Record<string, unknown>;
      reason: string | null;
      actor_staff_id: string | null;
    }>(
      `select event_type::text, payload, reason, actor_staff_id
         from public.consignment_item_events where consignment_item_id = $1 order by created_at, id`,
      [itemId],
    ),
  );
  return rows;
}

/** A consigned item's movements with their item and sale-line links (owner). */
export async function itemMovements(tx: pg.Client, productId: string) {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<{
      id: string;
      movement_type: string;
      quantity_delta: number;
      location_id: string;
      inventory_unit_id: string | null;
      consignment_item_id: string | null;
      reversal_of_id: string | null;
      request_id: string | null;
      unit_cost_snapshot: string | null;
      reason: string | null;
    }>(
      `select id::text, movement_type::text, quantity_delta, location_id, inventory_unit_id,
              consignment_item_id, reversal_of_id::text, request_id, unit_cost_snapshot::text, reason
         from public.inventory_movements where product_id = $1 order by id`,
      [productId],
    ),
  );
  return rows;
}

/** private.selling_price, read as the owner. */
export async function sellingPrice(
  tx: pg.Client,
  productId: string,
  unitId: string | null = null,
): Promise<string | null> {
  return readAsOwner(tx, () =>
    scalar<string | null>(tx, "select private.selling_price($1, $2)::text", [productId, unitId]),
  );
}

/**
 * A new active staff member holding exactly `permissions` (owner inserts);
 * returns their claims and staff id. Call it before actAs(), or after
 * ownerMode().
 */
export async function staffWith(
  tx: pg.Client,
  permissions: string[],
): Promise<{ claims: Claims; staffId: string }> {
  const email = `staff-${randomUUID().slice(0, 8)}@bicii.test`;
  const authUserId = await createAuthUser(tx, email);
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.staff (auth_user_id, display_name, email, role, active)
     values ($1, $2, $3, 'mechanic', true) returning id`,
    [authUserId, `Staff ${email}`, email],
  );
  for (const permission of permissions) {
    await tx.query("insert into public.staff_permissions (staff_id, permission) values ($1, $2)", [
      rows[0].id,
      permission,
    ]);
  }
  return { claims: staffClaims(authUserId), staffId: rows[0].id };
}

// ---------------------------------------------------------------------------
// Sales, restocks and refunds (Phase 6 step 2)
// ---------------------------------------------------------------------------

/** A sale line as record_retail_sale takes it (D45: a quantity line may name its item). */
export type SaleLineInput =
  | { inventory_unit_id: string; unit_sale_price?: string | number | null }
  | {
      product_id: string;
      location_id?: string;
      quantity: number | string;
      consignment_item_id?: string | null;
      unit_sale_price?: string | number | null;
    };

export type SaleResult = {
  sale_id: string;
  sale_number: string;
  status: string;
  recognized_at: Date;
  replayed: boolean;
};

/** public.record_retail_sale as whoever `tx` is (a fresh sale id unless given). */
export async function recordSale(
  tx: pg.Client,
  a: {
    saleId?: string;
    lines: SaleLineInput[] | unknown;
    customerId?: string | null;
    recognizedAt?: string | Date | null;
    notes?: string | null;
  },
): Promise<SaleResult> {
  const lines = Array.isArray(a.lines)
    ? a.lines.map((l) =>
        "product_id" in (l as object) && !("location_id" in (l as object))
          ? { ...(l as object), location_id: LOCATION.shopFloor }
          : l,
      )
    : a.lines;
  const { rows } = await tx.query<SaleResult>(
    `select (r).sale_id, (r).sale_number, (r).status::text, (r).recognized_at, (r).replayed
       from (select public.record_retail_sale($1, $2::jsonb, $3, $4, $5) r) s`,
    [
      a.saleId ?? randomUUID(),
      lines === null ? null : JSON.stringify(lines),
      a.customerId ?? null,
      a.recognizedAt ?? null,
      a.notes ?? null,
    ],
  );
  return rows[0];
}

export type SaleLineRow = {
  id: string;
  sale_id: string;
  line_number: number;
  product_id: string;
  inventory_unit_id: string | null;
  consignment_item_id: string | null;
  description_snapshot: string;
  quantity: string;
  unit_sale_price_snapshot: string;
  unit_direct_cost_snapshot: string;
  consignor_payout_snapshot: string | null;
  cult_commons_rate_snapshot: string;
  sale_total: string;
  cost_total: string;
  yield_total: string;
  cult_commons_share: string;
  shopify_line_item_id: string | null;
  restocked_at: Date | null;
  restocked_by: string | null;
};

/** A sale's lines in line order, every column (read as the owner). */
export async function saleLines(tx: pg.Client, saleId: string): Promise<SaleLineRow[]> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<SaleLineRow>(
      `select id, sale_id, line_number, product_id, inventory_unit_id, consignment_item_id,
              description_snapshot, quantity::text, unit_sale_price_snapshot::text,
              unit_direct_cost_snapshot::text, consignor_payout_snapshot::text,
              cult_commons_rate_snapshot::text, sale_total::text, cost_total::text, yield_total::text,
              cult_commons_share::text, shopify_line_item_id, restocked_at, restocked_by
         from public.sale_lines where sale_id = $1 order by line_number`,
      [saleId],
    ),
  );
  return rows;
}

/** public.restock_unit as whoever `tx` is. */
export async function restock(
  tx: pg.Client,
  a: { unitId: string; saleLineId: string; locationId?: string | null; reason?: string | null },
): Promise<{ unit_id: string; status: string }> {
  const { rows } = await tx.query<{ unit_id: string; status: string }>(
    "select (r).unit_id, (r).status::text from (select public.restock_unit($1, $2, $3, $4) r) s",
    [
      a.unitId,
      a.saleLineId,
      a.locationId ?? null,
      a.reason === undefined ? "Customer changed their mind" : a.reason,
    ],
  );
  return rows[0];
}

export type RefundRow = {
  id: string;
  sale_id: string;
  amount: string;
  reason: string;
  restocked: boolean;
  recorded_by: string | null;
};

/** public.record_sale_refund as whoever `tx` is (a fresh refund id unless given). */
export async function refund(
  tx: pg.Client,
  a: { refundId?: string; saleId: string; amount: string | number; reason?: string | null },
): Promise<RefundRow> {
  const { rows } = await tx.query<RefundRow>(
    `select (r).id, (r).sale_id, (r).amount::text, (r).reason, (r).restocked, (r).recorded_by
       from (select public.record_sale_refund($1, $2, $3, $4) r) s`,
    [
      a.refundId ?? randomUUID(),
      a.saleId,
      a.amount,
      a.reason === undefined ? "Customer returned it" : a.reason,
    ],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Settlements and the ledgers (Phase 6 step 2)
// ---------------------------------------------------------------------------

export type Allocation = {
  consignment_item_id: string;
  amount: string | number;
  override_reason?: string | null;
};

export type SettlementResult = {
  settlement_id: string;
  consignor_id: string;
  amount: string;
  paid_at: Date;
  replayed: boolean;
};

/** public.record_settlement as whoever `tx` is (a fresh settlement id unless given). */
export async function settle(
  tx: pg.Client,
  a: {
    settlementId?: string;
    consignorId: string;
    amount: string | number;
    allocations: Allocation[] | unknown;
    paidAt?: string | Date | null;
    reference?: string | null;
    notes?: string | null;
  },
): Promise<SettlementResult> {
  const { rows } = await tx.query<SettlementResult>(
    `select (r).settlement_id, (r).consignor_id, (r).amount::text, (r).paid_at, (r).replayed
       from (select public.record_settlement($1, $2, $3, $4::jsonb, $5, $6, $7) r) s`,
    [
      a.settlementId ?? randomUUID(),
      a.consignorId,
      a.amount,
      a.allocations === null ? null : JSON.stringify(a.allocations),
      a.paidAt ?? null,
      a.reference ?? null,
      a.notes ?? null,
    ],
  );
  return rows[0];
}

/** public.reverse_settlement as whoever `tx` is (a fresh reversal id unless given). */
export async function reverseSettlement(
  tx: pg.Client,
  a: { reversalId?: string; settlementId: string; reason?: string | null },
): Promise<{ id: string; settlement_id: string; reason: string }> {
  const { rows } = await tx.query<{ id: string; settlement_id: string; reason: string }>(
    `select (r).id, (r).settlement_id, (r).reason
       from (select public.reverse_settlement($1, $2, $3) r) s`,
    [
      a.reversalId ?? randomUUID(),
      a.settlementId,
      a.reason === undefined ? "Entered twice" : a.reason,
    ],
  );
  return rows[0];
}

export type ItemLedger = Position & {
  short_id: string;
  status: string;
  owed: string;
  paid: string;
  outstanding: string;
  last_settlement_at: Date | null;
};

/** The item's row of reporting.consignor_item_ledger (read as the owner). */
export async function itemLedger(tx: pg.Client, itemId: string): Promise<ItemLedger> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<ItemLedger>(
      `select quantity, sold_qty, restocked_qty, job_held_qty, job_sold_qty, returned_qty, remaining_qty,
              owed_qty, liability::text, consignor_charges::text, shop_charges::text, last_sale_at,
              last_returned_at, short_id, status::text, owed::text, paid::text, outstanding::text,
              last_settlement_at
         from reporting.consignor_item_ledger where consignment_item_id = $1`,
      [itemId],
    ),
  );
  return rows[0];
}

export type ConsignorLedger = {
  items_total: number;
  active_items: number;
  awaiting_settlement_items: number;
  returned_items: number;
  sold_items: number;
  liability: string;
  consignor_charges: string;
  owed: string;
  paid: string;
  outstanding: string;
};

/** The consignor's row of reporting.consignor_ledger (read as the owner), money fixed-2. */
export async function consignorLedger(
  tx: pg.Client,
  consignorId: string,
): Promise<ConsignorLedger> {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<ConsignorLedger>(
      `select items_total, active_items, awaiting_settlement_items, returned_items, sold_items,
              to_char(liability, 'FM9999999990.00') as liability,
              to_char(consignor_charges, 'FM9999999990.00') as consignor_charges,
              to_char(owed, 'FM9999999990.00') as owed,
              to_char(paid, 'FM9999999990.00') as paid,
              to_char(outstanding, 'FM9999999990.00') as outstanding
         from reporting.consignor_ledger where consignor_id = $1`,
      [consignorId],
    ),
  );
  return rows[0];
}
