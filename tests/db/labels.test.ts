/**
 * QR identity and label printing (SPEC §2 "Financial snapshots", §15 "QR
 * contains only that URL/ID", §16 label printing, §23 "Public QR pages
 * expose only explicitly published records", "Archived entities remain
 * available to historical references", "Historical ... snapshots do not
 * change with catalog edits", §31 "print QR labels; bulk labels in
 * arbitrary quantity"; DATA-MODEL §11, §12, §15, §16; PLAN D9 (QR base),
 * D24 (amended: 0 is a known price), D56 LABEL-QUANTITY, D57 UNIQUE-LABELS,
 * D58 LABEL-PRICE, D59 PRINT-CONFIRMED; TESTING.md "Database", the
 * labels rows).
 *
 *   * D9: the payload is exactly {public_site_url}/q/{short_id}, built only
 *     by private.qr_payload, with no fallback (public_site_url_invalid);
 *     the column check accepts exactly what qr_payload accepts
 *     (tests/fixtures/qr-bases.ts).
 *   * SPEC §16 / D56: N identical labels share one payload; per-job caps.
 *   * D57: unique items are labelled per unit; the U- label of a published
 *     unit resolves through reporting.public_items as anon, identically to
 *     what staff read there (the "What the public sees" panel).
 *   * D58: the label price is private.selling_price (= the public price =
 *     the sale default); NULL prints nothing, 0 prints 0.00.
 *   * SPEC §15, §23: labels never carry cost, consignor, ownership or notes
 *     (content whitelist, the function's source); text is a subset of the
 *     public row plus identifiers.
 *   * SPEC §2, §23: print jobs are snapshots, written only by RPCs, never
 *     deleted, still readable after their record is archived.
 *   * D59: the status machine (tests/fixtures/print-transitions.ts).
 *   * Templates and printer profiles: staff read, admins write, one default
 *     each; layout v1 (tests/fixtures/label-layouts.ts).
 *   * Customers and anonymous visitors read nothing about labels.
 *
 * Tests create products, units, bikes and consignment items (short-ID
 * sequences), so the file runs only on a per-file clone (TESTING.md).
 * Every test runs in a rolled-back transaction.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { bikeTitle } from "@/lib/bikes";

import {
  BIKE,
  CUSTOMER,
  LABEL_TEMPLATE,
  PRINTER_PROFILE,
  PRODUCT,
  SHOP,
  STAFF,
  UNIT,
} from "../fixtures/ids";
import { DEFAULT_LAYOUTS, LAYOUT_CASES } from "../fixtures/label-layouts";
import { PRINT_STATUSES, PRINT_TRANSITIONS } from "../fixtures/print-transitions";
import { QR_BASE_CASES } from "../fixtures/qr-bases";
import { recordSale, saleLines, sellingPrice, updateTerms } from "./consignment-fixtures";
import { customerClaims, linkCustomerLogin } from "./customer-fixtures";
import { actAs, connect, inTransaction, isolatedDatabase, scalar } from "./harness";
import {
  ADMIN,
  MANAGER,
  MECHANIC2,
  makeProduct,
  makeUniqueWithUnit,
  makeUnit,
  readAsOwner,
  writeOff,
  type PublicItem,
} from "./inventory-fixtures";
import {
  CONTENT_KEYS,
  createPrintJob,
  labelPreview,
  printJob,
  publishedFixtures,
  setDefaultProfile,
  setDefaultTemplate,
  setJobStatus,
  setSiteUrl,
  type LabelContent,
} from "./label-fixtures";
import { failsWith, makeBike, makeCustomer, ownerMode, tryAndUndo } from "./workshop-fixtures";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const inTx = <T>(fn: (tx: pg.Client) => Promise<T>) => inTransaction(conn, fn);

const ANON = { role: "anon" as const };

const P0001 = (message: string) => ({ code: "P0001", message });

const publicRows = async (tx: pg.Client, shortIds: string[]) =>
  (
    await tx.query<PublicItem>(
      "select * from reporting.public_items where short_id = any($1) order by short_id",
      [shortIds],
    )
  ).rows;

const shortIdOf = (tx: pg.Client, table: string, id: string) =>
  scalar<string>(tx, `select short_id from public.${table} where id = $1`, [id]);

describe.skipIf(!isolatedDatabase())("QR payload (D9)", () => {
  it("is exactly {public_site_url}/q/{short_id} for a product, a unit and a bike", async () => {
    await inTx(async (tx) => {
      await actAs(tx, ADMIN);
      for (const [kind, id] of [
        ["product", PRODUCT.barTape],
        ["unit", UNIT.colnago],
        ["bike", BIKE.tanTarmac],
      ] as const) {
        const content = await labelPreview(tx, kind, id);
        expect(content.qr_payload).toBe(`${SHOP.publicSiteUrl}/q/${content.short_id}`);
        const job = await createPrintJob(tx, { kind, entityId: id });
        expect(job.qr_payload).toBe(`${SHOP.publicSiteUrl}/q/${job.short_id}`);
        expect(job.content.qr_payload).toBe(job.qr_payload);
      }
    });
  });

  it("puts exactly one slash before q, also after a trailing slash or under a path", async () => {
    await inTx(async (tx) => {
      await actAs(tx, ADMIN);
      for (const c of QR_BASE_CASES.filter((q) => q.valid)) {
        await setSiteUrl(tx, c.base);
        const content = await labelPreview(tx, "product", PRODUCT.barTape);
        expect(content.qr_payload).toBe(`${c.payloadBase}/q/P-000011`);
      }
      await setSiteUrl(tx, "https://shop.example/");
      expect((await labelPreview(tx, "bike", BIKE.tanTarmac)).qr_payload).toBe(
        "https://shop.example/q/B-000001",
      );
      await setSiteUrl(tx, "https://bicii.sg/shop");
      expect((await labelPreview(tx, "unit", UNIT.colnago)).qr_payload).toBe(
        "https://bicii.sg/shop/q/U-000001",
      );
    });
  });

  it("an invalid address is refused by the column check (the same rule as qr_payload)", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      for (const c of QR_BASE_CASES) {
        if (c.valid) {
          await tryAndUndo(tx, () => setSiteUrl(tx, c.base));
        } else {
          await failsWith(tx, () => setSiteUrl(tx, c.base), {
            code: "23514",
            constraint: "shop_settings_public_site_url_check",
          });
        }
      }
    });
  });

  it("an invalid or missing site address stops printing: no fallback", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      await tx.query(
        "alter table public.shop_settings drop constraint shop_settings_public_site_url_check",
      );
      await actAs(tx, ADMIN);
      const refused = async () => {
        await failsWith(
          tx,
          () => createPrintJob(tx, { kind: "product", entityId: PRODUCT.barTape }),
          P0001("public_site_url_invalid"),
        );
        await failsWith(
          tx,
          () => labelPreview(tx, "product", PRODUCT.barTape),
          P0001("public_site_url_invalid"),
        );
      };
      for (const c of QR_BASE_CASES.filter((q) => !q.valid)) {
        await setSiteUrl(tx, c.base);
        await refused();
      }
      await setSiteUrl(tx, null);
      await refused();

      await ownerMode(tx);
      await tx.query("alter table public.shop_settings disable trigger user");
      await tx.query("delete from public.shop_settings");
      await actAs(tx, ADMIN);
      await refused();
    });
  });
});

describe.skipIf(!isolatedDatabase())("N labels and unique labels (SPEC §16, D56, D57)", () => {
  it("N identical labels carry one payload: one job, one QR", async () => {
    await inTx(async (tx) => {
      await actAs(tx, ADMIN);
      const job = await createPrintJob(tx, {
        kind: "product",
        entityId: PRODUCT.barTape,
        quantity: 10,
      });
      expect(job.quantity).toBe(10);
      expect(job.label_kind).toBe("product");
      expect(job.product_id).toBe(PRODUCT.barTape);
      const { rows } = await tx.query<{ n: number; payloads: number }>(
        "select count(*)::int as n, count(distinct qr_payload)::int as payloads from public.print_jobs where id = $1",
        [job.id],
      );
      expect(rows[0]).toEqual({ n: 1, payloads: 1 });
    });
  });

  it("a unique unit's label is distinct, and a P- label of a unique product is refused", async () => {
    await inTx(async (tx) => {
      const a = await makeUniqueWithUnit(tx, { name: "Steel frame", price: "900.00" });
      const b = await makeUnit(tx, a.productId);
      const labelA = await createPrintJob(tx, { kind: "unit", entityId: a.unitId });
      const labelB = await createPrintJob(tx, { kind: "unit", entityId: b.unit_id });
      const productSid = await shortIdOf(tx, "products", a.productId);
      expect(labelA.short_id).toBe(a.unitShortId);
      expect(labelB.short_id).toBe(b.short_id);
      expect(
        new Set([labelA.qr_payload, labelB.qr_payload, `${SHOP.publicSiteUrl}/q/${productSid}`])
          .size,
      ).toBe(3);
      await failsWith(
        tx,
        () => createPrintJob(tx, { kind: "product", entityId: a.productId }),
        P0001("label_unique_product_needs_unit"),
      );
      await failsWith(
        tx,
        () => labelPreview(tx, "product", a.productId),
        P0001("label_unique_product_needs_unit"),
      );
    });
  });

  it("quantity limits per job: product 1-500, unit and bike 1-10", async () => {
    await inTx(async (tx) => {
      const u = await makeUniqueWithUnit(tx);
      const out = P0001("label_quantity_out_of_range");
      for (const quantity of [0, 501, -1]) {
        await failsWith(
          tx,
          () => createPrintJob(tx, { kind: "product", entityId: PRODUCT.barTape, quantity }),
          out,
        );
      }
      expect(
        (await createPrintJob(tx, { kind: "product", entityId: PRODUCT.barTape, quantity: 500 }))
          .quantity,
      ).toBe(500);
      await failsWith(
        tx,
        () => createPrintJob(tx, { kind: "unit", entityId: u.unitId, quantity: 11 }),
        out,
      );
      await failsWith(
        tx,
        () => createPrintJob(tx, { kind: "bike", entityId: BIKE.tanTarmac, quantity: 11 }),
        out,
      );
      expect(
        (await createPrintJob(tx, { kind: "unit", entityId: u.unitId, quantity: 10 })).quantity,
      ).toBe(10);
      expect(
        (await createPrintJob(tx, { kind: "bike", entityId: BIKE.tanTarmac, quantity: 1 }))
          .quantity,
      ).toBe(1);
      // The table's own caps back the RPC for every writer.
      await ownerMode(tx);
      const job = await scalar<string>(
        tx,
        "select id from public.print_jobs where quantity = 500 limit 1",
      );
      for (const [quantity, constraint] of [
        [501, "print_jobs_quantity_check"],
        [0, "print_jobs_quantity_check"],
      ] as const) {
        await failsWith(
          tx,
          () =>
            tx.query(
              `insert into public.print_jobs
                 select (r).* from (
                   select jsonb_populate_record(j, jsonb_build_object('id', gen_random_uuid(), 'quantity', $2::int)) r
                     from public.print_jobs j where j.id = $1
                 ) s`,
              [job, quantity],
            ),
          { code: "23514", constraint },
        );
      }
      const unitJob = await scalar<string>(
        tx,
        "select id from public.print_jobs where label_kind = 'unit' and quantity = 10 limit 1",
      );
      await failsWith(
        tx,
        () =>
          tx.query(
            `insert into public.print_jobs
               select (r).* from (
                 select jsonb_populate_record(j, jsonb_build_object('id', gen_random_uuid(), 'quantity', 11)) r
                   from public.print_jobs j where j.id = $1
               ) s`,
            [unitJob],
          ),
        { code: "23514", constraint: "print_jobs_unique_quantity_check" },
      );
    });
  });
});

describe.skipIf(!isolatedDatabase())(
  "a printed label resolves publicly (SPEC §15, §23, D57)",
  () => {
    it("a published unit's label resolves through the anonymous surface; unpublished and unknown IDs do not", async () => {
      await inTx(async (tx) => {
        const f = await publishedFixtures(tx);
        const jobs = [
          await createPrintJob(tx, { kind: "product", entityId: f.quantityProductId, quantity: 5 }),
          await createPrintJob(tx, { kind: "unit", entityId: f.shopUnitId }),
          await createPrintJob(tx, { kind: "unit", entityId: f.consignedUnitId }),
        ];
        const draftJob = await createPrintJob(tx, { kind: "product", entityId: f.draftProductId });
        const bikeTag = await createPrintJob(tx, { kind: "bike", entityId: f.shopBikeId });

        await actAs(tx, ANON);
        for (const job of jobs) {
          const rows = await publicRows(tx, [job.short_id]);
          expect(rows).toHaveLength(1);
          expect(rows[0].kind).toBe(job.label_kind);
        }
        expect(await publicRows(tx, [draftJob.short_id])).toEqual([]);
        expect(await publicRows(tx, ["P-999999"])).toEqual([]);
        // D57: a bike tag resolves to "not found" publicly.
        expect(await publicRows(tx, [bikeTag.short_id])).toEqual([]);
      });
    });

    it("reporting.public_items returns identical rows to anon and to staff for the same short IDs", async () => {
      await inTx(async (tx) => {
        const f = await publishedFixtures(tx);
        const sids = [
          await shortIdOf(tx, "products", f.quantityProductId),
          await shortIdOf(tx, "products", f.shopProductId),
          await shortIdOf(tx, "inventory_units", f.shopUnitId),
          await shortIdOf(tx, "products", f.consignedProductId),
          await shortIdOf(tx, "inventory_units", f.consignedUnitId),
          await shortIdOf(tx, "products", f.draftProductId),
        ];
        await actAs(tx, ANON);
        const anon = await publicRows(tx, sids);
        await actAs(tx, MECHANIC2);
        const staff = await publicRows(tx, sids);
        await actAs(tx, ADMIN);
        const admin = await publicRows(tx, sids);
        expect(anon).toHaveLength(5);
        expect(staff).toEqual(anon);
        expect(admin).toEqual(anon);
      });
    });
  },
);

describe.skipIf(!isolatedDatabase())("the price on a label (D58, D24 amended)", () => {
  it("label price equals the public price and the sale default", async () => {
    await inTx(async (tx) => {
      const f = await publishedFixtures(tx);
      const cases = [
        {
          kind: "product" as const,
          id: f.quantityProductId,
          productId: f.quantityProductId,
          unitId: null,
        },
        {
          kind: "unit" as const,
          id: f.shopUnitId,
          productId: f.shopProductId,
          unitId: f.shopUnitId,
        },
        {
          kind: "unit" as const,
          id: f.consignedUnitId,
          productId: f.consignedProductId,
          unitId: f.consignedUnitId,
        },
      ];
      const labels: LabelContent[] = [];
      for (const c of cases)
        labels.push((await createPrintJob(tx, { kind: c.kind, entityId: c.id })).content);
      expect(labels.map((l) => l.price)).toEqual(["45.00", "850.00", "4200.00"]);

      for (const [i, c] of cases.entries()) {
        expect(await sellingPrice(tx, c.productId, c.unitId)).toBe(labels[i].price);
      }
      await actAs(tx, ANON);
      for (const label of labels) {
        const [row] = await publicRows(tx, [label.short_id]);
        expect(Number(row.sale_price)).toBe(Number(label.price));
        expect(row.currency).toBe(label.currency);
      }

      // The consigned unit sold without a price snapshots the label's price.
      await actAs(tx, ADMIN);
      await tryAndUndo(tx, async () => {
        const sale = await recordSale(tx, { lines: [{ inventory_unit_id: f.consignedUnitId }] });
        const [line] = await saleLines(tx, sale.sale_id);
        expect(line.unit_sale_price_snapshot).toBe(labels[2].price);
      });

      // New terms: the next label follows the asking price.
      await updateTerms(tx, f.consignedItemId, { asking: "3900.00", reason: "Price drop agreed" });
      expect((await labelPreview(tx, "unit", f.consignedUnitId)).price).toBe("3900.00");
    });
  });

  it("price line: unit price, else product default; 0 prints 0.00; NULL prints no price", async () => {
    await inTx(async (tx) => {
      const withPrice = await makeUniqueWithUnit(tx, { price: "900.00", unitPrice: "850.00" });
      const withoutPrice = await makeUniqueWithUnit(tx, { price: "900.00", unitPrice: null });
      await ownerMode(tx);
      const free = await makeProduct(tx, { name: "Valve cap", price: "0.00" });
      const unpriced = await makeProduct(tx, { name: "Spoke", price: null });
      const oneDecimal = await makeProduct(tx, { name: "Grip tape", price: "12.5" });
      await actAs(tx, MECHANIC2);

      expect((await labelPreview(tx, "unit", withPrice.unitId)).price).toBe("850.00");
      expect((await labelPreview(tx, "unit", withoutPrice.unitId)).price).toBe("900.00");
      const zero = await createPrintJob(tx, { kind: "product", entityId: free });
      expect(zero.content.price).toBe("0.00");
      const none = await createPrintJob(tx, { kind: "product", entityId: unpriced });
      expect(none.content.price).toBeNull();
      expect(none.content).toHaveProperty("price", null);
      expect((await labelPreview(tx, "product", oneDecimal)).price).toBe("12.50");
      expect((await labelPreview(tx, "bike", BIKE.tanTarmac)).price).toBeNull();
    });
  });
});

describe.skipIf(!isolatedDatabase())("what a label says (SPEC §15, §23)", () => {
  it("labels never carry cost, consignor, ownership or notes", async () => {
    await inTx(async (tx) => {
      const f = await publishedFixtures(tx);
      await readAsOwner(tx, () =>
        tx.query(
          "update public.inventory_units set internal_notes = 'Internal: bought cheap' where id = $1",
          [f.shopUnitId],
        ),
      );
      const jobs = [
        await createPrintJob(tx, { kind: "product", entityId: f.quantityProductId }),
        await createPrintJob(tx, { kind: "unit", entityId: f.shopUnitId }),
        await createPrintJob(tx, { kind: "unit", entityId: f.consignedUnitId }),
        await createPrintJob(tx, { kind: "bike", entityId: f.shopBikeId }),
      ];
      for (const job of jobs) {
        expect(Object.keys(job.content).sort()).toEqual([...CONTENT_KEYS]);
        const text = JSON.stringify(job.content);
        for (const cost of f.costs) expect(text).not.toContain(cost);
        expect(text).not.toContain(f.consignorName);
        expect(text).not.toMatch(/consign/i);
        expect(text).not.toMatch(/internal/i);
        expect(text).not.toMatch(/shop_owned/i);
      }

      // The whitelist holds for every writer.
      await ownerMode(tx);
      await failsWith(
        tx,
        () =>
          tx.query(
            `insert into public.print_jobs
               select (r).* from (
                 select jsonb_populate_record(j, jsonb_build_object(
                          'id', gen_random_uuid(), 'content', j.content || '{"cost": "400.00"}'::jsonb)) r
                   from public.print_jobs j where j.id = $1
               ) s`,
            [jobs[1].id],
          ),
        { code: "23514", constraint: "print_jobs_content_keys" },
      );
      const source = await scalar<string>(
        tx,
        "select prosrc from pg_proc where oid = 'private.label_content(public.label_kind, uuid)'::regprocedure",
      );
      for (const word of [
        "consignment_items",
        "direct_cost",
        "ownership_type",
        "internal_note",
        "customer",
      ]) {
        expect(source).not.toContain(word);
      }
    });
  });

  it("label text is a subset of the public row plus identifiers", async () => {
    await inTx(async (tx) => {
      const f = await publishedFixtures(tx);
      const product = await labelPreview(tx, "product", f.quantityProductId);
      const shopUnit = await labelPreview(tx, "unit", f.shopUnitId);
      const consigned = await labelPreview(tx, "unit", f.consignedUnitId);
      const bike = await labelPreview(tx, "bike", f.shopBikeId);

      expect(product).toMatchObject({
        kind: "product",
        name: "Track pump",
        sku: "LZ-TRACK-1",
        identity: ["Lezyne"],
        serial_number: null,
        currency: "SGD",
      });
      expect(shopUnit).toMatchObject({
        kind: "unit",
        name: "Steel frame",
        identity: ["Size 54 · Gloss Red", "Good: light scuffs on the top tube"],
        serial_number: "SF-54-0001",
      });
      expect(consigned).toMatchObject({ identity: ["Like new"], serial_number: "MXL-0042" });
      expect(bike).toMatchObject({
        kind: "bike",
        name: "Test Bike",
        identity: ["Size 54 · Gloss Red"],
        serial_number: "SF-54-0001",
        sku: null,
        price: null,
      });

      await actAs(tx, ANON);
      for (const label of [product, shopUnit, consigned]) {
        const [row] = await publicRows(tx, [label.short_id]);
        expect(label.name).toBe(row.name);
        const allowed = [row.brand, row.condition?.split("\n")[0]?.trim(), "Size 54 · Gloss Red"];
        for (const line of label.identity) expect(allowed).toContain(line);
      }
    });
  });

  it("every seeded bike's tag is named as the app names it (bikeTitle)", async () => {
    await inTx(async (tx) => {
      await actAs(tx, MECHANIC2);
      const { rows } = await tx.query<{
        id: string;
        brand: string;
        model: string;
        variant: string | null;
      }>("select id, brand, model, variant from public.bikes where id = any($1)", [
        Object.values(BIKE),
      ]);
      expect(rows).toHaveLength(Object.keys(BIKE).length);
      for (const b of rows) {
        expect((await labelPreview(tx, "bike", b.id)).name).toBe(bikeTitle(b));
      }
    });
  });
});

describe.skipIf(!isolatedDatabase())("print jobs are history (SPEC §2, §23)", () => {
  it("snapshots do not change with catalog edits", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      const id = await makeProduct(tx, { name: "Chain checker", price: "25.00", sku: "CC-1" });
      await actAs(tx, MECHANIC2);
      const job = await createPrintJob(tx, { kind: "product", entityId: id, quantity: 3 });
      await readAsOwner(tx, () =>
        tx.query(
          "update public.products set name = 'Chain wear gauge', default_sale_price = 29.00, sku = 'CC-2' where id = $1",
          [id],
        ),
      );
      const after = await printJob(tx, job.id);
      expect(after?.content).toEqual(job.content);
      expect(after?.content).toMatchObject({ name: "Chain checker", price: "25.00", sku: "CC-1" });
      expect(await labelPreview(tx, "product", id)).toMatchObject({
        name: "Chain wear gauge",
        price: "29.00",
        sku: "CC-2",
      });
      // The template and printer are snapshots too.
      expect(job.template_snapshot).toMatchObject({
        name: "Product 58 × 40",
        kind: "product",
        layout: DEFAULT_LAYOUTS.product,
      });
      expect(Number(job.template_snapshot.width_mm)).toBe(58);
      expect(job.profile_snapshot).toEqual({
        name: "This device (browser print)",
        adapter: "browser",
        config: {},
      });
    });
  });

  it("replaying a print job creates one job", async () => {
    await inTx(async (tx) => {
      await actAs(tx, MECHANIC2);
      const jobId = randomUUID();
      const first = await createPrintJob(tx, {
        jobId,
        kind: "product",
        entityId: PRODUCT.barTape,
        quantity: 4,
      });
      const again = await createPrintJob(tx, {
        jobId,
        kind: "product",
        entityId: PRODUCT.barTape,
        quantity: 4,
      });
      expect(again).toEqual(first);
      expect(
        await scalar<number>(tx, "select count(*)::int from public.print_jobs where id = $1", [
          jobId,
        ]),
      ).toBe(1);
      await failsWith(
        tx,
        () =>
          createPrintJob(tx, { jobId, kind: "product", entityId: PRODUCT.barTape, quantity: 5 }),
        P0001("print_job_conflict"),
      );
      await failsWith(
        tx,
        () =>
          createPrintJob(tx, { jobId, kind: "product", entityId: PRODUCT.brakePads, quantity: 4 }),
        P0001("print_job_conflict"),
      );
      await failsWith(
        tx,
        () =>
          createPrintJob(tx, {
            jobId,
            kind: "product",
            entityId: PRODUCT.barTape,
            quantity: 4,
            profileId: PRINTER_PROFILE.pdf,
          }),
        P0001("print_job_conflict"),
      );
      // The default printer changes; a replay without a printer is still the original job.
      await actAs(tx, ADMIN);
      await setDefaultProfile(tx, PRINTER_PROFILE.pdf);
      await actAs(tx, MECHANIC2);
      const replay = await createPrintJob(tx, {
        jobId,
        kind: "product",
        entityId: PRODUCT.barTape,
        quantity: 4,
      });
      expect(replay).toEqual(first);
      expect(replay.adapter).toBe("browser");
      expect(
        (await createPrintJob(tx, { kind: "product", entityId: PRODUCT.barTape })).adapter,
      ).toBe("pdf");
    });
  });

  it("print job status machine: only the D59 moves, stamped, by the actor", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      for (const t of PRINT_TRANSITIONS) {
        expect(
          await scalar<boolean>(tx, "select private.print_job_transition_allowed($1, $2)", [
            t.from,
            t.to,
          ]),
        ).toBe(t.allowed);
      }
      await actAs(tx, MECHANIC2);
      const at = async (status: (typeof PRINT_STATUSES)[number]) => {
        const job = await createPrintJob(tx, { kind: "product", entityId: PRODUCT.barTape });
        if (status === "rendered") await setJobStatus(tx, job.id, "rendered");
        if (status === "printed") await setJobStatus(tx, job.id, "printed");
        if (status === "failed") await setJobStatus(tx, job.id, "failed", "Printer jammed");
        return job.id;
      };
      for (const t of PRINT_TRANSITIONS) {
        const jobId = await at(t.from);
        const before = await printJob(tx, jobId);
        if (t.from === t.to) {
          expect(
            await setJobStatus(tx, jobId, t.to, t.to === "failed" ? "Another reason" : null),
          ).toEqual(before);
        } else if (t.allowed) {
          const after = await setJobStatus(
            tx,
            jobId,
            t.to,
            t.to === "failed" ? " Out of labels " : null,
          );
          expect(after.status).toBe(t.to);
          expect(after.status_changed_by).toBe(STAFF.mechanic2);
          expect(after.rendered_at === null).toBe(t.to === "failed" && t.from === "queued");
          expect(after.completed_at === null).toBe(t.to === "rendered");
          expect(after.error).toBe(t.to === "failed" ? "Out of labels" : null);
        } else {
          await failsWith(
            tx,
            () => setJobStatus(tx, jobId, t.to, "Out of labels"),
            P0001("print_job_transition_invalid"),
          );
        }
      }

      const queued = await at("queued");
      await failsWith(
        tx,
        () => setJobStatus(tx, queued, "failed"),
        P0001("print_job_error_required"),
      );
      await failsWith(
        tx,
        () => setJobStatus(tx, queued, "failed", "   "),
        P0001("print_job_error_required"),
      );
      await failsWith(
        tx,
        () => setJobStatus(tx, queued, "failed", "x".repeat(501)),
        P0001("reason_too_long"),
      );
      const printed = await setJobStatus(tx, queued, "printed");
      expect(printed.rendered_at).not.toBeNull();
      expect(printed.completed_at).not.toBeNull();
      // Replaying printed is a no-op; a failed job keeps its first error.
      expect(await setJobStatus(tx, queued, "printed")).toEqual(printed);
      const failed = await at("failed");
      expect((await setJobStatus(tx, failed, "failed", "Something else")).error).toBe(
        "Printer jammed",
      );
      await failsWith(tx, () => setJobStatus(tx, randomUUID(), "printed"), { code: "P0002" });
    });
  });

  it("print jobs are written only through RPCs and never deleted", async () => {
    await inTx(async (tx) => {
      await actAs(tx, MECHANIC2);
      const job = await createPrintJob(tx, { kind: "product", entityId: PRODUCT.barTape });
      const denied = { code: "42501" };
      await failsWith(
        tx,
        () =>
          tx.query(
            `insert into public.print_jobs (label_kind, product_id, short_id, qr_payload, content, quantity,
               printer_profile_id, profile_snapshot, adapter, label_template_id, template_snapshot, requested_by)
             select label_kind, product_id, short_id, qr_payload, content, 1, printer_profile_id,
                    profile_snapshot, adapter, label_template_id, template_snapshot, requested_by
               from public.print_jobs where id = $1`,
            [job.id],
          ),
        denied,
      );
      await failsWith(
        tx,
        () => tx.query("update public.print_jobs set status = 'printed' where id = $1", [job.id]),
        denied,
      );
      await failsWith(
        tx,
        () => tx.query("delete from public.print_jobs where id = $1", [job.id]),
        denied,
      );

      await ownerMode(tx);
      const immutable = P0001("print_job_immutable");
      await failsWith(
        tx,
        () => tx.query("update public.print_jobs set quantity = 2 where id = $1", [job.id]),
        immutable,
      );
      await failsWith(
        tx,
        () =>
          tx.query(
            `update public.print_jobs set content = content || '{"name": "Other"}' where id = $1`,
            [job.id],
          ),
        immutable,
      );
      await failsWith(
        tx,
        () => tx.query("delete from public.print_jobs where id = $1", [job.id]),
        immutable,
      );
      // Even the owner follows the status machine.
      await tx.query(
        "update public.print_jobs set status = 'printed', completed_at = now() where id = $1",
        [job.id],
      );
      await failsWith(
        tx,
        () =>
          tx.query(
            "update public.print_jobs set status = 'queued', completed_at = null where id = $1",
            [job.id],
          ),
        P0001("print_job_transition_invalid"),
      );
    });
  });

  it("archived records keep their print jobs readable and get no new labels", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      const productId = await makeProduct(tx, { name: "Old bell" });
      const bikeId = await makeBike(tx, null);
      const u = await makeUniqueWithUnit(tx, { name: "Old frame" });
      const productJob = await createPrintJob(tx, { kind: "product", entityId: productId });
      const unitJob = await createPrintJob(tx, { kind: "unit", entityId: u.unitId });
      const bikeJob = await createPrintJob(tx, { kind: "bike", entityId: bikeId });
      await writeOff(tx, u.unitId);

      await ownerMode(tx);
      await tx.query("update public.products set archived_at = now() where id = $1", [productId]);
      await tx.query("update public.bikes set archived_at = now() where id = $1", [bikeId]);
      // The unit's product first (the unit itself is not archived yet).
      await tx.query("update public.products set archived_at = now() where id = $1", [u.productId]);
      await actAs(tx, MECHANIC2);
      const archived = P0001("label_entity_archived");
      await failsWith(tx, () => labelPreview(tx, "unit", u.unitId), archived);
      await readAsOwner(tx, () =>
        tx.query("update public.inventory_units set archived_at = now() where id = $1", [u.unitId]),
      );

      for (const [job, kind, id] of [
        [productJob, "product", productId],
        [unitJob, "unit", u.unitId],
        [bikeJob, "bike", bikeId],
      ] as const) {
        const read = await printJob(tx, job.id);
        expect(read?.content).toEqual(job.content);
        await failsWith(tx, () => createPrintJob(tx, { kind, entityId: id }), archived);
        await failsWith(tx, () => labelPreview(tx, kind, id), archived);
        await failsWith(
          tx,
          () => createPrintJob(tx, { kind, entityId: id, reprintOf: job.id }),
          archived,
        );
      }
      await failsWith(tx, () => labelPreview(tx, "product", randomUUID()), { code: "P0002" });
    });
  });

  it("a reprint is linked to a job of the same record", async () => {
    await inTx(async (tx) => {
      await actAs(tx, MECHANIC2);
      const original = await createPrintJob(tx, { kind: "unit", entityId: UNIT.colnago });
      await setJobStatus(tx, original.id, "failed", "Smudged");
      const reprint = await createPrintJob(tx, {
        kind: "unit",
        entityId: UNIT.colnago,
        reprintOf: original.id,
      });
      expect(reprint.reprint_of_id).toBe(original.id);
      expect(reprint.status).toBe("queued");
      await failsWith(
        tx,
        () => createPrintJob(tx, { kind: "unit", entityId: UNIT.brompton, reprintOf: original.id }),
        P0001("print_job_reprint_mismatch"),
      );
      await failsWith(
        tx,
        () =>
          createPrintJob(tx, { kind: "bike", entityId: BIKE.shopColnago, reprintOf: original.id }),
        P0001("print_job_reprint_mismatch"),
      );
      await failsWith(
        tx,
        () => createPrintJob(tx, { kind: "unit", entityId: UNIT.colnago, reprintOf: randomUUID() }),
        { code: "P0002" },
      );
    });
  });
});

describe.skipIf(!isolatedDatabase())("templates and printer profiles", () => {
  const productTemplate = (name: string, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    name,
    kind: "product",
    width_mm: 58,
    height_mm: 40,
    layout: JSON.stringify(DEFAULT_LAYOUTS.product),
    active: true,
    ...extra,
  });

  const insertTemplate = (tx: pg.Client, t: ReturnType<typeof productTemplate>) =>
    tx.query(
      `insert into public.label_templates (id, name, kind, width_mm, height_mm, layout, active)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [t.id, t.name, t.kind, t.width_mm, t.height_mm, t.layout, t.active],
    );

  const insertProfile = (
    tx: pg.Client,
    id: string,
    name: string,
    adapter = "browser",
    active = true,
  ) =>
    tx.query(
      `insert into public.printer_profiles (id, name, adapter, config, active, sort_order)
       values ($1, $2, $3, '{"offset_x_mm": 0.5}'::jsonb, $4, 5)`,
      [id, name, adapter, active],
    );

  it("staff read templates and profiles; only admins write them", async () => {
    await inTx(async (tx) => {
      await actAs(tx, MECHANIC2);
      expect(await scalar<number>(tx, "select count(*)::int from public.label_templates")).toBe(3);
      expect(await scalar<number>(tx, "select count(*)::int from public.printer_profiles")).toBe(2);
      const denied = { code: "42501" };
      await failsWith(tx, () => insertTemplate(tx, productTemplate("Mechanic's template")), denied);
      await failsWith(tx, () => insertProfile(tx, randomUUID(), "Mechanic's printer"), denied);
      const t = await tx.query("update public.label_templates set name = 'Renamed' where id = $1", [
        LABEL_TEMPLATE.product,
      ]);
      expect(t.rowCount).toBe(0);
      const p = await tx.query(
        "update public.printer_profiles set name = 'Renamed' where id = $1",
        [PRINTER_PROFILE.pdf],
      );
      expect(p.rowCount).toBe(0);
      await failsWith(tx, () => setDefaultTemplate(tx, LABEL_TEMPLATE.product), denied);
      await failsWith(tx, () => setDefaultProfile(tx, PRINTER_PROFILE.pdf), denied);

      await actAs(tx, ADMIN);
      const small = productTemplate("Small 50 × 30", {
        width_mm: 50,
        height_mm: 30,
        layout: JSON.stringify({ ...DEFAULT_LAYOUTS.product, qr_mm: 24 }),
      });
      await insertTemplate(tx, small);
      expect(
        await scalar<string>(
          tx,
          "select created_by::text from public.label_templates where id = $1",
          [small.id],
        ),
      ).toBe(STAFF.admin);
      const updated = await tx.query(
        "update public.label_templates set name = '  Small label  ' where id = $1",
        [small.id],
      );
      expect(updated.rowCount).toBe(1);
      expect(
        await scalar<string>(tx, "select name from public.label_templates where id = $1", [
          small.id,
        ]),
      ).toBe("Small label");
      const printerId = randomUUID();
      await insertProfile(tx, printerId, "Back office browser");
      // Defaults move only through the RPCs.
      await failsWith(
        tx,
        () =>
          tx.query("update public.label_templates set is_default = true where id = $1", [small.id]),
        denied,
      );
      await failsWith(
        tx,
        () =>
          tx.query("update public.printer_profiles set is_default = true where id = $1", [
            printerId,
          ]),
        denied,
      );
      await failsWith(
        tx,
        () => tx.query("delete from public.label_templates where id = $1", [small.id]),
        denied,
      );
    });
  });

  // Staff roles (D90, D91): a manager holds every permission except
  // manage_staff, but is not an admin. Printing needs only an active staff
  // member; templates, printers and the QR address stay role admin
  // (private.require_admin / private.is_admin, which the roles migrations
  // left as role = 'admin').
  it("a manager prints labels but writes no template, printer or QR address (D91)", async () => {
    await inTx(async (tx) => {
      await actAs(tx, MANAGER);
      const job = await createPrintJob(tx, {
        kind: "product",
        entityId: PRODUCT.barTape,
        quantity: 3,
      });
      expect(job.requested_by).toBe(STAFF.manager);
      expect((await setJobStatus(tx, job.id, "printed")).status).toBe("printed");
      expect(await scalar<number>(tx, "select count(*)::int from public.label_templates")).toBe(3);
      const denied = { code: "42501" };
      await failsWith(tx, () => insertTemplate(tx, productTemplate("Manager's template")), denied);
      await failsWith(tx, () => insertProfile(tx, randomUUID(), "Manager's printer"), denied);
      const t = await tx.query("update public.label_templates set name = 'Renamed' where id = $1", [
        LABEL_TEMPLATE.product,
      ]);
      expect(t.rowCount).toBe(0);
      await failsWith(tx, () => setDefaultTemplate(tx, LABEL_TEMPLATE.product), denied);
      await failsWith(tx, () => setDefaultProfile(tx, PRINTER_PROFILE.pdf), denied);
      await failsWith(
        tx,
        () =>
          tx.query("select public.update_shop_settings(public_site_url => $1)", [
            "https://elsewhere.example",
          ]),
        denied,
      );
    });
  });

  it("one default per kind and one default printer, never switched off", async () => {
    await inTx(async (tx) => {
      await actAs(tx, ADMIN);
      await failsWith(
        tx,
        () =>
          tx.query("update public.label_templates set active = false where id = $1", [
            LABEL_TEMPLATE.product,
          ]),
        P0001("label_template_default_required"),
      );
      await failsWith(
        tx,
        () =>
          tx.query("update public.printer_profiles set active = false where id = $1", [
            PRINTER_PROFILE.browser,
          ]),
        P0001("printer_profile_default_required"),
      );

      const other = productTemplate("Product wide");
      await insertTemplate(tx, other);
      expect(await setDefaultTemplate(tx, other.id)).toMatchObject({
        id: other.id,
        is_default: true,
      });
      expect(await setDefaultTemplate(tx, other.id)).toMatchObject({
        id: other.id,
        is_default: true,
      });
      const defaults = await tx.query<{ id: string; kind: string }>(
        "select t.id, t.kind::text from public.label_templates t where t.is_default order by t.kind",
      );
      expect(defaults.rows).toEqual([
        { id: other.id, kind: "product" },
        { id: LABEL_TEMPLATE.unit, kind: "unit" },
        { id: LABEL_TEMPLATE.bike, kind: "bike" },
      ]);
      // The old default can now be switched off.
      await tx.query("update public.label_templates set active = false where id = $1", [
        LABEL_TEMPLATE.product,
      ]);
      await failsWith(
        tx,
        () => setDefaultTemplate(tx, LABEL_TEMPLATE.product),
        P0001("label_template_inactive"),
      );

      await setDefaultProfile(tx, PRINTER_PROFILE.pdf);
      expect(
        (await tx.query("select id from public.printer_profiles where is_default")).rows.map(
          (r) => r.id,
        ),
      ).toEqual([PRINTER_PROFILE.pdf]);
      await tx.query("update public.printer_profiles set active = false where id = $1", [
        PRINTER_PROFILE.browser,
      ]);
      await failsWith(
        tx,
        () => setDefaultProfile(tx, PRINTER_PROFILE.browser),
        P0001("printer_profile_inactive"),
      );
      await failsWith(tx, () => setDefaultProfile(tx, randomUUID()), { code: "P0002" });

      // Printing refuses a switched-off printer or template and a template of another kind.
      await failsWith(
        tx,
        () =>
          createPrintJob(tx, {
            kind: "product",
            entityId: PRODUCT.barTape,
            profileId: PRINTER_PROFILE.browser,
          }),
        P0001("printer_profile_inactive"),
      );
      await failsWith(
        tx,
        () =>
          createPrintJob(tx, {
            kind: "product",
            entityId: PRODUCT.barTape,
            templateId: LABEL_TEMPLATE.product,
          }),
        P0001("label_template_inactive"),
      );
      await failsWith(
        tx,
        () =>
          createPrintJob(tx, {
            kind: "product",
            entityId: PRODUCT.barTape,
            templateId: LABEL_TEMPLATE.bike,
          }),
        P0001("label_template_kind_mismatch"),
      );
      const job = await createPrintJob(tx, { kind: "product", entityId: PRODUCT.barTape });
      expect(job).toMatchObject({
        label_template_id: other.id,
        printer_profile_id: PRINTER_PROFILE.pdf,
      });

      // No default for a kind: nothing to print with.
      await ownerMode(tx);
      await tx.query("update public.label_templates set is_default = false where kind = 'bike'");
      await actAs(tx, ADMIN);
      await failsWith(
        tx,
        () => createPrintJob(tx, { kind: "bike", entityId: BIKE.tanTarmac }),
        P0001("label_template_missing"),
      );
    });
  });

  it("a template keeps its kind, a printer its adapter; hardware adapters are not available yet", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      await failsWith(
        tx,
        () =>
          tx.query("update public.label_templates set kind = 'unit' where id = $1", [
            LABEL_TEMPLATE.product,
          ]),
        P0001("label_template_kind_immutable"),
      );
      await failsWith(
        tx,
        () =>
          tx.query("update public.printer_profiles set adapter = 'pdf' where id = $1", [
            PRINTER_PROFILE.browser,
          ]),
        P0001("printer_profile_adapter_immutable"),
      );
      await actAs(tx, ADMIN);
      for (const adapter of ["bluetooth", "network_raw"]) {
        await failsWith(tx, () => insertProfile(tx, randomUUID(), `Shop ${adapter}`, adapter), {
          code: "23514",
          constraint: "printer_profiles_adapter_available",
        });
      }
      for (const config of [
        '{"offset_x_mm": 6}',
        '{"darkness": 3}',
        '{"offset_y_mm": "1"}',
        "[]",
      ]) {
        await failsWith(
          tx,
          () =>
            tx.query("update public.printer_profiles set config = $2::jsonb where id = $1", [
              PRINTER_PROFILE.pdf,
              config,
            ]),
          P0001("printer_config_invalid"),
        );
      }
      await tx.query(
        `update public.printer_profiles set config = '{"offset_x_mm": -5, "offset_y_mm": 1.5}' where id = $1`,
        [PRINTER_PROFILE.pdf],
      );
      for (const [w, h, constraint] of [
        [151, 40, "label_templates_width_mm_check"],
        [58, 151, "label_templates_height_mm_check"],
      ] as const) {
        await failsWith(
          tx,
          () =>
            tx.query(
              "update public.label_templates set width_mm = $2, height_mm = $3 where id = $1",
              [LABEL_TEMPLATE.unit, w, h],
            ),
          { code: "23514", constraint },
        );
      }
      await failsWith(tx, () => tx.query("select 'NaN'::public.label_mm"), { code: "23514" });
    });
  });

  it("layout validation follows layout v1 for every writer", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      for (const c of LAYOUT_CASES) {
        const problem = await scalar<string | null>(
          tx,
          "select private.label_layout_problem($1::jsonb, $2, $3)",
          [JSON.stringify(c.layout), c.widthMm, c.heightMm],
        );
        if (c.valid) {
          expect(problem, c.name).toBeNull();
        } else {
          expect(problem, c.name).toContain(c.problemIncludes);
        }
      }
      await actAs(tx, ADMIN);
      for (const c of LAYOUT_CASES.filter((l) => !l.valid)) {
        await failsWith(
          tx,
          () =>
            insertTemplate(
              tx,
              productTemplate(`Bad ${c.name}`, {
                width_mm: c.widthMm,
                height_mm: c.heightMm,
                layout: JSON.stringify(c.layout),
              }),
            ),
          {
            code: "P0001",
            message: "label_layout_invalid",
            detail: expect.stringContaining(c.problemIncludes!),
          },
        );
      }
    });
  });
});

describe.skipIf(!isolatedDatabase())("who reads labels", () => {
  it("customers and anonymous visitors read nothing about labels", async () => {
    await inTx(async (tx) => {
      await ownerMode(tx);
      const customerId = await makeCustomer(tx);
      const login = await linkCustomerLogin(tx, customerId);
      expect(customerId).not.toBe(CUSTOMER.chloe);
      await actAs(tx, customerClaims(login));
      for (const table of ["label_templates", "printer_profiles", "print_jobs"]) {
        expect(await scalar<number>(tx, `select count(*)::int from public.${table}`)).toBe(0);
      }
      const denied = { code: "42501" };
      await failsWith(tx, () => labelPreview(tx, "product", PRODUCT.barTape), denied);
      await failsWith(
        tx,
        () => createPrintJob(tx, { kind: "product", entityId: PRODUCT.barTape }),
        denied,
      );
      await failsWith(tx, () => setJobStatus(tx, randomUUID(), "printed"), denied);
      await failsWith(tx, () => setDefaultTemplate(tx, LABEL_TEMPLATE.product), denied);
      await failsWith(tx, () => setDefaultProfile(tx, PRINTER_PROFILE.pdf), denied);

      await actAs(tx, ANON);
      for (const table of ["label_templates", "printer_profiles", "print_jobs"]) {
        await failsWith(tx, () => tx.query(`select * from public.${table}`), denied);
      }
      await failsWith(tx, () => labelPreview(tx, "product", PRODUCT.barTape), denied);
      await failsWith(
        tx,
        () => createPrintJob(tx, { kind: "product", entityId: PRODUCT.barTape }),
        denied,
      );
      await failsWith(tx, () => setJobStatus(tx, randomUUID(), "printed"), denied);
    });
  });
});
