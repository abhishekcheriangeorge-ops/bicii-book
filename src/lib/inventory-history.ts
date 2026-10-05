/**
 * How a product's and a unit's history read (product_events,
 * inventory_unit_events; DATA-MODEL §6). Pure, so the record pages and
 * tests share it. Payloads never carry a cost (the database guarantees
 * it): a cost change reads "Cost changed", never a value.
 */
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";

import {
  PUBLICATION_LABELS,
  UNIT_STATUS_LABELS,
  type PublicationStatus,
  type UnitStatus,
} from "./inventory";

type Payload = Record<string, unknown>;

const text = (p: Payload, key: string): string | null => {
  const v = p[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
};

const isAmount = (v: unknown): v is number | string =>
  typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()));

const FIELD_LABELS: Record<string, string> = {
  sku: "SKU",
  name: "name",
  description: "description",
  brand: "brand",
  category_id: "category",
  reorder_point: "reorder point",
  active: "active",
  ownership_type: "ownership",
  currency: "currency",
  shopify_product_id: "Shopify link",
  shopify_variant_id: "Shopify link",
  serial_number: "serial number",
  condition: "condition",
  internal_notes: "internal notes",
  bike_id: "bike",
  consignment_item_id: "consignment",
  sold_sale_line_id: "sale",
};

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function changedFields(p: Payload): string {
  const fields = Array.isArray(p.fields) ? p.fields.filter((f) => typeof f === "string") : [];
  const words = [...new Set(fields.map((f) => FIELD_LABELS[f] ?? f.replaceAll("_", " ")))];
  if (words.length === 0) return "Details changed";
  const list = joinWords(words);
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} changed`;
}

function priceChange(p: Payload, currency: string): string {
  const from = isAmount(p.from) ? formatMoney(p.from, currency) : "none";
  const to = isAmount(p.to) ? formatMoney(p.to, currency) : "none";
  return `Price changed from ${from} to ${to}`;
}

const isPublication = (v: unknown): v is PublicationStatus =>
  typeof v === "string" && Object.hasOwn(PUBLICATION_LABELS, v);
const isUnitStatus = (v: unknown): v is UnitStatus =>
  typeof v === "string" && Object.hasOwn(UNIT_STATUS_LABELS, v);

/** One product_events row in staff words. */
export function describeProductEvent(
  type: string,
  payload: Payload,
  { currency = DEFAULT_CURRENCY }: { currency?: string } = {},
): string {
  switch (type) {
    case "created": {
      const status = isPublication(payload.publication_status)
        ? ` as ${PUBLICATION_LABELS[payload.publication_status].toLowerCase()}`
        : "";
      return `Created${status}`;
    }
    case "details_changed":
      return changedFields(payload);
    case "price_changed":
      return priceChange(payload, currency);
    case "cost_changed":
      return "Cost changed";
    case "publication_changed":
      return isPublication(payload.from) && isPublication(payload.to)
        ? `Publication: ${PUBLICATION_LABELS[payload.from]} → ${PUBLICATION_LABELS[payload.to]}`
        : "Publication changed";
    case "archived":
      return "Archived";
    case "unarchived":
      return "Unarchived";
    default:
      return "Changed";
  }
}

/**
 * One inventory_unit_events row in staff words. A status change made by a
 * job carries the job's number (and, at completion or reopen, its cause,
 * D25 SOLD-AT-COMPLETION). `locationName` names a location id (a move).
 */
export function describeUnitEvent(
  type: string,
  payload: Payload,
  {
    currency = DEFAULT_CURRENCY,
    locationName = () => null,
  }: { currency?: string; locationName?: (id: string) => string | null } = {},
): string {
  switch (type) {
    case "created": {
      const at = text(payload, "location_id");
      const where = at ? locationName(at) : null;
      return where ? `Registered at ${where}` : "Registered";
    }
    case "status_changed": {
      const job = text(payload, "job_number");
      const cause = text(payload, "cause");
      const to = isUnitStatus(payload.to) ? payload.to : null;
      const from = isUnitStatus(payload.from) ? payload.from : null;
      if (job && cause === "job_completed") return `Sold when ${job} was completed`;
      if (job && cause === "job_reopened") return `Back on hold: ${job} was reopened`;
      if (job && to === "held_for_customer") return `Put on job ${job}`;
      if (job && to === "available") return `Back in stock: its line on ${job} was voided`;
      if (from && to) return `Status: ${UNIT_STATUS_LABELS[from]} → ${UNIT_STATUS_LABELS[to]}`;
      return to ? `Status: ${UNIT_STATUS_LABELS[to]}` : "Status changed";
    }
    case "moved": {
      const fromId = text(payload, "from_location_id");
      const toId = text(payload, "to_location_id");
      const from = fromId ? locationName(fromId) : null;
      const to = toId ? locationName(toId) : null;
      return from && to ? `Moved from ${from} to ${to}` : to ? `Moved to ${to}` : "Moved";
    }
    case "details_changed":
      return changedFields(payload);
    case "price_changed":
      return priceChange(payload, currency);
    case "cost_changed":
      return "Cost changed";
    case "archived":
      return "Archived";
    case "unarchived":
      return "Unarchived";
    default:
      return "Changed";
  }
}
