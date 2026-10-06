import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { BIKE, CUSTOMER_LOGIN, PRINT_JOB, PRODUCT, PRODUCT_SHORT_ID } from "../fixtures/ids";
import { E2E_PUBLIC_SITE_URL } from "../fixtures/public-site";
import { sessionCookiesFor } from "./api";
import { createProduct, section, signIn, tagFor, toast } from "./helpers";
import { QR_BASE, labelPayloads as payloads } from "./label-helpers";

/**
 * Phase 8 step 3 on a phone and an iPad (SPEC §15, §16; PLAN D9, D56–D59;
 * ADR-017): printing from the product, unit and bike pages, confirming and
 * failing jobs, Print again, the admin's Labels and printers settings, and
 * that every QR URL shown is the database's.
 *
 * Every payload assertion is exact equality against the DATABASE QR base
 * (SHOP.publicSiteUrl), never the environment's scan-only base. Nothing
 * here changes the shop's public site address (one database for every
 * spec) or the status of a seeded print job. window.print is stubbed.
 */

const base = QR_BASE;

async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __printCalls: number }).__printCalls = 0;
    window.print = () => {
      (window as unknown as { __printCalls: number }).__printCalls++;
    };
  });
}

const printCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls);

const sheet = (page: Page) => page.getByRole("dialog");

async function openPrintSheet(page: Page) {
  await page.getByRole("button", { name: "Print label" }).first().click();
  await expect(sheet(page)).toBeVisible();
}

/** Presses the sheet's Print button and returns the new job's id from the print view's URL. */
async function startJob(page: Page, buttonName: string): Promise<string> {
  await sheet(page).getByRole("button", { name: buttonName }).click();
  await expect(page).toHaveURL(/\/print\/labels\/[0-9a-f-]{36}$/);
  return page.url().split("/").at(-1)!;
}

