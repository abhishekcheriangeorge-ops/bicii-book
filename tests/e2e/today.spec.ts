import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { jobEconomics } from "../../src/lib/cult-commons";
import { formatShopDay, formatShopDayShort } from "../../src/lib/dates";
import { Decimal, formatMoney } from "../../src/lib/money";
import { OVERDUE_AFTER_DAYS } from "../../src/lib/workshop";
import {
  PRODUCT,
  PRODUCT_SHORT_ID,
  REPORT_JOB,
  REPORT_JOB_NUMBER,
  REPORT_PRODUCT_SHORT_ID,
} from "../fixtures/ids";
import { SEED_DAYS, type SeedDay } from "../fixtures/reporting";
import {
  anchorDay,
  createJobViaIntake,
  createProduct,
  pickPart,
  readCount,
  readMoney,
  section,
  seedAnchor,
  signIn,
  tagFor,
  toast,
} from "./helpers";

/**
 * M1.5 Today, on a phone and an iPad (PLAN §3 exit criteria; SPEC §27.3
 * journey 1 ending on Today; D30-D35).
 *
 * The phone and iPad runs share one database, and other specs add jobs
 * today too, so every assertion about today is a DELTA read just before
 * acting. Exact values come only from the seeded history, on past days
 * counted from the seed's anchor (seedAnchor(), anchorDay(n)), never
 * from this machine's clock: the seed may be older than today.
 */

const PHOTO = path.join(__dirname, "fixtures", "bike-photo.jpg");

const money = (v: string) => formatMoney(v);

/** The live day's sections. */
const flows = (page: Page) => section(page, "Today");
const moneySection = (page: Page) => section(page, "Money");

/** The shop day the page shows, as its eyebrow says it ("Mon, 5 Oct 2026"). */
async function shownDay(page: Page): Promise<string> {
  return ((await page.getByRole("main").locator("header p").first().textContent()) ?? "").trim();
}

type Baseline = {
  checkedIn: number;
  completed: number;
  collected: number;
  gross: string;
  yield: string;
  cc: string;
};

async function readBaseline(page: Page): Promise<Baseline> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Right now", exact: true })).toBeVisible();
  return {
    checkedIn: await readCount(flows(page), "Checked in"),
    completed: await readCount(flows(page), "Completed"),
    collected: await readCount(flows(page), "Collected"),
    gross: await readMoney(moneySection(page), "Gross sales"),
    yield: await readMoney(moneySection(page), "Yield"),
    cc: await readMoney(moneySection(page), "Cult Commons"),
  };
}

