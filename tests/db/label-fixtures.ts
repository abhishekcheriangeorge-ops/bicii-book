/**
 * The shared labels DB fixture module (Phase 8), built on
 * tests/db/inventory-fixtures.ts and tests/db/consignment-fixtures.ts.
 *
 *   * The RPC helpers (createPrintJob, setJobStatus, labelPreview,
 *     setDefaultTemplate, setDefaultProfile) call the public RPCs as
 *     whoever `tx` is.
 *   * setSiteUrl writes shop_settings.public_site_url as the owner (the
 *     trigger and the check constraint still run) and returns to the role
 *     `tx` was acting as.
 *   * publishedFixtures builds, inside the caller's transaction, a
 *     published quantity product, an unpublished draft product, a
 *     published shop unique product whose unit is linked to a shop bike,
 *     and a published consigned unique unit (intake through
 *     create_consignment_item), each with a public photo. It leaves `tx`
 *     acting as the admin.
 *
 * Creating products, units, bikes and consignment items consumes short-ID
 * sequences, so tests that use these skip in existing-database mode
 * (isolatedDatabase()).
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";

import { createConsignor, intakeUnique } from "./consignment-fixtures";
import { actAs, scalar } from "./harness";
import {
  ADMIN,
  addPublicPhoto,
  makeProduct,
  makeUnit,
  publishProduct,
  readAsOwner,
} from "./inventory-fixtures";
import { makeBike, ownerMode } from "./workshop-fixtures";

export type LabelKind = "product" | "unit" | "bike";

/** private.label_content's shape (DATA-MODEL §12). */
export type LabelContent = {
  kind: LabelKind;
  short_id: string;
  qr_payload: string;
  name: string;
  price: string | null;
  currency: string;
  sku: string | null;
  identity: string[];
  serial_number: string | null;
};

/** The keys a label may carry (print_jobs_content_keys). */
export const CONTENT_KEYS = [
  "currency",
  "identity",
  "kind",
  "name",
  "price",
  "qr_payload",
  "serial_number",
  "short_id",
  "sku",
] as const;

export type PrintJobRow = {
  id: string;
  label_kind: LabelKind;
  product_id: string | null;
  inventory_unit_id: string | null;
  bike_id: string | null;
  short_id: string;
  qr_payload: string;
  content: LabelContent;
  quantity: number;
  printer_profile_id: string;
  profile_snapshot: { name: string; adapter: string; config: Record<string, unknown> };
  adapter: string;
  label_template_id: string;
  template_snapshot: {
    name: string;
    kind: LabelKind;
    width_mm: number;
    height_mm: number;
    layout: Record<string, unknown>;
  };
  status: "queued" | "rendered" | "printed" | "failed";
  rendered_at: Date | null;
  completed_at: Date | null;
  error: string | null;
  status_changed_by: string | null;
  reprint_of_id: string | null;
  requested_by: string;
  created_at: Date;
};

const JOB_COLUMNS = `j.id, j.label_kind::text as label_kind, j.product_id, j.inventory_unit_id, j.bike_id,
  j.short_id, j.qr_payload, j.content, j.quantity, j.printer_profile_id, j.profile_snapshot,
  j.adapter::text as adapter, j.label_template_id, j.template_snapshot, j.status::text as status,
  j.rendered_at, j.completed_at, j.error, j.status_changed_by, j.reprint_of_id, j.requested_by,
  j.created_at`;

/** public.create_print_job as whoever `tx` is (a fresh job id unless given). */
export async function createPrintJob(
  tx: pg.Client,
  a: {
    jobId?: string;
    kind: LabelKind;
    entityId: string;
    quantity?: number;
    profileId?: string | null;
    templateId?: string | null;
    reprintOf?: string | null;
  },
): Promise<PrintJobRow> {
  const { rows } = await tx.query<PrintJobRow>(
    `select ${JOB_COLUMNS} from public.create_print_job($1, $2, $3, $4, $5, $6, $7) j`,
    [
      a.jobId ?? randomUUID(),
      a.kind,
      a.entityId,
      a.quantity ?? 1,
      a.profileId ?? null,
      a.templateId ?? null,
      a.reprintOf ?? null,
    ],
  );
  return rows[0];
}

/** public.set_print_job_status as whoever `tx` is. */
export async function setJobStatus(
  tx: pg.Client,
  jobId: string,
  status: string,
  error: string | null = null,
): Promise<PrintJobRow> {
  const { rows } = await tx.query<PrintJobRow>(
    `select ${JOB_COLUMNS} from public.set_print_job_status($1, $2, $3) j`,
    [jobId, status, error],
  );
  return rows[0];
}

