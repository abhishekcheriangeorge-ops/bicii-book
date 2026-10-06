import { expect, test, type Page } from "@playwright/test";

import { REPORT_JOB, REPORT_JOB_NUMBER } from "../fixtures/ids";
import { anchorDay, isPhone, section, signIn, todayTile } from "./helpers";
import { expectNoSideScroll } from "./purchasing-helpers";

/**
 * Period reports (Phase 9 step 2; SPEC §19.2, §21, §22; PLAN D30,
 * D100–D105) on a phone and an iPad: the period and basis controls, the
 * breakdown and its drill-down, the CSV export and who sees what.
 *
 * Every figure comes from the seeded Phase 5 history (tests/fixtures/
 * reporting.ts), on days counted from the seed's anchor (anchorDay(n)),
 * never today. J-000013 (REPORT_JOB.combined, lead mechanic1) is checked
 * in on anchorDay(4), completed and ready on anchorDay(3) and collected on
 * anchorDay(2). Other jobs and sales share those days, and other specs add
 * records, so the tests assert J-000013's MEMBERSHIP, never emptiness or
 * exact totals.
 */

const JOB = REPORT_JOB_NUMBER.combined;
const JOB_ID = REPORT_JOB.combined;
const BASIS_LABEL = {
  sale: "Sale date",
  check_in: "Check-in",
  completion: "Completed",
  collection: "Collected",
} as const;
type Basis = keyof typeof BASIS_LABEL;

const breakdown = (page: Page) => section(page, "Breakdown");
const figures = (page: Page) => section(page, "Figures");
const jobLink = (page: Page) => breakdown(page).getByRole("link", { name: new RegExp(JOB) });

/** Chooses a date basis and waits for the page rendered on it. */
async function chooseBasis(page: Page, basis: Basis) {
  await page
    .getByRole("radiogroup", { name: "Date basis" })
    .getByRole("radio", { name: BASIS_LABEL[basis] })
    .click();
  await expect(page).toHaveURL(new RegExp(`[?&]basis=${basis}(&|$)`));
  await expect(figures(page)).toContainText(`on the ${BASIS_LABEL[basis]} basis.`);
}

/** Asserts J-000013 is (or is not) in the Job / sale breakdown on each basis. */
async function expectJobOn(page: Page, shown: readonly Basis[]) {
  for (const basis of ["sale", "check_in", "completion", "collection"] as const) {
    await chooseBasis(page, basis);
    // The URL keeps the period and the dimension (D100 changes only the basis).
    await expect(page).toHaveURL(/[?&]period=day(&|$)/);
    await expect(page).toHaveURL(/[?&]by=job(&|$)/);
    if (shown.includes(basis)) await expect(jobLink(page)).toBeVisible();
    else await expect(jobLink(page)).toHaveCount(0);
  }
}

