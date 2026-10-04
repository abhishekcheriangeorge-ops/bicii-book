import { expect, type Page } from "@playwright/test";

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
