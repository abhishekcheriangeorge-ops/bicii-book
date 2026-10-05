import { describe, expect, it } from "vitest";

import {
  buildReceiptLines,
  checkCost,
  checkQuantity,
  clampQuantity,
  clearReceiveDraft,
  costDiffers,
  defaultValues,
  duplicateReference,
  duplicateWarning,
  initialReceiveState,
  isEditable,
  loadReceiveDraft,
  mergeValues,
  normaliseReference,
  receiveDraftKey,
  receiveReducer,
  receiveTotals,
  receivedAtBounds,
  receivedAtForSubmit,
  saveReceiveDraft,
  setAllQuantities,
  toRpcLines,
  type ReceiptSummary,
  type ReceiveEvent,
  type ReceiveLineDef,
  type ReceiveState,
  type RecordedReference,
} from "@/lib/receive-form";

/**
 * The Receive screen's pure parts (src/lib/receive-form.ts; SPEC §2
 * "retries cannot duplicate stock"; PLAN D63 D-LASTCOST, D64
 * D-RECEIPT-TIME, D65 D-OVERRECEIPT).
 */

const PO = "8a3f0c55-1111-4aaa-8bbb-000000000001";
const LINE_A = "8a3f0c55-2222-4aaa-8bbb-00000000000a";
const LINE_B = "8a3f0c55-2222-4aaa-8bbb-00000000000b";
const SHOP = "8a3f0c55-3333-4aaa-8bbb-000000000001";
const BACK = "8a3f0c55-3333-4aaa-8bbb-000000000002";
const KEY_1 = "8a3f0c55-4444-4aaa-8bbb-000000000001";
const KEY_2 = "8a3f0c55-4444-4aaa-8bbb-000000000002";

const DEFS: ReceiveLineDef[] = [
  { id: LINE_A, outstanding: 20, unitCost: "12.00" },
  { id: LINE_B, outstanding: 2, unitCost: "0.00" },
];

const RECEIPT: ReceiptSummary = {
  receiptId: "8a3f0c55-5555-4aaa-8bbb-000000000001",
  purchaseOrderId: PO,
  poNumber: "PO-000034",
  receivedAt: "2026-10-05T02:42:00Z",
  receivedBy: "Asha Admin",
  reference: "DN-5531",
  units: 18,
};

function run(events: ReceiveEvent[], from?: ReceiveState): ReceiveState {
  return events.reduce(receiveReducer, from ?? initialReceiveState(defaultValues(DEFS, SHOP)));
}

/** A memory Storage; `throws` makes every access throw (blocked site data). */
function memoryStorage(throws = false) {
  const map = new Map<string, string>();
  const guard = () => {
    if (throws) throw new Error("SecurityError");
  };
  return {
    map,
    getItem: (k: string) => (guard(), map.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void map.set(k, v)),
    removeItem: (k: string) => (guard(), void map.delete(k)),
  };
}

describe("building the receive_purchase lines", () => {
  it("drops lines at 0, sends whole quantities and string costs, and always the cost", () => {
    const values = defaultValues(DEFS, SHOP);
    values.lines[LINE_A] = { quantity: "18", unitCost: "12.5", locationId: null };
    values.lines[LINE_B] = { quantity: "0", unitCost: "3.00", locationId: null };
    const built = buildReceiptLines(DEFS, values);
    expect(built).toEqual({
      ok: true,
      lines: [
        {
          purchaseOrderLineId: LINE_A,
          quantityReceived: 18,
          unitCostActual: "12.50",
          locationId: SHOP,
        },
      ],
    });
    if (!built.ok) throw new Error("expected ok");
    expect(Number.isInteger(built.lines[0].quantityReceived)).toBe(true);
    expect(typeof built.lines[0].unitCostActual).toBe("string");
  });

  it("keeps a 0 cost as a known cost (D24 as amended, D63)", () => {
    const values = defaultValues(DEFS, SHOP);
    values.lines[LINE_A].quantity = "0";
    values.lines[LINE_B] = { quantity: "2", unitCost: "0", locationId: BACK };
    const built = buildReceiptLines(DEFS, values);
    expect(built).toEqual({
      ok: true,
      lines: [
        {
          purchaseOrderLineId: LINE_B,
          quantityReceived: 2,
          unitCostActual: "0.00",
          locationId: BACK,
        },
      ],
    });
  });

  it("refuses more than is still to come, fractions and a blank cost", () => {
    const values = defaultValues(DEFS, SHOP);
    values.lines[LINE_A].quantity = "21";
    values.lines[LINE_B] = { quantity: "1", unitCost: "", locationId: null };
    const built = buildReceiptLines(DEFS, values);
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("expected errors");
    expect(built.lineErrors[LINE_A].quantity).toBe(
      "Only 20 still to come. Raise the ordered quantity on the order first.",
    );
    expect(built.lineErrors[LINE_B].unitCost).toMatch(/Enter the unit cost/);
    expect(checkQuantity("1.5", 5)).toMatchObject({ ok: false });
  });

  it("maps to snake_case JSON with the cost as a string", () => {
    expect(
      toRpcLines([
        {
          purchaseOrderLineId: LINE_A,
          quantityReceived: 3,
          unitCostActual: "0.00",
          locationId: SHOP,
        },
      ]),
    ).toEqual([
      {
        purchase_order_line_id: LINE_A,
        quantity_received: 3,
        unit_cost_actual: "0.00",
        location_id: SHOP,
      },
    ]);
  });
});

