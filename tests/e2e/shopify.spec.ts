import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

import { SHOPIFY_PRODUCT, SHOPIFY_PRODUCT_SHORT_ID } from "../fixtures/ids";
import {
  orderPaidPayload,
  refundPayload,
  webhookHeaders,
  type OrderLineInput,
} from "../fixtures/shopify";
import { section, signIn, toast } from "./helpers";

/**
 * Phase 10 on a phone and an iPad (SPEC §27.3 journey 5; PLAN D80–D89).
 * Shopify is the in-memory fake (playwright.config.mts sets
 * SHOPIFY_ADAPTER=fake, the fixtures' webhook secret and shop), and the
 * webhooks are POSTed to the real route, signed like Shopify signs them.
 * Every order id and name, refund id and webhook id carries the project
 * and a timestamp; each project uses its own seeded products
 * (SHOPIFY_PRODUCT.e2ePhone / e2eTablet for the journey, e2eLinkPhone /
 * e2eLinkTablet for the unmapped variant). A CI retry finds the journey
 * product already published and the link product already linked, and
 * still passes.
 */

const PHOTO = "tests/e2e/fixtures/bike-photo.jpg";

type Project = "phone" | "tablet";
const projectOf = (testInfo: TestInfo): Project =>
  testInfo.project.name === "tablet" ? "tablet" : "phone";

/** A numeric Shopify id unique to this project and moment: 1… on a phone, 2… on an iPad. */
function numericId(project: Project, stamp: number, suffix = ""): number {
  return Number(`${project === "phone" ? 1 : 2}${stamp}${suffix}`);
}

const journeyProduct = (p: Project) =>
  p === "phone" ? SHOPIFY_PRODUCT.e2ePhone : SHOPIFY_PRODUCT.e2eTablet;
const linkProduct = (p: Project) =>
  p === "phone" ? SHOPIFY_PRODUCT.e2eLinkPhone : SHOPIFY_PRODUCT.e2eLinkTablet;
const linkProductShortId = (p: Project) =>
  p === "phone" ? SHOPIFY_PRODUCT_SHORT_ID.e2eLinkPhone : SHOPIFY_PRODUCT_SHORT_ID.e2eLinkTablet;
/** The Shopify variant (and its product) the unmapped-variant step links. */
const linkVariant = (p: Project) => ({
  variant: p === "phone" ? 9800000001 : 9800000002,
  product: p === "phone" ? 9700000001 : 9700000002,
});

/** Opens a product page and waits until its cards have rendered (it streams). */
async function openProduct(page: Page, id: string) {
  await page.goto(`/products/${id}`);
  await expect(section(page, "Publication").getByText("Status", { exact: true })).toBeVisible();
  await expect(section(page, "Online (Shopify)")).toBeVisible();
}

/** The product page's stock total. */
async function onHand(page: Page): Promise<number> {
  const total = section(page, "Stock")
    .locator("dt", { hasText: /^Total$/ })
    .locator("xpath=following-sibling::dd[1]");
  return Number((await total.textContent())!.trim().replace("−", "-"));
}

