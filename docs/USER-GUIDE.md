# User guide

Audience: BICII staff and mechanics using the Admin on a phone in the
workshop or an iPad at the counter. Admins: shop settings, staff and
permissions are in [OPERATIONS.md](OPERATIONS.md#product-administration).

Applies to: `feat/p8-labels` at the end of Phase 8 (not deployed; on a
developer machine at http://localhost:3000; this branch has no purchasing
and signs staff in with a password).

Last walkthrough: not walked through by a person. These flows are exercised
by the E2E specs in `tests/e2e/` (among them `auth`, `workshop`,
`workshop-board`, `inventory`, `inventory-publish`, `scan`,
`appointments`, `appointment-settings`, `today`, `customers-bikes`,
`staff`, `consignment`, `consignment-journey`, `sales`, `print-view` and
`labels`), on an iPhone 13 and an iPad viewport: 146 passed locally on
2026-10-05 at the end of Phase 8; the latest green CI run is
[PR #7 e2e](https://github.com/abhishekcheriangeorge-ops/bicii-book/actions/runs/37276834195/job/111655595521).
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
  - "No part in stock matches. Archived, inactive and customer-owned items
    are not offered." Consigned items are offered, marked "Consigned ·
    <consignor>" (see [Use a consigned item on a job](#use-a-consigned-item-on-a-job)).
  - "This job is completed or closed. Reopen it to change its lines."

### Receive a consigned item

- Before you start: you need **Manage consignments**. Have the agreed
  amount owed to the consignor and the asking price ready.
- Steps:
  - **Consignment** → **Receive item** (or **Receive item** on a
    consignor's page, which fixes the consignor).
  - **Consignor**: search by name, phone or email. Someone new: type the
    name and choose **New consignor "…"**; fill in phone or email and,
    optionally, link their **Customer record** (it fills in the name,
    phone and email). They are created with the item.
  - **One item (bike, frame, wheelset)** or **Several identical**. A bike
    may link a **Shop bike record**; only bikes with no owner that are not
    in stock are offered. If the bike is registered to the consignor,
    first open the bike and **Transfer** it to the shop with a reason such
    as "Consigned by Daniel Ong" (D51).
  - **Name**, **Brand**, **Description**, **Category**; for one item the
    **Serial number** and **Condition** (public once published); for
    several, the **Quantity**; **Kept at**.
  - **Amount owed to the consignor when it sells** (per item; 0 is
    allowed) and the **Asking price** (the public, label and sale price).
    With View costs you see "If it sells at the asking price: yield … ·
    Cult Commons … · BICII keeps …".
  - **Received** (today unless you change it), **Agreement notes**,
    **Internal notes**. Press **Receive item**.
- Success looks like: "C-000123 received" and the item's page, where you
  add **Listing photos** (on the product; public once published) and
  **Agreement photos** (the signed agreement; always internal: "Agreement
  photos show the consignor's terms, so they stay internal.").
- If it fails: "That consignor is archived. Unarchive them first."; "The
  intake date can't be in the future."; "That bike belongs to a customer
  …" (transfer it to the shop first). Change terms later with **Edit
  terms** (a new amount owed needs a reason). Add work on the item with
  **Add charge**: choose **Consignor pays** (deducted from what we owe
  them) or **Shop pays** (added to the cost of the sale, so it lowers
  yield; one item only, before it is on a job or sold). There is no
  default (D4); void a charge with **Void…** and a reason.

### Use a consigned item on a job

- Before you start: the job is open; the consigned item is for sale.
- Steps: **Add part** on the job, search the item's name or U-/P-/C-
  number. Consigned choices show "Consigned · <consignor>" (several
  identical also show the C- number of the consignment they come from:
  the oldest one with stock left; at the location you take it from, the
  part comes from the oldest consignment that has that many there). The
  price is the asking price;
  **Price each** may change it. Press **Add part**.
- Success looks like: "Added … It is on hold for this job." The line shows
  "Consigned · <consignor>", linked to the item. When the job is
  **Completed** the item reads "Sold, awaiting payment" and the consignor
  is owed the agreed amount (D44).
- If it fails: consigned stock never goes below zero: "Only 2 of this
  consigned item at Shop floor. Consigned stock can't go below zero.", and
  "No single consignor has that many of this item at that location. Use
  fewer, or one consignor's stock at a time." To take it back, reopen the job and void
  the line; reopening alone removes what is owed until the job is
  completed again.

### Record a payment to a consignor

- Before you start: you need **Manage consignments**.
- Steps: open the consignor (Consignment → Consignors) → **Record
  payment**. Enter **Amount paid**, **Paid on** (today by default) and the
  **Reference**. Each item with something owed has a row, oldest sale
  first: type an amount per item, or press **Auto-fill**. **Add another
  item** pays an item that is not owed yet. Press **Record payment of
  $x**.
- Success looks like: "Payment of $200.00 recorded for <name>"; **Balance**
  shows Owed, Paid and Outstanding, and the payment appears under
  **Payments** with its allocations. "Settled" means everything owed has
  been paid; "Nothing owed yet" means nothing has sold.
- If it fails: the button stays disabled while the rows show "Unallocated
  $x" or "Over by $x", and while a row pays more than that item is owed
  without an answer to "Why pay more than is owed?". A wrong payment is
  corrected with **Reverse…** and a reason (the whole payment; it stays in
  the list, struck through). A negative balance reads "Overpaid $x
  (consignor owes the shop)": it clears with a later sale, by voiding a
  consignor-paid charge or by reversing a payment, never automatically
  (D46).

### Return an item to its consignor

- Before you start: you need **Manage consignments**; the item is for sale.
- Steps: open the item → **Return to consignor…** → answer "Why is it going
  back?"; for several identical, choose where from (only places holding
  this consignor's stock) and **How many** (all of their stock there by
  default). Press **Return to consignor** (or **Return N to consignor**).
  Another consignor's stock of the same item is never handed over (D54).
- Success looks like: the stock leaves the shop; a single item reads
  **Returned**; a quantity reads "2 of 3 left"; the history shows "1
  returned to consignor" with the reason. Nothing is owed for returned
  stock.
- If it fails: "Return at least one, and no more than the shop still has."
  "There isn't that much stock at that location." means this consignor
  has less there: choose the other location. An item on an open job must come off the job first. A returned bike
  keeps its link to its bike record; transfer the bike back to the
  consignor's customer record on the bike page ([R-020](RISKS.md#r-020--a-bike-record-consigned-once-cannot-be-consigned-again)).

### Record an in-store sale

- Before you start: anyone signed in can sell (D48). The item is in stock
  (a unique item is Available; it is not on a job).
- Steps: **More → Sales → New sale**, or **Sell** on a consignment item, a
  unit or a counted product (it starts with that item). Search the name,
  SKU or U-/P-/C- number under **Add item** and choose a result (each
  shows where it is, how many and the price; consigned ones show
  "Consigned · <consignor>"). The **Price** is the selling price; change
  it if you agreed another. For several, set **Quantity** (up to what is
  there). **Add item** adds more. Choose the **Customer** if they are on
  file (empty is a walk-in). **Sold earlier?** lets you enter when it was
  sold (not in the future, and not before the item came into the shop:
  a consigned item's intake, or the restock of a returned unit; D55).
  Press **Record sale · $x**.
- Success looks like: "S-000123 recorded" and the sale's page: the items,
  the total and who recorded it; the stock is lower, a unique item reads
  Sold ("Sold on S-…" on its page) and a consigned item is owed to its
  consignor. With View costs the sheet previews cost, yield and Cult
  Commons, and the sale page shows them.
- If it fails: "Below the asking price" and "Below cost: this sale loses
  money" are warnings, not blocks (D53). "That item has already been
  sold." outlines the line that went meanwhile: remove it and record the
  rest. "There isn't that much stock at that location." means the count
  changed: lower the quantity. "This item has no selling price. Enter
  one." needs a price. A date in the future is marked on **Sold at**;
  "A sale can't be dated before the item came into the shop." needs a
  later date. "No single consignor has that many of this item at that
  location." means the consigned stock there belongs to several
  consignors: sell fewer, or pick each consignor's line. A sold bike is not
  transferred to the buyer: use **Transfer** on the bike page (D51).

### Refund a sale

- Before you start: only an admin records a refund (D49).
- Steps: open the sale (Sales, or search its S- number) → **Record
  refund**. The **Amount** starts at what is left to refund; change it for
  a partial refund. Press **Record refund of $x…**, answer "Why is it
  being refunded?" and press **Refund $x**.
- Success looks like: "Refund of $x recorded"; the sale reads Partly
  refunded or Refunded and lists the refund with its reason. Nothing goes
  back into stock: if the item came back, restock it (below) (D7).
- If it fails: "That's more than is left to refund on this sale." The
  financial reports still count the sale in full until Phase 9 decides
  how refunds are reported ([R-021](RISKS.md#r-021--reports-overstate-net-sales-after-a-refund-or-restock)).

### Restock an item that came back

- Before you start: you need **Adjust stock**; for a consigned item also
  **Manage consignments** (D46). Only a single item (U- number) sold on a
  sale is restocked; an item sold through a job goes back by reopening the
  job and voiding the line.
- Steps: open the sale (or the unit's page, "Sold on S-…") → **Restock…**
  on the item → choose where it goes back if asked (default: where it was
  sold) → answer why → **Restock**.
- Success looks like: "U-000123 is back in stock"; the line reads
  Restocked and the unit Available again. A consigned item goes back on
  sale for its consignor and is no longer owed to them; money already paid
  for it stays paid (the balance may read Overpaid).
- If it fails: a unit whose bike now belongs to a customer cannot go back
  into stock (D29); a consigned item whose consignor is archived cannot
  either: "That consignor is archived. Unarchive them first." (the same
  applies to reopening a job that used it, D47); a restock never refunds
  money: record a refund too if the customer was paid back.

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
- Consigned stock moves one consignor's stock at a time: the oldest
  consignment with that many at **From** (D54). "No single consignor has
  that many of this item at that location." means move fewer, in two
  transfers.
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
  QR label URL is shown (the shop's public website address + `/q/` + the
  short ID; "QR address not set" until an admin sets that address, and
  then no label can be printed either).
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
  then reload this page." Labels printed against the shop's current public
  address, or against the earlier one the app is configured to accept,
  both scan.

### Print labels and confirm them

- Before you start: any staff member. Open the product (counted by
  quantity), the unit or the bike: **Print label** is in the header and in
  its **Labels** card. A unique product's labels are its units': its Labels
  card links each U- number. A bike tag (B-) is for the workshop; a
  customer who scans it sees "not found".
- Steps: **Print label**. The sheet shows the label exactly as it will
  print. **How many**: type a number, use − and +, or for a product tap 1,
  5, 10, 20 or 50 (one print job is up to 500 labels of a product, or up
  to 10 of a unit or bike; ask for more and the sheet says "Prints 500 now;
  print again for the remaining 120."). **Printer**: a list of the printers,
  each with what it does ("This device's print dialog", "Opens a PDF to
  share or print"); this device's last printer is already chosen. **Label size** appears when an admin has added
  more than one. Press **Print 10 labels**. In the print view with the
  browser printer press **Print**, pick the label printer, paper at the
  label size (58 × 40 mm), scale 100%, no margins. With the PDF printer
  (iPhone and iPad) press **Open PDF**, then Share → Print with the same
  paper and scale. **Print** and **Open PDF** stay at the top while you
  scroll the labels. Then answer "Did all 10 labels print correctly?" ("Did
  the label print correctly?" for one label), just below the title: **Yes,
  all printed**, or **Something went wrong…**, say what went wrong and
  **Mark as failed**.
- Success looks like: "Marked as printed" (or "Marked as failed") and
  links **Back to P-…** and **Print history**. The record's Labels card
  lists its last three prints and **All label jobs**; **Labels** (More)
  lists every print newest first; **To confirm** shows jobs sent but not
  confirmed, **Failed** the failed ones with their reason; search by short
  ID or name. A job's page shows the label exactly as it printed, the
  printer's name and its type (Browser print or PDF download) on separate
  rows.
- Worth knowing: "Not public yet: anyone who scans this label sees 'not
  found' until it is published." means the label works in the shop but not
  for customers until the product is published (**What the public sees**
  in the Labels card jumps to the preview). When the price changed since
  the last printed label, the Labels card says "The price changed since the
  last printed label (… → …). Reprint the labels on the shelf." A price of
  0 prints as $0.00; a product with no price prints no price line.
  Labels show the name, brand, price, condition (units), the bike's size
  and colour or serial number, the SKU and the short ID: never a cost, a
  consignor, an owner or a note. New stock from a purchase order is
  labelled from its product or unit page (the receiving screen has no
  label shortcut yet,
  [R-029](RISKS.md#r-029--the-purchase-receive-screen-has-no-print-n-labels-shortcut-yet)).
- If it fails: a printed or failed job cannot be printed again as it was:
  its print view shows what happened and **Print again**, which opens the
  record's print sheet ("Print again · …", same count and printer) for a
  new job with today's label, linked to the old one ("Reprint of"). After
  printing it, Back returns to where you pressed Print again; it does not
  open the sheet a second time. Print
  label is disabled with the reason when the record is archived ("That
  record is archived. Unarchive it before printing labels."), when the
  shop's public website address is not set (ask an admin), or when there is
  no label template. "This print was already started" means the job exists:
  open the link to its print jobs, or press Print again for a new one. A
  finished job's PDF link answers "This print job is finished. Print again
  from the record to make a new job."

### Set up label printing (admins)

- Before you start: admin. **Settings → Labels and printers**.
- Steps: **QR codes point to** shows the shop's public website address
  every label encodes (a label for P-000123 opens `{address}/q/P-000123`).
  **Change address**, type it (like https://bicii.sg), **Review the
  change**, read what changes and **Change the address**. **Printers**:
  tap a printer to rename it, nudge its **Calibration offset X / Y** in
  0.5 mm steps when labels come out off-centre, switch it off, or **Make
  default**; **Add printer** for another browser-print or PDF printer
  (network and Bluetooth printers need Phase 12). **Label templates**: tap
  one, or **Add template**, to set the size, QR size and margin, QR side,
  which fields print, name lines and text size, watching the preview.
- Success looks like: toasts "QR address saved", "… saved", "… is the
  default printer".
- If it fails: a malformed address shows "Use http:// or https://, a host
  and an optional path, with no ? or # part, under 200 characters." A
  template that does not fit says why under the preview (for example "The
  QR code does not fit: at most 26.0 mm on this label.") and cannot be
  saved. The default printer and default templates cannot be switched off:
  make another the default first. Changing the address does not change
  labels already printed: they keep opening the old address, so keep it
  working (a redirect) ([OPERATIONS.md](OPERATIONS.md#product-administration)).

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
- Money counts jobs completed and in-store sales recorded on the day.
  **Consignment sales** (sales and completed jobs with a consigned item)
  opens that day's sales (the jobs are under Jobs completed);
  **New consignor liability** (also View costs) opens Consignment.
- If it fails: a "Provisional: …" note means cost-pending lines are counted
  at 0. Refunds and restocks are not taken off yet (Phase 9).
- Admins also see **Shopify needs attention** rows under Needs attention:
  an online order or product sync BICII could not finish, with the reason;
  the row opens it in the Shopify queue
  ([Fix a Shopify order](#fix-a-shopify-order-that-needs-attention-admins)).

### Online orders from Shopify

- What happens: a paid Shopify order becomes a sale with source **Online**
  in Sales, at Shopify's prices after discounts (a 3 × $40 line with $20
  off is recorded as 2 × $33.33 and 1 × $33.34), dated when Shopify took
  the order. The stock comes from the online location (the Shop floor), and
  the product's movements show it as **Sold online**. Shopify sending the
  same order twice, or under a new webhook id, still records one sale.
- A refund made in Shopify marks the sale Partly refunded or Refunded, like
  an in-store refund: the stock and the item's status do not change; use
  **Restock…** on the sale if the item came back.
- A Shopify customer becomes a BICII customer only when an admin links
  them; a matching email is never enough.

### Publish a product online

- Who: staff with Manage inventory (everyone else sees the status, and the
  switch says "Needs Manage inventory").
- Steps: open the product → **Online (Shopify)** → switch on **Publish
  online**. The toast says "Published online"; the card then shows
  **Synced**, when, and the **Online quantity** at the online location.
- It needs: the product public (Publication card), a price ($0 counts),
  not archived and not customer-owned. When something is missing the reason
  sits beside the switch, for example "Make the product public first."
- Afterwards every stock, price, name or public-photo change is sent once,
  automatically. **Sync now** sends it again; on a failed sync the card
  shows the reason in red above it.
- Switching it off hides the product in Shopify (draft, quantity 0). A
  product linked to one made in Shopify says "Linked to a product made in
  Shopify: BICII sends price and stock only" and never gets a Buy-online
  link.
- **Shopify details** (folded) shows the Shopify product and variant IDs to
  copy. **Test Shopify** on the card means the app is talking to the
  pretend Shopify used for testing.

### Fix a Shopify order that needs attention (admins)

- Where: Today → **Needs attention** shows a **Shopify needs attention**
  row with the order and the problem in words; it opens **More → Shopify →
  Queue** on that item. The queue's **Needs attention** list has them all.
- Nothing was recorded for the order, so nothing has to be undone.
- An unknown product ("… is not linked to a BICII product"): tap the item →
  **Link to a BICII product** for the line → search the product by name or
  P- number → give a reason → **Link and retry**. The toast says
  "Recorded as S-000123"; later orders for that Shopify variant sell the
  same product. A custom Shopify line has no product to link: record it by
  hand if needed, then dismiss.
- Too little stock, a unit already sold in the shop, or an order taxed on
  top: fix the stock (or record it by hand) and tap **Retry**, or refund
  the order in Shopify and **Dismiss…** it with a reason. Dismissing an
  order also closes refunds of it that are waiting.
- Items under **Waiting** are retried automatically (1 minute, doubling, up
  to 8 tries); **Recent** shows what was done or dismissed in the last 7
  days. **Open event** shows what Shopify sent.

### Link a Shopify customer (admins)

- Steps: **More → Shopify → Events** → open the order → **Customer** →
  **Link to a BICII customer**. Customers with the same email are listed
  first as "Candidate — same email is not proof"; any customer can be
  searched. Give a reason (how you know it is them) → **Link customer**.
- The link applies to later orders. Sales already recorded are not changed;
  the toast says how many earlier online sales show the customer through
  their Shopify ID.

### Shopify settings and events (admins)

- **More → Shopify**: the connection (Live, Test (fake) or Not connected),
  the shop, the API version and the webhook address to give Shopify; the
  online location; the storefront address (used for the Buy online link on
  public item pages); and **Record Shopify test orders as sales**, which
  needs a reason to change and shows a warning while it is on. Setup and
  recovery: [RUNBOOK "Shopify"](RUNBOOK.md#shopify).
- **Events** lists every webhook, searchable by order name or webhook id
  and filterable (Failed, Rejected, Processed, Skipped). A delivery whose
  signature did not match is **Rejected** and keeps no body; nothing was
  recorded from it.

## Roles and limits

Everyone signed in can use customers, bikes, photos, jobs and their lines,
parts from stock, appointments and check-in, in-store sales, Scan, search,
printing labels (and confirming or failing print jobs), and read the
schedule, appointment types, services and locations. Selling prices and
sale totals are visible to all; costs are not.

| You have | What changes for you |
|---|---|
| Admin | Everything below, plus shop hours, closures, booking capacity, appointment types, the Cult Commons rate, **Record refund** on a sale (D49), Settings → **Labels and printers** (the QR address, printers, label templates) and **More → Shopify** (settings, the queue, events, linking variants and customers, D86) |
| View costs | Cost, yield and Cult Commons on jobs, lines, products, units, movements and sales (the sale sheet's preview and "Below cost" warning); Unit cost on manual lines and adjustments; the Cult Commons rate card; consignment money (balances, amounts owed, charges, payments, item history, agreement photos) read-only |
| View financial reports | The Money section on Today (costs inside it also need View costs) |
| Adjust stock | **Adjust stock** on a product; **Restock…** a unit sold on a sale (a consigned one also needs Manage consignments) |
| Manage inventory | New and edited products and units, **Transfer**, publication, **Publish online** and **Sync now**, services, categories and locations; with Adjust stock also **Split off as unique item** |
| Manage staff | Settings → Staff: invite, permissions and deactivation, only within your own permissions ([OPERATIONS.md](OPERATIONS.md#product-administration)) |
| Manage consignments | **Receive item**, **New consignor**, edit and archive consignors, **Show payout details**, **Edit terms**, **Add charge** and **Void…**, **Return to consignor…**, **Record payment** and **Reverse…**; with Adjust stock, **Restock…** a consigned unit; sees consignment money |
| Manage purchasing | Nothing yet on this branch |

Without a permission, its buttons are absent and the figures are not sent
to your screen at all. Opening a page you may not use shows "You can't open
this"; an action you may not take says "You don't have permission to do
that." Ask an admin.

Everyone can open Consignment, its consignors and items, and the asking
prices; who is owed what, payments and agreement photos need Manage
consignments or View costs (D48). Anyone may record an in-store sale and
see its total; its cost, yield and Cult Commons need View costs, and only
an admin records a refund (D48, D49).

Not available yet: **Purchasing** and **Reports** show
"Arrives in Phase 7 (Purchasing)" and "Phase 9 (Reporting)" ([R-018](RISKS.md#r-018--four-sections-are-placeholder-pages)).
There is no reschedule, no customer messaging and no data export. Help:
ask the owner or an admin.
