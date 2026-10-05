import { expect, test, type Page } from "@playwright/test";

import { PRODUCT, PRODUCT_SHORT_ID } from "../fixtures/ids";
import { section, signIn, tagFor, toast } from "./helpers";

/**
 * Phase 6 in-store sales (SPEC §13, §22; D7, D46, D48, D49, D53), on a
 * phone and an iPad: a quantity sale through New sale and the picker, a
 * partial refund that leaves the stock alone (D7), a unique unit sold from
 * its page and restocked with a reason, and what a member without cost
 * access sees (D48: no cost, yield or Cult Commons; no Record refund,
 * D49). Stock is read before and asserted relative to it; the unique item
 * carries tagFor(testInfo); nothing depends on another spec.
 */

/** The "N in stock" figure on a product page's Stock card. */
async function stockOf(page: Page, productId: string): Promise<number> {
  await page.goto(`/products/${productId}`);
  const text = (await section(page, "Stock")
    .getByText(/^-?\d+ in stock$/)
    .first()
    .textContent())!;
  return Number(text.replace(/ in stock$/, ""));
}

/** Opens New sale on /sales, finds `query` and adds the option matching `option`. */
async function startSale(page: Page, query: string, option: RegExp) {
  await page.goto("/sales");
  await page.getByRole("button", { name: "New sale" }).click();
  const sheet = page.getByRole("dialog", { name: "New sale" });
  await sheet.getByRole("combobox").first().fill(query);
  await sheet.getByRole("option", { name: option }).first().click();
  return sheet;
}

test("a quantity sale lowers the stock by one; a partial refund leaves the stock alone", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "admin");
  const before = await stockOf(page, PRODUCT.chainLube);

  const sheet = await startSale(page, "FL-DRY-120", /Dry chain lube/);
  const line = sheet.getByRole("listitem", { name: "Dry chain lube 120ml" });
  await expect(line).toContainText(PRODUCT_SHORT_ID.chainLube);
  await expect(line).toContainText(`${before} in stock at Shop floor`);
  await expect(line.getByLabel("Price each")).toHaveValue("16.00");
  await expect(line.getByLabel("Quantity")).toHaveValue("1");
  // Cost access: the labelled preview (16.00 sale, 7.00 cost).
  await expect(sheet.getByRole("region", { name: "Preview" })).toContainText("$9.00");
  await sheet.getByRole("button", { name: "Record sale · $16.00" }).click();
  await expect(toast(page, /^S-\d{6} recorded$/)).toBeVisible();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}$/);
  const saleUrl = page.url();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^S-\d{6}$/);
  const saleNumber = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
  await expect(page.getByLabel("Sale total")).toHaveText("$16.00");
  const economics = page.getByRole("definition").filter({ hasText: "$9.00" });
  await expect(economics.first()).toBeVisible();

  expect(await stockOf(page, PRODUCT.chainLube)).toBe(before - 1);

  // A partial refund with a reason (admins only, D49): money only (D7).
  await page.goto(saleUrl);
  await page.getByRole("button", { name: "Record refund" }).click();
  const refund = page.getByRole("dialog", { name: "Record refund" });
  await expect(refund.getByLabel("Amount")).toHaveValue("16.00");
  await expect(refund).toContainText(
    "A refund does not put anything back in stock. If the item came back, restock it separately.",
  );
  await refund.getByLabel("Amount").fill("5");
  await refund.getByRole("button", { name: "Record refund of $5.00…" }).click();
  await refund.getByLabel("Why is it being refunded?").fill("Opened bottle, partial credit");
  await page.waitForTimeout(500);
  await refund.getByRole("button", { name: "Refund $5.00" }).click();
  await expect(toast(page, "Refund of $5.00 recorded")).toBeVisible();
  await expect(refund).toBeHidden();
  await expect(page.locator("header").getByText("Partly refunded", { exact: true })).toBeVisible();
  const refunds = page.getByRole("list", { name: "Refunds" });
  await expect(refunds).toContainText("Refunded $5.00");
  await expect(refunds).toContainText("Opened bottle, partial credit");

  expect(await stockOf(page, PRODUCT.chainLube)).toBe(before - 1);

  // The Sales list shows it, partly refunded.
  await page.goto("/sales?range=today");
  const row = page.getByRole("link", { name: new RegExp(saleNumber) });
  await expect(row).toContainText("Partly refunded");
  await expect(row).toContainText("$16.00");
  await expect(row).toContainText("Walk-in");
});