async function newBike(page: Page, model: string): Promise<{ url: string; shortId: string }> {
  await page.goto("/bikes");
  await page.getByRole("button", { name: "New bike" }).first().click();
  const form = page.getByRole("dialog", { name: "New bike" });
  await form.getByLabel("Brand").fill("Moulton");
  await form.getByLabel("Model").fill(model);
  await form.getByLabel("Frame size").fill("M");
  await form.getByLabel("Colour").fill("Green");
  await form.getByRole("button", { name: "Add bike" }).click();
  await expect(page).toHaveURL(/\/bikes\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Moulton ${model}`);
  const shortId = (await page
    .locator("header")
    .getByText(/^B-\d{6}$/)
    .first()
    .textContent())!;
  return { url: page.url(), shortId: shortId.trim() };
}

/** A new unique product with its first unit (unique data); ends on the unit's page. */
async function newUniqueUnit(
  page: Page,
  name: string,
  serial: string,
  condition: string,
): Promise<{ url: string; shortId: string }> {
  await page.goto("/inventory");
  await page.getByRole("button", { name: "New product" }).first().click();
  const form = page.getByRole("dialog", { name: "New product" });
  await form.getByRole("radio", { name: "Unique" }).click();
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Sale price", { exact: true }).fill("900.00");
  await form.getByLabel("Cost", { exact: true }).fill("400.00");
  const firstUnit = form.getByRole("region", { name: "First unit" });
  await firstUnit.getByLabel("Serial number").fill(serial);
  await firstUnit.getByLabel("Condition (shown publicly when published)").fill(condition);
  await form.getByRole("button", { name: "Add product" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  const units = page.getByRole("list", { name: "Units", exact: true });
  const shortId = (await units.getByText(/^U-\d{6}$/).textContent())!.trim();
  await units.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/);
  return { url: page.url(), shortId };
}

test("browser print produces 10 identical labels", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const tag = tagFor(testInfo);
  await stubPrint(page);
  await signIn(page, "admin");
  const product = await createProduct(page, {
    name: `Label tape ${tag}`,
    sku: `LBL-${tag}`,
    price: "19.90",
    cost: "8",
  });

  await openPrintSheet(page);
  await expect(sheet(page).getByRole("heading")).toHaveText(`Print labels · ${product.shortId}`);
  await sheet(page).getByRole("button", { name: "10 labels" }).click();
  await sheet(page).getByRole("radio", { name: "This device (browser print)" }).click();
  const jobId = await startJob(page, "Print 10 labels");

  await expect(page.locator("[data-label]")).toHaveCount(10);
  expect(await payloads(page)).toEqual(
    Array.from({ length: 10 }, () => `${base}/q/${product.shortId}`),
  );
  await page.getByRole("button", { name: "Print", exact: true }).click();
  expect(await printCalls(page)).toBe(1);
  await page.getByRole("button", { name: "Yes, all printed" }).click();
  await expect(toast(page, "Marked as printed")).toBeVisible();

  await page.goto(`/labels/${jobId}`);
  await expect(page.getByText("Printed", { exact: true }).first()).toBeVisible();
  // The record's Labels card lists it.
  await page.goto(product.url);
  await expect(section(page, "Labels").locator(`a[href="/labels/${jobId}"]`)).toContainText(
    "Printed",
  );
});

test("a unique unit prints one distinct label that opens its record", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const tag = tagFor(testInfo);
  await signIn(page, "admin"); // a new product needs manage_inventory
  // A unit of its own (unique data): its jobs never crowd a seeded record's.
  // The condition stays short: a label truncates a long line with "…".
  const unit = await newUniqueUnit(page, `Frame ${tag}`, `SN-${tag}`, "Scuffed");

  // A new product is not published: what the public sees is nothing.
  await section(page, "Labels").getByRole("link", { name: "What the public sees" }).click();
  await expect(page).toHaveURL(/#what-the-public-sees$/);
  await expect(page.getByRole("region", { name: "What the public sees" })).toContainText(
    "Not public",
  );

  await openPrintSheet(page);
  await expect(sheet(page).getByText(/^Not public yet: anyone who scans this label/)).toBeVisible();
  await expect(sheet(page).getByText("One label per unit.", { exact: false })).toBeVisible();
  const qty = sheet(page).getByLabel("How many");
  await expect(qty).toHaveValue("1");
  await qty.fill("10");
  await expect(sheet(page).getByRole("button", { name: "Increase" })).toBeDisabled();
  await qty.fill("1");
  await startJob(page, "Print 1 label");

  await expect(page.locator("[data-label]")).toHaveCount(1);
  const payload = `${base}/q/${unit.shortId}`;
  expect(await payloads(page)).toEqual([payload]);
  // The unit's own lines: its condition's first line and its short ID.
  await expect(page.locator("[data-label]").first()).toContainText("Scuffed");
  await expect(page.locator("[data-label]").first()).toContainText(unit.shortId);
  // One label: the question is about "the label", never "all 1 label".
  await page.getByRole("button", { name: "Print", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Did the label print correctly?" })).toBeVisible();

  await page.goto("/scan");
  await page.getByLabel("Or type the code on the label").fill(payload);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(unit.url);
});

test("a failed print keeps its reason and is printed again as a new job", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const tag = tagFor(testInfo);
  await stubPrint(page);
  await signIn(page, "mechanic1");
  const bike = await newBike(page, `Tag ${tag}`);

  await openPrintSheet(page);
  await expect(
    sheet(page).getByText("Bike tags are for the workshop.", { exact: false }),
  ).toBeVisible();
  await sheet(page).getByRole("radio", { name: "This device (browser print)" }).click();
  const failedId = await startJob(page, "Print 1 label");
  expect(await payloads(page)).toEqual([`${base}/q/${bike.shortId}`]);

  // Only a compact row stays on top while the labels scroll (Back, status, Print).
  const toolbar = await page.locator("[data-print-toolbar]").boundingBox();
  expect(toolbar!.height).toBeLessThan(page.viewportSize()!.height / 4);
  await page.getByRole("button", { name: "Print", exact: true }).click();
  await page.getByRole("button", { name: "Something went wrong…" }).click();
  const reason = page.getByLabel("What went wrong?");
  await expect(reason).toBeFocused();
  // The whole confirmation is in the page's flow: on a phone too, its last
  // button is on screen (it used to sit below the fold of a sticky header).
  await expect(page.getByRole("button", { name: "Mark as failed" })).toBeInViewport();
  await page.waitForTimeout(500); // the confirm button ignores presses for 400 ms
  await page.getByRole("button", { name: "Mark as failed" }).click();
  await expect(page.getByText("Give a reason.")).toBeVisible();
  await reason.fill(`Smudged ${tag}`);
  await page.getByRole("button", { name: "Mark as failed" }).click();
  await expect(toast(page, "Marked as failed")).toBeVisible();

  await page.goto("/labels?status=failed");
  const row = page
    .getByRole("list", { name: "Print jobs" })
    .locator(`a[href="/labels/${failedId}"]`);
  await expect(row).toContainText(`Smudged ${tag}`);

  await page.goto(`/print/labels/${failedId}`);
  await page.getByRole("link", { name: "Print again" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/bikes/[0-9a-f-]{36}\\?print=1&qty=1&reprint=${failedId}$`),
  );
  await expect(sheet(page).getByRole("heading")).toHaveText(`Print again · ${bike.shortId}`);
  await expect(sheet(page).getByLabel("How many")).toHaveValue("1");
  const againId = await startJob(page, "Print 1 label");
  expect(againId).not.toBe(failedId);
  // The deep link is spent: Back skips it (no sheet, no second job).
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/print/labels/${failedId}$`));
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto(`/labels/${againId}`);
  await expect(page.getByRole("link", { name: "An earlier print job" })).toHaveAttribute(
    "href",
    `/labels/${failedId}`,
  );
});

test("mechanic2 prints a bike tag but cannot open label settings", async ({ page }) => {
  await signIn(page, "mechanic2");
  await page.goto(`/bikes/${BIKE.priyaTern}`);
  await openPrintSheet(page);
  await startJob(page, "Print 1 label");
  await expect(page.locator("[data-label]")).toHaveCount(1);

  await page.goto("/settings");
  await expect(page.getByRole("link", { name: /Labels and printers/ })).toHaveCount(0);
  const res = await page.goto("/settings/labels");
  expect(res?.status()).toBe(403);
});

test("admin adds a template and prints with it", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const tag = tagFor(testInfo);
  const name = `${tag} 50 × 30`;
  await signIn(page, "admin");
  await page.goto("/settings/labels");
  await page.getByRole("button", { name: "Add template" }).click();
  const form = page.getByRole("dialog", { name: "New label template" });
  await form.getByRole("textbox", { name: /^Name/ }).fill(name);
  await form.getByLabel("Width (mm)").fill("50");
  await form.getByLabel("Height (mm)").fill("30");
  await form.getByLabel("QR size (mm)").fill("30");
  await expect(form.getByRole("status").filter({ hasText: "does not fit" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Add template" })).toBeDisabled();
  await form.getByLabel("QR size (mm)").fill("24");
  await expect(form.getByRole("button", { name: "Add template" })).toBeEnabled();
  await form.getByRole("button", { name: "Add template" }).click();
  await expect(toast(page, `${name} saved`)).toBeVisible();
  const row = page.getByRole("list", { name: "Product templates" }).getByRole("button", {
    name: new RegExp(tag),
  });
  await expect(row).toContainText("50 × 30 mm");

  await page.goto(`/products/${PRODUCT.barTape}`);
  await openPrintSheet(page);
  await sheet(page).getByRole("radio", { name }).click();
  await expect(sheet(page).getByText(`50 × 30 mm · ${name}`)).toBeVisible();
  await sheet(page).getByLabel("How many").fill("2");
  await startJob(page, "Print 2 labels");
  await expect(page.locator("[data-label]")).toHaveCount(2);
  const css = await page
    .locator("style")
    .evaluateAll((els) => els.map((e) => e.textContent).join("\n"));
  expect(css).toContain("size: 50.0mm 30.0mm");

  // Not the default: it can be switched off.
  await page.goto("/settings/labels");
  await row.click();
  const edit = page.getByRole("dialog", { name: `Edit ${name}` });
  await edit.getByRole("switch", { name: "Active" }).click();
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(toast(page, `${name} saved`)).toBeVisible();
  await expect(row).toContainText("Off");
});

test("signed-out visitors cannot open print views or PDFs", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/print/labels/${PRINT_JOB.productQueued}`);
  await expect(page).toHaveURL(/\/login/);
  await page.goto(`/api/labels/${PRINT_JOB.productQueued}/pdf`);
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});

