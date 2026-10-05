import { expect, test, type Page } from "@playwright/test";

import { SIGN_IN_MESSAGES } from "../../src/lib/auth/sign-in-errors";
import { STAFF_EMAIL } from "../fixtures/ids";

import { sql } from "./db";
import { mailCursor, waitForCode, waitForMessage } from "./mail";
import { isPhone, requestCodeOnForm, signIn, signInOnForm } from "./helpers";

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

/** The "If … belongs to BICII staff …" paragraph, with the address replaced by {email}. */
async function explanation(page: Page, email: string): Promise<string> {
  const text = await page.getByText(/^If .+ belongs to BICII staff/).textContent();
  return (text ?? "").replace(email, "{email}");
}

const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

test("an unknown email gets exactly the screen a staff email gets, and no account", async ({
  page,
}, testInfo) => {
  const unknown = `e2e-unknown-${testInfo.project.name}-${Date.now()}@bicii.test`;
  await page.goto("/login");
  await requestCodeOnForm(page, STAFF_EMAIL.mechanic2);
  const staffScreen = await explanation(page, STAFF_EMAIL.mechanic2);
  expect(staffScreen).toBe(
    "If {email} belongs to BICII staff, we've emailed a 6-digit code. It expires in 10 minutes.",
  );

  await page.goto("/login");
  const cursor = await mailCursor(unknown);
  await page.getByLabel("Email").fill(unknown);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  expect(await explanation(page, unknown)).toBe(staffScreen);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Code")).toBeFocused();

  // Asking for a code never creates an account, and nothing is emailed.
  expect(await sql("select 1 from auth.users where email = $1", [unknown])).toHaveLength(0);
  await expect(waitForMessage({ to: unknown, after: cursor, timeoutMs: 2000 })).rejects.toThrow(
    /No email/,
  );
});