test("a unique item is sold from its page and restocked from the sale", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const tag = tagFor(testInfo);
  const name = `Frameset ${tag}`;

  await signIn(page, "admin");
  await page.goto("/inventory");
  await page.getByRole("button", { name: "New product" }).first().click();
  const productSheet = page.getByRole("dialog", { name: "New product" });
  await productSheet.getByRole("radio", { name: "Unique" }).click();
  await productSheet.getByLabel("Name").fill(name);
  await productSheet.getByLabel("Sale price", { exact: true }).fill("800.00");
  await productSheet.getByLabel("Cost", { exact: true }).fill("500.00");
  await productSheet
    .getByRole("region", { name: "First unit" })
    .getByLabel("Serial number")
    .fill(`SN-${tag}`);
  await productSheet.getByRole("button", { name: "Add product" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  const units = page.getByRole("list", { name: "Units" });
  const unitShortId = (await units.getByText(/^U-\d{6}$/).textContent())!.trim();
  await units.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/);
  const unitUrl = page.url();

  // Sell from the unit page: preset with this unit; a lower price warns (D53).
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "New sale" });
  const line = sheet.getByRole("listitem", { name });
  await expect(line).toContainText(unitShortId);
  await expect(line.getByLabel("Price")).toHaveValue("800.00");
  await line.getByLabel("Price").fill("450");
  await expect(line).toContainText("Below the asking price");
  await expect(line).toContainText("Below cost: this sale loses money");
  await line.getByLabel("Price").fill("800");
  await expect(line).not.toContainText("Below the asking price");
  // Sold earlier? A time in the future is marked on its own field, which
  // takes the focus (not only an alert scrolled out of view), and nothing
  // is recorded.
  await sheet.getByRole("button", { name: "Sold earlier?" }).click();
  const soldAt = sheet.getByLabel("Sold at");
  await soldAt.fill(`${new Date().getFullYear() + 1}-03-01T10:00`);
  await sheet.getByRole("button", { name: "Record sale · $800.00" }).click();
  await expect(sheet.getByText("Enter a date and time that is not in the future.")).toBeVisible();
  await expect(soldAt).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(unitUrl);
  await soldAt.fill("");
  await sheet.getByRole("button", { name: "Record sale · $800.00" }).click();
  await expect(toast(page, /^S-\d{6} recorded$/)).toBeVisible();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}$/);
  const saleNumber = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();

  // The unit page says where it went.
  await page.goto(unitUrl);
  await expect(page.locator("header").getByText("Sold", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: `Sold on ${saleNumber}` }).click();

  // Restock it from the sale, with a reason.
  const lineItem = page.getByRole("listitem", { name: new RegExp(name) });
  await lineItem.getByRole("button", { name: `Restock… ${unitShortId}` }).click();
  await lineItem.getByLabel(`Why is ${unitShortId} going back into stock?`).fill("Returned unused");
  await page.waitForTimeout(500);
  await lineItem.getByRole("button", { name: "Restock", exact: true }).click();
  await expect(toast(page, `${unitShortId} is back in stock`)).toBeVisible();
  await expect(lineItem.getByText("Restocked", { exact: true })).toBeVisible();
  await expect(lineItem.getByRole("button", { name: `Restock… ${unitShortId}` })).toHaveCount(0);

  await page.goto(unitUrl);
  await expect(page.locator("header").getByText("Available", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: `Sold on ${saleNumber}` })).toHaveCount(0);
});

test("a member without cost access sells, and sees no cost, yield, Cult Commons or refund", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "mechanic2");
  const before = await stockOf(page, PRODUCT.barTape);

  const sheet = await startSale(page, "LS-DSP32", /DSP 3\.2mm bar tape/);
  const line = sheet.getByRole("listitem", { name: "DSP 3.2mm bar tape" });
  await expect(line.getByLabel("Price each")).toHaveValue("49.00");
  await line.getByLabel("Price each").fill("10");
  await expect(line).toContainText("Below the asking price");
  await expect(line).not.toContainText("Below cost");
  await line.getByLabel("Price each").fill("49");
  await expect(sheet.getByRole("region", { name: "Preview" })).toHaveCount(0);
  for (const word of ["Yield", "Cult Commons", "Cost"]) {
    await expect(sheet.getByText(new RegExp(`\\b${word}\\b`))).toHaveCount(0);
  }
  await sheet.getByRole("button", { name: "Record sale · $49.00" }).click();
  await expect(toast(page, /^S-\d{6} recorded$/)).toBeVisible();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Sale total")).toHaveText("$49.00");
  for (const word of ["Yield", "Cult Commons", "Direct cost"]) {
    await expect(page.getByText(word)).toHaveCount(0);
  }
  await expect(page.getByText("$26.00")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record refund" })).toHaveCount(0);

  expect(await stockOf(page, PRODUCT.barTape)).toBe(before - 1);
});
