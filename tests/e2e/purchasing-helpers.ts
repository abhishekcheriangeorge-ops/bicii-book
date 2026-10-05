import { expect, type Locator, type Page } from "@playwright/test";

import { toast } from "./helpers";

/**
 * Presses `button` until `dialog` is open: a press before the page has
 * hydrated does nothing, so a slow first load must not fail the step.
 */
export async function openSheet(button: Locator, dialog: Locator): Promise<Locator> {
  await expect(async () => {
    if (!(await dialog.isVisible())) await button.click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return dialog;
}

/**
 * Shared Purchasing (Phase 7) steps for E2E specs: create a supplier
 * through its sheet, start an order (from a supplier's page, preset), add a
 * line through the line sheet, submit. Each acts as whoever is signed in
 * (manage_purchasing) and leaves the page on the record it made. Tag every
 * name with tagFor(testInfo) so phone and iPad runs never meet.
 */

export type SupplierInput = {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  website?: string;
  accountReference?: string;
};

/** New supplier from /purchasing/suppliers; returns on its page with its id. */
export async function createSupplier(page: Page, input: SupplierInput): Promise<{ id: string }> {
  await page.goto("/purchasing/suppliers");
  const sheet = await openSheet(
    page.getByRole("button", { name: "New supplier" }).first(),
    page.getByRole("dialog", { name: "New supplier" }),
  );
  await sheet.getByLabel(/^Name/).fill(input.name);
  if (input.contactName) await sheet.getByLabel("Contact name").fill(input.contactName);
  if (input.phone) await sheet.getByLabel("Phone").fill(input.phone);
  if (input.email) await sheet.getByLabel("Email").fill(input.email);
  if (input.website) await sheet.getByLabel("Website").fill(input.website);
  if (input.accountReference) {
    await sheet.getByLabel("Account reference").fill(input.accountReference);
  }
  await sheet.getByRole("button", { name: "Create supplier" }).click();
  await expect(page).toHaveURL(/\/purchasing\/suppliers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: input.name })).toBeVisible();
  return { id: new URL(page.url()).pathname.split("/").at(-1)! };
}

/**
 * On a supplier's page: New order (the supplier preset), optional
 * supplier reference, Create. Returns on the draft with its id and number.
 */
export async function startOrderFromSupplier(
  page: Page,
  { supplierName, supplierReference }: { supplierName: string; supplierReference?: string },
): Promise<{ id: string; poNumber: string }> {
  const sheet = await openSheet(
    section(page, "Orders").getByRole("button", { name: "New order" }),
    page.getByRole("dialog", { name: "New order" }),
  );
  // Preset: shown, not a picker.
  await expect(sheet.getByText(supplierName, { exact: true })).toBeVisible();
  await expect(sheet.getByRole("combobox")).toHaveCount(0);
  if (supplierReference) await sheet.getByLabel("Supplier reference").fill(supplierReference);
  await sheet.getByRole("button", { name: "Create order" }).click();
  await expect(page).toHaveURL(/\/purchasing\/orders\/[0-9a-f-]{36}$/);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^PO-\d{6}$/);
  return {
    id: new URL(page.url()).pathname.split("/").at(-1)!,
    poNumber: (await heading.textContent())!.trim(),
  };
}

/** The Card section whose heading is exactly `title`. */
export function section(page: Page, title: string): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

/** On an open order's page: Add line for the product found by `query`. */
export async function addOrderLine(
  page: Page,
  {
    query,
    option,
    quantity,
    unitCost,
  }: { query: string; option: RegExp; quantity: string; unitCost: string },
): Promise<void> {
  const sheet = await openSheet(
    section(page, "Order lines").getByRole("button", { name: "Add line" }),
    page.getByRole("dialog", { name: "Add line" }),
  );
  await sheet.getByRole("combobox").fill(query);
  const choice = sheet.getByRole("option", { name: option });
  await expect(choice).toBeVisible();
  await choice.click();
  // The cost prefill has arrived (its hint names where it came from).
  await expect(sheet.getByText(/Prefilled with|No earlier cost/)).toBeVisible();
  await sheet.getByLabel(/^Quantity/).fill(quantity);
  await sheet.getByLabel(/^Unit cost/).fill(unitCost);
  await sheet.getByRole("button", { name: "Add line" }).click();
  await expect(sheet).toBeHidden();
}

/** Submit order on a draft; the pill then reads Submitted. */
export async function submitOrder(page: Page, poNumber: string): Promise<void> {
  // The button ignores presses for 400 ms after it appears (a double tap).
  const submit = page.getByRole("button", { name: "Submit order" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(toast(page, `${poNumber} submitted`)).toBeVisible();
  await expect(page.locator("header").getByText("Submitted", { exact: true })).toBeVisible();
}

/**
 * A tagged supplier with one submitted order for `query`'s product:
 * the common starting point of the receiving and cancelling specs.
 */
export async function createSubmittedOrder(
  page: Page,
  {
    supplierName,
    query,
    option,
    quantity = "5",
    unitCost = "10.00",
  }: { supplierName: string; query: string; option: RegExp; quantity?: string; unitCost?: string },
): Promise<{ supplierId: string; id: string; poNumber: string }> {
  const { id: supplierId } = await createSupplier(page, { name: supplierName });
  const order = await startOrderFromSupplier(page, { supplierName });
  await addOrderLine(page, { query, option, quantity, unitCost });
  await submitOrder(page, order.poNumber);
  return { supplierId, ...order };
}

// ---------------------------------------------------------------------------
// Receiving (Phase 7 step 4)
// ---------------------------------------------------------------------------

/** On an order's page: Receive, then the receive page with its form ready (editable). */
export async function openReceive(page: Page, purchaseOrderId: string): Promise<void> {
  await page.getByRole("link", { name: "Receive", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/purchasing/receive/${purchaseOrderId}$`));
  // The form checks its key store on mount; it is editable once that is done.
  await expect(page.getByRole("button", { name: "All to come" })).toBeEnabled();
}

/** One line of the Receive form, by its product name. */
export function receiveLine(page: Page, productName: string): Locator {
  return page
    .getByRole("list", { name: "Lines to receive" })
    .getByRole("group", { name: productName });
}

/**
 * Intercepts the receive page's Server Action POSTs (next-action header) on
 * `purchaseOrderId`'s receive URL: `plan[i]` decides the i-th one —
 * "lostResponse" lets it reach the server (which commits) and then drops
 * the connection, "lostRequest" drops it before it leaves, "slow" delays it
 * 1.5 s (so a locked state can be seen), "pass" lets it through.
 */
export async function interceptReceiveActions(
  page: Page,
  purchaseOrderId: string,
  plan: readonly ("lostResponse" | "lostRequest" | "slow" | "pass")[],
): Promise<void> {
  let n = 0;
  await page.route(new RegExp(`/purchasing/receive/${purchaseOrderId}$`), async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) {
      await route.fallback();
      return;
    }
    const step = plan[n++] ?? "pass";
    if (step === "lostResponse") {
      await route.fetch();
      await route.abort("connectionreset");
    } else if (step === "lostRequest") {
      await route.abort("connectionreset");
    } else {
      if (step === "slow") await new Promise((r) => setTimeout(r, 1_500));
      await route.continue();
    }
  });
}
