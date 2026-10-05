import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { createJobViaIntake, section, signIn, tagFor, toast } from "./helpers";

/**
 * Phase 6 consignment (SPEC §13, §27.3), on a phone and an iPad: a new
 * consignor, a consigned bike received, its agreement photo kept internal
 * (D52), a shop-paid charge added and voided (D4), the bike used as a part
 * on a job and sold at completion (D44), what a member without consignment
 * money access sees (D48), two payments with an override reason in between
 * (D47), and a quantity consignment partly returned. Every record carries
 * tagFor(testInfo); nothing depends on another spec's or project's records.
 */

const PHOTO = path.join(__dirname, "fixtures", "bike-photo.jpg");

/**
 * Nothing in a sheet reaches past its right edge (a fieldset's min-content
 * width once pushed the "2. What" controls ~90px off a phone screen); a
 * segmented control scrolls inside its own row instead.
 */
async function expectNoSidewaysOverflow(page: Page, dialogName: string) {
  const dialog = page.getByRole("dialog", { name: dialogName });
  const outside = await dialog.evaluate((d) => {
    const right = d.getBoundingClientRect().right + 0.5;
    return [...d.querySelectorAll("fieldset, input, textarea, [role=radiogroup]")]
      .filter((el) => el.getBoundingClientRect().right > right)
      .map((el) => `${el.tagName} ${el.getAttribute("aria-label") ?? ""}`.trim());
  });
  expect(outside).toEqual([]);
}

/** Receives a consigned item through the Receive item sheet already open as `dialog`. */
async function fillMoney(page: Page, owed: string, asking: string) {
  const dialog = page.getByRole("dialog", { name: "Receive item" });
  await dialog.getByLabel("Amount owed to the consignor when it sells").fill(owed);
  await dialog.getByLabel("Asking price").fill(asking);
}

