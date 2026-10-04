import { expect, test } from "@playwright/test";

import { STAFF_EMAIL } from "../fixtures/ids";

import { isPhone, signIn, signInOnForm } from "./helpers";

test("an unauthenticated visit to / redirects to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
});

test("a deep link survives sign-in through ?next=", async ({ page }) => {
  await page.goto("/settings/profile");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fprofile$/);
  await signInOnForm(page, "mechanic1");
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByRole("heading", { name: "Marcus Tan" })).toBeVisible();
});

test("a wrong password shows a generic error and keeps the email", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(STAFF_EMAIL.admin);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "That email and password don't match. Try again.",
  );
  await expect(page.getByLabel("Email")).toHaveValue(STAFF_EMAIL.admin);
  await expect(page).toHaveURL(/\/login/);
});

test("the admin signs in and sees Today and the navigation", async ({ page }, testInfo) => {
  await signIn(page, "admin");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Asha");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toBeVisible();
  for (const label of ["Today", "Jobs", "Scan", "Inventory"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: "Today", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // The phone project must get the tab bar and the iPad the rail.
  expect(isPhone(page)).toBe(testInfo.project.name === "phone");
  if (isPhone(page)) {
    // Bottom tab bar, pinned to the bottom of the viewport, with More.
    await expect(nav.getByRole("link", { name: "More", exact: true })).toBeVisible();
    const box = await nav.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y + box!.height).toBeCloseTo(viewport.height, 0);
  } else {
    // Left rail lists every section, Settings included.
    await expect(nav.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
    const box = await nav.boundingBox();
    expect(box!.x).toBe(0);
  }
  await expect(page.getByRole("link", { name: "Your profile: Asha Admin" })).toBeVisible();
});

test("sign-out ends the session", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/settings/profile");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

for (const next of ["https://evil.example/phish", "//evil.example/phish", "/\\evil.example"]) {
  test(`login ?next=${next} cannot redirect off-site`, async ({ page, baseURL }) => {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await signInOnForm(page, "admin");
    await expect(page).toHaveURL(`${baseURL}/`);
  });
}
