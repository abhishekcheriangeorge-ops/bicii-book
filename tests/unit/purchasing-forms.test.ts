import { describe, expect, it } from "vitest";

import {
  cancelPurchaseOrderSchema,
  createPurchaseOrderFromLowStockSchema,
  createPurchaseOrderSchema,
  purchaseOrderLineSchema,
  purchaseUnitCostSchema,
  receivePurchaseSchema,
  removePurchaseOrderLineSchema,
  supplierProductSchema,
  supplierSchema,
} from "@/lib/purchasing-forms";

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const ID2 = "1f0e0d0c-0b0a-4908-8706-050403020100";
const ID3 = "2f0e0d0c-0b0a-4908-8706-050403020100";

const errorsOf = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.path.join("."));

describe("purchaseUnitCostSchema (purchase_order_lines_unit_cost_check)", () => {
  it("accepts 0 as a known cost (D24 as amended) and up to 99,999.99, as a string", () => {
    expect(purchaseUnitCostSchema.parse("0")).toBe("0.00");
    expect(purchaseUnitCostSchema.parse(0)).toBe("0.00");
    expect(purchaseUnitCostSchema.parse("99999.99")).toBe("99999.99");
    expect(purchaseUnitCostSchema.parse(" S$1,234.5 ")).toBe("1234.50");
    expect(purchaseUnitCostSchema.parse("12")).toBe("12.00");
    expect(typeof purchaseUnitCostSchema.parse(12.5)).toBe("string");
  });

  it("refuses negatives, 100,000 and more, three decimals and blanks", () => {
    for (const bad of ["-0.01", "100000", "100000.00", "12.345", "", "  ", "abc", "1.2.3"]) {
      expect(purchaseUnitCostSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(purchaseUnitCostSchema.safeParse("12.345").error?.issues[0]?.message).toMatch(
      /2 decimals/,
    );
    expect(purchaseUnitCostSchema.safeParse("100000").error?.issues[0]?.message).toMatch(
      /\$99,999\.99/,
    );
  });
});

describe("purchase order schemas", () => {
  it("creates a draft with optional fields blank as null and a real date", () => {
    const ok = createPurchaseOrderSchema.parse({
      id: ID,
      supplierId: ID2,
      expectedAt: "2026-10-12",
      supplierReference: "  ",
      notes: "",
    });
    expect(ok).toEqual({
      id: ID,
      supplierId: ID2,
      expectedAt: "2026-10-12",
      supplierReference: null,
      notes: null,
    });
    expect(createPurchaseOrderSchema.parse({ id: ID, supplierId: ID2 }).expectedAt).toBeNull();
    expect(
      errorsOf(
        createPurchaseOrderSchema.safeParse({ id: ID, supplierId: "", expectedAt: "2026-02-31" }),
      ),
    ).toEqual(["supplierId", "expectedAt"]);
  });

  it("takes a line's quantity as a whole number 1..100,000 and its cost as a string", () => {
    const line = purchaseOrderLineSchema.parse({
      id: ID,
      purchaseOrderId: ID2,
      productId: ID3,
      quantityOrdered: "20",
      unitCost: "12.00",
      reason: " ",
    });
    expect(line.quantityOrdered).toBe(20);
    expect(line.unitCost).toBe("12.00");
    expect(line.reason).toBeNull();
    expect(line.expectedAt).toBeNull();
    const zero = purchaseOrderLineSchema.parse({
      id: ID,
      purchaseOrderId: ID2,
      productId: ID3,
      quantityOrdered: 1,
      unitCost: "0",
    });
    expect(zero.unitCost).toBe("0.00");
    expect(
      errorsOf(
        purchaseOrderLineSchema.safeParse({
          id: ID,
          purchaseOrderId: ID2,
          productId: ID3,
          quantityOrdered: "0",
          unitCost: "-1",
          reason: "x".repeat(501),
        }),
      ),
    ).toEqual(["quantityOrdered", "unitCost", "reason"]);
    expect(
      errorsOf(
        purchaseOrderLineSchema.safeParse({
          id: ID,
          purchaseOrderId: ID2,
          productId: ID3,
          quantityOrdered: "100001",
          unitCost: "1",
        }),
      ),
    ).toEqual(["quantityOrdered"]);
    expect(
      errorsOf(
        purchaseOrderLineSchema.safeParse({
          id: ID,
          purchaseOrderId: ID2,
          productId: ID3,
          quantityOrdered: "2.5",
          unitCost: "1",
        }),
      ),
    ).toEqual(["quantityOrdered"]);
  });

  it("needs a reason to cancel, optional to remove a line", () => {
    expect(
      errorsOf(cancelPurchaseOrderSchema.safeParse({ purchaseOrderId: ID, reason: " " })),
    ).toEqual(["reason"]);
    expect(
      cancelPurchaseOrderSchema.parse({ purchaseOrderId: ID, reason: " Supplier closed " }).reason,
    ).toBe("Supplier closed");
    expect(removePurchaseOrderLineSchema.parse({ lineId: ID }).reason).toBeNull();
  });
});

describe("supplier schemas", () => {
  it("normalises the website and leaves blanks as null", () => {
    const s = supplierSchema.parse({
      id: ID,
      name: "  Velo Parts ",
      website: "veloparts.test",
      email: "",
      phone: " +65 6123 4501 ",
    });
    expect(s).toMatchObject({
      name: "Velo Parts",
      website: "https://veloparts.test",
      email: null,
      phone: "+65 6123 4501",
      contactName: null,
      accountReference: null,
      notes: null,
    });
    expect(
      errorsOf(supplierSchema.safeParse({ id: ID, name: " ", email: "nope", website: "a b" })),
    ).toEqual(["name", "email", "website"]);
  });

  it("links a product with an optional lead time 0..365 and a preferred switch", () => {
    const link = supplierProductSchema.parse({
      supplierId: ID,
      productId: ID2,
      supplierSku: "",
      leadDays: "7",
      preferred: "on",
    });
    expect(link).toEqual({
      supplierId: ID,
      productId: ID2,
      supplierSku: null,
      leadDays: 7,
      preferred: true,
    });
    expect(supplierProductSchema.parse({ supplierId: ID, productId: ID2 })).toMatchObject({
      leadDays: null,
      preferred: false,
    });
    expect(
      errorsOf(
        supplierProductSchema.safeParse({ supplierId: ID, productId: ID2, leadDays: "366" }),
      ),
    ).toEqual(["leadDays"]);
  });
});

describe("receivePurchaseSchema (Phase 7 step 4)", () => {
  const base = {
    purchaseOrderId: "8a3f0c55-1111-4aaa-8bbb-000000000001",
    idempotencyKey: "8a3f0c55-4444-4aaa-8bbb-000000000001",
    lines: [
      {
        purchaseOrderLineId: "8a3f0c55-2222-4aaa-8bbb-00000000000a",
        quantityReceived: 18,
        unitCostActual: "0",
        locationId: "8a3f0c55-3333-4aaa-8bbb-000000000001",
      },
    ],
  };

  it("accepts a 0 actual cost as a known cost (D24 as amended) and omits receivedAt as null", () => {
    const parsed = receivePurchaseSchema.parse(base);
    expect(parsed.lines[0].unitCostActual).toBe("0.00");
    expect(parsed.receivedAt).toBeNull();
    expect(parsed.reference).toBeNull();
  });

  it("takes an ISO instant with an offset and refuses other dates", () => {
    expect(
      receivePurchaseSchema.parse({ ...base, receivedAt: "2026-10-04T08:30:00.000Z" }).receivedAt,
    ).toBe("2026-10-04T08:30:00.000Z");
    expect(
      receivePurchaseSchema.safeParse({ ...base, receivedAt: "2026-10-04T16:30:00+08:00" }).success,
    ).toBe(true);
    expect(
      receivePurchaseSchema.safeParse({ ...base, receivedAt: "2026-10-04T16:30" }).success,
    ).toBe(false);
  });

  it("refuses fractional or zero quantities, no lines and more than 200", () => {
    const line = base.lines[0];
    for (const quantityReceived of [0, 1.5, 100_001]) {
      expect(
        receivePurchaseSchema.safeParse({ ...base, lines: [{ ...line, quantityReceived }] })
          .success,
      ).toBe(false);
    }
    expect(receivePurchaseSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(
      receivePurchaseSchema.safeParse({ ...base, lines: Array.from({ length: 201 }, () => line) })
        .success,
    ).toBe(false);
    expect(receivePurchaseSchema.safeParse({ ...base, reference: "x".repeat(101) }).success).toBe(
      false,
    );
  });

  it("creates from low stock with 1..100 products", () => {
    const ok = {
      id: base.idempotencyKey,
      supplierId: base.purchaseOrderId,
      productIds: [base.lines[0].locationId],
    };
    expect(createPurchaseOrderFromLowStockSchema.safeParse(ok).success).toBe(true);
    expect(createPurchaseOrderFromLowStockSchema.safeParse({ ...ok, productIds: [] }).success).toBe(
      false,
    );
  });
});
