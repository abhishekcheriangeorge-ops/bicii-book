/**
 * The shared inventory DB fixture module (Phase 4), built on
 * tests/db/workshop-fixtures.ts, which it re-exports in part. Later phases
 * (6 sales and consignment, 7 purchasing, 10 Shopify) extend it rather than
 * recreate it.
 *
 *   * `make*` helpers insert as the connection's owner (superuser): call them
 *     before actAs(), or after ownerMode(). makeUnit is the exception: it
 *     calls create_unique_unit, so it runs as whoever `tx` currently is (the
 *     admin by default via `asAdminInTx`).
 *   * The RPC helpers (addStock, addPart, transfer, writeOff) call the public
 *     RPCs as whoever `tx` currently is.
 *   * assertLedgerConsistent() runs the deferred unit-consistency checks
 *     now: call it at the end of every ledger test before the rollback
 *     (deferred checks never fire in a rolled-back transaction).
 *
 * Creating a product, unit, bike or job consumes a short-ID sequence, so
 * tests that use these skip in existing-database mode (isolatedDatabase()).
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";

import { AUTH_USER, LOCATION } from "../fixtures/ids";
import { attachmentPath } from "./customer-fixtures";
import { actAs, inTransaction, scalar, staffClaims, type Claims } from "./harness";
import {
  createWorkOrder,
  makeCustomerWithBike,
  ownerMode,
  setStatus,
  type WorkOrderRow,
} from "./workshop-fixtures";

export const ADMIN = staffClaims(AUTH_USER.admin);
export const MECHANIC1 = staffClaims(AUTH_USER.mechanic1);
export const MECHANIC2 = staffClaims(AUTH_USER.mechanic2);

export type Outcome<T> =
  { ok: true; value: T } | { ok: false; error: { code?: string; message?: string } };

/**
 * Runs `fn` as `claims` (the admin by default) on `c` in a COMMITTED
 * transaction; resolves to its result or its error. For concurrency tests
 * (isolatedDatabase() only).
 */
export function committed<T>(
  c: pg.Client,
  fn: (tx: pg.Client) => Promise<T>,
  claims: Claims = ADMIN,
): Promise<Outcome<T>> {
  return inTransaction(
    c,
    async (tx) => {
      await actAs(tx, claims);
      return fn(tx);
    },
    { commit: true },
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: { code?: string; message?: string }) => ({ ok: false as const, error }),
  );
}

/** Runs the deferred constraint triggers (unit ledger consistency) now. */
export async function assertLedgerConsistent(tx: pg.Client): Promise<void> {
  await tx.query("set constraints all immediate");
  await tx.query("set constraints all deferred");
}

/** A new active location (owner insert); returns its id. */
export async function makeLocation(
  tx: pg.Client,
  {
    name = `Loc ${randomUUID().slice(0, 8)}`,
    sortOrder = 100,
    active = true,
  }: { name?: string; sortOrder?: number; active?: boolean } = {},
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    "insert into public.locations (name, kind, sort_order, active) values ($1, 'storage', $2, $3) returning id",
    [name, sortOrder, active],
  );
  return rows[0].id;
}

export type ProductOptions = {
  id?: string;
  name?: string;
  tracking?: "quantity" | "unique";
  price?: string | null;
  cost?: string | null;
  reorderPoint?: number | null;
  sku?: string | null;
  publication?: "draft" | "internal_only";
  active?: boolean;
};

/** A new product (owner insert), internal_only by default; returns its id. */
export async function makeProduct(tx: pg.Client, o: ProductOptions = {}): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.products
       (id, name, tracking_type, default_sale_price, default_direct_cost, reorder_point, sku,
        publication_status, active)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [
      o.id ?? randomUUID(),
      o.name ?? `Part ${randomUUID().slice(0, 8)}`,
      o.tracking ?? "quantity",
      o.price === undefined ? "20.00" : o.price,
      o.cost === undefined ? "8.00" : o.cost,
      o.reorderPoint ?? null,
      o.sku ?? null,
      o.publication ?? "internal_only",
      o.active ?? true,
    ],
  );
  return rows[0].id;
}

export type MovementResult = { movement_id: string; on_hand: number };

