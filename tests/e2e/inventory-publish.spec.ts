import { expect, test, type Page } from "@playwright/test";

import { BIKE, PRODUCT, SHOP, UNIT, UNIT_SHORT_ID } from "../fixtures/ids";
import { section, signIn, tagFor, toast } from "./helpers";

/**
 * M1.4 Step 4 on a phone and an iPad: publishing a product (D26) with its
 * requirements and public preview, stock locations, splitting one counted
 * item off as a unique item (D28) and a shop bike's stock link. Every record
 * a test creates carries tagFor(testInfo); counts are asserted relative to
 * the test's own product, so runs and projects never see each other.
 */

const PHOTO = "tests/e2e/fixtures/bike-photo.jpg";

/** A counted product with a price, cost and `stock` at the Shop floor; returns its page URL. */
async function stockedProduct(page: Page, name: string, sku: string, stock: number) {
  await page.goto("/inventory");
  await page.getByRole("button", { name: "New product" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New product" });
  await sheet.getByLabel("Name").fill(name);
  await sheet.getByLabel("SKU").fill(sku);
  await sheet.getByLabel("Sale price", { exact: true }).fill("25.00");
  await sheet.getByLabel("Cost", { exact: true }).fill("10.00");
  await sheet.getByRole("button", { name: "Add product" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  const stockCard = section(page, "Stock");
  await stockCard.getByRole("button", { name: "Adjust stock" }).click();
  const adjust = page.getByRole("dialog", { name: "Adjust stock" });
  await adjust.getByLabel("Quantity").fill(String(stock));
  await adjust.getByRole("button", { name: "Opening stock count" }).click();
  await adjust.getByRole("button", { name: "Save adjustment" }).click();
  await expect(toast(page, `Stock saved. Shop floor: ${stock}`)).toBeVisible();
  await expect(stockCard.getByText(`${stock} in stock`)).toBeVisible();
  return page.url();
}

test("a product is published once it has a public photo, shows what the public sees, and is unpublished", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const tag = tagFor(testInfo);
  const name = `Saddle ${tag}`;
  await signIn(page, "admin");
  await stockedProduct(page, name, `SD-${tag}`, 3);

  const card = section(page, "Publication");
  await expect(card).toContainText("Draft");
  await expect(card.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "Make internal" }).click();
  await expect(toast(page, "Listing is internal only")).toBeVisible();

  // Not publishable yet: no public photo, and the preview says it is not public.
  const publish = card.getByRole("button", { name: "Publish", exact: true });
  await expect(publish).toBeDisabled();
  await expect(card).toContainText("Still needed: A public photo.");
  const needs = card.getByRole("list", { name: "Publishing needs" });
  await expect(needs.getByRole("listitem").filter({ hasText: "A public photo" })).toContainText(
    "(missing)",
  );
  await expect(needs.getByRole("listitem").filter({ hasText: "A sale price" })).toContainText(
    "(done)",
  );
  const preview = card.getByRole("region", { name: "What the public sees" });
  await expect(preview).toContainText("Not public. Anonymous scans show nothing.");
  // D9: the database QR base (shop_settings.public_site_url), not the environment's.
  await expect(card.getByLabel("QR label URL", { exact: true })).toHaveText(
    new RegExp(`^${SHOP.publicSiteUrl.replace(/[.]/g, "\\.")}/q/P-\\d{6}$`),
  );

  // A photo through the camera control, made public in the viewer.
  await page.getByLabel("Choose photos").setInputFiles(PHOTO);
  const grid = page.getByRole("list", { name: "Photos", exact: true });
  await expect(grid.getByRole("listitem")).toHaveCount(1);
  await grid.getByRole("button", { name: "Open photo 1" }).click();
  const viewer = page.getByRole("dialog", { name: "Photo 1" });
  await expect(viewer.getByRole("radio", { name: "Customer" })).toHaveCount(0);
  await viewer.getByRole("radio", { name: "Public" }).click();
  await expect(toast(page, "Photo is now public")).toBeVisible();
  await viewer.getByRole("button", { name: "Close" }).click();

  // Now it publishes, and the preview is the public row.
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(toast(page, "Published")).toBeVisible();
  await expect(page.locator("header").getByText("Public", { exact: true })).toBeVisible();
  await expect(preview).toContainText(name);
  await expect(preview).toContainText("$25.00");
  await expect(preview).toContainText("Available");
  await expect(preview).toContainText("1 public photo");

  // Unpublish: internal again, and anonymous scans show nothing.
  await card.getByRole("button", { name: "Unpublish" }).click();
  await expect(toast(page, "Listing is internal only")).toBeVisible();
  await expect(preview).toContainText("Not public. Anonymous scans show nothing.");
});

test("a new location appears where stock is counted until it is switched off", async ({
  page,
}, testInfo) => {
  const tag = tagFor(testInfo);
  const name = `Loc ${tag}`;
  await signIn(page, "admin");

  await page.goto("/settings");
  await page.getByRole("link", { name: /Locations/ }).click();
  await expect(page).toHaveURL(/\/settings\/locations$/);
  const list = page.getByRole("list", { name: "Locations" });
  await expect(list.getByRole("listitem", { name: "Shop floor" })).toContainText("Default");
  // The kind label renders (it is read in a Server Component).
  await expect(list.getByRole("listitem", { name: "Shop floor" })).toContainText(
    "Shop floor · Sort order 10",
  );

  await page.getByRole("button", { name: "Add location" }).click();
  const sheet = page.getByRole("dialog", { name: "New location" });
  await sheet.getByLabel("Name").fill(name);
  await sheet.getByLabel("Sort order").fill("900");
  await sheet.getByRole("button", { name: "Add location" }).click();
  await expect(toast(page, `${name} added`)).toBeVisible();
  const row = list.getByRole("listitem", { name });
  await expect(row).toContainText("Storage · Sort order 900");
  await expect(row).not.toContainText("Default");

  // It is offered when adjusting stock.
  const openAdjust = async () => {
    await page.goto(`/products/${PRODUCT.brakePads}`);
    await section(page, "Stock").getByRole("button", { name: "Adjust stock" }).click();
    return page.getByRole("dialog", { name: "Adjust stock" });
  };
  let adjust = await openAdjust();
  await expect(adjust.getByRole("radio", { name: new RegExp(`^${name}`) })).toBeVisible();
  await adjust.getByRole("button", { name: "Cancel" }).click();

  // Switched off (it holds nothing), it is no longer offered.
  await page.goto("/settings/locations");
  const active = list
    .getByRole("listitem", { name })
    .getByRole("switch", { name: `${name} active` });
  await expect(active).toHaveAttribute("aria-checked", "true");
  await active.click();
  await expect(toast(page, `${name} is inactive`)).toBeVisible();
  await expect(list.getByRole("listitem", { name })).toContainText("Inactive");
  adjust = await openAdjust();
  await expect(adjust.getByRole("radio", { name: /^Shop floor/ })).toBeVisible();
  await expect(adjust.getByRole("radio", { name: new RegExp(`^${name}`) })).toHaveCount(0);
});

test("one counted item is split off as its own unique item", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const tag = tagFor(testInfo);
  const name = `Wheelset ${tag}`;
  await signIn(page, "admin");
  const productUrl = await stockedProduct(page, name, `WS-${tag}`, 5);

  await section(page, "Stock").getByRole("button", { name: "Split off as unique item" }).click();
  const sheet = page.getByRole("dialog", { name: "Split off as unique item" });
  await expect(sheet.getByLabel("Name")).toHaveValue(name);
  await expect(sheet.getByRole("radio", { name: "Shop floor · 5" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await sheet.getByLabel("Serial number").fill(`SN-${tag}`);
  await sheet.getByLabel("Condition (shown publicly when published)").fill("Ex-display, as new");
  await sheet.getByLabel("Reason").fill("Ex-display wheelset sold on its own");
  await sheet.getByRole("button", { name: "Split off" }).click();

  await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/);
  const unitId = (await page
    .locator("header")
    .getByText(/^U-\d{6}$/)
    .textContent())!.trim();
  await expect(toast(page, `Split off as ${unitId}`)).toBeVisible();
  await expect(page.locator("header").getByText("Available", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  await page.goto(productUrl);
  await expect(section(page, "Stock").getByText("4 in stock")).toBeVisible();
});

test("a shop bike in stock links to its unit and cannot be archived", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto(`/bikes/${BIKE.shopColnago}`);
  const link = section(page, "Stock").getByRole("link", {
    name: new RegExp(`In stock as ${UNIT_SHORT_ID.colnago}`),
  });
  await expect(link).toContainText(`In stock as ${UNIT_SHORT_ID.colnago} · Available`);

  await page.getByRole("button", { name: "Archive bike…" }).click();
  await page.getByRole("button", { name: "Archive bike", exact: true }).click();
  await expect(
    toast(page, "This bike is in stock as a unit; sell or write off the unit first."),
  ).toBeVisible();

  await link.click();
  await expect(page).toHaveURL(new RegExp(`/units/${UNIT.colnago}$`));
  // The listing card names the product's actual publication status.
  await expect(
    page.getByText(/^Listing follows P-\d{6} \((Draft|Internal only|Public|Sold|Archived)\)\./),
  ).toBeVisible();
});
