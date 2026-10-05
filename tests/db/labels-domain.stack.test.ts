/**
 * The labels domain module (src/lib/domain/labels.ts) against the devstack,
 * as the app runs it (PLAN D9, D56–D59; DATA-MODEL §12): the print job DTO
 * from the seeded jobs' snapshots, the print history filters and cursor,
 * the record page's label context (including the printing-unavailable
 * results that must never throw), the reprint preset, and one job created
 * and confirmed through the RPCs.
 *
 * Reads the seeded jobs only; the one job it creates is confirmed printed,
 * so the seeded "To confirm" list is unchanged. Needs the devstack
 * (`npm run db:reset && npm run devstack:start`); skips otherwise, unless
 * BICII_REQUIRE_STACK=1.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  createPrintJob,
  getLabelContext,
  getPrintJob,
  getReprintPreset,
  resolvePrintPreset,
  listJobsFor,
  listPrintJobs,
  listProfiles,
  listTemplates,
  setPrintJobStatus,
} from "@/lib/domain/labels";
import type { ServerSupabase } from "@/lib/supabase/server";
import { newId } from "@/lib/uuid";

import {
  BIKE,
  BIKE_SHORT_ID,
  LABEL_TEMPLATE,
  PRINTER_PROFILE,
  PRINT_JOB,
  PRODUCT,
  PRODUCT_SHORT_ID,
  SHOP,
  UNIT,
} from "../fixtures/ids";
import { stackReachable, staffClient } from "./stack";

const reachable = await stackReachable("labels domain");

let staff: ServerSupabase;

beforeAll(async () => {
  if (!reachable) return;
  staff = (await staffClient("mechanic2")) as unknown as ServerSupabase;
});

const payload = (shortId: string) => `${SHOP.publicSiteUrl}/q/${shortId}`;

describe.skipIf(!reachable)("print jobs", () => {
  it("maps a seeded job from its snapshots", async () => {
    const job = await getPrintJob(staff, PRINT_JOB.productQueued);
    expect(job).toMatchObject({
      id: PRINT_JOB.productQueued,
      kind: "product",
      entityId: PRODUCT.barTape,
      entityArchived: false,
      shortId: PRODUCT_SHORT_ID.barTape,
      qrPayload: payload(PRODUCT_SHORT_ID.barTape),
      quantity: 10,
      adapter: "pdf",
      status: "queued",
      profile: { id: PRINTER_PROFILE.pdf, name: "PDF download", config: {} },
      template: { id: LABEL_TEMPLATE.product, widthMm: 58, heightMm: 40 },
      requestedBy: { name: "Marcus Tan" },
      statusChangedBy: null,
      reprintOfId: null,
    });
    expect(job?.content.qrPayload).toBe(job?.qrPayload);
    expect(job?.template.layout.fields).toEqual(["name", "price", "short_id", "sku"]);
  });

  it("keeps a failed job's reason and links a reprint", async () => {
    const failed = await getPrintJob(staff, PRINT_JOB.unitFailed);
    expect(failed).toMatchObject({
      status: "failed",
      error: "Label roll ran out halfway through",
      statusChangedBy: { name: "Asha Admin" },
      entityId: UNIT.colnago,
    });
    const reprint = await getPrintJob(staff, PRINT_JOB.unitReprint);
    expect(reprint?.reprintOfId).toBe(PRINT_JOB.unitFailed);
  });

  it("returns null for an unknown job", async () => {
    expect(await getPrintJob(staff, newId())).toBeNull();
  });

  it("filters the history: To confirm, Failed, a short ID, a name", async () => {
    const open = await listPrintJobs(staff, { filter: "open", q: "" });
    expect(open.items.every((j) => j.status === "queued" || j.status === "rendered")).toBe(true);
    expect(open.items.map((j) => j.id)).toEqual(
      expect.arrayContaining([PRINT_JOB.productQueued, PRINT_JOB.bikeUnconfirmed]),
    );

    const failed = await listPrintJobs(staff, { filter: "failed", q: "" });
    expect(failed.items.map((j) => j.id)).toContain(PRINT_JOB.unitFailed);
    expect(failed.items.every((j) => j.status === "failed")).toBe(true);

    const byShortId = await listPrintJobs(staff, { filter: "all", q: "p-000011" });
    expect(byShortId.items.map((j) => j.id)).toEqual(
      expect.arrayContaining([PRINT_JOB.productQueued, PRINT_JOB.productPrinted]),
    );
    expect(byShortId.items.every((j) => j.shortId === PRODUCT_SHORT_ID.barTape)).toBe(true);

    const name = (await getPrintJob(staff, PRINT_JOB.unitFailed))!.content.name;
    const byName = await listPrintJobs(staff, {
      filter: "all",
      q: name.slice(0, 7).toUpperCase(),
    });
    expect(byName.items.map((j) => j.id)).toContain(PRINT_JOB.unitFailed);

    const none = await listPrintJobs(staff, { filter: "all", q: "100%_no_such_label" });
    expect(none.items).toEqual([]);
  });

  it("pages newest first without gaps or repeats", async () => {
    const all = await listPrintJobs(staff, { filter: "all", q: "", limit: 500 });
    const first = await listPrintJobs(staff, { filter: "all", q: "", limit: 2 });
    expect(first.more).toBe(true);
    const second = await listPrintJobs(staff, {
      filter: "all",
      q: "",
      limit: 2,
      before: first.next,
    });
    expect([...first.items, ...second.items].map((j) => j.id)).toEqual(
      all.items.slice(0, 4).map((j) => j.id),
    );
  });

  it("lists a record's latest jobs", async () => {
    const jobs = await listJobsFor(staff, "unit", UNIT.colnago, 3);
    expect(jobs.map((j) => j.id)).toEqual(
      expect.arrayContaining([PRINT_JOB.unitReprint, PRINT_JOB.unitFailed]),
    );
  });
});

describe.skipIf(!reachable)("label context", () => {
  it("offers a counted product's label with templates, printers and its last printed price", async () => {
    const ctx = await getLabelContext(staff, { kind: "product", entityId: PRODUCT.barTape });
    expect(ctx.ok).toBe(true);
    if (!ctx.ok) return;
    expect(ctx.content.qrPayload).toBe(payload(PRODUCT_SHORT_ID.barTape));
    expect(ctx.defaultTemplateId).toBe(LABEL_TEMPLATE.product);
    expect(ctx.templates[0].id).toBe(LABEL_TEMPLATE.product);
    expect(ctx.defaultProfileId).toBe(PRINTER_PROFILE.browser);
    expect(ctx.publication).toEqual({ status: expect.any(String), isPublic: false });
    expect(ctx.lastPrintedPrice).not.toBeNull();
    expect(ctx.recentJobs.length).toBeGreaterThan(0);
  });

  it("refuses a unique product's P- label without throwing (D57)", async () => {
    const ctx = await getLabelContext(staff, { kind: "product", entityId: PRODUCT.colnago });
    expect(ctx).toMatchObject({ ok: false, reason: "unique_product" });
  });

  it("says an archived record cannot get labels, without throwing", async () => {
    const ctx = await getLabelContext(staff, {
      kind: "product",
      entityId: PRODUCT.chainX10Archived,
    });
    expect(ctx).toMatchObject({
      ok: false,
      reason: "archived",
      message: "That record is archived. Unarchive it before printing labels.",
    });
  });

  it("gives a bike tag no publication", async () => {
    const ctx = await getLabelContext(staff, { kind: "bike", entityId: BIKE.tanTarmac });
    expect(ctx).toMatchObject({ ok: true, publication: null });
    if (ctx.ok) expect(ctx.content.shortId).toBe(BIKE_SHORT_ID.tanTarmac);
  });

  it("presets Print again from a job of the same record only", async () => {
    expect(await getReprintPreset(staff, PRINT_JOB.unitFailed, "unit", UNIT.colnago)).toEqual({
      reprintOfId: PRINT_JOB.unitFailed,
      quantity: 1,
      profileId: PRINTER_PROFILE.pdf,
      templateId: LABEL_TEMPLATE.unit,
      price: "6800.00",
    });
    expect(await getReprintPreset(staff, PRINT_JOB.unitFailed, "unit", UNIT.brompton)).toBeNull();
    expect(
      await getReprintPreset(staff, PRINT_JOB.unitFailed, "product", PRODUCT.barTape),
    ).toBeNull();
  });

  it("resolves a record page's ?print=1 deep link into the sheet's preset", async () => {
    const closed = { open: false, requestedQuantity: 4, reprintOfId: null };
    expect(await resolvePrintPreset(staff, "unit", UNIT.colnago, closed)).toBeNull();
    expect(
      await resolvePrintPreset(staff, "unit", UNIT.colnago, {
        open: true,
        requestedQuantity: 3,
        reprintOfId: PRINT_JOB.unitFailed,
      }),
    ).toEqual({
      requestedQuantity: 3,
      reprintOfId: PRINT_JOB.unitFailed,
      profileId: PRINTER_PROFILE.pdf,
      templateId: LABEL_TEMPLATE.unit,
      reprintPrice: "6800.00",
    });
    // Another record's job: the sheet opens, without the link.
    expect(
      await resolvePrintPreset(staff, "product", PRODUCT.barTape, {
        open: true,
        requestedQuantity: null,
        reprintOfId: PRINT_JOB.unitFailed,
      }),
    ).toEqual({
      requestedQuantity: 1,
      reprintOfId: null,
      profileId: null,
      templateId: null,
      reprintPrice: null,
    });
  });

  it("lists templates and printers, defaults first", async () => {
    const templates = await listTemplates(staff, { kind: "bike" });
    expect(templates[0]).toMatchObject({ id: LABEL_TEMPLATE.bike, isDefault: true });
    const profiles = await listProfiles(staff);
    expect(profiles.map((p) => p.id).slice(0, 2)).toEqual([
      PRINTER_PROFILE.browser,
      PRINTER_PROFILE.pdf,
    ]);
  });
});

describe.skipIf(!reachable)("creating and confirming a job", () => {
  it("creates a job replay-safely and confirms it printed", async () => {
    const id = newId();
    const input = { id, kind: "bike" as const, entityId: BIKE.tanTarmac, quantity: 2 };
    const created = await createPrintJob(staff, input);
    expect(created).toEqual({ jobId: id, adapter: "browser" });
    expect(await createPrintJob(staff, input)).toEqual(created);

    const job = await getPrintJob(staff, id);
    expect(job?.qrPayload).toBe(payload(BIKE_SHORT_ID.tanTarmac));
    expect(job?.requestedBy.name).toBe("Nur Aisyah");

    expect(await setPrintJobStatus(staff, { id, status: "rendered" })).toEqual({
      status: "rendered",
    });
    expect(await setPrintJobStatus(staff, { id, status: "printed" })).toEqual({
      status: "printed",
    });
    await expect(
      setPrintJobStatus(staff, { id, status: "failed", error: "Too late" }),
    ).rejects.toMatchObject({ code: "P0001", message: "print_job_transition_invalid" });
  });
});
