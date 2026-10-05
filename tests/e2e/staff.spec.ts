import { expect, test } from "@playwright/test";

import { STAFF } from "../fixtures/ids";

import { isPhone, signIn, signInAs, toast } from "./helpers";

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
    await expect(toast(page, `${permission} removed`)).toBeVisible();
  }
  await toggle.click();
  await expect(toast(page, `${permission} granted`)).toBeVisible();
  if (isPhone(page)) {
    // The toast sits above the tab bar: Scan is still the element under a
    // tap at its centre while the confirmation shows.
    const scan = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Scan" });
    const box = (await scan.boundingBox())!;
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest("a")?.getAttribute("href") ?? null,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(hit).toBe("/scan");
  }
  await page.reload();
  await expect(page.getByRole("switch", { name: permission })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // The grant is in their history, with who made it.
  await expect(
    page.getByRole("list", { name: "Staff history" }).getByRole("listitem").first(),
  ).toContainText(`${permission} granted`);
  await expect(
    page.getByRole("list", { name: "Staff history" }).getByRole("listitem").first(),
  ).toContainText("Asha Admin");

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
  await expect(toast(page, `${permission} removed`)).toBeVisible();
});

test("the admin invites a colleague who signs in with an emailed code", async ({
  browser,
  page,
}, testInfo) => {
  const email = `e2e-${testInfo.project.name}-${Date.now()}@bicii.test`;
  await signIn(page, "admin");
  await page.goto("/settings/staff/new");

  // A rejected submission keeps what was typed, and focus goes to the field to fix.
  await page.getByLabel("Name").fill("Eddie Example");
  await page.getByLabel("Email").fill("eddie-at-bicii");
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Eddie Example");
  await expect(page.getByLabel("Email")).toHaveValue("eddie-at-bicii");
  await expect(page.getByLabel("Email")).toBeFocused();

  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `${email} can now sign in.` }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "They open BICII Admin, enter this email and type the 6-digit code we email them. No password needed.",
    ),
  ).toBeVisible();
  // No credential is shown or handed over (PLAN D10, D11).
  await expect(page.getByRole("button", { name: /copy/i })).toHaveCount(0);
  expect(await page.getByRole("main").textContent()).not.toMatch(/temporary|shown once/i);
  await expect(page.getByRole("link", { name: "Set permissions" })).toBeVisible();

  // Same email again: refused with a field error, nothing half-created.
  await page.getByRole("button", { name: "Invite another" }).click();
  await page.getByLabel("Name").fill("Eddie Again");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByText("An account with that email already exists.").first()).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Eddie Again");
  await expect(page.getByLabel("Email")).toHaveValue(email);

  const colleague = await browser.newContext({ ...testInfo.project.use });
  const colleaguePage = await colleague.newPage();
  try {
    // The colleague signs in with the code emailed to them.
    await signInAs(colleaguePage, email);
    await expect(colleaguePage).toHaveURL(/\/$/);
    await expect(colleaguePage.getByRole("heading", { level: 1 })).toContainText("Eddie");
    // New staff are active staff with no granted permissions: Today opens,
    // Staff settings is a 403.
    const response = await colleaguePage.goto("/settings/staff");
    expect(response?.status()).toBe(403);

    // The admin deactivates them: a reason is required, and it lands in their history.
    await page.goto("/settings/staff");
    await page.getByRole("link", { name: new RegExp(email.replace(/[.+]/g, "\\$&")) }).click();
    await page.getByRole("button", { name: "Deactivate…" }).click();
    const reason = page.getByLabel(/Why are you deactivating/);
    await expect(reason).toBeFocused();
    // A click straight after the confirm step opens is ignored on purpose
    // (double-tap guard); a person needs longer than this to read it anyway.
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Deactivate Eddie Example" }).click();
    await expect(page.getByText("Say why you are deactivating them.")).toBeVisible();
    await reason.fill("E2E: trial shift over");
    await page.getByRole("button", { name: "Deactivate Eddie Example" }).click();
    await expect(toast(page, "Eddie Example deactivated")).toBeVisible();
    const history = page.getByRole("list", { name: "Staff history" });
    await expect(history.getByRole("listitem").first()).toContainText("Deactivated");
    await expect(history.getByRole("listitem").first()).toContainText("E2E: trial shift over");

    // Their open session loses access at once. (/settings/staff has no
    // loading boundary, so the 403 is a real HTTP status.)
    const after = await colleaguePage.goto("/settings/staff");
    expect(after?.status()).toBe(403);
    await colleaguePage.goto("/settings/profile");
    await expect(colleaguePage.getByRole("heading", { name: "You can't open this" })).toBeVisible();
  } finally {
    await colleague.close();
  }
});
