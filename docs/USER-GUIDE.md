# User guide

Audience: BICII staff and mechanics using the Admin on a phone in the
workshop or an iPad at the counter. Admins: shop settings, staff and
permissions are in [OPERATIONS.md](OPERATIONS.md#product-administration).

Applies to: commit f32dc45 (application code identical to b34bbcd; not
deployed; on a developer machine at http://localhost:3000).

Last walkthrough: not walked through by a person. These flows are exercised
by the E2E specs `tests/e2e/auth.spec.ts`, `workshop.spec.ts`,
`workshop-board.spec.ts`, `inventory.spec.ts`, `inventory-publish.spec.ts`,
`scan.spec.ts`, `appointments.spec.ts`, `appointment-settings.spec.ts`,
`today.spec.ts`, `customers-bikes.spec.ts` and `staff.spec.ts`, on an
iPhone 13 and an iPad viewport: 106 passed locally on 2026-10-05, and
the latest green CI run is [PR #7 e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37276834195/job/111655595521).
Where a step below is not covered by a spec, it says so.

## Your first useful result

1. Open the Admin (on a developer machine: http://localhost:3000). You see
   **Staff sign in**.
2. Enter your **Email** and **Password** and press **Sign in**. On a
   developer machine only, the seeded logins work (listed with their
   password in
   [ENGINEERING.md](ENGINEERING.md#clean-checkout-to-running-application));
   a real shop has its own logins, created by an admin.
3. **Today** opens with a greeting and today's date. On a phone the tabs at
   the bottom are Today, Jobs, Scan, Inventory and More (Customers, Bikes,
   Appointments, Settings and the rest); on an iPad every section is in the
   rail on the left.

If it fails: "That email and password don't match. Try again." (check both;
the message is the same for an unknown email). "Too many attempts. Wait a
minute and try again." "Sign-in is unavailable right now. Try again in a
minute." (the service is down; tell whoever runs the system). A link you
opened before signing in takes you back there afterwards.

Your own details, permissions, password change and **Sign out** are under
Settings → Your profile.

## Routine tasks

### Check a bike in as a new job

- Before you start: the customer's name (or find them by name, phone,
  email, B- number or serial).
- Steps:
  1. **Jobs** → **New job**. The intake has five steps and a review.
  2. Customer: search, or **New customer** (First name, Last name) →
     **Create customer**.
  3. Bike: choose one of theirs, or **Add bike** (Brand, Model) → **Add
     bike**. **Next**.
  4. Work: **Requested work** (required) and **Condition on arrival**.
     **Next**.
  5. People: pick the **Lead mechanic** and any **Additional staff**.
     **Next**.
  6. Services: tap the services to include. **Next**, check the review,
     then **Create job**.
  7. The job opens on **Intake photos**: **Choose photos**, then **Done**.
- Success looks like: the job page with its J- number, the photos, the
  people and the totals; its timeline starts "Checked in as J-…".
- If it fails: an interrupted intake offers "Continue the intake you
  started at …" (**Continue** or **Discard**). "Say what the customer
  wants done." means Requested work is empty. "That bike belongs to someone
  else. Transfer it to this customer first." "That customer is archived.
  Unarchive them before checking in a bike."

### Move a job through its statuses

- Before you start: open the job (Jobs, search, or scan its label).
- Steps: use the large buttons for the usual next step: **Start work**,
  **Diagnose**, **Waiting on parts**, **Pause**, **Resume**, **Complete**,
  **Ready for collection**, then **Collected…** and **Mark collected**
  (Collected is final, so it asks again). Any other allowed move is under
  **Change status**, with an optional **Note**.
  - Reopen a completed job (or one ready for collection): **Change
    status** → **Reopen job…**, answer "Why are you reopening this job?",
    then **Reopen job**. A unique item sold on the job goes back on hold
    for it. (Reopen is not covered by an E2E spec.)
  - Cancel an open job: **Change status** → **Cancel job…**, answer "Why
    is this job being cancelled?", then **Cancel job**.
- Success looks like: a toast "J-…: <new status>" and the status in the
  timeline. A completed job says "Completed jobs are locked. Reopen to
  change lines."
- If it fails: "A job can't move to that status from where it is now."
  "Give a reason for this change." "Void the job's lines before cancelling
  it. Voiding a part returns it to stock." A collected or cancelled job
  cannot change: "This job is collected or cancelled and can no longer
  change."

### Add services, parts and other lines to a job

- Before you start: the job is open (not completed).
- Steps:
  - **Add service**: pick the service, adjust **Unit price** or
    **Quantity** if needed, press **Add service**.
  - **Add part**: search by name, SKU, P- or U- number. Each choice shows
    what is in stock where ("40 at Shop floor · 60 total"). Choose
    **Quantity** and where to **Take from**; **Price each** is optional
    (empty charges the selling price). Press **Add part**.
  - **Add manual line**: **Description**, **Quantity**, **Unit price** and,
    with cost access, **Unit cost** ("Enter 0 when there is no direct cost.
    Left empty, the line is marked cost pending.").
  - To remove a line: **Void…** on its row, give the reason, **Void line**.
    Nothing is deleted; **Show voided** lists them. Voiding a part returns
    it to stock.
- Success looks like: a toast such as "Added 1 × <part>. 39 left at Shop
  floor." (a unique item: "It is on hold for this job."), and the totals
  update.
- If it fails:
  - Taking more than a location holds is allowed but warned: "Only 2 at
    Shop floor. Adding 3 takes the count below zero; ask whoever does stock
    counts to recount." (D23).
  - "This part has no sale price. Enter a price or ask someone to set one."
  - "This part has no cost yet, so its yield cannot be worked out. Ask
    someone with cost access to set it." (staff with cost access see "This
    part has no cost yet, so it can't be added. Set its cost on the product
    first.") A price or cost of 0 is a real value; only a missing one is
    refused.
  - A line marked **Cost pending** counts its cost as 0: "Provisional: 1
    line has no cost entered, so cost, yield and Cult Commons count it at 0.
    Void it and add it again with its cost." The figures stay overstated
    until then ([RISKS R-005](RISKS.md#r-005--cost-pending-lines-overstate-yield-and-cult-commons)).
  - "No part in stock matches. Archived, inactive and consigned items are
    not offered." The database accepts consigned parts since Phase 6 step 1
    (D44), but this sheet does not offer them until the consignment screens
    are built (Phase 6 step 3;
    [R-007](RISKS.md#r-007--consigned-stock-cannot-be-a-job-part-yet)).
  - "This job is completed or closed. Reopen it to change its lines."

### Adjust stock or move it between locations

- Before you start: Adjust stock needs the Adjust stock permission;
  Transfer needs Manage inventory. Open the product (Inventory, search, or
  scan).
- Steps (adjust): **Stock** → **Adjust stock**. Choose the **Location**,
  **Add or remove**, the **Quantity**, the **Type** (Adjustment, or
  Damaged for stock removed) and a **Reason** (or a quick reason such as
  "Opening stock count" or "Stock count correction"). Check "After saving"
  ("Shop floor: 0 → 10") and press **Save adjustment**.
- Steps (transfer): **Stock** → **Transfer**. Choose **From**, **To** and
  **Quantity**, optionally a **Reason**, then **Move stock**.
- Success looks like: "Stock saved. Shop floor: 10", or "Moved 2 to
  <location>"; the movement appears under Recent movements and **All
  movements**, with the reason. (Transfer is not covered by an E2E spec.)
- If it fails: a manual count can never go below zero: "<location> has 3. A
  count can't go below zero by hand; check the number." (Save stays
  disabled). "Give a reason for this stock change." "Choose two different
  locations." "That location is inactive. Choose another or reactivate it."

### Publish a product

- Before you start: Manage inventory. Publishing needs **A name**, **A sale
  price**, **A public photo** and, for a unique item, **An available
  unit**.
- Steps: on the product, **Publication** → **Make internal** (a new
  product starts as Draft). Add a photo with **Choose photos**, open it and
  choose **Public** in the viewer ("Photo is now public"). Then
  **Publish**. **What the public sees** previews the public listing and the
  QR label URL is shown.
- Success looks like: toast "Published" and "Public" in the header.
  **Unpublish** makes it internal again ("Listing is internal only").
- If it fails: Publish stays disabled and the card says what is missing,
  e.g. "Still needed: A public photo." The database refuses with "Add a
  public photo before publishing.", "Set a selling price before
  publishing." or "There is no available unit to publish."

### Scan a label or type a code

- Before you start: the camera works only over HTTPS or on `localhost`.
- Steps: **Scan**. Allow camera access and hold the label inside the
  square, or type the code into **Or type the code on the label** (any
  case) and press **Open**.
- Success looks like: the bike, job, product or unit opens.
- If it fails: "Enter a code like P-000123" (not a code). "No record with
  P-999999" with **Scan again**. A QR code from elsewhere shows "Not a BICII
  label" and is never opened; scanning continues. "The camera only works
  over a secure connection. Open the app over HTTPS (or on localhost)."
  (type the code instead; [RUNBOOK](RUNBOOK.md#the-camera-scanner-on-phones-and-ipads)).
  "Camera access is blocked. On iPhone: Settings → Safari → Camera → Allow,
  then reload this page." Labels cannot be printed yet (Phase 8).

### Book and run an appointment

- Before you start: the shop's hours, capacity and appointment types are set
  by an admin.
- Steps (book): **Appointments** → **Book appointment** (phone: **Book**),
  or a customer's page → Appointments → **Book appointment**. Choose the
  **Customer**, the **Type**, a **Date** (or **Or pick a date**), a free
  **Time**, optionally the **Bike** and an **Internal note**, then
  **Book**.
- Steps (on the day): open the appointment from Appointments or Today.
  - **Arrived** when they arrive ("Marked as arrived"); **Confirm** marks
    a booking confirmed.
  - **Check in**: choose the bike, check **Requested work** (the customer's
    note is filled in), pick the **Lead mechanic**, and under **New or
    existing job** choose **New job** or the bike's open job; press **Check
    in and open job** (or **Check in and link J-…**).
  - **No-show…** → "Mark as a no-show? If they turn up later today, you can
    still reinstate them as arrived." → **Mark no-show**. **Reinstate as
    arrived** undoes it if they turn up.
  - **Cancel appointment…** → "Why is the appointment cancelled?" →
    **Cancel appointment**. The customer is not told automatically.
- Success looks like: "Checked in. J-… opened." and the job linked both
  ways; "Appointment cancelled"; the appointment's History records each
  step and who did it.
- If it fails: "That time has just filled up. Pick another time." (the
  times reload; the rest of the form is kept). "The shop is closed then."
  "Mark a no-show only after the appointment has started." There is no
  reschedule: cancel and book again, and phone the customer
  ([R-017](RISKS.md#r-017--appointments-mvp-has-no-reschedule-and-no-customer-messages)).

### Read Today

- Steps: **Today**. Right now (Received, Waiting, Ready to start, In
  progress, Awaiting collection, Overdue), the day's flow (Checked in,
  Started, Completed, Ready for collection, Collected, Cancelled),
  Appointments (arrivals, still expected, arrived), Stock (parts used, low
  stock, significant adjustments), Needs attention, Activity and the Last 7
  days. Use the day navigator for an earlier day and **Back to today**.
- Money (Gross sales) appears only with View financial reports; Direct
  costs (COGS), Yield, Cult Commons and BICII after Cult Commons also need
  View costs.
- Success looks like: tiles that link to the jobs behind them.
- If it fails: a "Provisional: …" note means cost-pending lines are counted
  at 0. Consignment figures show as not tracked until Phase 6.

## Roles and limits

Everyone signed in can use customers, bikes, photos, jobs and their lines,
parts from stock, appointments and check-in, Scan, search, and read the
schedule, appointment types, services and locations. Selling prices are
visible to all; costs are not.

| You have | What changes for you |
|---|---|
| Admin | Everything below, plus shop hours, closures, booking capacity, appointment types and the Cult Commons rate |
| View costs | Cost, yield and Cult Commons on jobs, lines, products, units and movements; Unit cost on manual lines and adjustments; the Cult Commons rate card |
| View financial reports | The Money section on Today (costs inside it also need View costs) |
| Adjust stock | **Adjust stock** on a product |
| Manage inventory | New and edited products and units, **Transfer**, publication, services, categories and locations; with Adjust stock also **Split off as unique item** |
| Manage staff | Settings → Staff: invite, permissions and deactivation, only within your own permissions ([OPERATIONS.md](OPERATIONS.md#product-administration)) |
| Manage consignments, Manage purchasing | Nothing yet |

Without a permission, its buttons are absent and the figures are not sent
to your screen at all. Opening a page you may not use shows "You can't open
this"; an action you may not take says "You don't have permission to do
that." Ask an admin.

Not available yet: **Consignment**, **Purchasing**, **Labels** and
**Reports** show "Arrives in Phase 6 (Consignment)", "Phase 7
(Purchasing)", "Phase 8 (QR and labels)" and "Phase 9 (Reporting)"
([R-018](RISKS.md#r-018--four-sections-are-placeholder-pages)).
There is no reschedule, no customer messaging and no data export. Help:
ask the owner or an admin.
