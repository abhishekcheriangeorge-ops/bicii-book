import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { signIn, tagFor, toast } from "./helpers";

/**
 * M1.2 customers, bikes and photos, on a phone and an iPad. Every record
 * these tests create carries a tag unique to the run and the project, so
 * the phone and iPad runs (and repeated runs on a kept database) never
 * find each other's customers or bikes.
 */

const PHOTO = path.join(__dirname, "fixtures", "bike-photo.jpg");

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
  const header = page.getByRole("searchbox", { name: "Search customers, bikes and jobs" });
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

  // Public, and back: the file moves between buckets, and a stranger (no
  // session, no key) can fetch it only while it is public.
  const shared = page.getByRole("dialog", { name: "Photo 1" });
  const image = shared.locator("img").first();
  const privateUrl = (await image.getAttribute("src"))!;
  expect(privateUrl).toContain("/object/sign/media-internal/");
  await shared.getByRole("radio", { name: "Public" }).click();
  await expect(toast(page, "Photo is now public")).toBeVisible();
  await expect(image).toHaveAttribute("src", /\/object\/public\/media-public\//);
  const publicUrl = (await image.getAttribute("src"))!;
  expect((await fetch(publicUrl)).status).toBe(200);
  // The private original is gone: its signed link no longer serves anything.
  expect((await fetch(privateUrl)).status).not.toBe(200);
  await shared.getByRole("radio", { name: "Internal" }).click();
  await expect(toast(page, "Photo is now internal")).toBeVisible();
  await expect(image).toHaveAttribute("src", /\/object\/sign\/media-internal\//);
  expect((await fetch(publicUrl)).status).not.toBe(200);
  const internalUrl = (await image.getAttribute("src"))!;
  expect((await fetch(internalUrl)).status).toBe(200);

  // Deleted with a reason: gone from the page and from Storage.
  await shared.getByRole("button", { name: "Delete photo…" }).click();
  await shared.getByRole("button", { name: "Cancel" }).click();
  // Cancel hands focus back to the button that opened the confirmation.
  await expect(shared.getByRole("button", { name: "Delete photo…" })).toBeFocused();
  await shared.getByRole("button", { name: "Delete photo…" }).click();
  await shared.getByLabel("Why are you deleting this photo?").fill("Test photo");
  // The confirm button ignores presses for 400 ms after it appears (a double tap).
  await page.waitForTimeout(500);
  await shared.getByRole("button", { name: "Delete photo", exact: true }).click();
  await expect(toast(page, "Photo deleted")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Photo 1" })).toBeHidden();
  await expect(grid).toBeHidden();
  expect((await fetch(internalUrl)).status).not.toBe(200);

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
  // ... and looks it: muted, with a not-allowed cursor, unlike the others.
  await expect(viewer.getByRole("radio", { name: "Public" })).toHaveCSS("cursor", "not-allowed");
  await expect(viewer.getByRole("radio", { name: "Customer" })).toHaveCSS("cursor", "pointer");
  const muted = await viewer
    .getByRole("radio", { name: "Public" })
    .evaluate((el) => getComputedStyle(el).color);
  const normal = await viewer
    .getByRole("radio", { name: "Customer" })
    .evaluate((el) => getComputedStyle(el).color);
  expect(muted).not.toBe(normal);
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

test("search keeps what is typed while a slow search loads, and a pending search never undoes opening a result", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page, "mechanic2");
  // A slow shop-floor connection: every search result takes 700 ms.
  await page.route(/\/customers\?/, async (route) => {
    if (route.request().headers()["rsc"]) await new Promise((r) => setTimeout(r, 700));
    await route.continue();
  });
  await page.goto("/customers");
  const field = page.getByRole("searchbox", { name: "Search customers", exact: true });

  // "tan" is sent after the pause; " wei" is typed while it loads, its
  // answer arriving between two keystrokes.
  await field.pressSequentially("tan", { delay: 30 });
  await page.waitForTimeout(350);
  await field.pressSequentially(" wei", { delay: 250 });
  await expect(page).toHaveURL(/[?&]q=tan(\+|%20)wei/);
  await expect(field).toHaveValue("tan wei");
  await page.waitForTimeout(1_000);
  await expect(field).toHaveValue("tan wei");
  const results = page.getByRole("list", { name: "Customers" });
  await expect(results.getByRole("link", { name: /Tan Wei Ming/ })).toBeVisible();

  // Type more and open the result at once, before that search is sent:
  // the record stays open.
  await field.pressSequentially(" m", { delay: 20 });
  await results.getByRole("link", { name: /Tan Wei Ming/ }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
});