test("a consigned bike is received, used on a job, sold at completion and settled", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const tag = tagFor(testInfo);
  const consignorName = `Consignor ${tag}`;
  const bikeName = `Colnago Master ${tag}`;

  // 1. A new consignor with a phone number.
  await signIn(page, "admin");
  await page.goto("/consignment");
  await page.getByRole("button", { name: "New consignor" }).first().click();
  const consignorSheet = page.getByRole("dialog", { name: "New consignor" });
  await consignorSheet
    .getByRole("textbox", { name: "Name (required)", exact: true })
    .fill(consignorName);
  await consignorSheet.getByLabel("Phone").fill("+65 9000 1234");
  await consignorSheet.getByRole("button", { name: "Create consignor" }).click();
  await expect(page).toHaveURL(/\/consignment\/consignors\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: consignorName })).toBeVisible();
  const consignorUrl = page.url();

  // 2. Receive one item: owed $500, asking $1,000.
  await page.getByRole("button", { name: "Receive item" }).click();
  const intake = page.getByRole("dialog", { name: "Receive item" });
  await expect(intake.getByText(consignorName)).toBeVisible();
  await expectNoSidewaysOverflow(page, "Receive item");
  await intake.getByRole("textbox", { name: "Name (required)", exact: true }).fill(bikeName);
  await intake.getByLabel("Brand").fill("Colnago");
  await intake.getByLabel("Serial number").fill(`SN${tag}`);
  await fillMoney(page, "500", "1000");
  await intake.getByRole("button", { name: "Receive item" }).click();
  await expect(toast(page, /^C-\d{6} received$/)).toBeVisible();
  await expect(page).toHaveURL(/\/consignment\/items\/[0-9a-f-]{36}$/);
  const itemUrl = page.url();
  await expect(page.getByRole("heading", { level: 1, name: bikeName })).toBeVisible();
  const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  await expect(header.getByText(/^C-\d{6}$/)).toBeVisible();
  const itemShortId = (await header.getByText(/^C-\d{6}$/).textContent())!.trim();
  await expect(header.getByRole("link", { name: /^U-\d{6}$/ })).toBeVisible();
  await expect(header.getByText("For sale", { exact: true })).toBeVisible();

  // Nothing has sold, so nothing is owed yet: not "Settled".
  await page.goto(consignorUrl);
  await expect(section(page, "Balance")).toContainText("Nothing owed yet");
  await expect(section(page, "Balance")).not.toContainText("Settled");
  await page.goto(itemUrl);

  // 3. The signed agreement: internal only (D52).
  const agreement = section(page, "Agreement photos");
  await agreement.getByLabel("Choose photos").setInputFiles(PHOTO);
  await expect(
    agreement.getByRole("list", { name: "Photos", exact: true }).getByRole("listitem"),
  ).toHaveCount(1);
  await agreement.getByRole("button", { name: /^Open photo 1/ }).click();
  const who = page.getByRole("radiogroup", { name: "Who can see this photo" });
  await expect(who.getByRole("radio", { name: "Internal" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(who.getByRole("radio", { name: "Public" })).toHaveAttribute("aria-disabled", "true");
  await expect(who.getByRole("radio", { name: "Customer" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(
    page.getByText("Agreement photos show the consignor's terms, so they stay internal."),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(who).toBeHidden();

  // 4. A shop-paid charge: the bearer is chosen explicitly (D4), then voided.
  const chargeName = `Pre-sale service ${tag}`;
  await section(page, "Charges").getByRole("button", { name: "Add charge" }).click();
  const chargeSheet = page.getByRole("dialog", { name: "Add charge" });
  await chargeSheet.getByLabel("Description").fill(chargeName);
  await chargeSheet.getByLabel("Amount").fill("120");
  const addCharge = chargeSheet.getByRole("button", { name: "Add charge" });
  await expect(addCharge).toBeDisabled();
  await chargeSheet.getByRole("radio", { name: "Shop pays" }).click();
  await expect(addCharge).toBeEnabled();
  await addCharge.click();
  await expect(toast(page, "Charge added")).toBeVisible();
  await expect(chargeSheet).toBeHidden();
  const charges = section(page, "Charges");
  await expect(charges).toContainText(chargeName);
  await expect(charges).toContainText("Shop pays");
  await charges.getByRole("button", { name: `Void… the charge ${chargeName}` }).click();
  await charges.getByLabel(`Why are you voiding ${chargeName}?`).fill("Entered by mistake");
  await page.waitForTimeout(500);
  await charges.getByRole("button", { name: "Void charge" }).click();
  await expect(toast(page, `${chargeName} voided`)).toBeVisible();
  await expect(charges).toContainText("Entered by mistake");
  const timeline = page.getByRole("list", { name: "Timeline" });
  await expect(timeline.getByText("Charge added", { exact: true })).toBeVisible();
  await expect(timeline.getByText("Charge voided", { exact: true })).toBeVisible();
  await expect(timeline.getByText("Received", { exact: true })).toBeVisible();

  // 5. The consigned bike as a part on a job (D44), sold when it is completed.
  const job = await createJobViaIntake(page, { tag, lead: "Marcus Tan" });
  await page.getByRole("button", { name: "Add part" }).click();
  const addPart = page.getByRole("dialog", { name: "Add part" });
  await addPart.getByRole("combobox").fill(bikeName);
  const option = addPart.getByRole("option", { name: new RegExp(bikeName) });
  await expect(option).toContainText(`Consigned · ${consignorName}`);
  await expect(option).toContainText("$1,000.00");
  await option.click();
  await expect(addPart.locator("output")).toHaveText("$1,000.00");
  await addPart.getByRole("button", { name: "Add part" }).click();
  await expect(toast(page, new RegExp(`^Added ${bikeName} \\(U-\\d{6}\\)`))).toBeVisible();
  await expect(addPart).toBeHidden();
  await expect(page.getByRole("row", { name: new RegExp(bikeName) })).toContainText(
    `Consigned · ${consignorName}`,
  );
  await page.getByRole("button", { name: "Start work" }).click();
  await expect(toast(page, `${job.jobNumber}: In progress`)).toBeVisible();
  await page.getByRole("button", { name: "Complete" }).click();
  await expect(toast(page, `${job.jobNumber}: Completed`)).toBeVisible();

  await page.goto(itemUrl);
  await expect(page.getByText("Sold, awaiting payment", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: `Job ${job.jobNumber}` })).toBeVisible();
  await expect(timeline.getByText(`Sold on ${job.jobNumber}`, { exact: true })).toBeVisible();

  await page.goto(consignorUrl);
  const balance = section(page, "Balance");
  await expect(balance).toContainText(/Outstanding\s*\$500\.00/);
  const awaiting = page.getByRole("list", { name: "Awaiting payment" });
  await expect(awaiting).toContainText(itemShortId);
  await expect(awaiting).toContainText("$500.00");

  // 6. A mechanic without consignment money access (D48): no balance, no
  // payments, no payout details; the item's money card and history are absent.
  const mechanic = await browser.newContext({ ...testInfo.project.use });
  const mechanicPage = await mechanic.newPage();
  await signIn(mechanicPage, "mechanic2", new URL(consignorUrl).pathname);
  await expect(mechanicPage.getByRole("heading", { level: 1, name: consignorName })).toBeVisible();
  await expect(mechanicPage.getByRole("list", { name: "Sold" })).toContainText(itemShortId);
  for (const word of ["Outstanding", "Owed", "Paid"]) {
    await expect(mechanicPage.getByText(word, { exact: true })).toHaveCount(0);
  }
  await expect(mechanicPage.getByText("$500.00")).toHaveCount(0);
  await expect(mechanicPage.getByRole("button", { name: "Record payment" })).toHaveCount(0);
  await expect(mechanicPage.getByRole("button", { name: "Show payout details" })).toHaveCount(0);
  await expect(mechanicPage.getByRole("button", { name: "Receive item" })).toHaveCount(0);
  await mechanicPage.goto(new URL(itemUrl).pathname);
  await expect(mechanicPage.getByRole("heading", { level: 1, name: bikeName })).toBeVisible();
  await expect(mechanicPage.getByText("$1,000.00").first()).toBeVisible();
  await expect(mechanicPage.getByRole("heading", { name: "Money" })).toHaveCount(0);
  await expect(mechanicPage.getByRole("list", { name: "Timeline" })).toHaveCount(0);
  await expect(mechanicPage.getByText("$500.00")).toHaveCount(0);
  // The list tells the same story: how many sold, never who awaits payment.
  await mechanicPage.goto(`/consignment?q=${encodeURIComponent(consignorName)}`);
  const row = mechanicPage.getByRole("link", { name: new RegExp(consignorName) });
  await expect(row).toContainText("1 sold");
  await expect(row).not.toContainText("awaiting payment");
  await mechanic.close();
  await page.goto(`/consignment?q=${encodeURIComponent(consignorName)}`);
  await expect(page.getByRole("link", { name: new RegExp(consignorName) })).toContainText(
    "1 awaiting payment",
  );
  await page.goto(consignorUrl);

  // 7. Payments: $200, then $350 against $300 needs a reason (D47), then $300.
  await page.getByRole("button", { name: "Record payment" }).click();
  let pay = page.getByRole("dialog", { name: "Record payment" });
  await pay.getByLabel("Amount paid").fill("200");
  await pay.getByLabel(`Amount for ${itemShortId}`).fill("200");
  await pay.getByLabel("Reference").fill(`PayNow ${tag}`);
  await pay.getByRole("button", { name: "Record payment of $200.00" }).click();
  await expect(toast(page, `Payment of $200.00 recorded for ${consignorName}`)).toBeVisible();
  await expect(pay).toBeHidden();
  await expect(balance).toContainText(/Outstanding\s*\$300\.00/);
  const payments = page.getByRole("list", { name: "Payments" });
  await expect(payments).toContainText(`PayNow ${tag}`);
  await expect(payments).toContainText("$200.00");

  await page.getByRole("button", { name: "Record payment" }).click();
  pay = page.getByRole("dialog", { name: "Record payment" });
  await pay.getByLabel("Amount paid").fill("350");
  await pay.getByLabel(`Amount for ${itemShortId}`).fill("350");
  const why = pay.getByLabel("Why pay more than is owed?");
  await expect(why).toBeVisible();
  await expect(pay.getByRole("button", { name: "Record payment of $350.00" })).toBeDisabled();
  await why.fill("Agreed bonus");
  await expect(pay.getByRole("button", { name: "Record payment of $350.00" })).toBeEnabled();
  await pay.getByLabel("Amount paid").fill("300");
  await pay.getByLabel(`Amount for ${itemShortId}`).fill("300");
  await expect(why).toBeHidden();
  await pay.getByRole("button", { name: "Record payment of $300.00" }).click();
  await expect(toast(page, `Payment of $300.00 recorded for ${consignorName}`)).toBeVisible();
  await expect(balance).toContainText(/Outstanding\s*\$0\.00/);
  await expect(balance).toContainText("Settled");

  await page.goto(itemUrl);
  await expect(page.getByText("Settled", { exact: true }).first()).toBeVisible();
});

test("a quantity consignment is received for a new consignor and partly returned", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const tag = tagFor(testInfo);
  const consignorName = `Qty ${tag}`;
  const productName = `Bottle cage ${tag}`;

  await signIn(page, "admin");
  await page.goto("/consignment");
  await page.getByRole("button", { name: "Receive item" }).click();
  const intake = page.getByRole("dialog", { name: "Receive item" });
  // A new consignor from the picker, created in the same commit.
  await intake.getByRole("combobox").first().fill(consignorName);
  await intake.getByRole("option", { name: `New consignor “${consignorName}”` }).click();
  await expect(intake.getByLabel("Consignor name")).toHaveValue(consignorName);
  await intake.getByRole("radio", { name: "Several identical" }).click();
  await expectNoSidewaysOverflow(page, "Receive item");
  await intake.getByRole("textbox", { name: "Name (required)", exact: true }).fill(productName);
  await intake.getByLabel("Quantity").fill("3");
  await fillMoney(page, "5", "12");
  await intake.getByRole("button", { name: "Receive item" }).click();
  await expect(toast(page, /^C-\d{6} received$/)).toBeVisible();
  await expect(page).toHaveURL(/\/consignment\/items\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: productName })).toBeVisible();
  await expect(page.getByText("3 of 3 left", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: consignorName })).toBeVisible();

  // Return one, with a reason.
  const returns = section(page, "Return to consignor");
  await returns.getByRole("button", { name: "Return to consignor…" }).click();
  await returns.getByLabel("Why is it going back?").fill("Consignor wants one back");
  await returns.getByLabel("How many").fill("1");
  await page.waitForTimeout(500);
  await returns.getByRole("button", { name: "Return 1 to consignor" }).click();
  await expect(toast(page, "1 returned to the consignor")).toBeVisible();
  await expect(page.getByText("2 of 3 left", { exact: true })).toBeVisible();
  const timeline = page.getByRole("list", { name: "Timeline" });
  await expect(timeline.getByText("1 returned to consignor", { exact: true })).toBeVisible();
  await expect(timeline.getByText("“Consignor wants one back”")).toBeVisible();
});