describe("quantities, costs and totals", () => {
  it("clamps the steppers to 0..outstanding", () => {
    expect(clampQuantity(-3, 5)).toBe(0);
    expect(clampQuantity(7, 5)).toBe(5);
    expect(clampQuantity(2.9, 5)).toBe(2);
    expect(clampQuantity(Number.NaN, 5)).toBe(0);
    expect(checkQuantity("", 5)).toEqual({ ok: true, quantity: 0 });
    expect(checkQuantity("3", 2)).toEqual({
      ok: false,
      quantity: 3,
      message: "Only 2 still to come. Raise the ordered quantity on the order first.",
    });
  });

  it("checks costs like purchaseUnitCostSchema (0 valid, 2 decimals, a ceiling)", () => {
    expect(checkCost("0")).toEqual({ ok: true, cost: "0.00" });
    expect(checkCost("S$12.5")).toEqual({ ok: true, cost: "12.50" });
    expect(checkCost("12.345").ok).toBe(false);
    expect(checkCost("100000").ok).toBe(false);
    expect(checkCost("-1").ok).toBe(false);
    expect(costDiffers("12.50", "12.00")).toBe(true);
    expect(costDiffers("12", "12.00")).toBe(false);
  });

  it("counts items and lines and previews the value, skipping lines at 0", () => {
    const values = defaultValues(DEFS, SHOP);
    values.lines[LINE_A] = { quantity: "18", unitCost: "12.50", locationId: null };
    values.lines[LINE_B].quantity = "0";
    const totals = receiveTotals(DEFS, values);
    expect(totals.text).toBe("18 items on 1 line");
    expect(totals.value.toFixed(2)).toBe("225.00");
    values.lines[LINE_B].quantity = "1";
    expect(receiveTotals(DEFS, values).text).toBe("19 items on 2 lines");
    const one = setAllQuantities(values, DEFS, "zero");
    one.lines[LINE_B].quantity = "1";
    expect(receiveTotals(DEFS, one).text).toBe("1 item on 1 line");
  });

  it("'All to come' and 'Clear all' set every line", () => {
    const cleared = setAllQuantities(defaultValues(DEFS, SHOP), DEFS, "zero");
    expect(Object.values(cleared.lines).map((l) => l.quantity)).toEqual(["0", "0"]);
    const all = setAllQuantities(cleared, DEFS, "outstanding");
    expect(Object.values(all.lines).map((l) => l.quantity)).toEqual(["20", "2"]);
  });

  it("merges stored values over the current lines", () => {
    const stored = defaultValues(DEFS, BACK);
    stored.lines[LINE_A].quantity = "7";
    const merged = mergeValues([DEFS[0]], stored, SHOP);
    expect(Object.keys(merged.lines)).toEqual([LINE_A]);
    expect(merged.lines[LINE_A].quantity).toBe("7");
    expect(merged.receiveInto).toBe(BACK);
  });
});

describe("received date-time (D64)", () => {
  const now = new Date("2026-10-05T02:42:30Z");

  it("bounds the input to 30 days back, not before submission, and now", () => {
    expect(receivedAtBounds(now, null)).toEqual({
      min: "2026-09-05T10:42",
      max: "2026-10-05T10:42",
    });
    expect(receivedAtBounds(now, "2026-10-01T01:00:00Z").min).toBe("2026-10-01T09:00");
  });

  it("sends receivedAt only when changed, as an ISO instant from shop time", () => {
    const values = defaultValues(DEFS, SHOP);
    expect(receivedAtForSubmit(values)).toBeUndefined();
    expect(
      receivedAtForSubmit({ ...values, receivedAt: "2026-10-04T16:30", receivedAtChanged: true }),
    ).toBe("2026-10-04T08:30:00.000Z");
    expect(receivedAtForSubmit({ ...values, receivedAt: "", receivedAtChanged: true })).toBeNull();
  });
});

