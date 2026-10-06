import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { shiftShopDay, shopToday } from "../../src/lib/dates";
import { LOCATION, STAFF_EMAIL, UNIT_SHORT_ID } from "../fixtures/ids";
import { rpc, signInApi } from "./api";
import { isPhone, section, signIn, tagFor, toast } from "./helpers";
import { expectNoSideScroll } from "./purchasing-helpers";

/**
 * Exceptions and stock reconciliation (Phase 9 step 4; SPEC §12, §19.1,
 * §26; PLAN D106–D108) on a phone and an iPad.
 *
 * Setup (beforeAll, as the admin through the API and the real RPCs): a
 * consignor and a consigned unique item taken in 60 days ago, agreed owed
 * 300.00, sold 45 days ago (D55 allows a back-dated sale after intake), so
 * it is an unsettled consignment at the default threshold of 30 days
 * (D107). afterAll settles it, the guarded fix, so the exception clears.
 *
 * Other specs create records through the same RPCs in this serial run, so
 * the tests assert this item's presence and the reconciliation's all-clear
 * (which those RPCs must keep, D106), never an exact count of exceptions.
 */

type ItemResult = { item_id: string; short_id: string; inventory_unit_id: string };

let token = "";
let item: ItemResult;
let consignorId = "";

const setThreshold = (days: number) =>
  rpc<number>(token, "set_consignment_settlement_alert_days", { p_days: days });

test.beforeAll(async () => {
  const tag = tagFor(test.info());
  token = await signInApi(STAFF_EMAIL.admin);
  await setThreshold(30);
  const today = shopToday();
  // new_consignor creates the consignor with this id in the same request.
  consignorId = randomUUID();
  item = await rpc<ItemResult>(token, "create_consignment_item", {
    item_id: randomUUID(),
    consignor_id: consignorId,
    location_id: LOCATION.shopFloor,
    agreed_amount_owed: "300.00",
    asking_price: "800.00",
    product_name: `Overdue payout bike ${tag}`,
    tracking_type: "unique",
    quantity: 1,
    received_at: `${shiftShopDay(today, -60)}T10:00:00+08:00`,
    new_consignor: { display_name: `Late payee ${tag}` },
  });
  await rpc(token, "record_retail_sale", {
    sale_id: randomUUID(),
    lines: [{ inventory_unit_id: item.inventory_unit_id }],
    recognized_at: `${shiftShopDay(today, -45)}T12:00:00+08:00`,
  });
});

test.afterAll(async () => {
  if (!token) return;
  await setThreshold(30);
  if (item && consignorId) {
    await rpc(token, "record_settlement", {
      settlement_id: randomUUID(),
      consignor_id: consignorId,
      amount: "300.00",
      allocations: [{ consignment_item_id: item.item_id, amount: "300.00" }],
      reference: "E2E exceptions cleanup",
    });
  }
});

const unsettled = (page: Page) => section(page, "Unsettled consignments");
const itemRow = (page: Page) =>
  unsettled(page).getByRole("link", { name: new RegExp(item.short_id) });

async function changeThreshold(page: Page, days: number) {
  await page.getByRole("button", { name: /^Change/ }).click();
  const sheet = page.getByRole("dialog", { name: "When to flag unsettled consignments" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Days").fill(String(days));
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(toast(page, `Alert unsettled consignments after ${days} days`)).toBeVisible();
  await expect(sheet).toBeHidden();
  await expect(
    page.getByRole("main").getByText(`Alert unsettled consignments after ${days} days`),
  ).toBeVisible();
}

test("an admin follows Today to the exceptions, opens an unsettled consignment and moves the threshold", async ({
  page,
}) => {
  test.setTimeout(90_000);
  try {
    await signIn(page, "admin");
    await page.goto("/");
    // Today must fit the phone even with long tagged names from other specs
    // (a wider page is zoomed out, and taps land in the wrong place).
    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await expectNoSideScroll(page);
    const seeAll = section(page, "Needs attention").getByRole("link", {
      name: "See all exceptions",
    });
    await expect(seeAll).toHaveAttribute("href", "/reports/exceptions");
    await seeAll.click();
    await expect(page).toHaveURL(/\/reports\/exceptions$/);
    await expect(page.getByRole("heading", { level: 1, name: "Exceptions" })).toBeVisible();
    await expect(
      page.getByRole("main").getByText("Alert unsettled consignments after 30 days"),
    ).toBeVisible();

    await expect(itemRow(page)).toBeVisible();
    await expect(itemRow(page)).toContainText("$300.00 outstanding");
    await expect(itemRow(page)).toContainText("Needs attention");
    await expectNoSideScroll(page);
    await itemRow(page).click();
    await expect(page).toHaveURL(new RegExp(`/consignment/items/${item.item_id}$`));
    await page.goBack();
    await expect(itemRow(page)).toBeVisible();

    // D107: strictly more than N shop days since the latest sale.
    await changeThreshold(page, 60);
    await expect(page.getByRole("link", { name: new RegExp(item.short_id) })).toHaveCount(0);
    await changeThreshold(page, 30);
    await expect(itemRow(page)).toBeVisible();

    // The CSV holds the same row.
    const link = page.getByRole("link", { name: "Export CSV: exceptions" });
    await expect(link).toHaveAttribute("target", "_blank");
    const csv = await page.request.get((await link.getAttribute("href"))!);
    expect(csv.status()).toBe(200);
    const lines = (await csv.text()).slice(1).split("\r\n");
    expect(lines[0]).toBe("kind,severity,issue,short_id,title,detail,amount,currency,since");
    expect(
      lines.some((l) =>
        l.startsWith(`unsettled_consignment,warning,unsettled_consignment,${item.short_id},`),
      ),
    ).toBe(true);
  } finally {
    // Never leave 60 behind, whatever failed above.
    await setThreshold(30);
  }
});

test("a mechanic without consignment money access sees no unsettled consignments and cannot change the threshold", async ({
  page,
}) => {
  await signIn(page, "mechanic2");
  await page.goto("/reports/exceptions");
  await expect(page.getByRole("heading", { level: 1, name: "Exceptions" })).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Alert unsettled consignments after 30 days"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Change/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Unsettled consignments" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: new RegExp(item.short_id) })).toHaveCount(0);
});

