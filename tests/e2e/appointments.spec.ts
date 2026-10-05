import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { formatClock } from "../../src/lib/appointments/format";
import { shiftShopDay, shopToday } from "../../src/lib/dates";
import {
  APPOINTMENT_TYPE,
  BIKE,
  CUSTOMER,
  CUSTOMER_LOGIN,
  SEED_PASSWORD,
  STAFF_EMAIL,
} from "../fixtures/ids";
import { rpc, select, signInApi } from "./api";
import { clearDay, pickTime, readCount, section, signIn, tagFor, toast } from "./helpers";

/**
 * Phase 2 appointments on a phone and an iPad (SPEC §27.3 "Appointment ->
 * arrival -> check-in -> work order"; TESTING.md journey 2; PLAN D36-D40).
 *
 * These tests act on the real clock's shop day (shopToday()), not the
 * seed's anchor: a customer can only book ahead of now. So that a time is
 * free whenever the suite runs, beforeAll (as admin, through the API, every
 * step idempotent for the second project or a retry) sets the online
 * notice to 0 and the capacity to 4, opens today 00:00-24:00 with custom
 * hours under a fixed id, and cancels anything earlier runs left booked
 * (which also keeps Chloe under her three online bookings, D37). afterAll
 * restores the seeded settings and removes the custom hours.
 */

/** The fixed id of today's all-day custom hours (an RFC-valid v4 UUID). */
const ALL_DAY_HOURS = "e4000000-0000-4000-8000-0000000000e2";

let adminToken = "";

const today = () => shopToday();
const dayRange = (day: string) =>
  `starts_at=gte.${encodeURIComponent(`${day}T00:00:00+08:00`)}&starts_at=lt.${encodeURIComponent(
    `${shiftShopDay(day, 1)}T00:00:00+08:00`,
  )}`;

async function openTodayAllDay(token: string) {
  const day = today();
  const existing = await select<{ id: string }>(
    token,
    `closure_overrides?select=id&id=eq.${ALL_DAY_HOURS}`,
  );
  await rpc(token, "save_closure_override", {
    closure_id: ALL_DAY_HOURS,
    is_new: existing.length === 0,
    kind: "custom_hours",
    first_day: day,
    last_day: day,
    reason: "E2E all-day hours",
    from_time: "00:00",
    to_time: "24:00",
  });
}

async function cancelLeftovers(token: string) {
  const leftovers = await select<{ id: string }>(
    token,
    `appointments?select=id&${dayRange(today())}&status=in.(booked,confirmed,arrived)&or=(${encodeURIComponent(
      "customer_note.like.Gears skipping*,internal_note.like.E2E no-show*",
    )})`,
  );
  for (const a of leftovers) {
    await rpc(token, "cancel_appointment", { appointment_id: a.id, reason: "E2E cleanup" });
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  adminToken = await signInApi(STAFF_EMAIL.admin, SEED_PASSWORD);
  await rpc(adminToken, "update_shop_settings", {
    booking_min_notice_minutes: 0,
    intake_capacity_units: 4,
  });
  await openTodayAllDay(adminToken);
  await cancelLeftovers(adminToken);
});

test.afterAll(async () => {
  const token = adminToken || (await signInApi(STAFF_EMAIL.admin, SEED_PASSWORD));
  await rpc(token, "update_shop_settings", {
    booking_min_notice_minutes: 120,
    intake_capacity_units: 2,
  });
  await rpc(token, "delete_closure_override", {
    closure_id: ALL_DAY_HOURS,
    reason: "E2E cleanup",
  });
});

/** The status pill in the appointment's header (the one h1's header). */
function statusPill(page: Page, label: string) {
  return page
    .locator("main header")
    .filter({ has: page.getByRole("heading", { level: 1 }) })
    .getByText(label, { exact: true });
}