/** public.adjust_stock as whoever `tx` is (a fresh request id unless given). */
export async function addStock(
  tx: pg.Client,
  productId: string,
  quantity: number,
  {
    locationId = LOCATION.shopFloor,
    requestId = randomUUID(),
    type = "stock_adjustment",
    reason = "Stock count",
    unitCost = null,
  }: {
    locationId?: string;
    requestId?: string;
    type?: string;
    reason?: string | null;
    unitCost?: string | null;
  } = {},
): Promise<MovementResult> {
  const { rows } = await tx.query<MovementResult>(
    "select movement_id::text, on_hand from public.adjust_stock($1, $2, $3, $4, $5, $6, $7)",
    [requestId, productId, locationId, quantity, type, reason, unitCost],
  );
  return rows[0];
}

/** public.create_unique_unit as whoever `tx` is; returns {unit_id, short_id}. */
export async function makeUnit(
  tx: pg.Client,
  productId: string,
  {
    unitId = randomUUID(),
    locationId = LOCATION.shopFloor,
    serial = null,
    condition = null,
    price = null,
    cost = null,
    bikeId = null,
  }: {
    unitId?: string;
    locationId?: string;
    serial?: string | null;
    condition?: string | null;
    price?: string | null;
    cost?: string | null;
    bikeId?: string | null;
  } = {},
): Promise<{ unit_id: string; short_id: string }> {
  const { rows } = await tx.query<{ unit_id: string; short_id: string }>(
    `select (r).unit_id, (r).short_id from (
       select public.create_unique_unit($1, $2, $3, $4, $5, $6, $7, $8) r
     ) s`,
    [unitId, productId, locationId, serial, condition, price, cost, bikeId],
  );
  return rows[0];
}

/** A unique product with one available unit (owner product, unit as the admin). */
export async function makeUniqueWithUnit(
  tx: pg.Client,
  o: ProductOptions & { unitPrice?: string | null; unitCost?: string | null } = {},
): Promise<{ productId: string; unitId: string; unitShortId: string }> {
  await ownerMode(tx);
  const productId = await makeProduct(tx, { ...o, tracking: "unique" });
  await actAs(tx, ADMIN);
  const unit = await makeUnit(tx, productId, {
    price: o.unitPrice ?? null,
    cost: o.unitCost ?? null,
  });
  return { productId, unitId: unit.unit_id, unitShortId: unit.short_id };
}

export type PartResult = {
  line_id: string;
  movement_id: string | null;
  location_id: string | null;
  on_hand_after: number | null;
  replayed: boolean;
};

/** public.add_inventory_line as whoever `tx` is. */
export async function addPart(
  tx: pg.Client,
  a: {
    lineId?: string;
    workOrderId: string;
    productId: string;
    quantity?: number;
    locationId?: string | null;
    unitId?: string | null;
    price?: string | null;
  },
): Promise<PartResult> {
  const { rows } = await tx.query<PartResult>(
    `select (r).line_id, (r).movement_id::text, (r).location_id, (r).on_hand_after, (r).replayed
       from (select public.add_inventory_line($1, $2, $3, $4, $5, $6, $7) r) s`,
    [
      a.lineId ?? randomUUID(),
      a.workOrderId,
      a.productId,
      a.quantity ?? 1,
      a.locationId ?? null,
      a.unitId ?? null,
      a.price ?? null,
    ],
  );
  return rows[0];
}

/** public.transfer_stock as whoever `tx` is; returns its rows. */
export async function transfer(
  tx: pg.Client,
  a: {
    requestId?: string;
    productId: string;
    from: string;
    to: string;
    quantity?: number;
    reason?: string | null;
    unitId?: string | null;
  },
) {
  const { rows } = await tx.query<{
    movement_id: string;
    location_id: string;
    quantity_delta: number;
  }>(
    "select movement_id::text, location_id, quantity_delta from public.transfer_stock($1, $2, $3, $4, $5, $6, $7)",
    [
      a.requestId ?? randomUUID(),
      a.productId,
      a.from,
      a.to,
      a.quantity ?? 1,
      a.reason ?? null,
      a.unitId ?? null,
    ],
  );
  return rows;
}

