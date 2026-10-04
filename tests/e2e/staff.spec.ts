import { expect, test } from "@playwright/test";

import { STAFF } from "../fixtures/ids";

import { signIn } from "./helpers";

test("mechanic2 (no manage_staff) gets the 403 page on /settings/staff", async ({ page }) => {
  await signIn(page, "mechanic2");
  const response = await page.goto("/settings/staff");
  expect(response?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "You can't open this" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("a permission the admin grants appears on mechanic2's profile", async ({
  browser,
  page,
}, testInfo) => {
  // Each project uses its own permission, so the two runs never interfere.
  const permission = testInfo.project.name === "phone" ? "Adjust stock" : "Manage purchasing";

  await signIn(page, "admin");
  await page.goto("/settings/staff");
  await expect(page.getByRole("list", { name: "Staff members" })).toContainText("Nur Aisyah");
  await page.getByRole("link", { name: /Nur Aisyah/ }).click();
  await expect(page).toHaveURL(new RegExp(`/settings/staff/${STAFF.mechanic2}$`));

  const toggle = page.getByRole("switch", { name: permission });
  // Start from "not granted" even if an earlier run left it on.
  if ((await toggle.getAttribute("aria-checked")) === "true") {
    await toggle.click();
    await expect(page.getByText(`${permission} removed`)).toBeVisible();
  }
  await toggle.click();
  await expect(page.getByText(`${permission} granted`)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: permission })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  const mechanic = await browser.newContext({ ...testInfo.project.use });
  const mechanicPage = await mechanic.newPage();
  try {
    await signIn(mechanicPage, "mechanic2", "/settings/profile");
    await expect(mechanicPage.getByRole("list", { name: "Your permissions" })).toContainText(
      permission,
    );
  } finally {
    await mechanic.close();
  }

  // Leave the seed as it was.
  await page.getByRole("switch", { name: permission }).click();
  await expect(page.getByText(`${permission} removed`)).toBeVisible();
});

test("the admin invites a colleague who signs in with the one-time password", async ({
  browser,
  page,
}, testInfo) => {
  const email = `e2e-${testInfo.project.name}-${Date.now()}@bicii.test`;
  await signIn(page, "admin");
  await page.goto("/settings/staff/new");
  await page.getByLabel("Name").fill("Eddie Example");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByRole("status").filter({ hasText: "can now sign in" })).toBeVisible();
  const password = (await page.getByTestId("temporary-password").textContent())?.trim() ?? "";
  expect(password).toMatch(/^[A-Za-z0-9]{5}(-[A-Za-z0-9]{5}){3}$/);

  // Same email again: refused with a field error, nothing half-created.
  await page.getByRole("button", { name: "Invite another" }).click();
  await page.getByLabel("Name").fill("Eddie Again");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByText("An account with that email already exists.").first()).toBeVisible();

  const colleague = await browser.newContext({ ...testInfo.project.use });
  const colleaguePage = await colleague.newPage();
  try {
    await colleaguePage.goto("/login");
    await colleaguePage.getByLabel("Email").fill(email);
    await colleaguePage.getByLabel("Password").fill(password);
    await colleaguePage.getByRole("button", { name: "Sign in" }).click();
    await expect(colleaguePage.getByRole("heading", { level: 1 })).toContainText("Eddie");
    // New staff start with workshop access only.
    const response = await colleaguePage.goto("/settings/staff");
    expect(response?.status()).toBe(403);
  } finally {
    await colleague.close();
  }
});
