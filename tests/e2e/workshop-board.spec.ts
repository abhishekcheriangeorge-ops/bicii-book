import { expect, test, type Page } from "@playwright/test";

import { BIKE, WORK_ORDER } from "../fixtures/ids";
import { createJobViaIntake, section, signIn, tagFor, toast } from "./helpers";

/**
 * M1.3 workshop, on a phone and an iPad: the board and My Jobs with their
 * filters (SPEC §7.2), the cost boundary for a mechanic without
 * view_costs (D14), job search (§20), service history, a service created
 * in settings reaching a job, and reassignment with notes (§7.2, §31).
 * Seeded jobs are only read, so both projects share one database; every
 * record a test creates carries tagFor(testInfo); nothing counts rows
 * across the shared database.
 */

/** A job number shown on the page body (not the header). */
const job = (page: Page, number: string) =>
  page.getByRole("main").getByText(number, { exact: true });

async function openFilters(page: Page) {
  await page.getByRole("button", { name: /^Filters/ }).click();
  return page.getByRole("dialog", { name: "Filter jobs" });
}

test("the board: My jobs, Unassigned, the Overdue age and a single status", async ({ page }) => {
  await signIn(page, "mechanic2");
  await page.goto("/jobs");
  const views = page.getByRole("navigation", { name: "Show jobs" });

  // My jobs: Nur leads J2, J5, J9 and helps on J3; Marcus's J4 is not hers.
  await views.getByRole("link", { name: "My jobs" }).click();
  await expect(page).toHaveURL(/\/jobs\?view=mine$/);
  await expect(views.getByRole("link", { name: "My jobs" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  for (const n of ["J-000002", "J-000003", "J-000005", "J-000009"]) {
    await expect(job(page, n)).toBeVisible();
  }
  await expect(job(page, "J-000004")).toHaveCount(0);
  // Counts per group, and no money anywhere on the board.
  await expect(
    page.getByRole("navigation", { name: "Board groups" }).getByRole("link", { name: /^Waiting/ }),
  ).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("$");

  // Unassigned: J7 has no lead.
  await views.getByRole("link", { name: "Unassigned" }).click();
  await expect(page).toHaveURL(/view=unassigned/);
  await expect(job(page, "J-000007")).toBeVisible();
  await expect(job(page, "J-000002")).toHaveCount(0);

  // Overdue (D20): J6, checked in 8 days ago and still open.
  await page.goto("/jobs");
  let sheet = await openFilters(page);
  await sheet
    .getByRole("radiogroup", { name: "Age" })
    .getByRole("radio", { name: "Overdue" })
    .click();
  await sheet.getByRole("button", { name: "Show jobs" }).click();
  await expect(page).toHaveURL(/age=overdue/);
  const overdueRow = page.getByRole("link").filter({ hasText: "J-000006" });
  await expect(overdueRow).toContainText("Overdue");
  // J-000002 is ready for collection, so never overdue however old the
  // seed is (E2E_RESET=0 keeps an ageing database).
  await expect(job(page, "J-000002")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Age: Overdue");

  // One status out of the Waiting group: parts, not the customer.
  await page.getByRole("link", { name: "Clear", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs$/);
  sheet = await openFilters(page);
  await sheet.getByText("Waiting on parts", { exact: true }).click();
  await expect(sheet.getByLabel("Waiting on parts")).toBeChecked();
  await sheet.getByRole("button", { name: "Show jobs" }).click();
  await expect(page).toHaveURL(/status=awaiting_parts/);
  await expect(job(page, "J-000005")).toBeVisible();
  await expect(job(page, "J-000006")).toHaveCount(0);

  // Removing the chip brings the rest back.
  await page.getByRole("link", { name: "Remove filter: Waiting on parts" }).click();
  await expect(job(page, "J-000006")).toBeVisible();

  // A job number, typed loosely.
  await page.getByRole("searchbox", { name: "Job number" }).fill("j000004");
  await expect(page).toHaveURL(/q=j000004/);
  await expect(job(page, "J-000004")).toBeVisible();
  await expect(job(page, "J-000006")).toHaveCount(0);
});

test("a mechanic without cost access never sees a cost, yield or Cult Commons", async ({
  page,
}) => {
  await signIn(page, "mechanic2");
  await page.goto(`/jobs/${WORK_ORDER.priyaDomaneReady}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("J-000002");
  await expect(page.getByLabel("Totals", { exact: true })).toContainText(/Total\s*\$300\.00/);
  await expect(page.getByText(/\bCost\b|Yield|Cult Commons/)).toHaveCount(0);

  await page.goto("/settings/services");
  await expect(page.getByRole("heading", { name: "Services", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Basic Service");
  await expect(page.getByRole("main")).toContainText("$80.00");
  await expect(page.getByText(/\bCost\b|Cult Commons/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New service" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
});

test("a mechanic with cost access sees the job's Cult Commons", async ({ page }) => {
  await signIn(page, "mechanic1");
  await page.goto(`/jobs/${WORK_ORDER.priyaDomaneReady}`);
  const totals = page.getByLabel("Totals", { exact: true });
  await expect(totals).toContainText(/Cult Commons \(30%\)\s*\$52\.80/);
  await expect(totals).toContainText(/BICII yield after Cult Commons\s*\$123\.20/);

  await page.goto("/settings/services");
  await expect(section(page, "Cult Commons")).toContainText("30%");
  await expect(page.getByRole("button", { name: "Schedule a new rate" })).toHaveCount(0);
});

test("search finds a job by number; a bike lists its jobs", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/");
  const header = page.getByRole("searchbox", { name: "Search customers, bikes and jobs" });
  await header.fill("j-000004");
  await header.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=j-000004/);
  const jobs = page.getByRole("list", { name: "Jobs", exact: true });
  await expect(page.getByRole("main").getByRole("heading", { level: 2 }).first()).toHaveText(
    /^Jobs/,
  );
  await jobs.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${WORK_ORDER.chloeGiantInProgress}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("J-000004");

  await page.goto(`/bikes/${BIKE.chloeGiant}`);
  const history = page.getByRole("list", { name: "Service history" });
  await expect(history).toContainText("J-000004");
  await history.getByRole("link").filter({ hasText: "J-000004" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("J-000004");
});

test("a new service reaches a new job; the lead is reassigned and a note added", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const tag = tagFor(testInfo);
  const serviceName = `Race Check ${tag}`;

  await signIn(page, "admin");

  // A service, created in settings.
  await page.goto("/settings/services");
  await page.getByRole("button", { name: "New service" }).click();
  const serviceSheet = page.getByRole("dialog", { name: "New service" });
  await serviceSheet.getByLabel("Name").fill(serviceName);
  await serviceSheet.getByLabel("Category").selectOption({ label: "Servicing" });
  await serviceSheet.getByLabel("Price").fill("42.50");
  await serviceSheet.getByRole("button", { name: "Create service" }).click();
  await expect(serviceSheet).toBeHidden();
  await expect(toast(page, `${serviceName} created`)).toBeVisible();
  await expect(page.getByRole("list", { name: "Servicing" })).toContainText(serviceName);

  // A job, through intake, with Marcus as lead.
  const { jobNumber } = await createJobViaIntake(page, {
    tag,
    requestedWork: "Gears slipping",
    lead: "Marcus Tan",
  });

  // The new service is offered on it.
  await page.getByRole("button", { name: "Add service" }).click();
  const addService = page.getByRole("dialog", { name: "Add service" });
  await addService.getByRole("combobox").fill(tag);
  await expect(addService.getByRole("option", { name: new RegExp(serviceName) })).toBeVisible();
  await addService.getByRole("button", { name: "Cancel" }).click();
  await expect(addService).toBeHidden();

  // Reassign the lead to Nur: Marcus leaves the job.
  const people = section(page, "People");
  await expect(people.getByRole("list", { name: "Lead" })).toContainText("Marcus Tan");
  await people.getByRole("button", { name: "Assign" }).click();
  const assign = page.getByRole("dialog", { name: "Assign" });
  await assign.getByRole("radio", { name: /^Nur Aisyah/ }).click();
  await assign
    .getByRole("radiogroup", { name: "Role" })
    .getByRole("radio", { name: "Lead" })
    .click();
  await expect(assign).toContainText("Replaces Marcus Tan as lead; they leave the job.");
  await assign.getByRole("button", { name: "Assign" }).click();
  await expect(assign).toBeHidden();
  await expect(toast(page, "Nur Aisyah is now the lead")).toBeVisible();
  await expect(people.getByRole("list", { name: "Lead" })).toContainText("Nur Aisyah");
  await expect(people).not.toContainText("Marcus Tan");

  // A note.
  await page.getByRole("button", { name: "Add note" }).click();
  const noteSheet = page.getByRole("dialog", { name: "Add note" });
  await noteSheet.getByLabel("Note").fill(`Tagged note ${tag}`);
  await noteSheet.getByRole("button", { name: "Add note" }).click();
  await expect(noteSheet).toBeHidden();
  await expect(toast(page, "Note added")).toBeVisible();

  // The customer approved the extra work (applies at once).
  await page.getByRole("switch", { name: "Customer approved extra work" }).click();
  await expect(toast(page, "Marked as approved by the customer")).toBeVisible();

  // Details: a blank requested work is refused and what was typed stays.
  await section(page, "Requested work").getByRole("button", { name: "Edit" }).click();
  const details = page.getByRole("dialog", { name: "Edit job details" });
  await details.getByLabel("Requested work").fill("");
  await details.getByLabel("Internal notes").fill(`Seat post seized ${tag}`);
  await details.getByRole("button", { name: "Save" }).click();
  await expect(details.getByText("Say what the customer wants done.")).toBeVisible();
  await expect(details.getByLabel("Internal notes")).toHaveValue(`Seat post seized ${tag}`);
  await details.getByLabel("Requested work").fill("Gears slipping, index both derailleurs");
  await details.getByRole("button", { name: "Save" }).click();
  await expect(details).toBeHidden();
  await expect(section(page, "Notes")).toContainText(`Seat post seized ${tag}`);

  // Everything is in the timeline.
  const timeline = page.getByRole("list", { name: "Timeline" });
  for (const line of [
    "Marcus Tan assigned as lead",
    "Nur Aisyah assigned as lead",
    "Marcus Tan removed from the job",
    `“Tagged note ${tag}”`,
    "Marked customer-approved",
  ]) {
    await expect(timeline.getByText(line, { exact: true })).toBeVisible();
  }

  await expect(
    timeline.getByText(
      /^(Requested work and internal notes|Internal notes and requested work) updated$/,
    ),
  ).toBeVisible();

  // On the board, the job now shows Nur as its lead.
  await page.goto(`/jobs?q=${jobNumber}`);
  await expect(page.getByRole("link", { name: new RegExp(`^${jobNumber}`) })).toContainText(
    "Nur Aisyah",
  );
});
