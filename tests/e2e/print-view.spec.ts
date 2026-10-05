import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import { reprintPath } from "../../src/lib/printing/links";
import { PRINT_JOB, PRODUCT, PRODUCT_SHORT_ID, UNIT } from "../fixtures/ids";
import { E2E_PUBLIC_SITE_URL } from "../fixtures/public-site";
import { signIn } from "./helpers";
import { QR_BASE, labelPayloads, pdfLinkUris, qrPayloadFor } from "./label-helpers";

/**
 * Phase 8 step 2 on a phone and an iPad (PLAN D9, D56, D59): the print view
 * and the PDF of an open job, a finished job's view, the print history, and
 * the QR base the Admin displays and accepts.
 *
 * READ-ONLY on the seeded jobs (PRINT_JOB): nothing here clicks Print,
 * Open PDF or a confirmation, so the jobs keep their statuses for the next
 * project and every other spec. Every payload assertion is exact equality
 * against the DATABASE QR base (SHOP.publicSiteUrl, http://localhost:4000),
 * which differs from the environment's scan-only base (E2E_PUBLIC_SITE_URL,
 * http://localhost:4001 by default).
 */

const base = QR_BASE;
const payload = qrPayloadFor(PRODUCT_SHORT_ID.barTape);
const MM = 72 / 25.4;

const codeField = (page: Page) => page.getByLabel("Or type the code on the label");

test("an open job's print view and PDF carry exactly the database payload", async ({ page }) => {
  await signIn(page, "mechanic1");
  await page.goto(`/print/labels/${PRINT_JOB.productQueued}`);

  await expect(page.locator("[data-label]")).toHaveCount(10);
  expect(await labelPayloads(page)).toEqual(Array.from({ length: 10 }, () => payload));
  await expect(page.getByText("10 labels · PDF download · 58 × 40 mm")).toBeVisible();
  await expect(page.getByText("1 of 10", { exact: true })).toBeVisible();

  // Read the link; never click it (that would mark the seeded job rendered).
  const href = await page.getByRole("link", { name: "Open PDF" }).getAttribute("href");
  expect(href).toBe(`/api/labels/${PRINT_JOB.productQueued}/pdf`);
  await expect(page.getByText(/Share → Print\. Set the paper to 58 × 40 mm/)).toBeVisible();

  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(res.headers()["content-disposition"]).toBe(
    `inline; filename="labels-${PRODUCT_SHORT_ID.barTape}-x10.pdf"`,
  );
  const pdf = await PDFDocument.load(await res.body(), { updateMetadata: false });
  expect(pdf.getPageCount()).toBe(10);
  for (const p of pdf.getPages()) {
    expect(Math.abs(p.getWidth() - 58 * MM)).toBeLessThan(0.01);
    expect(Math.abs(p.getHeight() - 40 * MM)).toBeLessThan(0.01);
  }
  expect(pdfLinkUris(pdf)).toEqual(Array.from({ length: 10 }, () => payload));
});

test("printed, the view is the labels and nothing else", async ({ page }) => {
  await signIn(page, "mechanic1");
  await page.goto(`/print/labels/${PRINT_JOB.productQueued}`);
  await expect(page.locator("[data-label]")).toHaveCount(10);
  await page.emulateMedia({ media: "print" });

  await expect(page.locator("[data-print-toolbar]")).toBeHidden();
  await expect(page.getByRole("link", { name: "Open PDF" })).toBeHidden();
  await expect(page.getByText("1 of 10", { exact: true })).toBeHidden();
  for (const label of await page.locator("[data-label]").all()) await expect(label).toBeVisible();

  const report = await page.evaluate(() => {
    const toast = document.querySelector('ol[aria-label="Notifications"]')?.parentElement;
    // Every rendered element that carries its own text must be inside a label.
    const stray: string[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      const ownText = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
      );
      if (!ownText || el.getClientRects().length === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden") continue;
      if (!el.closest("[data-label]")) stray.push(`${el.tagName}: ${el.textContent?.trim()}`);
    }
    return { toastDisplay: toast ? getComputedStyle(toast).display : null, stray };
  });
  expect(report.toastDisplay).toBe("none");
  expect(report.stray).toEqual([]);
});