test("an admin steps through days and bases, and J-000013 counts on its own dates", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "admin");

  // From the navigation: More on the phone, the rail on the iPad.
  const nav = page.getByRole("navigation", { name: "Main" });
  if (isPhone(page)) {
    await nav.getByRole("link", { name: "More", exact: true }).click();
    await page
      .getByRole("main")
      .getByRole("link", { name: /^Reports/ })
      .click();
  } else {
    await nav.getByRole("link", { name: "Reports", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  await expect(
    page.getByRole("radiogroup", { name: "Period" }).getByRole("radio", { name: "Week" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("radiogroup", { name: "Date basis" }).getByRole("radio", { name: "Sale date" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(todayTile(figures(page), "Gross sales")).toContainText(/\$[\d,]+\.\d{2}/);
  await expect(todayTile(figures(page), "Yield")).toBeVisible();

  // The stepper, once each way.
  await page.goto(`/reports?period=day&date=${anchorDay(4)}&by=job`);
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page).toHaveURL(new RegExp(`date=${anchorDay(5)}`));
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page).toHaveURL(new RegExp(`date=${anchorDay(4)}`));

  // Every section fits the screen: tables scroll inside their own box.
  await expect(jobLink(page)).toHaveCount(0);
  await expectNoSideScroll(page);

  // Checked in on anchorDay(4): only the Check-in basis has it.
  await expectJobOn(page, ["check_in"]);

  // Completed on anchorDay(3): the Completed and Sale date bases (D100).
  await page.goto(`/reports?period=day&date=${anchorDay(3)}&by=job`);
  await expectJobOn(page, ["sale", "completion"]);

  // Collected on anchorDay(2): only the Collected basis.
  await page.goto(`/reports?period=day&date=${anchorDay(2)}&by=job`);
  await expectJobOn(page, ["collection"]);

  // A custom range before any record, on Completed: the empty state says why.
  await chooseBasis(page, "completion");
  await page
    .getByRole("radiogroup", { name: "Period" })
    .getByRole("radio", { name: "Custom" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Custom range" });
  await sheet.getByLabel("From").fill("2020-01-07");
  await sheet.getByLabel("To").fill("2020-01-01");
  await sheet.getByRole("button", { name: "Apply" }).click();
  // A reversed range is refused in the sheet, which keeps the values.
  await expect(sheet.getByRole("alert")).toContainText("on or before the end day");
  await expect(sheet.getByLabel("From")).toHaveValue("2020-01-07");
  await sheet.getByLabel("From").fill("2020-01-01");
  await sheet.getByLabel("To").fill("2020-01-07");
  await sheet.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/period=custom/);
  await expect(page).toHaveURL(/from=2020-01-01/);
  await expect(page).toHaveURL(/to=2020-01-07/);
  await expect(page).toHaveURL(/basis=completion/);
  await expect(breakdown(page)).toContainText(
    "Nothing recorded for this period on the Completed basis.",
  );
  await expect(breakdown(page)).toContainText(
    "Jobs not completed yet only show on the Check-in basis.",
  );
});

test("a breakdown row opens its job, and a product opens its lines", async ({ page }) => {
  await signIn(page, "admin");
  const report = `/reports?period=day&date=${anchorDay(3)}&basis=completion&by=job`;
  await page.goto(report);
  await jobLink(page).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}$`));

  await page.goto(report);
  await breakdown(page).getByRole("link", { name: "Product", exact: true }).click();
  await expect(page).toHaveURL(/[?&]by=product(&|$)/);
  await expect(breakdown(page).getByRole("link", { name: "Product", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await breakdown(page)
    .getByRole("link", { name: /Carbon disc wheelset 700c, 45mm/ })
    .click();
  await expect(page).toHaveURL(/\/reports\/lines\?.*by=product.*key=d5300000-/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Carbon disc wheelset 700c, 45mm",
  );
  await expect(
    page.getByRole("main").getByRole("link", { name: JOB, exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Reports" })).toHaveAttribute(
    "href",
    /\/reports\?.*basis=completion/,
  );
});

test("the breakdown exports as CSV with its costs and a TOTAL row", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto(`/reports?period=day&date=${anchorDay(3)}&basis=completion&by=job`);
  const link = page.getByRole("link", { name: "Export CSV: breakdown by Job / sale" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener");
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/reports\/export\?kind=breakdown&/);

  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/csv/);
  expect(response.headers()["content-disposition"]).toMatch(
    new RegExp(
      `^attachment; filename="bicii-breakdown-completion-${anchorDay(3)}_${anchorDay(3)}\\.csv"$`,
    ),
  );
  expect(response.headers()["cache-control"]).toBe("no-store");
  const body = await response.text();
  expect(body.startsWith("\uFEFF")).toBe(true);
  const lines = body.slice(1).split("\r\n");
  expect(lines[0]).toBe(
    "dimension,key,name,detail,lines,jobs,sales,quantity,gross,cost,yield,cult_commons,after_cc,currency",
  );
  expect(lines.some((l) => l.startsWith(`job,${JOB_ID},${JOB},`))).toBe(true);
  expect(lines.some((l) => l.startsWith("TOTAL,"))).toBe(true);
});

test("a manager sees costs through the role", async ({ page }) => {
  await signIn(page, "manager");
  await page.goto(`/reports?period=day&date=${anchorDay(3)}`);
  await expect(todayTile(figures(page), "Yield")).toBeVisible();
  await expect(todayTile(figures(page), "Cult Commons")).toBeVisible();
});

test("a mechanic without permissions sees activity only, and the exports refuse", async ({
  page,
}) => {
  await signIn(page, "mechanic2");
  const query = `period=day&date=${anchorDay(3)}&basis=completion`;
  await page.goto(`/reports?${query}`);
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Sales, yield and Cult Commons figures need the View financial reports permission.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Gross sales")).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Date basis" })).toHaveCount(0);

  const refused = await page.request.get(`/reports/export?kind=breakdown&${query}&by=job`);
  expect(refused.status()).toBe(403);
  expect(await refused.text()).toBe("Forbidden");

  const lines = await page.goto(`/reports/lines?${query}&by=job&key=${JOB_ID}`);
  expect(lines?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "You can't open this" })).toBeVisible();

  const mechanics = await page.request.get(`/reports/export?kind=mechanics&${query}`);
  expect(mechanics.status()).toBe(200);
  expect(mechanics.headers()["content-type"]).toMatch(/^text\/csv/);
  const body = await mechanics.text();
  expect(body.slice(1).split("\r\n")[0]).toBe(
    "name,active,checked_in,completed,collected,open_now",
  );
});
