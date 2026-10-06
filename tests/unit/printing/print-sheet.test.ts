import { describe, expect, it } from "vitest";

import {
  LABEL_PRINTER_KEY,
  choosePrinter,
  chooseTemplate,
  describeLabelPrice,
  initialQuantity,
  parsePrintParams,
  priceChanged,
  printButtonLabel,
  readRememberedPrinter,
  rememberPrinter,
} from "@/lib/printing/print-sheet";

const A = "a8000000-0000-4000-8000-000000000001";
const B = "a8000000-0000-4000-8000-000000000002";
const C = "a8000000-0000-4000-8000-000000000003";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("full");
  },
};

describe("the printer this device used last (localStorage)", () => {
  it("is remembered and read back under its key", () => {
    const storage = memoryStorage();
    rememberPrinter(B, storage);
    expect(storage.map.get(LABEL_PRINTER_KEY)).toBe(B);
    expect(readRememberedPrinter(storage)).toBe(B);
  });

  it("ignores missing, malformed or blocked storage", () => {
    expect(readRememberedPrinter(null)).toBeNull();
    expect(readRememberedPrinter(memoryStorage({ [LABEL_PRINTER_KEY]: "laser" }))).toBeNull();
    expect(readRememberedPrinter(throwing)).toBeNull();
    expect(() => rememberPrinter(A, throwing)).not.toThrow();
  });
});

describe("choosePrinter", () => {
  it("prefers the reprinted job's, then this device's, then the default", () => {
    expect(choosePrinter([A, B, C], { presetId: C, rememberedId: B, defaultId: A })).toBe(C);
    expect(choosePrinter([A, B, C], { rememberedId: B, defaultId: A })).toBe(B);
    expect(choosePrinter([A, B, C], { defaultId: A })).toBe(A);
  });

  it("skips a printer that is gone or switched off", () => {
    expect(choosePrinter([A, C], { presetId: B, rememberedId: B, defaultId: A })).toBe(A);
    expect(choosePrinter([C], { rememberedId: B, defaultId: A })).toBe(C);
    expect(choosePrinter([], { defaultId: A })).toBeNull();
  });
});

describe("chooseTemplate", () => {
  it("keeps the reprinted job's template while it is active, else the default", () => {
    expect(chooseTemplate([A, B], { presetId: B, defaultId: A })).toBe(B);
    expect(chooseTemplate([A], { presetId: B, defaultId: A })).toBe(A);
    expect(chooseTemplate([B], { defaultId: A })).toBe(B);
  });
});

describe("priceChanged (D58, D24 amended)", () => {
  it("compares decimals, not strings", () => {
    expect(priceChanged("39.90", "39.9")).toBe(false);
    expect(priceChanged("49.00", "45.00")).toBe(true);
  });

  it("treats 0 as a known price and null as no price", () => {
    expect(priceChanged("0.00", "0")).toBe(false);
    expect(priceChanged(null, "0.00")).toBe(true);
    expect(priceChanged("0.00", null)).toBe(true);
    expect(priceChanged(null, null)).toBe(false);
  });
});

describe("describeLabelPrice (D58, D24 amended)", () => {
  it("says no price for NULL and $0.00 for a zero price", () => {
    expect(describeLabelPrice(null, "SGD")).toBe("no price");
    expect(describeLabelPrice("0.00", "SGD")).toBe("$0.00");
    expect(describeLabelPrice("39.90", "SGD")).toBe("$39.90");
  });
});

describe("initialQuantity (D56: a per-job cap)", () => {
  it("defaults to 1", () => {
    expect(initialQuantity("product", null)).toEqual({ quantity: 1, remaining: 0 });
    expect(initialQuantity("unit", 0)).toEqual({ quantity: 1, remaining: 0 });
  });

  it("caps at the kind's maximum and says how many remain", () => {
    expect(initialQuantity("product", 120)).toEqual({ quantity: 120, remaining: 0 });
    expect(initialQuantity("product", 620)).toEqual({ quantity: 500, remaining: 120 });
    expect(initialQuantity("bike", 12)).toEqual({ quantity: 10, remaining: 2 });
  });
});

describe("printButtonLabel", () => {
  it("pluralises the count", () => {
    expect(printButtonLabel("1")).toBe("Print 1 label");
    expect(printButtonLabel("10")).toBe("Print 10 labels");
    expect(printButtonLabel("")).toBe("Print labels");
    expect(printButtonLabel("2.5")).toBe("Print labels");
  });
});

describe("parsePrintParams (?print=1&qty=N&reprint=…)", () => {
  const job = "a9000000-0000-4000-8000-000000000002";

  it("opens only with print=1", () => {
    expect(parsePrintParams({})).toEqual({
      open: false,
      requestedQuantity: null,
      reprintOfId: null,
    });
    expect(parsePrintParams({ print: "yes", qty: "3", reprint: job })).toEqual({
      open: false,
      requestedQuantity: null,
      reprintOfId: null,
    });
  });

  it("reads the count and the reprinted job", () => {
    expect(parsePrintParams({ print: "1", qty: "12", reprint: job.toUpperCase() })).toEqual({
      open: true,
      requestedQuantity: 12,
      reprintOfId: job,
    });
  });

  it("ignores a malformed count or job", () => {
    expect(parsePrintParams({ print: ["1", "0"], qty: "-2", reprint: "J-000001" })).toEqual({
      open: true,
      requestedQuantity: null,
      reprintOfId: null,
    });
    expect(parsePrintParams({ print: "1", qty: "0" }).requestedQuantity).toBeNull();
  });
});
