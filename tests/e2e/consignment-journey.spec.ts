import path from "node:path";

import { expect, test } from "@playwright/test";

import { readMoney, section, signIn, tagFor, toast } from "./helpers";

/**
 * Journey 4 (SPEC §27.3), on a phone and an iPad: "Create unique
 * consignment bike -> label -> public page -> sale -> Cult Commons
 * calculation -> consignor outstanding -> partial/full settlement".
 * The label step is left out: labels are Phase 8. The public page is
 * checked through the product page's "What the public sees" panel, the
 * staff view of the public projection (as inventory-publish.spec.ts does).
 *
 * A new consignor; one consigned Colnago (owed $500, asking $1,000) with a
 * public listing photo (agreement photos stay internal, D52); published at
 * the asking price, the single selling price (D45), with no cost; sold in
 * store from its item page; the sale's economics (D1, D44: the consignor
 * payout is the direct cost); the public listing turns sold (D26); the
 * consignor is owed $500 (D46); a member without consignment money or cost
 * access sees the sale total only (D48); paid $200 then $300 to Settled
 * (D47); Today's Consignment sales tile opens that day's Sales list, which
 * shows the sale.
 * Every record carries tagFor(testInfo).
 */

const PHOTO = path.join(__dirname, "fixtures", "bike-photo.jpg");