/** public.write_off_unit as whoever `tx` is; returns {unit_id, status}. */
export async function writeOff(
  tx: pg.Client,
  unitId: string,
  {
    requestId = randomUUID(),
    reason = "Frame cracked",
  }: { requestId?: string; reason?: string | null } = {},
) {
  const { rows } = await tx.query<{ unit_id: string; status: string }>(
    "select (r).unit_id, (r).status from (select public.write_off_unit($1, $2, $3) r) s",
    [requestId, unitId, reason],
  );
  return rows[0];
}

/** A new open job (owner customer and bike, created as `claims`, the admin by default). */
export async function newJob(tx: pg.Client, claims = ADMIN): Promise<WorkOrderRow> {
  await ownerMode(tx);
  const ids = await makeCustomerWithBike(tx);
  await actAs(tx, claims);
  return createWorkOrder(tx, ids);
}

/** received/open → in_progress → completed as whoever `tx` is. */
export async function completeJob(tx: pg.Client, workOrderId: string): Promise<WorkOrderRow> {
  const status = await scalar<string>(
    tx,
    "select status::text from public.work_orders where id = $1",
    [workOrderId],
  );
  if (status !== "in_progress") await setStatus(tx, workOrderId, "in_progress");
  return setStatus(tx, workOrderId, "completed");
}

/** completed/ready → in_progress (a reopen, with its required reason). */
export async function reopenJob(tx: pg.Client, workOrderId: string): Promise<WorkOrderRow> {
  return setStatus(tx, workOrderId, "in_progress", "Customer reported a fault");
}

/** On-hand of a product at a location (the ledger sum), as the owner reads it. */
export async function onHand(
  tx: pg.Client,
  productId: string,
  locationId: string = LOCATION.shopFloor,
): Promise<number> {
  return scalar<number>(
    tx,
    `select coalesce(sum(quantity_delta), 0)::int from public.inventory_movements
      where product_id = $1 and location_id = $2`,
    [productId, locationId],
  );
}

export type UnitRow = {
  id: string;
  short_id: string;
  status: string;
  location_id: string;
  sold_at: Date | null;
  bike_id: string | null;
  archived_at: Date | null;
};

/** A unit's state (columns staff may read). */
export async function unit(tx: pg.Client, unitId: string): Promise<UnitRow> {
  const { rows } = await tx.query<UnitRow>(
    `select id, short_id, status::text, location_id, sold_at, bike_id, archived_at
       from public.inventory_units where id = $1`,
    [unitId],
  );
  return rows[0];
}

/** A product's publication status. */
export const publication = (tx: pg.Client, productId: string) =>
  scalar<string>(tx, "select publication_status::text from public.products where id = $1", [
    productId,
  ]);

/**
 * A photo of a product, unit or bike inserted as the owner (no storage
 * object needed for a direct insert); public unless `visibility` says
 * otherwise; `createdAt` backdates or postdates it. Returns its id.
 */
export async function addPublicPhoto(
  tx: pg.Client,
  entityType: "product" | "inventory_unit" | "bike",
  entityId: string,
  {
    visibility = "public",
    createdAt = null,
    caption = null,
    width = 1600,
    height = 1200,
  }: {
    visibility?: "public" | "internal";
    createdAt?: Date | string | null;
    caption?: string | null;
    width?: number | null;
    height?: number | null;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `insert into public.attachments
       (id, entity_type, entity_id, storage_bucket, storage_path, media_type, visibility, caption,
        width, height, created_at)
     values ($1, $2, $3, $4, $5, 'image/jpeg', $6, $7, $8, $9, coalesce($10::timestamptz, now()))`,
    [
      id,
      entityType,
      entityId,
      visibility === "public" ? "media-public" : "media-internal",
      attachmentPath(entityType, entityId, id),
      visibility,
      caption,
      width,
      height,
      createdAt,
    ],
  );
  return id;
}

/** Owner: publish a product by a direct UPDATE (the trigger enforces the machine and requirements). */
export async function publish(tx: pg.Client, productId: string): Promise<void> {
  await tx.query("update public.products set publication_status = 'public' where id = $1", [
    productId,
  ]);
}

export type PublicationResult = {
  product_id: string;
  publication_status: string;
  public_slug: string | null;
};