/** Reloads the product page until its stock total is `n`. */
async function expectOnHand(page: Page, n: number) {
  await expect
    .poll(
      async () => {
        await page.reload();
        await expect(section(page, "Stock")).toBeVisible();
        return onHand(page);
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toBe(n);
}

/** How many "Sold online" rows the product page's recent movements show. */
async function onlineSales(page: Page): Promise<number> {
  return section(page, "Recent movements")
    .getByRole("listitem", { name: /^Sold online / })
    .count();
}

async function post(
  request: APIRequestContext,
  topic: string,
  webhookId: string,
  body: unknown,
  secret?: string,
) {
  const raw = JSON.stringify(body);
  return request.post("/api/shopify/webhooks", {
    data: raw,
    headers: webhookHeaders({ topic, webhookId, raw, ...(secret ? { secret } : {}) }),
  });
}

/** Makes the product public (a public photo, then Publish) unless it already is. */
async function ensurePublic(page: Page) {
  const publication = section(page, "Publication");
  const publish = publication.getByRole("button", { name: "Publish", exact: true });
  if ((await publish.count()) === 0) return;
  if (await publish.isDisabled()) {
    await page.getByLabel("Choose photos").setInputFiles(PHOTO);
    const grid = page.getByRole("list", { name: "Photos", exact: true });
    await expect(grid.getByRole("listitem")).toHaveCount(1);
    await grid.getByRole("button", { name: /^Open photo 1/ }).click();
    const viewer = page.getByRole("dialog", { name: "Photo 1" });
    await viewer.getByRole("radio", { name: "Public" }).click();
    await expect(toast(page, "Photo is now public")).toBeVisible();
    await viewer.getByRole("button", { name: "Close" }).click();
  }
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(toast(page, /^Published$/)).toBeVisible();
}

test("journey 5: publish online, one sale from repeated deliveries, then a refund that moves no stock", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240_000);
  const project = projectOf(testInfo);
  const stamp = Date.now();
  await signIn(page, "admin");
  await openProduct(page, journeyProduct(project));
  await ensurePublic(page);
  const n = await onHand(page);
  expect(n).toBeGreaterThan(1);

  // 1. Publish online: the toast, then Synced at the on-hand quantity.
  const online = section(page, "Online (Shopify)");
  await expect(online.getByText("Test Shopify")).toBeVisible();
  const toggle = online.getByRole("switch", { name: "Publish online" });
  if ((await toggle.getAttribute("aria-checked")) !== "true") {
    await toggle.click();
    await expect(toast(page, "Published online")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(online.getByText("Synced", { exact: true })).toBeVisible();
    await expect(online).toContainText(`Online quantity ${n} at Shop floor`);
  }
  // Otherwise a retry found it published: the in-memory Shopify of a new
  // server process no longer holds it, so a sync may defer (D83); the
  // order below does not depend on it.
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await online.getByText("Shopify details").click();
  const variantGid = (await online
    .getByLabel("Shopify variant ID", { exact: true })
    .textContent())!.trim();
  const productGid = (await online
    .getByLabel("Shopify product ID", { exact: true })
    .textContent())!.trim();
  expect(variantGid).toMatch(/^gid:\/\/shopify\/ProductVariant\/\d+$/);
  const before = await onlineSales(page);

  // 2. One paid order, delivered twice under one webhook id and once more
  // under another: one sale (D80, D88).
  const orderId = numericId(project, stamp);
  const orderName = `#E2E-${project}-${stamp}`;
  const line: OrderLineInput = {
    lineItemId: numericId(project, stamp, "1"),
    productId: Number(productGid.split("/").at(-1)),
    variantId: Number(variantGid.split("/").at(-1)),
    title: `Online journey bottle (${project})`,
    quantity: 1,
    price: "25.00",
  };
  const order = orderPaidPayload({
    orderId,
    name: orderName,
    processedAt: new Date().toISOString(),
    customer: { id: numericId(project, stamp, "7"), email: `e2e-${project}-${stamp}@example.com` },
    lines: [line],
  });
  const firstId = `e2e-${project}-${stamp}-order`;
  expect((await post(request, "orders/paid", firstId, order)).status()).toBe(200);
  expect((await post(request, "orders/paid", firstId, order)).status()).toBe(200);
  expect((await post(request, "orders/paid", `${firstId}-again`, order)).status()).toBe(200);

  await expectOnHand(page, n - 1);
  await page.waitForTimeout(2_000);
  await openProduct(page, journeyProduct(project));
  expect(await onHand(page)).toBe(n - 1);
  expect(await onlineSales(page)).toBe(before + 1);

  // 3. The events: the first delivered twice and recorded, the second a duplicate.
  await page.goto(`/shopify/events?q=${encodeURIComponent(orderName)}`);
  const events = page.getByRole("list", { name: "Events" });
  const recorded = events.getByRole("link").filter({ hasText: "Delivered 2×" });
  await expect(recorded).toHaveCount(1);
  await expect(recorded).toContainText("Processed");
  await expect(recorded).toContainText(/Recorded as S-\d{6}/);
  await expect(recorded).toContainText(firstId);
  const saleNumber = (await recorded.textContent())!.match(/S-\d{6}/)![0];
  const duplicate = events.getByRole("link").filter({ hasText: "Already recorded" });
  await expect(duplicate).toHaveCount(1);
  await expect(duplicate).toContainText(saleNumber);
  await recorded.click();
  await expect(page).toHaveURL(/\/shopify\/events\/[0-9a-f-]{36}$/);
  const summary = section(page, "Summary");
  await expect(summary).toContainText(`Recorded as sale ${saleNumber}`);
  await expect(summary.getByRole("link", { name: saleNumber })).toHaveAttribute(
    "href",
    /^\/sales\/[0-9a-f-]{36}$/,
  );
  // The customer is shown, not linked (D86: only an admin links, never by email).
  const customer = section(page, "Customer");
  await expect(customer).toContainText("Not linked");
  await expect(customer.getByRole("button", { name: "Link to a BICII customer" })).toBeVisible();

  // 4. A refund of 5.00 on that order: one refund on the sale, stock untouched (D7, D85).
  const refundId = numericId(project, stamp, "3");
  const refundWebhook = `e2e-${project}-${stamp}-refund`;
  const refund = refundPayload({
    refundId,
    orderId,
    amount: "5.00",
    lines: [{ lineItemId: line.lineItemId, quantity: 1, subtotal: "5.00" }],
  });
  expect((await post(request, "refunds/create", refundWebhook, refund)).status()).toBe(200);
  await page.goto(`/shopify/events?q=${encodeURIComponent(refundWebhook)}`);
  await page.getByRole("list", { name: "Events" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/shopify\/events\/[0-9a-f-]{36}$/);
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByText("Refund of $5.00 recorded").count();
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toBe(1);
  await expect(page.getByText(/stock untouched/)).toBeVisible();
  await openProduct(page, journeyProduct(project));
  expect(await onHand(page)).toBe(n - 1);
});

test("an order for an unknown variant waits on Today and in the queue until it is linked", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const project = projectOf(testInfo);
  const stamp = Date.now();
  const { variant, product } = linkVariant(project);
  const variantGid = `gid://shopify/ProductVariant/${variant}`;
  await signIn(page, "admin");
  await openProduct(page, linkProduct(project));
  const m = await onHand(page);
  const online = section(page, "Online (Shopify)");
  const alreadyLinked =
    (await online.getByLabel("Shopify variant ID", { exact: true }).count()) > 0;
  if (alreadyLinked) {
    await online.getByText("Shopify details").click();
    await expect(online.getByLabel("Shopify variant ID", { exact: true })).toHaveText(variantGid);
  }

  const orderName = `#E2E-LINK-${project}-${stamp}`;
  const title = `E2E musette ${project} ${stamp}`;
  const order = orderPaidPayload({
    orderId: numericId(project, stamp, "5"),
    name: orderName,
    processedAt: new Date().toISOString(),
    lines: [
      {
        lineItemId: numericId(project, stamp, "6"),
        productId: product,
        variantId: variant,
        title,
        quantity: 1,
        price: "18.00",
      },
    ],
  });
  const res = await post(request, "orders/paid", `e2e-${project}-${stamp}-link`, order);
  expect(res.status()).toBe(200);

  if (alreadyLinked) {
    // A retry after the link was made: the order records at once.
    await expectOnHand(page, m - 1);
    return;
  }

  // Nothing recorded; the queue says which line and what to do (D82, D84).
  await page.goto("/shopify/queue");
  const queue = page.getByRole("list", { name: "Queue" });
  const row = queue.getByRole("listitem").filter({ hasText: orderName });
  await expect
    .poll(
      async () => {
        await page.reload();
        return row.count();
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toBe(1);
  await expect(row).toContainText(`"${title}"`);
  await expect(row).toContainText("is not linked to a BICII product");
  await expect(row).toContainText("Needs attention");

  // Today's exceptions list it for an admin and open the queue on it.
  await page.goto("/");
  const attention = section(page, "Needs attention").getByRole("list", { name: "Needs attention" });
  const exception = attention.getByRole("link").filter({ hasText: orderName });
  await expect(exception).toContainText("Shopify needs attention");
  await expect(exception).toContainText("Fix it in the Shopify queue");
  await exception.click();
  await expect(page).toHaveURL(/\/shopify\/queue\?job=[0-9a-f-]{36}$/);
  const sheet = page.getByRole("dialog", { name: `Order ${orderName}` });
  await expect(sheet).toContainText("is not linked to a BICII product");

  // Link the variant to the project's product with a reason; the order records.
  await sheet.getByRole("button", { name: `Link to a BICII product: ${title}` }).click();
  await sheet.getByRole("combobox").fill(linkProductShortId(project));
  await page.getByRole("option", { name: new RegExp(linkProductShortId(project)) }).click();
  await sheet.getByLabel("Reason").fill(`E2E ${project}: same musette as in the shop`);
  await sheet.getByRole("button", { name: "Link and retry" }).click();
  await expect(toast(page, /^Recorded as S-\d{6}$/)).toBeVisible();
  await expect(sheet).toBeHidden();

  await openProduct(page, linkProduct(project));
  expect(await onHand(page)).toBe(m - 1);
  await online.getByText("Shopify details").click();
  await expect(online.getByLabel("Shopify variant ID", { exact: true })).toHaveText(variantGid);
  await expect(online).toContainText("Linked to a product made in Shopify");
});

test("a delivery with a bad signature is refused, kept as evidence without its body, and moves no stock", async ({
  page,
  request,
}, testInfo) => {
  const project = projectOf(testInfo);
  const stamp = Date.now();
  await signIn(page, "admin");
  await openProduct(page, journeyProduct(project));
  const n = await onHand(page);

  const webhookId = `e2e-${project}-${stamp}-forged`;
  const forged = orderPaidPayload({
    orderId: numericId(project, stamp, "9"),
    name: `#E2E-FORGED-${project}-${stamp}`,
    lines: [
      {
        lineItemId: numericId(project, stamp, "8"),
        variantId: 9100000000,
        title: "Forged",
        quantity: 1,
        price: "0.01",
      },
    ],
  });
  const res = await post(request, "orders/paid", webhookId, forged, "not-the-shop-secret");
  expect(res.status()).toBe(401);

  await page.goto(`/shopify/events?status=rejected&q=${encodeURIComponent(webhookId)}`);
  const row = page.getByRole("list", { name: "Events" }).getByRole("link").first();
  await expect(row).toContainText("Rejected");
  await expect(row).toContainText("Signature did not match");
  await row.click();
  await expect(page).toHaveURL(/\/shopify\/events\/[0-9a-f-]{36}$/);
  await expect(section(page, "Delivery")).toContainText("Invalid");
  await expect(section(page, "Payload")).toContainText(
    "Body not stored: the signature did not match",
  );
  await expect(section(page, "Payload").getByRole("button", { name: "Wrap lines" })).toHaveCount(0);

  await openProduct(page, journeyProduct(project));
  expect(await onHand(page)).toBe(n);
});

test("boundaries: only admins open Shopify; other staff see the sync status; the cron needs its bearer", async ({
  page,
  request,
}, testInfo) => {
  const project = projectOf(testInfo);
  await signIn(page, "mechanic2");
  const res = await page.goto("/shopify");
  expect(res?.status()).toBe(403);
  expect((await page.goto("/shopify/queue"))?.status()).toBe(403);

  await openProduct(page, journeyProduct(project));
  const online = section(page, "Online (Shopify)");
  const toggle = online.getByRole("switch", { name: "Publish online" });
  await expect(toggle).toBeDisabled();
  await expect(online).toContainText("Needs Manage inventory");
  await expect(online.getByText(/^(Synced|Syncing|Offline|Not synced|Sync failed)$/)).toBeVisible();
  await expect(online.getByRole("button", { name: "Sync now" })).toHaveCount(0);

  // Anonymous: a 401 from the cron, never a redirect to /login.
  // (The `request` fixture carries no session.)
  const cron = await request.get("/api/cron/integrations", { maxRedirects: 0 });
  expect(cron.status()).toBe(401);
});

test("the Shopify overview shows the connection, the settings and the lists (admins)", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/more");
  await page.getByRole("link", { name: /Shopify/ }).click();
  await expect(page).toHaveURL(/\/shopify$/);
  // The dev/E2E seed records test orders, so the warning shows (D89).
  await expect(page.getByRole("note")).toContainText("Shopify test orders are recorded as sales");
  const connection = section(page, "Connection");
  await expect(connection.getByText("Test (fake)", { exact: true })).toBeVisible();
  await expect(connection.getByLabel("Webhook address", { exact: true })).toHaveText(
    /\/api\/shopify\/webhooks$/,
  );
  await expect(page.getByRole("link", { name: /^Needs attention: \d+$/ })).toBeVisible();

  // Changing the test-order switch needs a reason; nothing is saved without one.
  const settings = section(page, "Settings");
  await settings.getByRole("switch", { name: "Record Shopify test orders as sales" }).click();
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(
    settings.getByText("Say why you are changing whether test orders are recorded."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("note")).toContainText("Shopify test orders are recorded as sales");

  // Products online: the seeded tyre is synced; a row opens its product.
  await page.goto("/shopify/products");
  const products = page.getByRole("list", { name: "Products on Shopify" });
  await expect(products.getByRole("link").filter({ hasText: "P-000027" })).toContainText("Synced");
  await page.goto(`/shopify/queue?view=recent`);
  await expect(page.getByRole("link", { name: "Recent", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
