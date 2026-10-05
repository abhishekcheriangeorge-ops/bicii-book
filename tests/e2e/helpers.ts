import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

import { parseShopDay, shiftShopDay } from "../../src/lib/dates";
import { STAFF_EMAIL, type SeedStaff } from "../fixtures/ids";

import { mailCursor, waitForCode } from "./mail";

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

/** Signs a seeded staff member in through the real login form and waits until the app is open. */
export async function signIn(page: Page, who: SeedStaff, next?: string) {
  await signInAs(page, STAFF_EMAIL[who], next);
}

/** Signs in on the login form already on screen (a seeded staff member). */
export async function signInOnForm(page: Page, who: SeedStaff) {
  await signInOnFormAs(page, STAFF_EMAIL[who]);
}

/** signIn() for any address with a login (an invited colleague). */
export async function signInAs(page: Page, email: string, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await signInOnFormAs(page, email);
}

/** When this worker last asked for a code for each address (requestCodeOnForm). */
const lastAsked = new Map<string, number>();

/** Records that Auth just issued a code for `email` (api.ts signInApi), so the next request waits out the interval. */
export function noteCodeIssued(email: string): void {
  lastAsked.set(email, Date.now());
}

/** Auth's per-address interval on the devstack (max_frequency 1s), plus a margin. */
const PER_ADDRESS_INTERVAL_MS = 1100;

/**
 * The email step of the login form already on screen: asks for a code and
 * returns it, read from the mail catcher (PLAN D10). The cursor is taken
 * BEFORE the click, so an older email to the same address is never used.
 *
 * Auth emails one address at most once per second here (max_frequency;
 * raised limits otherwise, TESTING.md). Within that interval it refuses to
 * send, and the Admin shows "Check your email" anyway, exactly as for an
 * unknown address (D70), so the refusal cannot be seen on screen: the
 * helper waits out the interval since this worker last asked for the same
 * address, and if no email arrives it goes back ("Use a different email"),
 * waits again and asks again, up to 5 times.
 */
export async function requestCodeOnForm(page: Page, email: string): Promise<string> {
  const cursor = await mailCursor(email);
  const checkEmail = page.getByRole("heading", { name: "Check your email" });
  for (let attempt = 1; ; attempt++) {
    const wait = (lastAsked.get(email) ?? 0) + PER_ADDRESS_INTERVAL_MS - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(checkEmail).toBeVisible();
    lastAsked.set(email, Date.now());
    try {
      return await waitForCode({ to: email, after: cursor, timeoutMs: 5000 });
    } catch (error) {
      if (attempt >= 5) throw error;
    }
    await page.getByRole("button", { name: "Use a different email" }).click();
    await expect(page.getByLabel("Email")).toHaveValue(email);
  }
}

/** Signs `email` in on the login form already on screen, with an emailed code. */
export async function signInOnFormAs(page: Page, email: string) {
  const code = await requestCodeOnForm(page, email);
  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1024) < 768;
}

/** A toast with this text (polite confirmations or errors), not the same words elsewhere on the page. */
export function toast(page: Page, text: string | RegExp): Locator {
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
  /** Condition on arrival; none when omitted. */
  condition?: string;
  /** A photo file to add on the intake photos step; none when omitted. */
  photo?: string;
};

/**
 * Checks a bike in through the real intake wizard as whoever is signed in
 * (it signs nobody in): a new customer "Intake {tag}" and a new Brompton
 * for them from the sheets, the requested work, the people and services
 * given, then Create job. Adds `photo` on the intake photos step when
 * given (otherwise skips them), presses Done and returns on
 * the job's page with its id and J- number. Each call creates its own
 * customer and bike, so a test may call it more than once with one tag.
 */