test("an admin reconciles stock from Reports and Inventory, sees every item and exports it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page, "admin");
  await page.goto("/reports");
  await page
    .getByRole("navigation", { name: "More reports" })
    .getByRole("link", { name: "Stock reconciliation" })
    .click();
  await expect(page).toHaveURL(/\/reports\/reconciliation$/);
  await expect(page.getByRole("heading", { level: 1, name: "Stock reconciliation" })).toBeVisible();

  await page.goto("/inventory");
  await page.getByRole("link", { name: "Reconcile stock" }).click();
  await expect(page).toHaveURL(/\/reports\/reconciliation$/);
  const units = section(page, "Unique items");
  await expect(
    page.getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: "Problems only" }),
  ).toHaveAttribute("aria-checked", "true");
  // Every RPC keeps the unit records and the ledger in step (D106).
  await expect(units.getByText("Every item reconciles with the ledger")).toBeVisible();

  await page
    .getByRole("radiogroup", { name: "Show" })
    .getByRole("radio", { name: "Everything" })
    .click();
  await expect(page).toHaveURL(/\/reports\/reconciliation\?all=1$/);
  const all = await rpc<
    { unit_short_id: string; ledger_on_hand: number; expected_on_hand: number }[]
  >(token, "report_unit_reconciliation", { p_only_issues: false });
  const colnago = all.find((r) => r.unit_short_id === UNIT_SHORT_ID.colnago)!;
  expect(colnago).toBeTruthy();
  const shown = new RegExp(`${colnago.ledger_on_hand}(,| /) expected ${colnago.expected_on_hand}`);
  if (isPhone(page)) {
    const row = units.getByRole("link", { name: new RegExp(UNIT_SHORT_ID.colnago) });
    await expect(row).toContainText(shown);
  } else {
    const row = units.getByRole("row").filter({ hasText: UNIT_SHORT_ID.colnago });
    await expect(row).toContainText(shown);
  }
  await expectNoSideScroll(page);

  const link = page.getByRole("link", { name: "Export CSV: products by location" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener");
  const href = await link.getAttribute("href");
  expect(href).toBe("/reports/export?kind=stock&all=1");
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/csv/);
  const body = await response.text();
  expect(body.slice(1).split("\r\n")[0]).toBe(
    "product_short_id,product,tracking,location,ledger_on_hand,units_in_stock,issue",
  );
});

test("the exceptions export needs a session, and a mechanic's has no unsettled consignments", async ({
  page,
  request,
}) => {
  // Signed out (a fresh request context): the proxy sends it to /login.
  const signedOut = await request.get("/reports/export?kind=exceptions", { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(signedOut.status());
  expect(signedOut.headers()["location"]).toMatch(/\/login\?next=/);

  await signIn(page, "mechanic2");
  const response = await page.request.get("/reports/export?kind=exceptions");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/csv/);
  const body = await response.text();
  expect(body.slice(1).split("\r\n")[0]).toBe(
    "kind,severity,issue,short_id,title,detail,amount,currency,since",
  );
  expect(body).not.toContain("unsettled_consignment");
  expect(body).not.toContain(item.short_id);
});
