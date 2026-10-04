import path from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { signIn, toast } from "./helpers";

/**
 * M1.2 customers, bikes and photos, on a phone and an iPad. Every record
 * these tests create carries a tag unique to the run and the project, so
 * the phone and iPad runs (and repeated runs on a kept database) never
 * find each other's customers or bikes.
 */

const PHOTO = path.join(__dirname, "fixtures", "bike-photo.jpg");

function tagFor(testInfo: TestInfo): string {
  return `${testInfo.project.name}${Date.now().toString(36)}`.toUpperCase();
}

async function createCustomer(page: Page, first: string, last: string, phone?: string) {
  await page.goto("/customers");
  await page.getByRole("button", { name: "New customer" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New customer" });
  await sheet.getByLabel("First name").fill(first);
  await sheet.getByLabel("Last name").fill(last);
  if (phone) await sheet.getByLabel("Phone").fill(phone);
  await sheet.getByRole("button", { name: "Create customer" }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: `${first} ${last}` })).toBeVisible();
  return page.url();
}

/** Searches from the header field (Enter opens /search) and opens the bike result. */
async function searchFromHeader(page: Page, query: string, bikeTitle: string) {
  const header = page.getByRole("searchbox", { name: "Search customers and bikes" });
  await header.fill(query);
  await header.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=/);
  const result = page.getByRole("list", { name: "Bikes" }).getByRole("link", { name: bikeTitle });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/\/bikes\/[0-9a-f-]{36}$/);
}