describe("duplicate delivery-note guard (D65)", () => {
  const recorded: RecordedReference[] = [
    {
      reference: "DN-5531",
      normalised: normaliseReference("DN-5531"),
      receivedAt: "2026-10-05T02:42:00Z",
      receivedBy: "Asha Admin",
      units: 18,
    },
  ];

  it("matches trimmed and case-insensitive, never a blank reference", () => {
    expect(duplicateReference("  dn-5531 ", recorded)?.reference).toBe("DN-5531");
    expect(duplicateReference("DN-5532", recorded)).toBeNull();
    expect(duplicateReference("   ", recorded)).toBeNull();
  });

  it("says when and by whom", () => {
    expect(duplicateWarning(recorded[0], new Date("2026-10-05T05:00:00Z"))).toBe(
      "DN-5531 was already recorded at 10:42 am by Asha Admin (18 items)",
    );
    expect(duplicateWarning(recorded[0], new Date("2026-10-07T05:00:00Z"))).toMatch(
      /^DN-5531 was already recorded on 5 Oct 2026, 10:42 am by Asha Admin \(18 items\)$/,
    );
  });
});

describe("the idempotency state machine", () => {
  const values = defaultValues(DEFS, SHOP);
  const editing = run([{ type: "start", key: KEY_1, values }]);

  it("starts locked, then editing with the new key", () => {
    expect(isEditable(initialReceiveState(values).phase)).toBe(false);
    expect(editing).toMatchObject({ phase: "editing", key: KEY_1 });
  });

  it("locks editing while submitting; a second submit changes nothing", () => {
    const submitting = run([{ type: "submit" }], editing);
    expect(submitting.phase).toBe("submitting");
    expect(isEditable(submitting.phase)).toBe(false);
    const changed = { ...values, reference: "DN-1" };
    expect(run([{ type: "edit", values: changed }, { type: "submit" }], submitting)).toEqual(
      submitting,
    );
    expect(run([{ type: "slow" }], submitting).slow).toBe(true);
  });

  it("unknown -> checking (locked) -> recorded", () => {
    const checking = run([{ type: "submit" }, { type: "unknown" }], editing);
    expect(checking.phase).toBe("checking");
    expect(isEditable(checking.phase)).toBe(false);
    expect(run([{ type: "edit", values: { ...values, notes: "x" } }], checking)).toEqual(checking);
    const recorded = run([{ type: "found", receipt: RECEIPT }], checking);
    expect(recorded).toMatchObject({ phase: "recorded", recorded: RECEIPT, key: KEY_1 });
  });

  it("unknown -> checking -> notRecorded -> retry with the same key and values", () => {
    const notRecorded = run(
      [{ type: "submit" }, { type: "unknown" }, { type: "notFound" }],
      editing,
    );
    expect(notRecorded.phase).toBe("notRecorded");
    expect(isEditable(notRecorded.phase)).toBe(true);
    const retry = run([{ type: "submit" }], notRecorded);
    expect(retry).toMatchObject({ phase: "submitting", key: KEY_1, values });
  });

  it("a failed lookup stays checking and locked until Check again", () => {
    const failed = run(
      [{ type: "submit" }, { type: "unknown" }, { type: "lookupFailed" }],
      editing,
    );
    expect(failed).toMatchObject({ phase: "checking", lookupFailed: true });
    expect(run([{ type: "submit" }], failed)).toEqual(failed);
    expect(run([{ type: "checkAgain" }], failed)).toMatchObject({
      phase: "checking",
      lookupFailed: false,
    });
  });

  it("key_reused -> checking -> recorded, never a new key with the old values", () => {
    const typed = { ...values, reference: "DN-9" };
    const reused = run(
      [{ type: "edit", values: typed }, { type: "submit" }, { type: "keyReused" }],
      editing,
    );
    expect(reused).toMatchObject({ phase: "checking", key: KEY_1 });
    const recorded = run([{ type: "found", receipt: RECEIPT }], reused);
    expect(recorded.key).toBe(KEY_1);
    // Nothing but "Receive another delivery" changes the key, and it brings new values.
    for (const e of [
      { type: "start", key: KEY_2, values: typed },
      { type: "resume", key: KEY_2, values: typed, pending: false },
      { type: "submit" },
      { type: "edit", values: typed },
    ] as ReceiveEvent[]) {
      expect(receiveReducer(recorded, e).key).toBe(KEY_1);
    }
  });

  it("'Receive another delivery' gives a new key and the new defaults", () => {
    const recorded = run(
      [
        { type: "edit", values: { ...values, reference: "DN-1", notes: "old" } },
        { type: "submit" },
        { type: "unknown" },
        { type: "found", receipt: RECEIPT },
      ],
      editing,
    );
    const fresh = defaultValues([{ id: LINE_A, outstanding: 2, unitCost: "12.50" }], SHOP);
    const next = run([{ type: "receiveAnother", key: KEY_2, values: fresh }], recorded);
    expect(next).toMatchObject({ phase: "editing", key: KEY_2, values: fresh, recorded: null });
    expect(next.values.reference).toBe("");
    expect(next.values.lines[LINE_A].quantity).toBe("2");
  });

  it("definite refusals return to editing with the same key", () => {
    const submitting = run([{ type: "submit" }], editing);
    const over = run(
      [{ type: "refused", code: "purchase_over_receipt", message: "Too many" }],
      submitting,
    );
    expect(over).toMatchObject({
      phase: "editing",
      key: KEY_1,
      values,
      overReceipt: true,
      error: "Too many",
    });
    const date = run(
      [{ type: "refused", code: "purchase_receipt_too_old", message: "At most 30 days" }],
      submitting,
    );
    expect(date).toMatchObject({
      phase: "editing",
      key: KEY_1,
      receivedAtError: "At most 30 days",
    });
    const closed = run(
      [{ type: "refused", code: "purchase_order_closed", message: "Closed" }],
      submitting,
    );
    expect(closed.phase).toBe("closed");
    expect(run([{ type: "succeeded" }], submitting).phase).toBe("done");
  });

  it("a stored key is checked on mount: not found is editing, or Retry if it was pending", () => {
    const resumed = run([{ type: "resume", key: KEY_1, values, pending: false }]);
    expect(resumed).toMatchObject({ phase: "checking", key: KEY_1 });
    expect(run([{ type: "notFound" }], resumed).phase).toBe("editing");
    const pending = run([{ type: "resume", key: KEY_1, values, pending: true }]);
    expect(run([{ type: "notFound" }], pending)).toMatchObject({
      phase: "notRecorded",
      key: KEY_1,
    });
    expect(run([{ type: "found", receipt: RECEIPT }], pending).phase).toBe("recorded");
  });
});