/** public.set_publication_status as whoever `tx` is. */
export async function setPublication(
  tx: pg.Client,
  productId: string,
  status: string,
  reason: string | null = null,
): Promise<PublicationResult> {
  const { rows } = await tx.query<PublicationResult>(
    `select (r).product_id, (r).publication_status::text, (r).public_slug
       from (select public.set_publication_status($1, $2, $3) r) s`,
    [productId, status, reason],
  );
  return rows[0];
}

/**
 * Publishes a product through set_publication_status as whoever `tx` is,
 * walking draft → internal_only first when needed.
 */
export async function publishProduct(tx: pg.Client, productId: string): Promise<PublicationResult> {
  const from = await publication(tx, productId);
  if (from === "draft" || from === "archived") await setPublication(tx, productId, "internal_only");
  return setPublication(tx, productId, "public");
}

export type SplitResult = {
  product_id: string;
  product_short_id: string;
  unit_id: string;
  unit_short_id: string;
};

/** public.split_unit_from_stock as whoever `tx` is (fresh ids unless given). */
export async function splitUnit(
  tx: pg.Client,
  a: {
    newProductId?: string;
    unitId?: string;
    sourceProductId: string;
    locationId?: string;
    name?: string;
    reason?: string | null;
    serial?: string | null;
    condition?: string | null;
    price?: string | null;
  },
): Promise<SplitResult> {
  const { rows } = await tx.query<SplitResult>(
    `select (r).product_id, (r).product_short_id, (r).unit_id, (r).unit_short_id
       from (select public.split_unit_from_stock($1, $2, $3, $4, $5, $6, $7, $8, $9) r) s`,
    [
      a.newProductId ?? randomUUID(),
      a.unitId ?? randomUUID(),
      a.sourceProductId,
      a.locationId ?? LOCATION.shopFloor,
      a.name ?? "Ex-display item",
      a.reason === undefined ? "Ex-display, sold on its own" : a.reason,
      a.serial ?? null,
      a.condition ?? null,
      a.price ?? null,
    ],
  );
  return rows[0];
}

export type PublicItem = {
  kind: "product" | "unit";
  short_id: string;
  slug: string | null;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  condition: string | null;
  sale_price: string | null;
  currency: string;
  availability: "available" | "sold_out" | "sold" | "unavailable";
  photos: { bucket: string; path: string; width: number; height: number; caption: string | null }[];
  updated_at: Date;
};

/** Every row of reporting.public_items as whoever `tx` is, by short ID. */
export async function publicItems(tx: pg.Client): Promise<PublicItem[]> {
  const { rows } = await tx.query<PublicItem>(
    "select * from reporting.public_items order by short_id",
  );
  return rows;
}

/**
 * Runs `fn` as the connection's owner, then returns to the API role `tx` was
 * acting as (the JWT claims are untouched), for reads of cost columns.
 */
export async function readAsOwner<T>(tx: pg.Client, fn: () => Promise<T>): Promise<T> {
  const role = await scalar<string>(tx, "select current_user::text");
  await tx.query("reset role");
  const owner = await scalar<string>(tx, "select current_user::text");
  try {
    return await fn();
  } finally {
    if (role !== owner) await tx.query(`set local role ${role}`);
  }
}

/** Movements of a product, oldest first (read as the owner, costs included). */
export async function movements(tx: pg.Client, productId: string) {
  const { rows } = await readAsOwner(tx, () =>
    tx.query<{
      id: string;
      movement_type: string;
      quantity_delta: number;
      location_id: string;
      inventory_unit_id: string | null;
      reversal_of_id: string | null;
      work_order_line_item_id: string | null;
      request_id: string | null;
      reason: string | null;
      created_by: string | null;
      created_at: Date;
      unit_cost_snapshot: string | null;
    }>(
      `select id::text, movement_type::text, quantity_delta, location_id, inventory_unit_id,
            reversal_of_id::text, work_order_line_item_id, request_id, reason, created_by, created_at,
            unit_cost_snapshot::text
       from public.inventory_movements where product_id = $1 order by id`,
      [productId],
    ),
  );
  return rows;
}

/** The unit's history, oldest first. */
export async function unitEvents(tx: pg.Client, unitId: string) {
  const { rows } = await tx.query<{ event_type: string; payload: Record<string, unknown> }>(
    `select event_type::text, payload from public.inventory_unit_events
      where unit_id = $1 order by created_at, id`,
    [unitId],
  );
  return rows;
}