test("staff register a customer's bike with a photo, share it, find it, hand it over and archive the customer", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const tag = tagFor(testInfo);
  const serial = `E2E-${tag}-77`;
  const model = `TSR ${tag}`;
  const bikeTitle = `Moulton ${model}`;

  await signIn(page, "admin");
  await createCustomer(page, "Buyer", tag);
  const ownerUrl = await createCustomer(page, "Owner", tag, "+65 8000 0001");

  // Contact card: tap to call.
  await expect(page.getByRole("link", { name: /\+65 8000 0001/ })).toHaveAttribute(
    "href",
    "tel:+6580000001",
  );

  // New bike from the customer's page: the owner is preset.
  await page.getByRole("button", { name: "Add bike" }).click();
  const bikeSheet = page.getByRole("dialog", { name: "New bike" });
  await expect(bikeSheet).toContainText(`Owner ${tag}`);
  await bikeSheet.getByLabel("Brand").fill("Moulton");
  await bikeSheet.getByLabel("Model").fill(model);
  await bikeSheet.getByLabel("Serial number").fill(serial);
  await bikeSheet.getByRole("button", { name: "Add bike" }).click();
  await expect(page).toHaveURL(/\/bikes\/[0-9a-f-]{36}$/);
  const bikeUrl = page.url();
  await expect(page.getByRole("heading", { level: 1, name: bikeTitle })).toBeVisible();
  const shortId = (await page
    .getByText(/^B-\d{6}$/)
    .first()
    .textContent())!.trim();
  expect(shortId).toMatch(/^B-\d{6}$/);
  await expect(
    page.getByRole("list", { name: "Ownership history" }).getByRole("listitem").first(),
  ).toContainText(`Registered to Owner ${tag}`);

  // A photo from the library: the thumbnail appears, and opens.
  await page.getByLabel("Choose photos").setInputFiles(PHOTO);
  const grid = page.getByRole("list", { name: "Photos", exact: true });
  await expect(grid.getByRole("listitem")).toHaveCount(1);
  const thumb = grid.getByRole("button", { name: "Open photo 1" });
  await expect(thumb.locator("img")).toHaveJSProperty("complete", true);
  expect(await thumb.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(
    640,
  );
  await thumb.click();
  const viewer = page.getByRole("dialog", { name: "Photo 1" });
  await expect(viewer.getByRole("radio", { name: "Internal" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Share it with the customer: still private storage, a badge on the tile.
  await viewer.getByRole("radio", { name: "Customer" }).click();
  await expect(toast(page, "Photo is now customer")).toBeVisible();
  await expect(viewer).toContainText("Staff, and the bike's current owner");
  await viewer.getByRole("button", { name: "Close" }).click();
  await expect(grid.getByText("Customer", { exact: true })).toBeVisible();
  await page.reload();
  await grid.getByRole("button", { name: "Open photo 1" }).click();
  await expect(
    page.getByRole("dialog", { name: "Photo 1" }).getByRole("radio", { name: "Customer" }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("dialog", { name: "Photo 1" })
    .getByRole("button", { name: "Close" })
    .click();

  // Found from the header search by serial number (case, spaces and dashes
  // don't matter) and by its B- number.
  await searchFromHeader(page, serial.toLowerCase().replaceAll("-", " "), bikeTitle);
  await searchFromHeader(page, shortId, bikeTitle);
  expect(page.url()).toBe(bikeUrl);

  // Hand it over, with a reason that stays in its history.
  await page.getByRole("button", { name: "Transfer ownership" }).click();
  const transfer = page.getByRole("dialog", { name: "Transfer ownership" });
  await transfer.getByRole("combobox", { name: "Customer" }).fill(`Buyer ${tag}`);
  await page.getByRole("option", { name: new RegExp(`Buyer ${tag}`) }).click();
  await transfer.getByLabel("Reason").fill(`Sold privately (${tag})`);
  await transfer.getByRole("button", { name: "Transfer", exact: true }).click();
  await expect(toast(page, `Bike transferred to Buyer ${tag}`)).toBeVisible();
  const latest = page
    .getByRole("list", { name: "Ownership history" })
    .getByRole("listitem")
    .first();
  await expect(latest).toContainText(`Owner ${tag} → Buyer ${tag}`);
  await expect(latest).toContainText(`Sold privately (${tag})`);
  await expect(latest).toContainText("Asha Admin");
  await expect(page.getByText(`Owned by Buyer ${tag}`)).toBeVisible();

  // Archive the previous owner: hidden from search, cannot receive bikes.
  await page.goto(ownerUrl);
  await page.getByRole("button", { name: "Archive customer…" }).click();
  await page.getByRole("button", { name: "Archive customer", exact: true }).click();
  await expect(toast(page, `Owner ${tag} archived`)).toBeVisible();
  await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add bike" })).toBeDisabled();
  await page.goto(`/customers?q=${encodeURIComponent(`Owner ${tag}`)}`);
  await expect(page.getByText(`No customer matches “Owner ${tag}”`)).toBeVisible();
  await page.goto(`/customers?archived=1&q=${encodeURIComponent(`Owner ${tag}`)}`);
  await expect(page.getByRole("list", { name: "Customers" })).toContainText(`Owner ${tag}`);
});

test("mechanic2, with no permissions, adds customers and shop bikes; a customer-record photo is never public", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const tag = tagFor(testInfo);

  await signIn(page, "mechanic2");
  await createCustomer(page, "Walk-in", tag);

  // Photo on the customer record: internal or customer, never public (PLAN D13).
  await page.getByLabel("Choose photos").setInputFiles(PHOTO);
  const grid = page.getByRole("list", { name: "Photos", exact: true });
  await expect(grid.getByRole("listitem")).toHaveCount(1);
  await grid.getByRole("button", { name: "Open photo 1" }).click();
  const viewer = page.getByRole("dialog", { name: "Photo 1" });
  await expect(viewer.getByRole("radio", { name: "Public" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(viewer).toContainText("Photos on a customer record can never be public.");
  await viewer.getByRole("button", { name: "Close" }).click();

  // A shop bike: no customer.
  await page.goto("/bikes");
  await page.getByRole("button", { name: "New bike" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New bike" });
  await sheet.getByLabel("Brand").fill("Brompton");
  await sheet.getByLabel("Model").fill(`Shop ${tag}`);
  await sheet.getByRole("button", { name: "Add bike" }).click();
  await expect(page).toHaveURL(/\/bikes\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: `Brompton Shop ${tag}` })).toBeVisible();
  await expect(page.getByText("Shop bike · no customer")).toBeVisible();
  await expect(page.getByText(/^B-\d{6}$/).first()).toBeVisible();
});