/** A print job as whoever `tx` is (RLS applies). */
export async function printJob(tx: pg.Client, jobId: string): Promise<PrintJobRow | undefined> {
  const { rows } = await tx.query<PrintJobRow>(
    `select ${JOB_COLUMNS} from public.print_jobs j where j.id = $1`,
    [jobId],
  );
  return rows[0];
}

/** public.label_preview as whoever `tx` is. */
export async function labelPreview(
  tx: pg.Client,
  kind: LabelKind,
  entityId: string,
): Promise<LabelContent> {
  return scalar<LabelContent>(tx, "select public.label_preview($1, $2)", [kind, entityId]);
}

/** public.set_default_label_template as whoever `tx` is; returns the row's id and flags. */
export async function setDefaultTemplate(tx: pg.Client, templateId: string) {
  const { rows } = await tx.query<{ id: string; kind: string; is_default: boolean }>(
    "select t.id, t.kind::text, t.is_default from public.set_default_label_template($1) t",
    [templateId],
  );
  return rows[0];
}

/** public.set_default_printer_profile as whoever `tx` is. */
export async function setDefaultProfile(tx: pg.Client, profileId: string) {
  const { rows } = await tx.query<{ id: string; is_default: boolean }>(
    "select p.id, p.is_default from public.set_default_printer_profile($1) p",
    [profileId],
  );
  return rows[0];
}

/** Owner: set shop_settings.public_site_url (null clears it). */
export async function setSiteUrl(tx: pg.Client, url: string | null): Promise<void> {
  await readAsOwner(tx, () =>
    tx.query("update public.shop_settings set public_site_url = $1 where id = 1", [url]),
  );
}

export type PublishedFixtures = {
  /** Published quantity product "Track pump", 45.00 / cost 20.00, brand Lezyne. */
  quantityProductId: string;
  /** Draft (unpublished) product. */
  draftProductId: string;
  /** Published unique product "Steel frame" (900.00) and its unit (850.00 / cost 400.00). */
  shopProductId: string;
  shopUnitId: string;
  /** The shop bike the unit is (size 54, colour Gloss Red, serial SF-54-0001). */
  shopBikeId: string;
  /** The unit's condition (two lines; only the first prints). */
  shopUnitCondition: string;
  /** Published consigned unit: agreed 2400.00, asking 4200.00. */
  consignedProductId: string;
  consignedUnitId: string;
  consignedItemId: string;
  consignorName: string;
  /** Direct costs that must never reach a label. */
  costs: string[];
};

/** See the module header. Leaves `tx` acting as the admin. */
export async function publishedFixtures(tx: pg.Client): Promise<PublishedFixtures> {
  await ownerMode(tx);
  const quantityProductId = await makeProduct(tx, {
    name: "Track pump",
    price: "45.00",
    cost: "20.00",
    sku: "LZ-TRACK-1",
  });
  await tx.query("update public.products set brand = 'Lezyne' where id = $1", [quantityProductId]);
  await addPublicPhoto(tx, "product", quantityProductId);

  const draftProductId = await makeProduct(tx, { publication: "draft", name: "Draft pump" });

  const shopProductId = await makeProduct(tx, {
    tracking: "unique",
    name: "Steel frame",
    price: "900.00",
    cost: "380.00",
  });
  const shopBikeId = await makeBike(tx, null);
  await tx.query(
    "update public.bikes set frame_size = '54', colour = 'Gloss Red', serial_number = 'SF-54-0001' where id = $1",
    [shopBikeId],
  );
  await addPublicPhoto(tx, "product", shopProductId);

  const consignorName = `Kelvin Labeltest ${randomUUID().slice(0, 6)}`;
  const consignorId = await createConsignor(tx, { displayName: consignorName });

  await actAs(tx, ADMIN);
  const shopUnitCondition = "Good: light scuffs on the top tube\nNew chain fitted in March";
  const unit = await makeUnit(tx, shopProductId, {
    price: "850.00",
    cost: "400.00",
    bikeId: shopBikeId,
    condition: shopUnitCondition,
  });
  const item = await intakeUnique(tx, {
    consignorId,
    agreed: "2400.00",
    asking: "4200.00",
    productName: "Colnago Master X-Light",
    serial: "MXL-0042",
    condition: "Like new",
  });

  await ownerMode(tx);
  await addPublicPhoto(tx, "product", item.product_id);
  await actAs(tx, ADMIN);
  for (const id of [quantityProductId, shopProductId, item.product_id]) {
    await publishProduct(tx, id);
  }

  return {
    quantityProductId,
    draftProductId,
    shopProductId,
    shopUnitId: unit.unit_id,
    shopBikeId,
    shopUnitCondition,
    consignedProductId: item.product_id,
    consignedUnitId: item.inventory_unit_id!,
    consignedItemId: item.item_id,
    consignorName,
    costs: ["20.00", "380.00", "400.00", "2400.00"],
  };
}
