/**
 * How a customer is named and reached on screen. Pure: safe in Client
 * Components and unit tests.
 */

export type CustomerName = {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
};

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * The name to show for a customer. Mirrors private.customer_label (the
 * customers migration), which staff_search uses for its titles: display
 * name, else first + last, else either, else email, else phone.
 */
export function customerLabel(c: CustomerName): string {
  const first = clean(c.firstName);
  const last = clean(c.lastName);
  return (
    clean(c.displayName) ??
    (first && last ? `${first} ${last}` : null) ??
    first ??
    last ??
    clean(c.email) ??
    clean(c.phone) ??
    "Customer"
  );
}

/**
 * A `tel:` link for a phone number as staff typed it ("+65 9123 4567"),
 * keeping only a leading + and the digits; null when there are too few
 * digits to dial.
 */
export function telHref(phone: string | null | undefined): string | null {
  const raw = phone?.trim() ?? "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return `tel:${raw.startsWith("+") ? "+" : ""}${digits}`;
}

/** A `mailto:` link, or null for anything that is not an address. */
export function mailtoHref(email: string | null | undefined): string | null {
  const raw = email?.trim() ?? "";
  if (!/^[^@\s]+@[^@\s]+$/.test(raw)) return null;
  return `mailto:${raw}`;
}
