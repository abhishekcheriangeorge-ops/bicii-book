/**
 * Why a record cannot get a label right now (label_preview's refusals),
 * with what to do about it. Any other code is not a "printing unavailable"
 * condition (null): callers rethrow it.
 */
export type LabelUnavailableReason =
  "archived" | "unique_product" | "site_url_invalid" | "no_template" | "not_found";

/**
 * Not a database message: label_preview's P0002 (the record does not
 * exist, e.g. deleted while the page rendered), which getLabelContext maps
 * here so a record page never fails on it.
 */
export const LABEL_ENTITY_NOT_FOUND = "label_entity_not_found";

export type LabelUnavailable = { reason: LabelUnavailableReason; message: string };

const UNAVAILABLE: Record<string, LabelUnavailable> = {
  label_entity_archived: {
    reason: "archived",
    message: "That record is archived. Unarchive it before printing labels.",
  },
  label_unique_product_needs_unit: {
    reason: "unique_product",
    message: "Unique items get one label per unit. Print labels from each unit.",
  },
  public_site_url_invalid: {
    reason: "site_url_invalid",
    message:
      "Labels are off until an admin sets the public website address in Labels and printers settings.",
  },
  label_template_missing: {
    reason: "no_template",
    message: "There is no label template for this kind of record. Ask an admin to set one up.",
  },
  [LABEL_ENTITY_NOT_FOUND]: {
    reason: "not_found",
    message: "That record no longer exists, so it cannot get a label.",
  },
};

export function labelUnavailable(code: string | null | undefined): LabelUnavailable | null {
  return code && Object.hasOwn(UNAVAILABLE, code) ? UNAVAILABLE[code] : null;
}
