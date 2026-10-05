import type { LabelContent, LabelKind } from "./types";

/**
 * Sample label content per kind for the admin template previews and the
 * tests: realistic, clearly marked as samples, on a fixed example base
 * (example.com, never the shop's address).
 */
export const SAMPLE_QR_BASE = "https://example.com";

export const SAMPLE_CONTENT: Record<LabelKind, LabelContent> = {
  product: {
    kind: "product",
    shortId: "P-000123",
    qrPayload: `${SAMPLE_QR_BASE}/q/P-000123`,
    name: "Sample: Supacaz Super Sticky Kush bar tape",
    price: "39.90",
    currency: "SGD",
    sku: "SAMPLE-TAPE-BLK",
    identity: ["Supacaz"],
    serialNumber: null,
  },
  unit: {
    kind: "unit",
    shortId: "U-000045",
    qrPayload: `${SAMPLE_QR_BASE}/q/U-000045`,
    name: "Sample: Colnago C64 Disc (2019), 54 cm",
    price: "4200.00",
    currency: "SGD",
    sku: null,
    identity: ["Size 54 · Red", "Lightly used, new tyres"],
    serialNumber: "SAMPLE123456",
  },
  bike: {
    kind: "bike",
    shortId: "B-000678",
    qrPayload: `${SAMPLE_QR_BASE}/q/B-000678`,
    name: "Sample: Specialized Tarmac SL7",
    price: null,
    currency: "SGD",
    sku: null,
    identity: ["Size 56 · Tan"],
    serialNumber: "WSBCSAMPLE01",
  },
};