test("journey 4: a consigned bike is listed, sold in store, its yield split and its consignor paid", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const tag = tagFor(testInfo);
  const consignorName = `Consignor ${tag}`;
  const bikeName = `Colnago Master ${tag}`;

  // 1. A new consignor.
  await signIn(page, "admin");
  await page.goto("/consignment");
  await page.getByRole("button", { name: "New consignor" }).first().click();
  const consignorSheet = page.getByRole("dialog", { name: "New consignor" });
  await consignorSheet
    .getByRole("textbox", { name: "Name (required)", exact: true })
    .fill(consignorName);
  await consignorSheet.getByRole("button", { name: "Create consignor" }).click();
  await expect(page).toHaveURL(/\/consignment\/consignors\/[0-9a-f-]{36}$/);
  const consignorUrl = page.url();

  // 2. Receive the bike: one item, owed $500, asking $1,000.
  await page.getByRole("button", { name: "Receive item" }).click();
  const intake = page.getByRole("dialog", { name: "Receive item" });
  await intake.getByRole("textbox", { name: "Name (required)", exact: true }).fill(bikeName);
  await intake.getByLabel("Brand").fill("Colnago");
  await intake.getByLabel("Serial number").fill(`SN${tag}`);
  await intake.getByLabel("Amount owed to the consignor when it sells").fill("500");
  await intake.getByLabel("Asking price").fill("1000");
  await intake.getByRole("button", { name: "Receive item" }).click();
  await expect(toast(page, /^C-\d{6} received$/)).toBeVisible();
  await expect(page).toHaveURL(/\/consignment\/items\/[0-9a-f-]{36}$/);
  const itemUrl = page.url();
  const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  const itemShortId = (await header.getByText(/^C-\d{6}$/).textContent())!.trim();
  await expect(header.getByRole("link", { name: /^U-\d{6}$/ })).toBeVisible();
  await expect(header.getByText("For sale", { exact: true })).toBeVisible();

  // 3. A listing photo, made public; the agreement photos offer no Public (D52).
  const listing = section(page, "Listing photos");
  await listing.getByLabel("Choose photos").setInputFiles(PHOTO);
  const listingGrid = listing.getByRole("list", { name: "Photos", exact: true });
  await expect(listingGrid.getByRole("listitem")).toHaveCount(1);
  await listingGrid.getByRole("button", { name: /^Open photo 1/ }).click();
  const viewer = page.getByRole("dialog", { name: "Photo 1" });
  await viewer.getByRole("radio", { name: "Public" }).click();
  await expect(toast(page, "Photo is now public")).toBeVisible();
  await viewer.getByRole("button", { name: "Close" }).click();

  const agreement = section(page, "Agreement photos");
  await agreement.getByLabel("Choose photos").setInputFiles(PHOTO);
  const agreementGrid = agreement.getByRole("list", { name: "Photos", exact: true });
  await expect(agreementGrid.getByRole("listitem")).toHaveCount(1);
  await agreementGrid.getByRole("button", { name: /^Open photo 1/ }).click();
  const who = page.getByRole("radiogroup", { name: "Who can see this photo" });
  await expect(who.getByRole("radio", { name: "Public" })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(who).toBeHidden();

  // 4. Publish the product: the public sees it available at the asking price, no cost.
  await header.getByRole("link", { name: /^U-\d{6}$/ }).click();
  await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/);
  await page.getByRole("heading", { level: 1 }).getByRole("link").click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  const productUrl = page.url();
  const publication = section(page, "Publication");
  await publication.getByRole("button", { name: "Make internal" }).click();
  await expect(toast(page, "Listing is internal only")).toBeVisible();
  const publish = publication.getByRole("button", { name: "Publish", exact: true });
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(toast(page, "Published")).toBeVisible();
  const preview = publication.getByRole("region", { name: "What the public sees" });
  await expect(preview).toContainText(bikeName);
  await expect(preview).toContainText("$1,000.00");
  await expect(preview).toContainText("Available");
  await expect(preview).not.toContainText("$500.00");

  // 5. Sell it from its item page at the asking price.
  await page.goto(itemUrl);
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  const sale = page.getByRole("dialog", { name: "New sale" });
  const line = sale.getByRole("listitem", { name: bikeName });
  await expect(line).toContainText(`Consigned · ${consignorName}`);
  await expect(line.getByLabel("Price")).toHaveValue("1000.00");
  await sale.getByRole("button", { name: "Record sale · $1,000.00" }).click();
  await expect(toast(page, /^S-\d{6} recorded$/)).toBeVisible();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}$/);
  const saleUrl = page.url();
  const saleNumber = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
  expect(saleNumber).toMatch(/^S-\d{6}$/);

  // 6. The Cult Commons calculation (D1, D44): the payout is the direct cost.
  await expect(page.getByLabel("Sale total")).toHaveText("$1,000.00");
  const economics = page.getByLabel("Sale economics");
  await expect(economics).toContainText(/Sale\s*\$1,000\.00/);
  await expect(economics).toContainText(/Direct cost \(incl\. consignor payout\)\s*\$500\.00/);
  await expect(economics).toContainText(/Yield\s*\$500\.00/);
  await expect(economics).toContainText(/Cult Commons \(30% of positive yield\)\s*\$150\.00/);
  await expect(economics).toContainText(/BICII after Cult Commons\s*\$350\.00/);
  const saleLine = page.getByRole("listitem", { name: new RegExp(bikeName) });
  await expect(saleLine).toContainText(`Consigned by ${consignorName}`);
  await expect(saleLine).toContainText("owed $500.00, paid separately");

  // 7. The public listing now shows it sold (D26).
  await page.goto(productUrl);
  await expect(preview).toContainText("Sold");

  // 8. The consignor is owed $500 for it (D46).
  await page.goto(consignorUrl);
  const balance = section(page, "Balance");
  await expect(balance).toContainText(/Outstanding\s*\$500\.00/);
  await expect(page.getByRole("list", { name: "Awaiting payment" })).toContainText(itemShortId);

  // 9. A member without consignment money or cost access (D48).
  const mechanic = await browser.newContext({ ...testInfo.project.use });
  const mechanicPage = await mechanic.newPage();
  await signIn(mechanicPage, "mechanic2", new URL(saleUrl).pathname);
  await expect(mechanicPage.getByRole("heading", { level: 1 })).toHaveText(saleNumber);
  await expect(mechanicPage.getByLabel("Sale total")).toHaveText("$1,000.00");
  for (const word of ["Yield", "Cult Commons", "Direct cost"]) {
    await expect(mechanicPage.getByText(word)).toHaveCount(0);
  }
  await expect(mechanicPage.getByText("$500.00")).toHaveCount(0);
  await mechanicPage.goto(new URL(consignorUrl).pathname);
  await expect(mechanicPage.getByRole("heading", { level: 1, name: consignorName })).toBeVisible();
  for (const word of ["Outstanding", "Owed"]) {
    await expect(mechanicPage.getByText(word, { exact: true })).toHaveCount(0);
  }
  await expect(mechanicPage.getByText("$500.00")).toHaveCount(0);
  await expect(mechanicPage.getByRole("button", { name: "Record payment" })).toHaveCount(0);
  await expect(mechanicPage.getByRole("button", { name: "Show payout details" })).toHaveCount(0);
  await mechanic.close();

  // 10. A partial payment, then the rest (D47).
  await page.getByRole("button", { name: "Record payment" }).click();
  let pay = page.getByRole("dialog", { name: "Record payment" });
  await pay.getByLabel("Amount paid").fill("200");
  await pay.getByLabel(`Amount for ${itemShortId}`).fill("200");
  await pay.getByLabel("Reference").fill(`PayNow ${tag}`);
  await pay.getByRole("button", { name: "Record payment of $200.00" }).click();
  await expect(toast(page, `Payment of $200.00 recorded for ${consignorName}`)).toBeVisible();
  await expect(balance).toContainText(/Outstanding\s*\$300\.00/);

  await page.getByRole("button", { name: "Record payment" }).click();
  pay = page.getByRole("dialog", { name: "Record payment" });
  await pay.getByLabel("Amount paid").fill("300");
  await pay.getByLabel(`Amount for ${itemShortId}`).fill("300");
  await pay.getByRole("button", { name: "Record payment of $300.00" }).click();
  await expect(toast(page, `Payment of $300.00 recorded for ${consignorName}`)).toBeVisible();
  await expect(balance).toContainText(/Outstanding\s*\$0\.00/);
  await expect(balance).toContainText("Settled");

  // 11. Today and the Sales list.
  await page.goto("/");
  const money = section(page, "Money");
  expect(Number(await readMoney(money, "Consignment sales"))).toBeGreaterThanOrEqual(1000);
  // The tile counts sales and jobs with consigned stock and opens that
  // shop day's sales (?day=), today or any other day.
  const tile = money.getByRole("link", { name: /^Consignment sales/ });
  await expect(tile).toContainText(/sales? or jobs? with consigned items/);
  await tile.click();
  await expect(page).toHaveURL(/\/sales\?day=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("link", { name: new RegExp(saleNumber) })).toContainText("$1,000.00");
});