export async function createJobViaIntake(
  page: Page,
  {
    tag,
    requestedWork = "Full service",
    lead,
    additional = [],
    services = [],
    condition,
    photo,
  }: IntakeJob,
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
  if (condition) await page.getByLabel("Condition on arrival").fill(condition);
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

  // The job, on its intake photos step: add the photo if given, then Done.
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}\?intake=photos$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const intakePhotos = section(page, "Intake photos");
  if (photo) {
    await page.getByLabel("Choose photos").setInputFiles(photo);
    await expect(
      intakePhotos.getByRole("list", { name: "Photos", exact: true }).getByRole("listitem"),
    ).toHaveCount(1);
  }
  await intakePhotos.getByRole("link", { name: "Done" }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${id}$`));
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^J-\d{6}$/);
  return { id, jobNumber: (await heading.textContent())!.trim() };
}

/** Creates a counted product through New product and returns its page's URL and P- number. */
export async function createProduct(
  page: Page,
  { name, sku, price, cost, reorderPoint }: Record<string, string>,
): Promise<{ url: string; shortId: string }> {
  await page.goto("/inventory");
  await page.getByRole("button", { name: "New product" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New product" });
  await expect(sheet.getByRole("radio", { name: "Quantity" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await sheet.getByLabel("Name").fill(name);
  await sheet.getByLabel("SKU").fill(sku);
  await sheet.getByLabel("Sale price", { exact: true }).fill(price);
  await sheet.getByLabel("Cost", { exact: true }).fill(cost);
  await sheet.getByLabel("Reorder point").fill(reorderPoint);
  await sheet.getByRole("button", { name: "Add product" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  const shortId = (await page
    .locator("header")
    .getByText(/^P-\d{6}$/)
    .textContent())!.trim();
  return { url: page.url(), shortId };
}

/** Opens Add part on the job page, picks the first option matching `query` and returns the sheet. */
export async function pickPart(page: Page, query: string, option: RegExp) {
  await page.getByRole("button", { name: "Add part" }).click();
  const sheet = page.getByRole("dialog", { name: "Add part" });
  await sheet.getByRole("combobox").fill(query);
  const choice = sheet.getByRole("option", { name: option });
  await expect(choice).toBeVisible();
  // Really on screen before any click scrolls it there: not clipped into the
  // sheet body's hidden scroll space, and not under the sheet footer (a
  // short sheet on a phone used to hide the results behind it).
  await expect(choice).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() =>
      choice.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit !== null && el.contains(hit);
      }),
    )
    .toBe(true);
  return { sheet, choice };
}

/**
 * The value of the Today tile labelled exactly `label` inside `scope` (a
 * section): the `<dd>` of the `<dl>` whose `<dt>` reads `label`.
 */
export function todayTile(scope: Locator, label: string): Locator {
  return scope
    .locator("dl")
    .filter({
      has: scope
        .page()
        .locator("dt")
        .filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`) }),
    })
    .locator("dd")
    .first();
}

/** A Today count tile's number. */
export async function readCount(scope: Locator, label: string): Promise<number> {
  const text = ((await todayTile(scope, label).textContent()) ?? "").replace(/[^\d−-]/g, "");
  return Number(text.replace("−", "-"));
}

/** A Today money tile's amount as a fixed-2 string ("1000.00", "-15.00"). */
export async function readMoney(scope: Locator, label: string): Promise<string> {
  const text = (await todayTile(scope, label).textContent()) ?? "";
  const m = /([−-]?)\$([\d,]+\.\d{2})/.exec(text);
  if (!m) throw new Error(`No amount in the "${label}" tile: ${JSON.stringify(text)}`);
  return `${m[1] ? "-" : ""}${m[2].replaceAll(",", "")}`;
}

/**
 * The first shop day on or after `from` that falls on `weekday` (0 =
 * Sunday), plus 7 days on the tablet project so the phone and iPad runs
 * never share a day (appointment and settings specs).
 */
export function clearDay(testInfo: TestInfo, from: string, weekday: number): string {
  let day = from;
  while (new Date(`${day}T00:00:00Z`).getUTCDay() !== weekday) day = shiftShopDay(day, 1);
  return testInfo.project.name === "tablet" ? shiftShopDay(day, 7) : day;
}

/** Opens the Book appointment sheet from the page's Book button (the phone's FAB or the md+ button). */
export async function openBookSheet(page: Page): Promise<Locator> {
  await page
    .getByRole("button", { name: /^(Book|Book appointment)$/ })
    .filter({ visible: true })
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "Book appointment" });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Picks a time in the open Book sheet by tapping its chip (the radio inside is visually hidden). */
export async function pickTime(sheet: Locator, time: string): Promise<void> {
  const name = new RegExp(`^${time}`);
  await sheet
    .locator("label")
    .filter({ has: sheet.page().getByRole("radio", { name }) })
    .click();
  await expect(sheet.getByRole("radio", { name })).toBeChecked();
}
