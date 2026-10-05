import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  BIKE,
  BIKE_SHORT_ID,
  PRODUCT,
  PRODUCT_SHORT_ID,
  UNIT,
  UNIT_SHORT_ID,
} from "../fixtures/ids";
import { E2E_PUBLIC_SITE_URL } from "../fixtures/public-site";
import { signIn } from "./helpers";

/**
 * Scanning and short-ID jumps (SPEC §20, PLAN D9), on a phone and an iPad.
 *
 * The camera is stubbed (TESTING.md "Scanning"): getUserMedia returns a
 * canvas.captureStream() whose canvas is repainted at 10 fps, so the
 * <video> really plays and requestVideoFrameCallback fires; a fake
 * BarcodeDetector "sees" whatever code the test chose. The page's own
 * decoding loop, interpretation and navigation run unchanged. Nothing is
 * written, so the specs need no tags.
 */

/** Stubs the camera and BarcodeDetector so every detection reads `rawValue`. */
async function stubCamera(context: BrowserContext, page: Page, rawValue: string) {
  await context.grantPermissions(["camera"]);
  await page.addInitScript((value: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 320;
    const ctx = canvas.getContext("2d")!;
    let flip = false;
    const paint = () => {
      flip = !flip;
      ctx.fillStyle = flip ? "#f5d000" : "#050707";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    paint();
    window.setInterval(paint, 100);

    const w = window as unknown as Record<string, unknown>;
    w.__scanDetections = 0;
    w.BarcodeDetector = class {
      static async getSupportedFormats() {
        return ["qr_code"];
      }
      async detect() {
        w.__scanDetections = (w.__scanDetections as number) + 1;
        return [{ rawValue: value }];
      }
    };
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(10);
    }
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = ((descriptor: PermissionDescriptor) =>
      descriptor.name === ("camera" as PermissionName)
        ? Promise.resolve({ state: "granted", onchange: null } as PermissionStatus)
        : query(descriptor)) as typeof navigator.permissions.query;
  }, rawValue);
}

const codeField = (page: Page) => page.getByLabel("Or type the code on the label");

async function typeCode(page: Page, code: string) {
  await codeField(page).fill(code);
  await page.getByRole("button", { name: "Open", exact: true }).click();
}

test("typing a label's code opens the record, in any case, and an unknown code says so", async ({
  page,
}) => {
  await signIn(page, "mechanic2");
  await page.goto("/scan");

  // A product by its P- number.
  await typeCode(page, PRODUCT_SHORT_ID.brakePads);
  await expect(page).toHaveURL(new RegExp(`/products/${PRODUCT.brakePads}$`));
  await expect(page.getByText(PRODUCT_SHORT_ID.brakePads, { exact: true }).first()).toBeVisible();

  // A bike, typed in lower case.
  await page.goto("/scan");
  await typeCode(page, BIKE_SHORT_ID.tanTarmac.toLowerCase());
  await expect(page).toHaveURL(new RegExp(`/bikes/${BIKE.tanTarmac}$`));

  // Not a code at all: a field error, no navigation.
  await page.goto("/scan");
  await typeCode(page, "hello");
  await expect(page.getByText("Enter a code like P-000123")).toBeVisible();
  await expect(page).toHaveURL(/\/scan$/);

  // A well-formed code that matches nothing.
  await typeCode(page, "P-999999");
  await expect(page).toHaveURL(/\/q\/P-999999$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("No record with P-999999");
  await page.getByRole("link", { name: "Scan again" }).click();
  await expect(page).toHaveURL(/\/scan$/);

  // The Admin's own /q route redirects straight to the record.
  await page.goto(`/q/${UNIT_SHORT_ID.colnago}`);
  await expect(page).toHaveURL(new RegExp(`/units/${UNIT.colnago}$`));
  await page.goto(`/q/${UNIT_SHORT_ID.colnago.toLowerCase()}`);
  await expect(page).toHaveURL(new RegExp(`/units/${UNIT.colnago}$`));
});

test("scanning a BICII label with the camera opens the unit", async ({ page, context }) => {
  await stubCamera(context, page, `${E2E_PUBLIC_SITE_URL}/q/${UNIT_SHORT_ID.colnago}`);
  await signIn(page, "admin");
  await page.goto("/scan");
  await expect(page).toHaveURL(new RegExp(`/units/${UNIT.colnago}$`));
  await expect(page.getByText(UNIT_SHORT_ID.colnago, { exact: true }).first()).toBeVisible();
});

test("a code that is not a BICII label is shown, never followed", async ({ page, context }) => {
  await stubCamera(context, page, "https://example.com/phish");
  await signIn(page, "admin");
  await page.goto("/scan");
  const notice = page.getByRole("alert").filter({ hasText: "Not a BICII label" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("https://example.com/phish");
  // It keeps scanning, and stays put: no navigation, no link to the text.
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __scanDetections: number }).__scanDetections),
    )
    .toBeGreaterThan(3);
  await expect(page).toHaveURL(/\/scan$/);
  await expect(page.locator('a[href*="example.com"]')).toHaveCount(0);
  // Typing still works alongside the camera.
  await typeCode(page, PRODUCT_SHORT_ID.brakePads);
  await expect(page).toHaveURL(new RegExp(`/products/${PRODUCT.brakePads}$`));
});

test("the header search finds a SKU in lower case and jumps straight to an exact P- number", async ({
  page,
}) => {
  await signIn(page, "mechanic1");
  await page.goto("/");
  const header = page.getByRole("searchbox", { name: "Search customers, bikes, jobs and stock" });
  await header.fill("shi-l05a-rf");
  await header.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=shi-l05a-rf/);
  const products = page.getByRole("list", { name: "Products" });
  const hit = products.getByRole("link", { name: /Road disc brake pads/ });
  await expect(hit).toContainText(PRODUCT_SHORT_ID.brakePads);
  await expect(hit).toContainText(/\d+ in stock/);

  await page.goto("/");
  await header.fill(PRODUCT_SHORT_ID.brakePads.toLowerCase());
  await header.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/products/${PRODUCT.brakePads}$`));
});