test("a wrong code is refused with one message and keeps the email; the real code then works", async ({
  page,
}) => {
  const email = STAFF_EMAIL.mechanic1;
  await page.goto("/login");
  const code = await requestCodeOnForm(page, email);
  await page.getByLabel("Code").fill(wrongCode(code));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(SIGN_IN_MESSAGES.invalid_code);
  await expect(page).toHaveURL(/\/login/);
  // The email is kept, the wrong code is not echoed, and focus is back on Code.
  expect(await explanation(page, email)).toContain("If {email} belongs");
  await expect(page.getByLabel("Code")).toHaveValue("");
  await expect(page.getByLabel("Code")).toBeFocused();
  await expect(page.getByLabel("Code")).toHaveAttribute("aria-invalid", "true");

  // Auth 2.178 keeps the code after a wrong attempt (TESTING.md), and a
  // pasted code with a space in it is accepted.
  await page.getByLabel("Code").fill(`${code.slice(0, 3)} ${code.slice(3)}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Marcus");
});

test("an expired code is refused", async ({ page }) => {
  const email = STAFF_EMAIL.mechanic2;
  await page.goto("/login");
  const code = await requestCodeOnForm(page, email);
  // Auth 2.178 times an email code to an existing login from
  // auth.users.recovery_sent_at (not auth.one_time_tokens.created_at;
  // TESTING.md): move it past the 10-minute expiry.
  const aged = await sql(
    "update auth.users set recovery_sent_at = recovery_sent_at - interval '11 minutes' " +
      "where email = $1 returning id",
    [email],
  );
  expect(aged).toHaveLength(1);
  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(SIGN_IN_MESSAGES.invalid_code);
  await expect(page).toHaveURL(/\/login/);
});

test("a used or superseded code is refused", async ({ browser, page }, testInfo) => {
  const email = STAFF_EMAIL.mechanic1;
  await page.goto("/login");
  const used = await requestCodeOnForm(page, email);
  await page.getByLabel("Code").fill(used);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);

  const other = await browser.newContext({ ...testInfo.project.use });
  const otherPage = await other.newPage();
  try {
    await otherPage.goto("/login");
    const fresh = await requestCodeOnForm(otherPage, email);
    expect(fresh).not.toBe(used);
    await otherPage.getByLabel("Code").fill(used);
    await otherPage.getByRole("button", { name: "Sign in" }).click();
    await expect(otherPage.getByRole("main").getByRole("alert")).toHaveText(
      SIGN_IN_MESSAGES.invalid_code,
    );
    await expect(otherPage).toHaveURL(/\/login/);
  } finally {
    await other.close();
  }
});

test("a new code unlocks after the countdown and replaces the old one; the email can be changed", async ({
  page,
}) => {
  const email = STAFF_EMAIL.admin;
  // The page's clock only: the 60 s countdown is fast-forwarded, Auth is not.
  await page.clock.install();
  await page.goto("/login");
  const first = await requestCodeOnForm(page, email);
  const resend = page.getByRole("button", { name: /^Send a new code/ });
  await expect(resend).toBeDisabled();
  await expect(resend).toHaveText(/^Send a new code in [01]:\d\d$/);
  const shown = await resend.textContent();
  await page.clock.fastForward(2000);
  await expect(resend).not.toHaveText(shown ?? "");
  await expect(resend).toBeDisabled();

  // "Use a different email" goes back with the email kept.
  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel("Email")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Check your email" })).toHaveCount(0);

  const second = await requestCodeOnForm(page, email);
  await page.clock.fastForward("01:01");
  await expect(resend).toBeEnabled();
  await expect(resend).toHaveText("Send a new code");
  // Auth sends one email per address per second (max_frequency).
  await page.waitForTimeout(1100);
  const cursor = await mailCursor(email);
  await resend.click();
  await expect(
    page.getByRole("status").filter({ hasText: "We've sent a new code." }),
  ).toBeVisible();
  await expect(resend).toBeDisabled();
  await expect(page.getByLabel("Code")).toBeFocused();
  const third = await waitForCode({ to: email, after: cursor });

  // Only the newest code works.
  for (const old of new Set([first, second].filter((c) => c !== third))) {
    await page.getByLabel("Code").fill(old);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      SIGN_IN_MESSAGES.invalid_code,
    );
  }
  await page.getByLabel("Code").fill(third);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
});

test("a login that is not staff is signed out straight after its code", async ({
  page,
}, testInfo) => {
  // A confirmed Auth login with no staff row (a future customer login, say).
  const { GATEWAY_URL, SERVICE_ROLE_KEY } = await import("../../scripts/devstack/config.mjs");
  const email = `e2e-notstaff-${testInfo.project.name}-${Date.now()}@bicii.test`;
  const admin = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };
  const created = await fetch(`${GATEWAY_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...admin, "Content-Type": "application/json" },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  expect(created.status).toBe(200);
  const { id } = (await created.json()) as { id: string };
  try {
    await page.goto("/login");
    const code = await requestCodeOnForm(page, email);
    await page.getByLabel("Code").fill(code);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(SIGN_IN_MESSAGES.not_staff);
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await expect(page.getByLabel("Email")).toBeFocused();
    // No session was kept.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await fetch(`${GATEWAY_URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
  }
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

for (const next of [
  "https://evil.example/phish",
  "//evil.example/phish",
  "/\\evil.example",
  "/.//evil.example/phish",
]) {
  test(`login ?next=${next} cannot redirect off-site`, async ({ page, baseURL }) => {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await signInOnForm(page, "admin");
    await expect(page).toHaveURL(`${baseURL}/`);
  });
}

// A signed-in visit to /login redirects straight to `next` on the server;
// dot segments must not normalise into a protocol-relative Location.
for (const next of ["/.//evil.example/phish", "/a/..//evil.example", "/%2e//evil.example"]) {
  test(`signed in, GET /login?next=${next} stays on this site`, async ({ page, baseURL }) => {
    await signIn(page, "admin");
    const response = await page.request.get(`/login?next=${next}`, { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    const location = response.headers()["location"] ?? "";
    expect(location.startsWith("//")).toBe(false);
    expect(new URL(location, baseURL).origin).toBe(new URL(baseURL!).origin);
    await page.goto(`/login?next=${next}`);
    await expect(page).toHaveURL(`${baseURL}/`);
  });
}
