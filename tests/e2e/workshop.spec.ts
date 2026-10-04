import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { WORK_ORDER } from "../fixtures/ids";
import { signIn, tagFor, toast } from "./helpers";

/**
 * M1.3 workshop, on a phone and an iPad: SPEC §27.3 journey 1 (walk-in bike
 * -> intake photos -> job -> services -> complete -> ready -> collected),
 * without the part line (inventory is Phase 4), and the intake draft
 * surviving a reload. Every record carries tagFor(testInfo); nothing
 * counts rows across the shared database.
 */

const PHOTO = path.join(__dirname, "fixtures", "bike-photo.jpg");

/** The section (Card) whose heading is `title`. */
const card = (page: Page, title: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

async function next(page: Page, expectStep: string) {
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Intake steps" })).toContainText(expectStep);
}

test("journey 1: a walk-in bike is checked in with photos, priced, completed and collected", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const tag = tagFor(testInfo);
  const model = `C Line ${tag}`;

  await signIn(page, "admin");
  await page.goto("/jobs");
  await page.getByRole("link", { name: "New job" }).first().click();
  await expect(page).toHaveURL(/\/jobs\/new$/);
  await expect(page.getByText("Step 1 of 5", { exact: true })).toBeVisible();

  // 1. Customer: a new one, from the sheet.
  await page.getByRole("button", { name: "New customer" }).click();
  const customerSheet = page.getByRole("dialog", { name: "New customer" });
  await customerSheet.getByLabel("First name").fill("Walkin");
  await customerSheet.getByLabel("Last name").fill(tag);
  await customerSheet.getByRole("button", { name: "Create customer" }).click();
  await expect(customerSheet).toBeHidden();

  // 2. Bike: added for them, then chosen.
  await expect(page.getByText("Step 2 of 5", { exact: true })).toBeVisible();
  await expect(page.getByText(`Walkin ${tag}`)).toBeVisible();
  await page.getByRole("button", { name: "Add bike" }).click();
  const bikeSheet = page.getByRole("dialog", { name: "New bike" });
  await expect(bikeSheet).toContainText(`Walkin ${tag}`);
  await bikeSheet.getByLabel("Brand").fill("Brompton");
  await bikeSheet.getByLabel("Model").fill(model);
  await bikeSheet.getByRole("button", { name: "Add bike" }).click();
  await expect(bikeSheet).toBeHidden();
  const bikeCard = page.getByRole("button", { name: new RegExp(`Brompton ${model}`) });
  await expect(bikeCard).toHaveAttribute("aria-pressed", "true");
  await expect(bikeCard).toContainText(/B-\d{6}/);
  await next(page, "Step 3 of 5");

  // 3. Work.
  await page.getByLabel("Requested work").fill("Full service and true both wheels");
  await page.getByLabel("Condition on arrival").fill("Scuff on the left crank arm");
  await next(page, "Step 4 of 5");

  // 4. People: Marcus leads, Nur helps.
  await page
    .getByRole("radiogroup", { name: "Lead mechanic" })
    .getByRole("radio", { name: "Marcus Tan" })
    .click();
  await page
    .getByRole("group", { name: "Additional staff" })
    .getByRole("button", { name: "Nur Aisyah" })
    .click();
  await next(page, "Step 5 of 5");

  // 5. Services: Full Service.
  await page.getByRole("button", { name: /^Full Service/ }).click();
  await expect(page.getByRole("list", { name: "Chosen services" })).toContainText("Full Service");
  await next(page, "Review");
  await expect(page.getByText("Lead: Marcus Tan")).toBeVisible();
  await page.getByRole("button", { name: "Create job" }).click();

  // The job, intake photos first.
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}\?intake=photos$/);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^J-\d{6}$/);
  const jobNumber = (await heading.textContent())!.trim();
  const jobUrl = page.url().replace(/\?.*$/, "");
  const intake = card(page, "Intake photos");
  await expect(intake).toBeVisible();
  await page.getByLabel("Choose photos").setInputFiles(PHOTO);
  await expect(
    intake.getByRole("list", { name: "Photos", exact: true }).getByRole("listitem"),
  ).toHaveCount(1);
  await intake.getByRole("link", { name: "Done" }).click();
  await expect(page).toHaveURL(jobUrl);
  await expect(card(page, "Intake photos")).toHaveCount(0);
  await expect(
    card(page, "Photos").getByRole("list", { name: "Photos", exact: true }).getByRole("listitem"),
  ).toHaveCount(1);

  // People, read-only here.
  const people = card(page, "People");
  await expect(people).toContainText("LeadMarcus Tan");
  await expect(people.getByRole("list", { name: "Also on the job" })).toContainText("Nur Aisyah");

  const totals = page.getByLabel("Totals", { exact: true });
  await expect(totals).toContainText(/Total\s*\$200\.00/);

  // Wheel True × 2.
  await page.getByRole("button", { name: "Add service" }).click();
  const addService = page.getByRole("dialog", { name: "Add service" });
  await addService.getByRole("combobox").fill("Wheel");
  await addService.getByRole("option", { name: /Wheel True/ }).click();
  await expect(addService.getByLabel("Unit price")).toHaveValue("35.00");
  await addService.getByRole("button", { name: "Increase" }).click();
  await expect(addService.getByLabel("Quantity")).toHaveValue("2");
  await expect(addService.locator("output")).toHaveText("$70.00");
  await addService.getByRole("button", { name: "Add service" }).click();
  await expect(addService).toBeHidden();
  await expect(totals).toContainText(/Total\s*\$270\.00/);
  await expect(totals).toContainText(/Cost\s*\$0\.00/);
  await expect(totals).toContainText(/Yield\s*\$270\.00/);
  await expect(totals).toContainText(/Cult Commons \(30%\)\s*\$81\.00/);
  await expect(totals).toContainText(/after Cult Commons\s*\$189\.00/);

  // A manual line with a cost.
  await page.getByRole("button", { name: "Add manual line" }).click();
  const manual = page.getByRole("dialog", { name: "Add manual line" });
  await manual.getByLabel("Description").fill("Valve core");
  await manual.getByLabel("Unit price").fill("5.00");
  await manual.getByLabel("Unit cost").fill("2.00");
  await expect(manual.locator("output")).toHaveText("$5.00");
  await manual.getByRole("button", { name: "Add line" }).click();
  await expect(manual).toBeHidden();
  await expect(totals).toContainText(/Total\s*\$275\.00/);
  await expect(totals).toContainText(/Cult Commons \(30%\)\s*\$81\.90/);

  // Void it, with a reason.
  const valveRow = page.getByRole("row", { name: /Valve core/ });
  await valveRow.getByRole("button", { name: "Void…" }).click();
  await valveRow.getByLabel("Why are you voiding Valve core?").fill("Not needed");
  await page.waitForTimeout(500);
  await valveRow.getByRole("button", { name: "Void line" }).click();
  await expect(toast(page, "Valve core voided")).toBeVisible();
  await expect(totals).toContainText(/Total\s*\$270\.00/);
  await expect(page.getByRole("row", { name: /Valve core/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Show voided (1)" }).click();
  await expect(page.getByRole("row", { name: /Valve core/ })).toContainText("Not needed");

  // Start -> Complete -> Ready for collection -> Collected.
  await page.getByRole("button", { name: "Start work" }).click();
  await expect(toast(page, `${jobNumber}: In progress`)).toBeVisible();
  await page.getByRole("button", { name: "Complete" }).click();
  await expect(toast(page, `${jobNumber}: Completed`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add service" })).toBeDisabled();
  await expect(page.getByText("Completed jobs are locked. Reopen to change lines.")).toBeVisible();
  await page.getByRole("button", { name: "Ready for collection" }).click();
  await expect(toast(page, `${jobNumber}: Ready for collection`)).toBeVisible();
  await page.getByRole("button", { name: "Collected" }).click();
  await expect(toast(page, `${jobNumber}: Collected`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Change status" })).toHaveCount(0);

  // Completed and collected are two separate timestamps.
  const dates = page.getByLabel("Dates", { exact: true });
  await expect(dates.getByText("Completed", { exact: true })).toBeVisible();
  await expect(dates.getByText("Collected", { exact: true })).toBeVisible();
  await expect(dates.locator("time")).toHaveCount(5);

  // The timeline tells the whole story.
  const timeline = page.getByRole("list", { name: "Timeline" });
  for (const line of [
    `Checked in as ${jobNumber}`,
    "Marcus Tan assigned as lead",
    "Nur Aisyah added to the job",
    "Photo added",
    "Added Full Service · $200.00",
    "Added Wheel True × 2 · $70.00",
    "Added Valve core · $5.00",
    "Voided Valve core · $5.00",
    "“Not needed”",
    "Work started",
    "Completed",
    "Ready for collection",
    "Collected",
  ]) {
    await expect(timeline.getByText(line, { exact: true })).toBeVisible();
  }
});

test("an intake interrupted by a reload comes back from the draft", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const tag = tagFor(testInfo);

  await signIn(page, "admin");
  await page.goto("/jobs/new");
  await page.getByRole("button", { name: "New customer" }).click();
  const customerSheet = page.getByRole("dialog", { name: "New customer" });
  await customerSheet.getByLabel("First name").fill("Draft");
  await customerSheet.getByLabel("Last name").fill(tag);
  await customerSheet.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByText("Step 2 of 5", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText(/Continue the intake you started at/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 2 of 5", { exact: true })).toBeVisible();
  await expect(page.getByText(`Draft ${tag}`)).toBeVisible();

  // Discarding starts afresh.
  await page.reload();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Step 1 of 5", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Step 1 of 5", { exact: true })).toBeVisible();
  await expect(page.getByText(/Continue the intake you started at/)).toHaveCount(0);
});

test("a mechanic without cost access sees the sale side of a job and nothing else", async ({
  page,
}) => {
  await signIn(page, "mechanic2");
  await page.goto(`/jobs/${WORK_ORDER.priyaDomaneReady}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("J-000002");
  const totals = page.getByLabel("Totals", { exact: true });
  await expect(totals).toContainText(/Total\s*\$300\.00/);
  await expect(totals).not.toContainText("Cost");
  await expect(page.getByText(/Cult Commons|Yield|Unit cost/)).toHaveCount(0);
  // Not hidden but absent: the page's data carries no cost figure at all.
  const html = await page.content();
  for (const key of ["costTotal", "yieldTotal", "ccShare", "unitDirectCost", "124.00"]) {
    expect(html).not.toContain(key);
  }
});