test("Journey 2: a customer's booking is arrived, checked in and becomes a linked job", async ({
  page,
}, testInfo) => {
  const tag = tagFor(testInfo);
  const note = `Gears skipping ${tag}`;

  // The customer books online (the public site's job from Phase 11) through the API.
  const chloe = await signInApi(CUSTOMER_LOGIN.chloe.email, SEED_PASSWORD);
  const slots = await rpc<Array<{ slot_start: string; remaining_units: number | null }>>(
    chloe,
    "available_slots",
    { day: today(), appointment_type_id: APPOINTMENT_TYPE.serviceDropOff },
  );
  test.skip(
    slots.length === 0,
    "No bookable time is left today: the last half hour of the Singapore day has no later slot.",
  );
  expect(slots[0].remaining_units).toBeNull(); // customers never see units (D42)
  const id = randomUUID();
  await rpc(chloe, "book_my_appointment", {
    appointment_id: id,
    appointment_type_id: APPOINTMENT_TYPE.serviceDropOff,
    starts_at: slots[0].slot_start,
    bike_id: BIKE.chloeGiant,
    customer_note: note,
  });
  const mine = await rpc<Array<Record<string, unknown>>>(chloe, "my_appointments", {});
  const booked = mine.find((a) => a.id === id);
  // can_cancel depends on the 120-minute cutoff (D37): the first free time is usually inside it.
  expect(booked).toMatchObject({ status: "booked", customer_note: note });
  for (const hidden of ["internal_note", "cancellation_reason", "capacity_units", "source"]) {
    expect(Object.keys(booked!)).not.toContain(hidden);
  }

  // Today shows it among the expected arrivals, named with its time (D41
  // counts by scheduled day and current status; read before, never absolute).
  await signIn(page, "admin", "/");
  const todaySection = section(page, "Appointments");
  const bookedTime = formatClock(slots[0].slot_start);
  const arrival = todaySection
    .getByRole("list", { name: "Arrivals" })
    .locator(`a[href="/appointments/${id}"]`);
  await expect(arrival).toBeVisible();
  await expect(arrival).toHaveAccessibleName(new RegExp(`^${bookedTime}, Chloe Lim, `));
  expect(await readCount(todaySection, "Still expected")).toBeGreaterThanOrEqual(1);
  const arrivedBefore = await readCount(todaySection, "Arrived");

  // Staff see it on today's list and open it by its link (Chloe has another booking today).
  await page.goto(`/appointments?date=${today()}`);
  const row = page.locator(`a[href="/appointments/${id}"]`);
  await expect(row).toContainText("Booked online");
  await expect(row).toContainText("Chloe Lim");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/appointments/${id}$`));
  await expect(statusPill(page, "Booked")).toBeVisible();
  await expect(page.locator("main header").getByText("Booked online")).toBeVisible();

  // Arrived: one tap.
  await page.getByRole("button", { name: "Arrived", exact: true }).click();
  await expect(statusPill(page, "Arrived")).toBeVisible();
  await expect(toast(page, "Marked as arrived")).toBeVisible();

  // Check in: her Giant preselected, the note as requested work, Marcus as lead.
  await page.getByRole("link", { name: "Check in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/appointments/${id}/check-in$`));
  await expect(page.getByRole("radio", { name: /Giant TCR/ })).toBeChecked();
  await expect(page.getByLabel("Requested work")).toHaveValue(note);
  await page
    .getByRole("radiogroup", { name: "Lead mechanic" })
    .getByRole("radio", { name: "Marcus Tan" })
    .click();
  await page.getByRole("button", { name: "Check in and open job" }).click();

  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}(\?intake=photos)?$/);
  const jobId = new URL(page.url()).pathname.split("/").at(-1)!;
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^J-\d{6}$/);
  const jobNumber = (await heading.textContent())!.trim();
  await expect(toast(page, `Checked in. ${jobNumber} opened.`)).toBeVisible();

  // The job's timeline: the check-in and the appointment link.
  await page.goto(`/jobs/${jobId}`);
  const timeline = section(page, "Timeline");
  await expect(timeline.getByText(`Checked in as ${jobNumber}`)).toBeVisible();
  await expect(
    timeline.getByRole("link", {
      name: new RegExp(`^Opened from the appointment on .* ${bookedTime} \\(Service drop-off\\)$`),
    }),
  ).toHaveAttribute("href", `/appointments/${id}`);
  // The job's chip back to its appointment.
  await expect(
    page.getByRole("link", {
      name: new RegExp(`^Booked appointment · .* ${bookedTime} · Service drop-off$`),
    }),
  ).toHaveAttribute("href", `/appointments/${id}`);

  // Today: one more arrival than before (checked in counts as arrived, D41).
  await page.goto("/");
  await expect
    .poll(() => readCount(section(page, "Appointments"), "Arrived"))
    .toBe(arrivedBefore + 1);
  await expect(page.locator(`a[href="/appointments/${id}"]`)).toHaveCount(0);

  // Back on the appointment: checked in, the job linked, the history in words.
  await page.goto(`/appointments/${id}`);
  await expect(statusPill(page, "Checked in")).toBeVisible();
  await expect(section(page, "Job").getByRole("link")).toHaveAttribute("href", `/jobs/${jobId}`);
  const history = section(page, "History");
  await expect(history.getByText("Booked online by the customer")).toBeVisible();
  await expect(history.getByText("Marked as arrived by Asha Admin")).toBeVisible();
  await expect(history.getByText("Checked in by Asha Admin")).toBeVisible();
  await expect(history.getByText(`Job ${jobNumber} opened`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Arrived", exact: true })).toHaveCount(0);
});