test("a signed-in customer gets a 403, not a print view or a PDF", async ({ page }, testInfo) => {
  // proxy.ts only redirects signed-out visitors: this reaches the handlers'
  // own staff checks (requireStaff, authorizeStaff) with a real session.
  // The login form signs a customer out straight after the code (D70), so
  // the session is made through the API and handed to the browser.
  const cookies = await sessionCookiesFor(CUSTOMER_LOGIN.chloe.email);
  const url = String(testInfo.project.use.baseURL);
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, url })));
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/login/);

  const pdf = await page.request.get(`/api/labels/${PRINT_JOB.productQueued}/pdf`);
  expect(pdf.status()).toBe(403);
  expect(pdf.headers()["content-type"] ?? "").not.toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString("latin1")).not.toBe("%PDF");

  const view = await page.goto(`/print/labels/${PRINT_JOB.productQueued}`);
  expect(view?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "You can't open this" })).toBeVisible();
  await expect(page.locator("[data-label]")).toHaveCount(0);
});

test("an unknown bike is not found, not an error", async ({ page }) => {
  await signIn(page, "mechanic2");
  await page.goto(`/bikes/${randomUUID()}`);
  await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
});

test("a record page still renders when printing is unavailable", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const tag = tagFor(testInfo);
  await signIn(page, "admin");
  const bike = await newBike(page, `Archived ${tag}`);
  await page.getByRole("button", { name: "Archive bike…" }).click();
  await page.getByRole("button", { name: "Archive bike", exact: true }).click();
  await expect(toast(page, `${bike.shortId} archived`)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Moulton Archived ${tag}`);
  const labels = section(page, "Labels");
  await expect(labels).toContainText(
    "That record is archived. Unarchive it before printing labels.",
  );
  await expect(labels.getByRole("button", { name: "Print label" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Print label" }).first()).toBeDisabled();
});

test("the QR address shown is the one printed", async ({ page }) => {
  expect(E2E_PUBLIC_SITE_URL).not.toBe(base);
  await signIn(page, "admin");
  await page.goto("/settings/labels");
  await expect(page.locator("[data-qr-base]")).toHaveText(base);

  const payload = `${base}/q/${PRODUCT_SHORT_ID.barTape}`;
  await page.goto(`/products/${PRODUCT.barTape}`);
  const onLabel = await page.getByLabel("QR URL on the label", { exact: true }).textContent();
  const listing = await page.getByLabel("QR label URL", { exact: true }).textContent();
  expect(onLabel).toBe(payload);
  expect(listing).toBe(payload);
  const envForm = `${E2E_PUBLIC_SITE_URL}/q/${PRODUCT_SHORT_ID.barTape}`;
  expect(onLabel).not.toBe(envForm);
  expect(listing).not.toBe(envForm);
});