test("a finished job is history: an outcome, Print again, and no PDF", async ({ page }) => {
  await signIn(page, "mechanic2");
  await page.goto(`/print/labels/${PRINT_JOB.productPrinted}`);
  await expect(
    page.getByRole("status").filter({ hasText: /^Printed .* by Marcus Tan/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Print again" })).toHaveAttribute(
    "href",
    reprintPath({
      id: PRINT_JOB.productPrinted,
      kind: "product",
      entityId: PRODUCT.barTape,
      quantity: 10,
    }),
  );
  await expect(page.getByRole("button", { name: "Print", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open PDF" })).toHaveCount(0);

  const res = await page.request.get(`/api/labels/${PRINT_JOB.productPrinted}/pdf`);
  expect(res.status()).toBe(409);
  expect(await res.text()).toBe(
    "This print job is finished. Print again from the record to make a new job.",
  );
  expect((await page.request.get(`/api/labels/not-a-job/pdf`)).status()).toBe(404);
});

test("the print history lists, filters and explains the seeded jobs", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/labels");
  await expect(page.getByRole("heading", { level: 1, name: "Labels" })).toBeVisible();
  const list = page.getByRole("list", { name: "Print jobs" });
  for (const id of Object.values(PRINT_JOB)) {
    await expect(list.locator(`a[href="/labels/${id}"]`)).toHaveCount(1);
  }

  await page.getByRole("link", { name: "Failed", exact: true }).click();
  await expect(page).toHaveURL(/\/labels\?status=failed$/);
  await expect(list.locator(`a[href="/labels/${PRINT_JOB.unitFailed}"]`)).toBeVisible();
  await expect(list.locator(`a[href="/labels/${PRINT_JOB.productQueued}"]`)).toHaveCount(0);
  await list.locator(`a[href="/labels/${PRINT_JOB.unitFailed}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/labels/${PRINT_JOB.unitFailed}$`));
  const details = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Details" }) });
  await expect(details).toContainText("Label roll ran out halfway through");
  await expect(page.getByRole("img", { name: /^Label: / })).toBeVisible();

  await page.goto(`/labels/${PRINT_JOB.unitReprint}`);
  await expect(page.getByRole("link", { name: "An earlier print job" })).toHaveAttribute(
    "href",
    `/labels/${PRINT_JOB.unitFailed}`,
  );
  await expect(page.getByRole("link", { name: "Print again" })).toHaveAttribute(
    "href",
    `/units/${UNIT.colnago}?print=1&qty=1&reprint=${PRINT_JOB.unitReprint}`,
  );

  await page.goto("/labels?status=open");
  await expect(list.locator(`a[href="/labels/${PRINT_JOB.bikeUnconfirmed}"]`)).toBeVisible();
  await expect(list.locator(`a[href="/labels/${PRINT_JOB.productPrinted}"]`)).toHaveCount(0);
});

test("scanning accepts the database base and the environment's base", async ({ page }) => {
  expect(E2E_PUBLIC_SITE_URL).not.toBe(base);
  await signIn(page, "mechanic2");
  for (const code of [payload, `${E2E_PUBLIC_SITE_URL}/q/${PRODUCT_SHORT_ID.barTape}`]) {
    await page.goto("/scan");
    await codeField(page).fill(code);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/products/${PRODUCT.barTape}$`));
  }
});

test("a product shows its QR label URL on the database base", async ({ page }) => {
  await signIn(page, "mechanic1");
  await page.goto(`/products/${PRODUCT.barTape}`);
  await expect(page.getByLabel("QR label URL", { exact: true })).toHaveText(payload);
});