test("No-show and late arrival: a no-show is reinstated as arrived on its own day", async ({
  page,
}, testInfo) => {
  const tag = tagFor(testInfo);
  // Now, rounded down to the 30-minute grid (Singapore is UTC+8, so the UTC
  // grid is the local one): staff may book while the slot has not ended (D37).
  const slot = 30 * 60_000;
  const startsAt = new Date(Math.floor(Date.now() / slot) * slot).toISOString();
  const id = randomUUID();
  await rpc(adminToken, "book_appointment", {
    appointment_id: id,
    customer_id: CUSTOMER.daniel,
    appointment_type_id: APPOINTMENT_TYPE.serviceDropOff,
    starts_at: startsAt,
    internal_note: `E2E no-show ${tag}`,
  });
  await rpc(adminToken, "mark_appointment_status", { appointment_id: id, status: "no_show" });

  await signIn(page, "admin", `/appointments/${id}`);
  await expect(page).toHaveURL(new RegExp(`/appointments/${id}$`));
  await expect(statusPill(page, "No-show")).toBeVisible();
  await page.getByRole("button", { name: "Reinstate as arrived" }).click();
  await expect(statusPill(page, "Arrived")).toBeVisible();
  await expect(toast(page, "Reinstated as arrived")).toBeVisible();
  await expect(
    section(page, "History").getByText("Reinstated as arrived by Asha Admin"),
  ).toBeVisible();
  await expect(
    section(page, "History").getByText("Marked as a no-show by Asha Admin"),
  ).toBeVisible();
});

test("Staff book for a customer and capacity closes the slot", async ({ page }, testInfo) => {
  const tag = tagFor(testInfo);
  const note = `E2E capacity ${tag}`;
  // A clear future Tuesday (10:00-19:00, no override), 7 days later on the iPad.
  const day = clearDay(testInfo, shiftShopDay(today(), 21), 2);
  const ours = async () =>
    select<{ id: string }>(
      adminToken,
      `appointments?select=id&${dayRange(day)}&status=in.(booked,confirmed,arrived)&internal_note=like.${encodeURIComponent("E2E capacity*")}`,
    );
  // D2: one pool of 2 per 30-minute window for this test (beforeAll set 4).
  await rpc(adminToken, "update_shop_settings", { intake_capacity_units: 2 });
  try {
    for (const a of await ours()) {
      await rpc(adminToken, "cancel_appointment", { appointment_id: a.id, reason: "E2E cleanup" });
    }

    await signIn(page, "mechanic2", `/customers/${CUSTOMER.tan}`);
    const booked: string[] = [];
    for (const customer of [CUSTOMER.tan, CUSTOMER.priya]) {
      await page.goto(`/customers/${customer}`);
      const name = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
      await section(page, "Appointments").getByRole("button", { name: "Book appointment" }).click();
      const sheet = page.getByRole("dialog", { name: "Book appointment" });
      await expect(sheet.getByText(name, { exact: true })).toBeVisible(); // preset and locked
      await expect(sheet.getByRole("combobox")).toHaveCount(0);
      await sheet.getByRole("radio", { name: /^Service drop-off/ }).check();
      await sheet.getByLabel("Or pick a date").fill(day);
      await pickTime(sheet, "11:00");
      await sheet.getByLabel("Internal note").fill(note);
      await sheet.getByRole("button", { name: "Book", exact: true }).click();
      await expect(page).toHaveURL(/\/appointments\/[0-9a-f-]{36}$/);
      booked.push(new URL(page.url()).pathname.split("/").at(-1)!);
    }

    // The window holds 2 of 2: 11:00 is no longer offered, 11:30 still is.
    await page.goto(`/customers/${CUSTOMER.daniel}`);
    await section(page, "Appointments").getByRole("button", { name: "Book appointment" }).click();
    let sheet = page.getByRole("dialog", { name: "Book appointment" });
    await sheet.getByRole("radio", { name: /^Service drop-off/ }).check();
    await sheet.getByLabel("Or pick a date").fill(day);
    await expect(sheet.getByRole("radio", { name: /^11:30/ })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: /^11:00/ })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();

    // Cancel both with a reason (two steps): the place frees up again.
    for (const id of booked) {
      await page.goto(`/appointments/${id}`);
      await page.getByRole("button", { name: "Cancel appointment…" }).click();
      await page.getByLabel("Why is the appointment cancelled?").fill(`Customer rang ${tag}`);
      await page.waitForTimeout(500); // the confirm button ignores presses for 400 ms
      await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
      await expect(toast(page, "Appointment cancelled")).toBeVisible();
    }
    await page.goto(`/customers/${CUSTOMER.daniel}`);
    await section(page, "Appointments").getByRole("button", { name: "Book appointment" }).click();
    sheet = page.getByRole("dialog", { name: "Book appointment" });
    await sheet.getByRole("radio", { name: /^Service drop-off/ }).check();
    await sheet.getByLabel("Or pick a date").fill(day);
    await expect(sheet.getByRole("radio", { name: /^11:00/ })).toBeVisible();
  } finally {
    for (const a of await ours()) {
      await rpc(adminToken, "cancel_appointment", { appointment_id: a.id, reason: "E2E cleanup" });
    }
    await rpc(adminToken, "update_shop_settings", { intake_capacity_units: 4 });
  }
});