describe("the key store", () => {
  it("creates, reuses across reloads and clears", () => {
    const storage = memoryStorage();
    expect(loadReceiveDraft(PO, storage)).toBeNull();
    const values = defaultValues(DEFS, SHOP);
    expect(saveReceiveDraft(PO, { key: KEY_1, values, pending: false }, storage)).toBe(true);
    expect(storage.map.has(receiveDraftKey(PO))).toBe(true);
    // A reload reads the same key and values.
    expect(loadReceiveDraft(PO, storage)).toEqual({ v: 1, key: KEY_1, values, pending: false });
    saveReceiveDraft(PO, { key: KEY_1, values, pending: true }, storage);
    expect(loadReceiveDraft(PO, storage)?.pending).toBe(true);
    clearReceiveDraft(PO, storage);
    expect(loadReceiveDraft(PO, storage)).toBeNull();
  });

  it("ignores what it cannot read and works when storage throws", () => {
    const storage = memoryStorage();
    storage.map.set(receiveDraftKey(PO), "{not json");
    expect(loadReceiveDraft(PO, storage)).toBeNull();
    storage.map.set(receiveDraftKey(PO), JSON.stringify({ v: 1, key: "nope", values: {} }));
    expect(loadReceiveDraft(PO, storage)).toBeNull();
    const blocked = memoryStorage(true);
    expect(loadReceiveDraft(PO, blocked)).toBeNull();
    expect(
      saveReceiveDraft(
        PO,
        { key: KEY_1, values: defaultValues(DEFS, SHOP), pending: true },
        blocked,
      ),
    ).toBe(false);
    expect(() => clearReceiveDraft(PO, blocked)).not.toThrow();
    expect(
      saveReceiveDraft(PO, { key: KEY_1, values: defaultValues(DEFS, SHOP), pending: true }, null),
    ).toBe(false);
  });

  it("uses window.sessionStorage by default", () => {
    window.sessionStorage.clear();
    saveReceiveDraft(PO, { key: KEY_2, values: defaultValues(DEFS, SHOP), pending: false });
    expect(window.sessionStorage.getItem(`bicii:receive:${PO}`)).toContain(KEY_2);
    clearReceiveDraft(PO);
    expect(window.sessionStorage.getItem(`bicii:receive:${PO}`)).toBeNull();
  });
});
