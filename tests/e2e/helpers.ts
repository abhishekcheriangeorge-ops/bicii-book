import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

import { SEED_PASSWORD, STAFF_EMAIL, type SeedStaff } from "../fixtures/ids";

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
