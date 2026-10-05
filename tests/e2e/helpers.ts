import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

import { parseShopDay, shiftShopDay } from "../../src/lib/dates";
import { SEED_PASSWORD, STAFF_EMAIL, type SeedStaff } from "../fixtures/ids";

/**
 * The seed's anchor: the shop day the database was reset and seeded
 * ('YYYY-MM-DD'), read once by global-setup.mts into E2E_SEED_ANCHOR. The
 * seeded history (tests/fixtures/reporting.ts) is relative to it, and it
 * need not be today (E2E_RESET=0, E2E_EXTERNAL_STACK=1, a run across
 * Singapore midnight).
 */
export function seedAnchor(): string {
  const anchor = parseShopDay(process.env.E2E_SEED_ANCHOR);
  if (anchor === null) {
    throw new Error(
      `E2E_SEED_ANCHOR is ${JSON.stringify(process.env.E2E_SEED_ANCHOR ?? null)}, not a YYYY-MM-DD day: ` +
        "tests/e2e/global-setup.mts sets it; run the suite through `npm run test:e2e`.",
    );
  }
  return anchor;
}

/** The shop day `n` days before the seed's anchor (anchorDay(0) is the anchor). */
export function anchorDay(n: number): string {
  return shiftShopDay(seedAnchor(), -n);
}

/** Signs in through the real login form and waits until the app is open. */
export async function signIn(page: Page, who: SeedStaff, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await signInOnForm(page, who);
}

/** Fills and submits the login form already on screen. */
export async function signInOnForm(page: Page, who: SeedStaff) {
  await page.getByLabel("Email").fill(STAFF_EMAIL[who]);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1024) < 768;
}

/** A toast with this text (polite confirmations or errors), not the same words elsewhere on the page. */
export function toast(page: Page, text: string): Locator {
  return page
    .getByRole("list", { name: "Notifications" })
    .or(page.getByRole("alert", { name: "Errors" }))
    .getByText(text);
}

/**
 * A tag unique to this run and project (phone, tablet), put on every record
 * a test creates, so the phone and iPad runs (and repeated runs on a kept
 * database) never find each other's records.
 */
export function tagFor(testInfo: TestInfo): string {
  return `${testInfo.project.name}${Date.now().toString(36)}`.toUpperCase();
}

/** The section (a Card) whose heading is exactly `title`. */
export function section(page: Page, title: string): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

/** Presses the intake wizard's Next and waits until its step label reads `expectStep`. */
export async function nextIntakeStep(page: Page, expectStep: string): Promise<void> {
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Intake steps" })).toContainText(expectStep);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let intakeBikes = 0;

export type IntakeJob = {
  /** Tag from tagFor(testInfo); the customer's last name and part of the bike's model. */
  tag: string;
  /** Defaults to "Full service". */
  requestedWork?: string;
  /** The lead mechanic's display name, e.g. "Marcus Tan"; none when omitted. */
  lead?: string;
  /** Additional staff by display name. */
  additional?: readonly string[];
  /** Active services by name (each chosen once, prices as listed). */
  services?: readonly string[];
};

/**
 * Checks a bike in through the real intake wizard as whoever is signed in
 * (it signs nobody in): a new customer "Intake {tag}" and a new Brompton
 * for them from the sheets, the requested work, the people and services
 * given, then Create job. Skips the intake photos (Done) and returns on
 * the job's page with its id and J- number. Each call creates its own
 * customer and bike, so a test may call it more than once with one tag.
 */
export async function createJobViaIntake(
  page: Page,
  { tag, requestedWork = "Full service", lead, additional = [], services = [] }: IntakeJob,
): Promise<{ id: string; jobNumber: string }> {
  const model = `Intake ${++intakeBikes} ${tag}`;
  await page.goto("/jobs/new");
  await expect(page.getByText("Step 1 of 5", { exact: true })).toBeVisible();

  // 1. Customer, from the sheet.
  await page.getByRole("button", { name: "New customer" }).click();
  const customerSheet = page.getByRole("dialog", { name: "New customer" });
  await customerSheet.getByLabel("First name").fill("Intake");
  await customerSheet.getByLabel("Last name").fill(tag);
  await customerSheet.getByRole("button", { name: "Create customer" }).click();
  await expect(customerSheet).toBeHidden();

  // 2. Bike, added for them (and so chosen).
  await expect(page.getByText("Step 2 of 5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add bike" }).click();
  const bikeSheet = page.getByRole("dialog", { name: "New bike" });
  await bikeSheet.getByLabel("Brand").fill("Brompton");
  await bikeSheet.getByLabel("Model").fill(model);
  await bikeSheet.getByRole("button", { name: "Add bike" }).click();
  await expect(bikeSheet).toBeHidden();
  await expect(
    page.getByRole("button", { name: new RegExp(`Brompton ${escapeRegExp(model)}`) }),
  ).toHaveAttribute("aria-pressed", "true");
  await nextIntakeStep(page, "Step 3 of 5");

  // 3. Work.
  await page.getByLabel("Requested work").fill(requestedWork);
  await nextIntakeStep(page, "Step 4 of 5");

  // 4. People.
  if (lead) {
    await page
      .getByRole("radiogroup", { name: "Lead mechanic" })
      .getByRole("radio", { name: lead })
      .click();
  }
  for (const name of additional) {
    await page
      .getByRole("group", { name: "Additional staff" })
      .getByRole("button", { name })
      .click();
  }
  await nextIntakeStep(page, "Step 5 of 5");

  // 5. Services.
  for (const name of services) {
    await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(name)}`) }).click();
    await expect(page.getByRole("list", { name: "Chosen services" })).toContainText(name);
  }
  await nextIntakeStep(page, "Review");
  await page.getByRole("button", { name: "Create job" }).click();

  // The job, on its intake photos step: skip them.
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}\?intake=photos$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await section(page, "Intake photos").getByRole("link", { name: "Done" }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${id}$`));
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^J-\d{6}$/);
  return { id, jobNumber: (await heading.textContent())!.trim() };
}
