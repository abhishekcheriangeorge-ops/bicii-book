import { expect, test } from "@playwright/test";

import { SIGN_IN_MESSAGES } from "../../src/lib/auth/sign-in-errors";
import { STAFF } from "../fixtures/ids";

import { sql, sqlTransaction } from "./db";
import { isPhone, requestCodeOnForm, signIn, signInAs, toast } from "./helpers";

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

    // Their open session ends at once (PLAN D71): deactivation deleted their
    // Auth sessions, and on the devstack (HS256) getClaims asks Auth, so the
    // next navigation lands on the sign-in page. (Hosted asymmetric keys
    // keep the access token valid until it expires; requireStaff's 403
    // covers that window: the next test, and tests/unit/session-guard.)
    await colleaguePage.goto("/settings/staff");
    await expect(colleaguePage).toHaveURL(/\/login\?next=%2Fsettings%2Fstaff$/);
    await expect(colleaguePage.getByRole("heading", { name: "Staff sign in" })).toBeVisible();

    // Auth still emails them a code (it knows nothing about staff) and shows
    // the same "Check your email" screen, but the Admin signs them out
    // straight after the code (PLAN D70).
    const code = await requestCodeOnForm(colleaguePage, email);
    await colleaguePage.getByLabel("Code").fill(code);
    await colleaguePage.getByRole("button", { name: "Sign in" }).click();
    await expect(colleaguePage.getByRole("main").getByRole("alert")).toHaveText(
      SIGN_IN_MESSAGES.not_staff,
    );
    await expect(colleaguePage).toHaveURL(/\/login/);
    await expect(colleaguePage.getByLabel("Email")).toHaveValue(email);
    // No session was kept.
    await colleaguePage.goto("/");
    await expect(colleaguePage).toHaveURL(/\/login$/);
  } finally {
    await colleague.close();
  }
});

test("a deactivated person whose session is still valid gets the 403 page (D71's hosted window)", async ({
  browser,
  page,
}, testInfo) => {
  const email = `e2e-window-${testInfo.project.name}-${Date.now()}@bicii.test`;
  await signIn(page, "admin");
  await page.goto("/settings/staff/new");
  await page.getByLabel("Name").fill("Wendy Window");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `${email} can now sign in.` }),
  ).toBeVisible();

  const colleague = await browser.newContext({ ...testInfo.project.use });
  const colleaguePage = await colleague.newPage();
  try {
    await signInAs(colleaguePage, email);
    await expect(colleaguePage.getByRole("heading", { level: 1 })).toContainText("Wendy");

    // On a hosted project that verifies JWTs locally, deactivation leaves an
    // issued access token valid until it expires (PLAN D71). The devstack
    // asks Auth instead, so recreate that window: deactivate them with the
    // session-revoking trigger held off for this one transaction, so their
    // session stays valid at Auth.
    await sqlTransaction(async (query) => {
      await query("alter table public.staff disable trigger staff_revoke_sessions");
      const updated = await query(
        "update public.staff set active = false where email = $1 returning id",
        [email],
      );
      expect(updated).toHaveLength(1);
      await query("alter table public.staff enable trigger staff_revoke_sessions");
    });
    const sessions = await sql<{ n: number }>(
      "select count(*)::int as n from auth.sessions s join auth.users u on u.id = s.user_id " +
        "where u.email = $1",
      [email],
    );
    expect(sessions[0].n).toBeGreaterThan(0);

    // Today and their own profile need no permission: only the active check
    // in requireStaff refuses them, with the 403 page, not the sign-in page
    // and not their data. (The HTTP status may be 200: once a page has
    // started streaming its shell, forbidden() can no longer change it.)
    for (const path of ["/", "/settings/profile"]) {
      await colleaguePage.goto(path);
      await expect(colleaguePage).toHaveURL(new RegExp(`${path.replace(/\//g, "\\/")}$`));
      await expect(
        colleaguePage.getByRole("heading", { name: "You can't open this" }),
      ).toBeVisible();
      await expect(colleaguePage.getByText("403 · No access")).toBeVisible();
      await expect(colleaguePage.getByRole("heading", { name: /Wendy/ })).toHaveCount(0);
    }
  } finally {
    await colleague.close();
  }
});
