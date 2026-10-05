import { expect, test } from "@playwright/test";

import { PO_NUMBER, PURCHASE_ORDER } from "../fixtures/ids";
import { signIn, tagFor, toast } from "./helpers";
import {
  addOrderLine,
  createSubmittedOrder,
  createSupplier,
  section,
  startOrderFromSupplier,
  submitOrder,
} from "./purchasing-helpers";

/**
 * Phase 7 suppliers and purchase orders on a phone and an iPad (SPEC §14,
 * §21; PLAN D60 D-PO-COSTS, D61 D-PO-CANCEL, D65 D-OVERRECEIPT). Records
 * these tests create carry tagFor(testInfo); the seeded orders
 * (tests/fixtures/ids.ts PURCHASE_ORDER) are only read.
 */

const PADS = { query: "SHI-L05A", option: /Road disc brake pads/ };

test("a buyer adds a supplier, orders from it, changes a line, submits and finds the order again", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const tag = tagFor(testInfo);
  const supplierName = `Spokes ${tag}`;

  await signIn(page, "admin");
  await createSupplier(page, {
    name: supplierName,
    contactName: "Mei Tan",
    phone: "+65 6000 0042",
    website: "spokes.test",
  });
  // The contact card dials and opens the website safely.
  await expect(page.getByRole("link", { name: /\+65 6000 0042/ })).toHaveAttribute(
    "href",
    "tel:+6560000042",
  );
  const website = page.getByRole("link", { name: /spokes\.test/ });
  await expect(website).toHaveAttribute("href", "https://spokes.test");
  await expect(website).toHaveAttribute("rel", "noopener noreferrer");

  // New order from the supplier's page: the supplier is preset.
  const { poNumber } = await startOrderFromSupplier(page, { supplierName });
  await expect(page.locator("header").getByText("Draft", { exact: true })).toBeVisible();

  await addOrderLine(page, { ...PADS, quantity: "20", unitCost: "12.00" });
  const lines = page.getByRole("table", { name: "Order lines" });
  await expect(lines).toContainText("0 of 20 received");
  await expect(lines).toContainText("$240.00");
  await expect(
    lines.getByRole("progressbar", { name: /Road disc brake pads.* received/ }),
  ).toHaveAttribute("aria-valuemax", "20");

  // Change the line to 24, then back to 20.
  for (const [quantity, total] of [
    ["24", "$288.00"],
    ["20", "$240.00"],
  ] as const) {
    await lines.getByRole("button", { name: /Change line: Road disc brake pads/ }).click();
    const sheet = page.getByRole("dialog", { name: "Change line" });
    await sheet.getByLabel(/^Quantity/).fill(quantity);
    await sheet.getByRole("button", { name: "Save line" }).click();
    await expect(sheet).toBeHidden();
    await expect(lines).toContainText(`0 of ${quantity} received`);
    await expect(lines).toContainText(total);
  }

  await submitOrder(page, poNumber);
  await expect(page.getByRole("button", { name: "Submit order" })).toHaveCount(0);

  // The header search finds it however the number is typed.
  const header = page.getByRole("searchbox", { name: "Search customers, bikes, jobs and stock" });
  await header.fill(poNumber.toLowerCase().replace("-", " "));
  await header.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=/);
  const hit = page
    .getByRole("list", { name: "Purchase orders" })
    .getByRole("link", { name: new RegExp(poNumber) });
  await expect(hit).toContainText(supplierName);
  await hit.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(poNumber);
});

test("staff without purchasing access follow deliveries but see no costs or controls", async ({
  page,
}) => {
  await signIn(page, "mechanic2", "/purchasing");
  await expect(page).toHaveURL(/\/purchasing$/);
  await expect(page.getByRole("navigation", { name: "Purchasing" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New order" })).toHaveCount(0);

  const row = page
    .getByRole("list", { name: "Purchase orders" })
    .getByRole("link", { name: new RegExp(PO_NUMBER.partial) });
  await expect(row).toContainText("Partially received");
  await expect(row).toContainText("Overdue");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/purchasing/orders/${PURCHASE_ORDER.partial}$`));

  const lines = page.getByRole("table", { name: "Order lines" });
  await expect(lines).toContainText("18 of 20 received · 2 to come");
  await expect(lines.getByText("Overdue")).toBeVisible();
  await expect(lines).not.toContainText("$");
  await expect(page.getByRole("heading", { name: "Totals" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "History" })).toHaveCount(0);
  for (const name of [/^New order/, "Submit order", "Cancel order…", "Add line", "Edit details"]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  }
  await expect(lines.getByRole("button")).toHaveCount(0);
  // The delivery that came is listed for everyone, without its cost.
  await expect(section(page, "Receipts")).toContainText("DN-5531");
  await expect(section(page, "Receipts")).not.toContainText("$");
});

test("a buyer cancels a submitted order with a reason, kept in its history", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const tag = tagFor(testInfo);
  const reason = `Supplier closed for stocktake ${tag}`;

  await signIn(page, "admin");
  const { poNumber } = await createSubmittedOrder(page, {
    supplierName: `Cancel ${tag}`,
    ...PADS,
  });

  const cancel = section(page, "Cancel order");
  await cancel.getByRole("button", { name: "Cancel order…" }).click();
  await expect(cancel).toContainText("Items already received stay in stock");
  await cancel.getByLabel("Why is this order being cancelled?").fill(reason);
  // The confirm ignores presses for 400 ms after it appears (a double tap).
  await page.waitForTimeout(500);
  await cancel.getByRole("button", { name: "Cancel order", exact: true }).click();
  await expect(toast(page, `${poNumber} cancelled`)).toBeVisible();

  await expect(page.locator("header").getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Order history" })).toContainText(
    `cancelled: ${reason}`,
  );
  await expect(page.getByRole("table", { name: "Order lines" })).toContainText(
    "0 of 5 received · 5 cancelled",
  );
  // Cancelled is final: no editing, no second cancel.
  await expect(page.getByRole("button", { name: "Add line" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel order…" })).toHaveCount(0);
});

test("a fully received order is closed: a calm note and no line editing", async ({ page }) => {
  await signIn(page, "admin", `/purchasing/orders/${PURCHASE_ORDER.receivedInFull}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(PO_NUMBER.receivedInFull);
  await expect(page.locator("header").getByText("Received", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Fully received.*Extra or late units go on a new order\./),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New order for Velo Parts Asia Pte Ltd" }),
  ).toBeVisible();
  const lines = page.getByRole("table", { name: "Order lines" });
  await expect(lines).toContainText("4 of 4 received");
  await expect(lines.getByRole("button")).toHaveCount(0);
  for (const name of ["Add line", "Edit details", "Submit order", "Cancel order…"]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  }
});