test.describe.serial("Milestone M1.5", () => {
  /** The job journey 1a created, per project, so phone and iPad never share one. */
  const jobs = new Map<string, { id: string; jobNumber: string; sale: string }>();

  test("Milestone M1.5: a walk-in job from phone intake to Today", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const tag = tagFor(testInfo);
    const productName = `Brake cable ${tag}`;
    const sku = `BC-${tag}`;

    // 1. Today before anything happens.
    await signIn(page, "admin");
    const before = await readBaseline(page);
    const today = await shownDay(page);

    // 2-3. A customer and a bike, checked in with a photo, condition,
    //      requested work and Nur as lead mechanic.
    const job = await createJobViaIntake(page, {
      tag,
      requestedWork: "Basic service and a new brake cable",
      condition: "Rear brake cable frayed",
      lead: "Nur Aisyah",
      photo: PHOTO,
    });
    await expect(
      section(page, "Photos")
        .getByRole("list", { name: "Photos", exact: true })
        .getByRole("listitem"),
    ).toHaveCount(1);
    await expect(section(page, "People")).toContainText("LeadNur Aisyah");
    await expect(page.getByText("Rear brake cable frayed")).toBeVisible();

    // 4. A counted product with opening stock 10.
    const product = await createProduct(page, {
      name: productName,
      sku,
      price: "12.00",
      cost: "5.00",
      reorderPoint: "0",
    });
    const stock = section(page, "Stock");
    await stock.getByRole("button", { name: "Adjust stock" }).click();
    const adjust = page.getByRole("dialog", { name: "Adjust stock" });
    await adjust.getByLabel("Quantity").fill("10");
    await adjust.getByRole("button", { name: "Opening stock count" }).click();
    await adjust.getByRole("button", { name: "Save adjustment" }).click();
    await expect(toast(page, "Stock saved. Shop floor: 10")).toBeVisible();
    await expect(stock.getByText("10 in stock")).toBeVisible();

    // One service and one part on the job.
    await page.goto(`/jobs/${job.id}`);
    await page.getByRole("button", { name: "Add service" }).click();
    const addService = page.getByRole("dialog", { name: "Add service" });
    await addService.getByRole("combobox").fill("Basic");
    await addService.getByRole("option", { name: /Basic Service/ }).click();
    await expect(addService.getByLabel("Unit price")).toHaveValue("80.00");
    await addService.getByRole("button", { name: "Add service" }).click();
    await expect(addService).toBeHidden();

    const { sheet, choice } = await pickPart(page, sku, new RegExp(productName));
    await expect(choice).toContainText("10 at Shop floor · 10 total");
    await choice.click();
    await sheet.getByRole("button", { name: "Add part" }).click();
    await expect(toast(page, `Added 1 × ${productName}. 9 left at Shop floor.`)).toBeVisible();
    await expect(sheet).toBeHidden();

    // The stock went down by exactly one, and stays so after a reload.
    const partLine = page.getByRole("row", { name: new RegExp(productName) });
    await expect(partLine).toContainText(product.shortId);
    await expect(partLine).toContainText("9 left at Shop floor");
    await page.reload();
    await expect(page.getByRole("row", { name: new RegExp(productName) })).toContainText(
      "9 left at Shop floor",
    );
    await page.goto(product.url);
    await expect(section(page, "Stock").getByText("9 in stock")).toBeVisible();
    await page.reload();
    await expect(section(page, "Stock").getByText("9 in stock")).toBeVisible();

    // 5. The yield panel: sale, cost, yield, Cult Commons, BICII after CC.
    const economics = jobEconomics([
      { quantity: "1", unitSalePrice: "80.00", unitDirectCost: "0.00", rate: "0.3" },
      { quantity: "1", unitSalePrice: "12.00", unitDirectCost: "5.00", rate: "0.3" },
    ]);
    const fixed = (d: Decimal) => d.toFixed(2);
    await page.goto(`/jobs/${job.id}`);
    const totals = page.getByLabel("Totals", { exact: true });
    await expect(totals).toContainText(`Total${money(fixed(economics.sale))}`);
    await expect(totals).toContainText(`Cost${money(fixed(economics.cost))}`);
    await expect(totals).toContainText(`Yield${money(fixed(economics.yield))}`);
    await expect(totals).toContainText(`Cult Commons (30%)${money(fixed(economics.ccShare))}`);
    await expect(totals).toContainText(
      `BICII yield after Cult Commons${money(fixed(economics.yieldAfterCc))}`,
    );
    await expect(page.getByText("Counted in reports once the job is completed")).toBeVisible();

    // 6. In progress -> completed -> ready -> collected.
    await page.getByRole("button", { name: "Start work" }).click();
    await expect(toast(page, `${job.jobNumber}: In progress`)).toBeVisible();
    await page.getByRole("button", { name: "Complete" }).click();
    await expect(toast(page, `${job.jobNumber}: Completed`)).toBeVisible();
    await page.getByRole("button", { name: "Ready for collection" }).click();
    await expect(toast(page, `${job.jobNumber}: Ready for collection`)).toBeVisible();
    await page.getByRole("button", { name: "Collected…" }).click();
    const collect = page.getByRole("group", {
      name: new RegExp(`^Mark ${job.jobNumber} collected by`),
    });
    await collect.getByRole("button", { name: "Mark collected" }).click();
    await expect(toast(page, `${job.jobNumber}: Collected`)).toBeVisible();

    const timeline = page.getByRole("list", { name: "Timeline" });
    await expect(timeline.getByText("Completed", { exact: true })).toBeVisible();
    await expect(timeline.getByText("Collected", { exact: true })).toBeVisible();
    const dates = page.getByLabel("Dates", { exact: true });
    await expect(dates.getByText("Completed", { exact: true })).toBeVisible();
    await expect(dates.getByText("Collected", { exact: true })).toBeVisible();
    await expect(page.getByText(`Counted in reports on ${today} (completed)`)).toBeVisible();

    const sale = fixed(economics.sale);
    jobs.set(testInfo.project.name, { id: job.id, jobNumber: job.jobNumber, sale });

    // 7. Today moved by exactly this job.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Right now", exact: true })).toBeVisible();
    expect(await readCount(flows(page), "Checked in")).toBe(before.checkedIn + 1);
    expect(await readCount(flows(page), "Completed")).toBe(before.completed + 1);
    expect(await readCount(flows(page), "Collected")).toBe(before.collected + 1);
    expect(await readMoney(moneySection(page), "Gross sales")).toBe(
      new Decimal(before.gross).plus(economics.sale).toFixed(2),
    );
    expect(await readMoney(moneySection(page), "Yield")).toBe(
      new Decimal(before.yield).plus(economics.yield).toFixed(2),
    );
    expect(await readMoney(moneySection(page), "Cult Commons")).toBe(
      new Decimal(before.cc).plus(economics.ccShare).toFixed(2),
    );

    // 8. Listed under Activity, and its row opens the job.
    const activity = section(page, "Activity");
    const completedList = activity.getByRole("list", { name: "Completed", exact: true });
    const collectedList = activity.getByRole("list", { name: "Collected", exact: true });
    await expect(
      completedList.getByRole("link", { name: new RegExp(job.jobNumber) }),
    ).toContainText(money(sale));
    await expect(
      collectedList.getByRole("link", { name: new RegExp(job.jobNumber) }),
    ).toBeVisible();
    await completedList.getByRole("link", { name: new RegExp(job.jobNumber) }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}$`));

    // "What makes up these figures" lists its lines.
    await page.goto("/?entries=open");
    const entries = page.locator("details#financial-entries");
    await expect(entries).toHaveAttribute("open", "");
    const lines = entries.getByRole("list", { name: `Lines of ${job.jobNumber}` });
    await expect(lines).toContainText("Basic Service");
    await expect(lines).toContainText(productName);
  });

  test("Mechanics see the job's sale but not its costs", async ({ page }, testInfo) => {
    const job = jobs.get(testInfo.project.name);
    expect(job, "journey 1a stores its job").toBeDefined();

    // mechanic2: no permissions.
    await signIn(page, "mechanic2");
    await page.goto(`/jobs/${job!.id}`);
    const totals = page.getByLabel("Totals", { exact: true });
    await expect(totals).toContainText(`Total${money(job!.sale)}`);
    await expect(totals).not.toContainText("Cost");
    await expect(page.getByText(/Cult Commons|Yield|Counted in reports|Unit cost/)).toHaveCount(0);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Right now", exact: true })).toBeVisible();
    await expect(flows(page)).toBeVisible();
    await expect(moneySection(page)).toHaveCount(0);
    await expect(
      section(page, "Activity")
        .getByRole("list", { name: "Completed", exact: true })
        .getByRole("link", { name: new RegExp(job!.jobNumber) }),
    ).toBeVisible();
    await expect(page.getByText(/Cult Commons|Gross sales/)).toHaveCount(0);

    // mechanic1: view_costs only, so the full panel on the job, no Money on Today.
    await page.context().clearCookies();
    await signIn(page, "mechanic1");
    await page.goto(`/jobs/${job!.id}`);
    await expect(totals).toContainText("Cost");
    await expect(totals).toContainText("Cult Commons (30%)");
    await expect(page.getByText(/^Counted in reports on /)).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Right now", exact: true })).toBeVisible();
    await expect(moneySection(page)).toHaveCount(0);
  });
});

/** The values of one Last-7-days row: completed, collected, then money columns. */
async function weekRow(page: Page, day: string): Promise<string[]> {
  const row = section(page, "Last 7 days").locator(`[data-day="${day}"]`).filter({ visible: true });
  return (await row.locator("dd, td").allTextContents()).map((s) => s.trim());
}

test("Several days of history reconcile on Today", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, "admin");

  // Day 3: the SPEC §10 combined job, exactly.
  const d3 = SEED_DAYS[3];
  await page.goto(`/?day=${anchorDay(3)}`);
  await expect(page.getByRole("link", { name: "Back to today" })).toBeVisible();
  const onDay = section(page, `On ${formatShopDayShort(anchorDay(3))}`);
  expect(await readCount(onDay, "Checked in")).toBe(d3.jobs_checked_in);
  expect(await readCount(onDay, "Started")).toBe(d3.jobs_started);
  expect(await readCount(onDay, "Completed")).toBe(d3.jobs_completed);
  expect(await readCount(onDay, "Ready for collection")).toBe(d3.jobs_ready_for_collection);
  expect(await readCount(onDay, "Collected")).toBe(d3.jobs_collected);
  const m = moneySection(page);
  expect(await readMoney(m, "Gross sales")).toBe(d3.gross_sales);
  expect(await readMoney(m, "Direct costs (COGS)")).toBe(d3.cogs);
  expect(await readMoney(m, "Yield")).toBe(d3.yield_total);
  expect(await readMoney(m, "Cult Commons")).toBe(d3.cult_commons_share);
  expect(await readMoney(m, "BICII after Cult Commons")).toBe(d3.bicii_yield_after_cc);
  await expect(m).toContainText("If one is reopened, it moves to the day it is completed again.");

  // A past day has no snapshot and no exceptions (D31).
  await expect(page.getByRole("heading", { name: "Right now", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toHaveCount(0);

  // Previous and Next move exactly one day.
  await page.getByRole("link", { name: "Previous day" }).click();
  await expect(page).toHaveURL(new RegExp(`\\?day=${anchorDay(4)}$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto(`/?day=${anchorDay(3)}`);
  await page.getByRole("link", { name: "Next day" }).click();
  await expect(page).toHaveURL(new RegExp(`\\?day=${anchorDay(2)}$`));

  // Day 2: the loss line (D1): Cult Commons 12.00, not 7.50.
  const d2 = SEED_DAYS[2];
  await expect(moneySection(page)).toContainText(
    "1 line sold at a loss: −$15.00. Losses don't reduce Cult Commons on other lines.",
  );
  expect(await readMoney(moneySection(page), "Cult Commons")).toBe(d2.cult_commons_share);

  // Last 7 days, ending at day 1: seven rows, the seeded values on days 1-6.
  await page.goto(`/?day=${anchorDay(1)}`);
  const week = section(page, "Last 7 days");
  await expect(week.locator("[data-day]").filter({ visible: true })).toHaveCount(7);
  for (const n of [1, 2, 3, 4, 5, 6] as SeedDay[]) {
    const s = SEED_DAYS[n];
    expect(await weekRow(page, anchorDay(n)), `day ${n}`).toEqual([
      String(s.jobs_completed),
      String(s.jobs_collected),
      money(s.gross_sales),
      money(s.yield_total),
      money(s.cult_commons_share),
    ]);
  }
  await expect(
    week
      .locator(`[data-day="${anchorDay(1)}"]`)
      .filter({ visible: true })
      .getByRole("link"),
  ).toHaveAttribute("aria-current", "date");

  // A day that is not a date shows today.
  await page.goto("/?day=garbage");
  await expect(page.getByRole("heading", { name: "Right now", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to today" })).toHaveCount(0);
});

test("Today shows low stock and the day's significant adjustment", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/");
  const low = section(page, "Stock").getByRole("list", { name: "Low stock" });
  for (const key of ["hydraulicHose", "cableKit", "sealant"] as const) {
    await expect(low.getByRole("link", { name: new RegExp(PRODUCT_SHORT_ID[key]) })).toBeVisible();
  }
  await expect(
    section(page, "Stock").getByRole("link", { name: "See all low stock" }),
  ).toHaveAttribute("href", "/inventory?filter=low");
  await low.getByRole("link", { name: new RegExp(PRODUCT_SHORT_ID.hydraulicHose) }).click();
  await expect(page).toHaveURL(new RegExp(`/products/${PRODUCT.hydraulicHose}$`));

  // A2: inner tubes −6, damaged in storage, significant (D33).
  await page.goto(`/?day=${anchorDay(1)}`);
  const adjustments = section(page, "Stock").getByRole("list", { name: "Stock adjustments" });
  const a2 = adjustments
    .getByRole("listitem")
    .filter({ hasText: REPORT_PRODUCT_SHORT_ID.innerTube });
  await expect(a2).toContainText("−6");
  await expect(a2).toContainText("Water damage in storage");
  await expect(a2).toContainText("Significant");
  await expect(a2).toContainText("Damaged");
});

test("Today lists what needs attention", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Right now", exact: true })).toBeVisible();
  // Exceptions are relative to the live day: exact only when the seed is today's.
  test.skip(
    (await shownDay(page)) !== formatShopDay(seedAnchor()),
    `The seed's anchor (${seedAnchor()}) is not the live day; overdue and uncollected depend on it.`,
  );
  const attention = section(page, "Needs attention").getByRole("list", {
    name: "Needs attention",
  });
  const overdue = attention.getByRole("link", { name: new RegExp(REPORT_JOB_NUMBER.overdue) });
  const uncollected = attention.getByRole("link", {
    name: new RegExp(REPORT_JOB_NUMBER.uncollected),
  });
  await expect(overdue).toContainText("Overdue");
  await expect(overdue).toContainText(`over the ${OVERDUE_AFTER_DAYS}-day limit`);
  await expect(uncollected).toContainText("Waiting for collection");
  await uncollected.click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${REPORT_JOB.uncollected}$`));
  await page.goBack();
  await section(page, "Needs attention")
    .getByRole("link", { name: new RegExp(REPORT_JOB_NUMBER.overdue) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${REPORT_JOB.overdue}$`));
});
