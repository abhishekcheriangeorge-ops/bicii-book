# BICII Admin — Design tokens and primitives

The Admin has to look like it belongs to BICII. Its tokens start from the
public site's `src/app/globals.css` (palette, dust ramp, Archivo + Inter,
spring easings, two-tone focus ring, `.gutter` / `.eyebrow` / `.measure`)
and add an operational layer the public site does not need. Everything lives
in [`src/app/globals.css`](../src/app/globals.css) as Tailwind 4 `@theme`
tokens, so each one is also a utility class (`bg-waiting`, `text-dense`,
`min-h-tap`).

To see them: `npm run dev`, open `/dev/ui` (development only; it 404s in
production builds).

## Brand layer (ported verbatim)

| Token | Value | Use |
|---|---|---|
| `ink` | `#050707` | Text, borders, solid buttons |
| `paper` | `#fbfaf7` | Page background, `themeColor` |
| `red` `yellow` `sky` `indigo` `green` | wordmark accents | Fills only, except indigo (10.37:1 on paper) |
| `dust-100…700` | warm neutral ramp | `dust-500` = secondary text (4.95:1 paper, 4.54:1 dust-100); `dust-300` only on ink |
| `font-display` / `font-sans` | Archivo / Inter (next/font, variable) | Uppercase Archivo for labels and buttons |
| `ease-spring` `ease-soft` `ease-pop` `ease-glide` | spring curves | Press-compress, sheets, toasts |

## Operational layer (Admin only)

**Surfaces**, back to front: `paper` (page) → `sunken` (= dust-100: wells,
table headers) → `card` (white, with a `hairline` = dust-200 border).

**Status** maps onto the five accents. Each status has four tokens:

| Status | Accent | Solid fill + text | Ratio | Soft fill + text | Ratio |
|---|---|---|---|---|---|
| `waiting` | yellow | `bg-waiting text-waiting-fg` (ink) | 12.16:1 | `bg-waiting-soft text-waiting-deep` | 5.62:1 |
| `progress` | sky | `bg-progress text-progress-fg` (ink) | 8.00:1 | `bg-progress-soft text-progress-deep` | 5.77:1 |
| `done` | green | `bg-done text-done-fg` (ink) | 6.42:1 | `bg-done-soft text-done-deep` | 5.38:1 |
| `danger` | red | `bg-danger text-danger-fg` (paper) | 4.71:1 | `bg-danger-soft text-danger-deep` | 5.67:1 |
| `info` | indigo | `bg-info text-info-fg` (paper) | 10.37:1 | `bg-info-soft text-info-deep` | 8.53:1 |

Never put ink text on red (4.11:1). The `-deep` steps also pass as text on
paper (6.1–6.8:1), so `text-danger-deep` is the error-message colour. Domain
code maps its enums onto these five (e.g. `waiting_parts` → waiting,
`ready` → done, overdue → danger) and always shows the text label with the
colour.

**Density**: `text-dense` is 13px on a 20px line, for tables and line items;
pair money and quantity columns with `tabular-nums`. Inputs stay at 16px so
iOS does not zoom on focus.

**Tap targets**: `--spacing-tap` is 44px (`min-h-tap`, `size-tap`). Every
interactive primitive meets it; buttons are 48px by default as on the public
site.

All ratios come from `npm run tokens:contrast` (`scripts/contrast.mjs`), which
fails if a documented text pair drops under 4.5:1 or a UI pair under 3:1.
Change a colour → rerun → update the comments in `globals.css` and this table.

## Primitives (`src/components/ui/`)

Server components unless they need state or browser APIs.

| Component | Notes |
|---|---|
| `Button`, `ButtonLink`, `SubmitButton` | solid / outline / accent / ghost / danger; sm / md / lg; `pending` sets aria-busy, disables, shows a spinner; press-compress. `SubmitButton` (client) reads `useFormStatus`. |
| `IconButton` | `aria-label` is required by type. |
| `Field` (client) | Label, hint, error, required marker. Provides context so the control inside gets `id`, `aria-describedby` (error, hint), `aria-invalid`, `required`. |
| `Input`, `Textarea`, `NumberInput` (client) | `NumberInput` is `type="text"` + `inputMode` (decimal for money, numeric for a whole-number quantity); values stay strings — parse with `lib/money`. Optional −/+ steppers. A quantity with `decimals` (job lines and intake services take 2, for 1.5 hours of labour) gets the decimal keypad, and its steppers add or take 1 in decimal arithmetic, keeping the fraction. |
| `Checkbox`, `Switch` (client) | Checkbox is native and styled; Switch is `role="switch"` for settings that apply immediately. |
| `Sheet` (client) | Modal dialog: bottom sheet on phones, right panel at `md`+. Inerts the rest of the page, traps Tab, Escape closes, focus returns to the opener. `dismissible={false}` while a commit is pending. Without a footer the body pads for the iPhone home indicator. While open it moves toasts above its footer (`--toast-inset-bottom`). |
| `ToastProvider`, `useToast` (client) | Polite live region for confirmations, `role="alert"` for errors (errors persist until dismissed). Mounted in the root layout. On phones it sits above the tab bar (never over Scan); an open Sheet lifts it above its Save/Cancel row. Optional `action` (`{ label, onAction }`, e.g. "Retry" on a failed upload) adds one button that runs it and dismisses the toast; toasts with an action stay until dismissed and are never pushed out (at most four show; a new toast pushes out the oldest plain one). Optional `key`: a toast with the same key replaces the one on screen in place (one "3 photos not saved" per record, not one per photo); `dismiss` takes the id or the key. The provider outlives navigation, so a Retry still works after the screen that failed was left. |
| `Badge`, `StatusPill` | Tone = the status tokens; pills always carry text. |
| `Card`, `EmptyState`, `Skeleton`, `Spinner`, `PageHeader` | Layout and feedback. `Card` never clips (no `overflow-hidden`), so pickers, menus and focus rings inside it can extend past its edge; flush content rounds its own corners. Its header wraps: an action too wide to sit beside the title (a half-width card on iPad) moves under it rather than squeezing it, and several actions wrap among themselves (a job's Add service, Add part, Add manual line on a phone). |
| `RowList`, `RowLink` | Edge-to-edge list of tappable rows (More, Settings, Staff; later jobs, products, customers). Rows use the inset focus ring and round their own first/last corners; the list does not clip. |
| `SearchPicker` (client) | ARIA 1.2 combobox + listbox; async `search(query)` (may be a Server Action), debounce, stale-response guard, ↑/↓/Enter/Escape, hidden input for forms. `action` adds a last option ("Create new customer") reached with the arrows and Enter like any result. Optional pickers (`clearable`, default `!required`) can go back to nothing: a 44px clear button, emptying the field and leaving it, or Escape on an empty field; `onSelect(null)` reports it. Inside a `Sheet` (`InSheetBodyContext`, `src/components/ui/sheet-context.ts`) the results take space in the flow and are scrolled into view, because the sheet body clips an absolute popup behind its footer when the sheet is short (Add part on a phone); elsewhere they float under the input. SPEC §22: use it instead of any large `<select>`. |
| `Chip`, `ChipRadioGroup` (client) | A 48px choice chip: a toggle button (`aria-pressed`) for several choices. `ChipRadioGroup` for one choice (the intake's lead, Assign's who, the board's mechanic filter): a radio group with one Tab stop (the chosen chip, or the first) and Arrow / Home / End moving and choosing, like `SegmentedControl`. |
| `Select` (client) | A native select styled like `Input`, wired by `Field`. Only for short fixed lists (fewer than 15 options: a service's category); anything that grows uses `SearchPicker`. |
| `SegmentedControl`, `Tabs` (client) | Radiogroup and tablist with roving tabindex and arrow keys. A segment can be `disabled` (`aria-disabled`, skipped by the arrow keys, ignores clicks, muted text and a not-allowed cursor); say why next to the control (photo visibility: never public on a customer record, or for an undecoded original). Each state has its own class branch: `cn()` does not resolve conflicting utilities. |

Class strings are joined with `cn()` (`src/lib/cn.ts`), which does not merge
conflicting utilities; prefer a variant prop over overriding colours with
`className`.

## Focus

The global ring (`:focus-visible`: 3px indigo outline, 3px offset, paper
halo) is drawn outside the element. Anything full-bleed inside a clipping
or edge-to-edge container uses the **inset** variant, the `focus-inset`
utility (`globals.css`): the same two tones drawn inside the element, so no
ancestor's `overflow` can cut it. Used by `RowLink`, `Tabs` and
`SegmentedControl` (both scroll horizontally, which clips vertically too).
Never add `overflow-hidden` to a container of focusable rows to get rounded
corners; round the first and last rows instead.

## Forms

The pattern every Server Action form follows (`staffAction` +
`useActionState`, `src/lib/actions.ts`):

- React resets uncontrolled fields after every form action, success or
  not. A failed action returns `values` (the submitted text fields, never
  passwords or other secrets, `src/lib/form-data.ts`); render them back as
  `defaultValue={values?.field ?? ""}` so nothing typed is lost. Passwords
  are re-entered.
- Errors: `error` above the form (`role="alert"`), `fieldErrors` on each
  `Field`. `useFocusFirstInvalid(state)` (ref on the `<form>`) moves focus to
  the first invalid control after a failed submit.
- Controls that apply immediately (switches) use the action directly with
  `useOptimistic` and a toast, not a form.
- Create/edit forms live in a `Sheet` whose body is mounted only while it
  is open (`CustomerSheet`, `BikeSheet`), so every opening starts clean.
  The submit button sits in the sheet footer, outside the `<form>`, and
  points at it with `form={formId}`; it takes `pending` from
  `useActionState`. The action wrapper passed to `useActionState` handles
  success (toast, close or `router.push` to the new record).
- A form that creates a record carries its own id (`newId()`,
  `src/lib/uuid.ts`, made when the sheet opens) as the idempotency key: a
  repeated submit finds the row it already created (the domain treats the
  primary-key conflict as success) instead of making a second customer or
  bike. `newId()` falls back from `crypto.randomUUID()` (secure contexts
  only) to `getRandomValues()` for an iPad on a plain-http LAN address.
- A form that appends a permanent record (a timeline note, a Cult Commons
  rate) carries a `newId()` key the same way, and the RPC replays on it, so
  a retry after a lost response never writes the record twice.
- An edit sheet over text other people also edit (a job's details) sends
  only the fields its user changed; the RPC keeps the rest (null keeps), so
  a colleague's newer text is not overwritten with this page's older copy.
- One-tap buttons that stay in place while what they do changes (a job's
  status buttons, whose first slot is the next step) are disabled for
  400 ms after each change (`useArmedAfter` in `src/components/ui/use-armed.ts`),
  so the second tap of a double tap cannot take the button the first one
  revealed. A final step (marking a job collected) is never one tap.
- Destructive or commit steps (deactivate staff; later stock, payment and
  settlement reversals) are two steps: the first button opens a confirm
  block that asks for the reason (SPEC §22), puts focus in the reason field,
  places the confirm button in a different position with a different React
  `key` (so the first button's DOM node and focus are not reused), and
  ignores clicks for 400 ms after opening (a double tap). See
  `AccessControl` in `settings/staff/[staffId]/staff-controls.tsx`, and
  "Delete photo" in the photo viewer.
- A confirmation without a reason field (archive a customer or bike,
  `ArchiveControl`) puts focus on Cancel and keeps its confirm button
  *disabled* for 400 ms rather than silently ignoring an early press, so
  a double tap cannot confirm and nothing seems to swallow a click.
  Archiving is reversible (Unarchive is one press) and deletes nothing.

## Loading

- Sections whose pages need nothing beyond `requireStaff()` have a
  `loading.tsx` rendering `RouteLoading` (skeletons in an `aria-busy`
  region): it is prefetched, so a tap shows the new screen's skeleton at
  once.
- A loading boundary makes the response stream, which commits it to HTTP
  200 before the page runs (Next docs, `loading.js` "Status Codes"): a page
  under it that calls `forbidden()` or `notFound()` shows the right UI with
  a 200. So permission-gated subtrees (`/settings/staff`, later `/reports`)
  have none, nor do the group root (`/`) and `/settings` (whose subtree
  includes `/settings/staff`), keeping their real 403s.
- Every nav link (tab bar, rail) marks its icon while its navigation is
  pending (`LinkPending`, `useLinkStatus`), which also covers the sections
  without a `loading.tsx`.
- `/q/[shortId]` has no `loading.tsx` on purpose: its job is a server
  `redirect()`, which must happen before anything streams.
- Record pages (`/customers/[id]`, `/bikes/[id]`) have their own
  `loading.tsx`, so opening a row shows the record skeleton at once. An
  unknown or malformed id renders the not-found screen (with a 200 status,
  as above).
- Search-as-you-type changes only `?q=`: the page segment keeps its React
  state (Next keys segments without search params), so the field keeps
  focus and caret, the old results stay until the new ones arrive (the
  navigation is a transition), and the field shows a spinner meanwhile.

## App shell (`src/components/shell/`)

| Piece | Notes |
|---|---|
| `TabBar` (client) | Phones (< md): fixed bottom bar, Today · Jobs · **Scan** · Inventory · More. Scan is a raised 64px yellow disc. Pads for `env(safe-area-inset-bottom)`; pages pad their bottom to clear it. |
| `SideRail` (client) | md and up: sticky labelled rail with the mark, the four primary sections (Scan in yellow) and every More destination. |
| `AppHeader` | Sticky; mark (phones only), `HeaderSearch`, and `ProfileChip` (initials → `/settings/profile`) streamed in `<Suspense>`. Clears `env(safe-area-inset-top)`. |
| `HeaderSearch` (client) | The global search field ("Search customers, bikes, jobs and stock"): a `next/form` GET form to `/search?q=` (works before hydration), remembered in recent searches on submit; a query that is exactly a short ID in any case ("p-000123") opens the record straight away through `/q/{id}` instead (`shortIdJump`, `src/lib/search.ts`; still remembered); `/` focuses it from anywhere on a keyboard. On `/search` it steps aside for the page's own field. |
| `nav.ts` | Single source for tabs, More items and active-state matching. |
| `ComingSoon` | `PageHeader` + `EmptyState` naming the phase that builds a section. |
| `StatusScreen` | 401/403/404/500 pages. |
| `ServiceWorkerRegistration` | Registers `public/sw.js` in production builds only. |

## Domain components (`src/components/domain/`)

Built from the primitives for one kind of record or job; Client Components
unless noted. They call Server Actions, never Supabase (except the photo
upload itself, below).

| Component | Notes |
|---|---|
| `SearchField` | Search box whose query lives in the URL (`?q=`, `src/lib/search-params.ts`): typing updates it after 300 ms with `router.replace` in a transition, Enter at once; other params (`archived`) are kept; back/forward and links update the field, but its own search arriving late never overwrites what was typed since (it remembers what it sent). A search still waiting for the pause is dropped when a link is clicked or the field unmounts, so it cannot pull staff back to the list. Pages render results on the server; lists say "First 30 matches" and how to narrow it when there are more. Used by `/customers`, `/bikes`, `/search`. |
| `ArchivedFilter` (server) | Active / Archived links for a list page, keeping `?q=`. The Archived list searches with `staff_search(…, archived => true)`, so a query matches exactly as on the active list. |
| `ShortId` (server) | A human short ID in monospace, never wrapped; `large` is the identity header of a record (the number on the bike's label). `ShortIdLink` links the chip with a 44px (`--spacing-tap`) hit area from a transparent `::before` overlay, so a standalone chip link (job part lines, stock movements) meets the tap floor without changing the row. |
| `CustomerSheet`, `NewCustomerButton`, `EditCustomerButton` | New/edit customer. Creating opens the new customer's page. |
| `BikeSheet`, `NewBikeButton`, `EditBikeButton` | New/edit bike. A new bike's owner is preset (from a customer's page), picked (`CustomerPicker`), or none (shop and consigned bikes). The edit form has no owner: ownership changes only by transfer. Creating opens the bike, ready for photos. |
| `TransferOwnershipButton` | Sheet: new owner (a customer via `CustomerPicker`, or the shop) and a required reason, kept in the bike's ownership history. The current owner is listed but not choosable. |
| `CustomerPicker` | `SearchPicker` over active customers (`staff_search`), via a Server Action. |
| `ArchiveControl` | Archive (confirmed) / unarchive a customer, bike, service or product (refused while public or holding stock), with what archiving does in a sentence. |
| `CaptureButton` | The camera control for every photo (intake reuses it): "Take photo" (`<input type=file accept="image/*" capture="environment">`, opens the rear camera on phones) and "Choose photos" (library, several at once). Each file is decoded with its EXIF orientation (`createImageBitmap(…, { imageOrientation: "from-image" })`, `<img>` fallback), scaled to at most 2048 px on the long edge and re-encoded as JPEG 0.85 (`prepare-photo.ts`, sizing in `src/lib/images.ts`); re-encoding also drops EXIF, GPS included. A file the browser cannot decode (HEIC outside Safari) is uploaded as is when it is an accepted photo type. Then: a signed upload URL from the server, upload with the browser Supabase client straight to Storage with byte progress, record. Optimistic thumbnails with status and progress; up to two photos in flight. The queue lives above the pages (`PhotoUploadsProvider` in the staff layout, `upload-store.ts`), so uploads finish after leaving the record and their tiles are there again on coming back. A failure keeps the photo and its preview on its tile (Retry, Discard); one error toast per record ("3 photos not saved", Retry all) updates in place and is never pushed out; the header shows "N photos not saved" on every screen, linking to the record; closing or reloading the tab while any photo is unsaved asks first. Retry resumes at the failed step: once the object is in Storage only recording is retried (unless the server says it is missing). Photos are labelled "New photo 3", not by file name (iPhone captures are all image.jpg). A file Storage refuses (type, size) is not retried and says to save it as JPEG. The page refreshes once when a record's queue drains, not once per photo (each refresh re-signs every photo). A photo picked before hydration is picked up when React attaches. An undecodable original keeps its metadata, so it is recorded without dimensions and can never be made public. |
| `PhotoGrid` | A record's photos: thumbnails (visibility badge when not internal) that open `PhotoViewer`, with `CaptureButton` under them (hidden for archived records). |
| `ReasonConfirm` | The two-step destructive pattern with a required reason (below, "Forms"), shared by voiding a line and cancelling or reopening a job: focus in the reason field, the confirm button in a new position with a new key, presses ignored for 400 ms, and a dismiss button that returns focus to the first button. The dismiss button says what it keeps where "Cancel" would be ambiguous: "Keep job" beside "Cancel job", "Keep line" beside "Void line", "Back" for a reopen. `onConfirmingChange` lets a sheet hide its own submit while the confirmation is open. |
| `IntakeWizard` | `/jobs/new` (SPEC §7.1): one step at a time with "Step 2 of 5" and a progress bar, Back/Next as 48px buttons kept above the tab bar, Enter advancing on a keyboard (not in a textarea, a picker or a sheet). Customer (one `SearchPicker` over customers and bikes; a bike selects its owner; "New customer" opens `CustomerSheet` with `onCreated`), Bike (the customer's active bikes as large cards with an "Open job J-…" chip; "Add bike" opens `BikeSheet` with the owner preset and `onCreated`), Work (requested work, condition on arrival), People (lead as single-select chips, "Me" first, Unassigned allowed; additional staff as toggles; active staff only, D22), Services (chips by category, a filter above 12, −/+ quantity, a preview subtotal and, only with view_costs, a Cult Commons preview), then Review with Edit per section. It owns the job's and each service line's `newId()` key, so a double tap or retry makes one job. Draft: `src/lib/intake-draft.ts`, one per device under `bicii.intake-draft.v1` (ids, labels, typed text; guarded like recent searches), offered back as "Continue the intake you started at 10:42?" / Discard, cleared on success; Continue drops services no longer offered and staff no longer active (they could not be seen or removed, and the job would be refused every time) and says what it removed. A bike whose owner is archived is "Owned by … (archived)", never a shop bike: choosing it says to unarchive the owner or transfer the bike. If the bikes cannot be loaded, an error with "Try again" replaces the skeleton. The progress bar has one segment per counted step, full at "Step 5 of 5". Rendered only in the browser (the draft is in localStorage). |
| `JobStatusActions` | The usual next steps (`primaryActions`) as large buttons with a toast, disabled for 400 ms after every status change (the next step's button lands under the finger). "Collected…" is final (D15), so it opens a confirmation naming the job and the customer, focus on Back, "Mark collected" disabled for 400 ms. "Change status": a sheet listing the other allowed moves (`allowedTransitions`) with nothing pre-selected, an optional note and, when Collected is picked, that it is final; plus Reopen and Cancel as `ReasonConfirm` (D15, D16), during which the sheet's own submit is hidden. Nothing for a collected or cancelled job. |
| `LineTable` | A job's lines, dense (`text-dense`, `tabular-nums`): description, qty, unit price, total, and with view_costs unit cost, yield and Cult Commons per line. Its layout follows its own width (container queries: 28rem without costs, 42rem with), not the screen's, since the lines card is narrow on an iPad; narrower, each line is a stacked row. Voided lines stay, struck through with who, when and why, behind "Show voided". Each live line of an open job has `VoidLineControl`. A manual line added without a cost shows a "Cost pending" badge to everyone (D14), and "—" as its unit cost. |
| `VoidLineControl` | "Void…" on a line: `ReasonConfirm` calling `voidLine`. |
| `AddServiceButton` / `AddServiceSheet` | `SearchPicker` over active services (price and category shown), quantity with steppers, the price prefilled and editable by anyone (D14), the cost field only with view_costs, a live line-total preview; the sheet's `newId()` line key makes a repeat submit add one line. Disabled with "Completed jobs are locked. Reopen to change lines." once the job is completed. |
| `ManualLineButton` / `ManualLineSheet` | Description, quantity, unit price and (view_costs only) cost, with the same preview, key and lock. Left without a cost, the line is marked cost pending (D14); the sheet says so (to view_costs holders: "Enter 0 when there is no direct cost"). |
| `TotalsSummary` (server) — the job yield panel | The compact summary row under the lines (SPEC §22, not a modal): the running sale total for everyone; with view_costs also Cost, Yield, Cult Commons (with the rate when every line shares it) and BICII yield after Cult Commons, from `work_order_totals_staff`, marked "Provisional" while a live line has no cost entered (D14), with what to do about it. It is PLAN Phase 5's job yield panel (no second economics block): for view_costs holders the job page also reads `work_order_yield` (`getWorkOrderYield`, in its `Promise.all`) and passes it as `report`, which labels Cult Commons with the lines' snapshot rates ("30%", or "25–30%" when they differ, `formatRateRange`), adds the loss note shared with Today ("1 line sold at a loss: −$15.00. Losses don't reduce Cult Commons on other lines.", D1) and says when the job counts in reports: "Counted in reports on Sat, 3 Oct 2026 (completed)" from its current completion (D32), "Counted in reports once the job is completed" while open or after a reopen, or "Not counted in reports (cancelled)" on a cancelled job (final, D15; never recognised, D32). Without view_costs: the sale total only, and no recognition text anywhere on the page. |
| `Timeline` (server, `job-timeline.tsx`) | A job's events newest first: `describeEvent` titles (`src/lib/workshop-timeline.ts`), notes and reasons quoted, the actor ("Recorded outside the app" when none) and the time. Payloads carry no costs. The page shows the newest 200 (`?events=all`: 1,000); when older ones exist it says so ("Earlier ones, including the check-in, are not shown") with "Show earlier events". |
| `PhotoViewer` | Sheet: the photo enlarged (tap for full size), who can see it (`SegmentedControl` Internal / Customer / Public, applied immediately with `useOptimistic` and a toast; each level explained; Public disabled on a customer record, PLAN D13, and on a job, D19), caption, and delete with a reason (two steps; Cancel returns focus to "Delete photo…"). A change that went through but could not remove the old copy from Storage is reported as done, with "Finish" (toast and inline), not as a failure; the next showing of the record finishes it anyway. |
| `LinkSegments`, `GroupChips`, `ActiveFilterChips`, `JobRow` (server, `workshop-board.tsx`) | The board's pieces as links, so every view is a URL and works before hydration: the All / My jobs / Unassigned switch (styled like `SegmentedControl`, `aria-current` on the current one); the groups as a horizontally scrolling chip row with counts ("All open" first; wraps from `sm`); the active filters as removable chips (`Remove filter: …`) and "Clear"; and the job row (whole row tappable, ≥ 64px): J- number, `StatusPill` (text + tone), bike, customer, lead or "Unassigned" (waiting tone), age ("3 d") and, for D20, a solid danger "Overdue" badge with its word. No money on the board. |
| `BoardFiltersButton` / `BoardFilterSheet` | "Filters (n)": a Sheet with statuses as checkboxes under their board group (several at once, e.g. only "Waiting on parts", which the Waiting group otherwise merges with the customer and paused), mechanic chips ("Anyone" first; jobs they are on as lead or additional), customer and bike `SearchPicker`s (the intake search action), checked in (Any, Today, Last 7 days, Last 30 days; Singapore time) and age (Any, Over 3 days, Overdue). "Show jobs" writes them to the URL (`boardQuery`); Reset clears the sheet. |
| `AssignmentsCard` | The job's "People": the lead and "Also on the job", each with Remove (toast "… removed from the job"), and "Assign": a Sheet with active staff as radio chips (their current role noted) and Lead / Additional; choosing Lead says "Replaces <lead> as lead; they leave the job." (D22), moving the lead to Additional says the job will have no lead. Read-only on collected and cancelled jobs. |
| `ApprovalSwitch` | "Customer approved extra work": a `Switch` applied at once (`useOptimistic`, toast; it snaps back if refused) that keeps the stored note, with an optional approval note saved by its own button (shown only when changed); the note follows the stored one when the page brings a newer one. Hidden on collected and cancelled jobs, where the flag shows as a badge. |
| `NoteButtons` / `NoteSheet` | "Add note" and "Add diagnosis" (any status): a Sheet with one textarea (1–5,000 characters) that keeps what was typed when refused; the note is append-only, in the timeline, and the sheet's `newId()` note key makes a retry add one note. |
| `EditDetailsButton` / `DetailsSheet` | "Edit" on Requested work: requested work (required), condition on arrival, internal notes and completion notes; only the fields changed since the sheet opened are sent (a colleague's newer text elsewhere is kept); an emptied note is cleared; a failed save shows what was typed (`values`). One "… updated" timeline entry names what changed. |
| `JobHistoryList` (server) | A bike's service history and a customer's jobs, newest first: J- number, status, the first line of the requested work (with the bike on a customer's page), checked-in / completed / collected dates and the lead; each row opens the job. |
| `ServiceSheet`, `NewServiceButton`, `EditServiceButton` | manage_inventory: name, category (`Select`, "No category (Other)"), price, the cost only with view_costs (on edit, empty keeps the current cost), description, Active and Public switches; `newId()` key; values kept on failure (controlled state); the snapshot note; editing also offers `ArchiveControl` (kind `service`). |
| `CategoriesEditor` (`categories-card.tsx`) | manage_inventory: service categories with Rename (in place) and Archive, "New category", and archived ones with Unarchive. Written through the RLS client; never deleted. |
| `ScheduleRateButton` / `CancelRateButton` | Admin, D21. Schedule: a percentage (up to 2 decimals, converted exactly to the 4 dp fraction, `percentToRate`) starting Now or Later (a Singapore `datetime-local`, never past), then a second step in place saying it applies to lines added from then on and never changes existing lines; its confirm button is disabled for 400 ms and focus starts on Back; the sheet's `newId()` rate key makes a retried "now" one rate. Cancel (a future rate only): "Cancel…" opens a confirmation with focus on "Keep it" and "Cancel rate" disabled for 400 ms. |
| `StockBadge` (server or client, `stock-badge.tsx`) | A product's stock as a `Badge`: tone and words from `stockTone` / `stockLabel` (`src/lib/inventory.ts`): danger "Out of stock" or "−2 (recount needed)" (D23), waiting at or below the reorder point, done "34 in stock"; a unique product "2 available". `label` keeps the tone with other words: the part picker's "12 at Shop floor · 20 total", a part line's "37 left at Shop floor". |
| `AdjustStockButton` / `AdjustStockSheet` | adjust_stock, counted products: location (`SegmentedControl`, each segment with its count, the default location first), Add / Remove, quantity with steppers, Adjustment / Damaged (Damaged disabled when adding), a required reason with quick-fill chips ("Stock count correction", "Found stock", "Damaged in workshop", "Opening stock count"), a unit cost when adding (view_costs only, optional), a live "Shop floor: 34 → 31" right under the quantity; a result below zero is shown there as an alert (the quantity marked invalid and described by it) and the submit disabled (insufficient_stock), so the reason is in view next to its cause on a phone. `newId()` request id made when the sheet opens. |
| `StockTransferButton` / `StockTransferSheet` (`stock-transfer-sheet.tsx`) | manage_inventory: From (locations holding stock, with counts), To (the other active locations), quantity (or the unit, fixed) and an optional reason; "Move stock". Not `transfer-sheet.tsx`, the bike ownership transfer. Counted products from the product page; a unit from its own page while available or reserved. |
| `ProductSheet`, `NewProductButton`, `EditProductButton` | manage_inventory. New: Quantity / Unique first (read-only afterwards), name, SKU, brand, category (`Select` of `product` categories), description, sale price, cost (view_costs only; on edit, empty keeps it), reorder point (counted only), Active. Unique adds the first unit on the same sheet (`UnitFields`: location, serial, "Condition (shown publicly when published)", unit sale price, unit cost with view_costs, and an optional "This is a complete bike" `SearchPicker` over shop bikes with no owner and no unit, saying customer bikes must be transferred first); both the product and the unit carry their own `newId()`, and a refused unit leaves the product, whose page offers Add unit (the swallowed failure is still logged, at error level when it is not a refusal). With Unique chosen and no active location, Add product is disabled (the unit fields show `NoActiveLocation`); Quantity stays possible. Creating opens the product. |
| `AddUnitButton` / `AddUnitSheet`, `EditUnitButton`, `WriteOffUnitControl` (`unit-sheet.tsx`) | Add unit: `UnitFields` with the unit id as key. Edit details (manage_inventory): serial, condition (public once published), own price, cost (view_costs; empty keeps), internal notes. Write off (adjust_stock, units in stock): `ReasonConfirm` whose request id is made when the confirmation opens. |
| `AddPartButton` / `AddPartSheet` | "Add part" beside Add service and Add manual line, locked the same way (D15). A `SearchPicker` over saleable stock (archived, inactive, consigned and unavailable units left out, D27; a unique product found by name offers its available units), each option with name, P-/U- number, SKU, price and a `StockBadge`. Then a counted part: quantity with steppers and "Take from" segments with their counts (default location chosen); a unit: quantity 1 at its own location. The selling price, an optional "Price each" for anyone (D14; required when the part has none, D24), a cost and yield preview only with view_costs, a line total. More than the location holds shows the non-blocking D23 warning ("Only 1 at Shop floor. Adding 2 takes the count below zero; …"). Success toast "Added 2 × Road inner tube. 37 left at Shop floor." With no active location, the sheet (like Adjust stock, the unique part of New product and the product page's Stock card) shows `NoActiveLocation`: "No active stock location. Ask someone with inventory access to add one in Settings → Locations", the last words linking to `/settings/locations`. |
| `MovementList`, `HistoryList` (server, `movement-list.tsx`) | Movements newest first: signed quantity first (tabular, `text-done-deep` in, `text-danger-deep` out, a real minus sign), the label (`movementLabel`: "Used on job", "Returned from job", "Adjustment", "Damaged", "Transfer in/out", "Received"), the J- link and `#id`, the product and unit (linked; left out on the product's own page), location · actor · time (Singapore), the reason quoted, "Reverses #n" / "Reversed by #m" anchors to `#movement-{id}` (to the movements list when the other row is not on the page), and the unit cost only when the DTO carries it. `HistoryList` renders product and unit events through `describeProductEvent` / `describeUnitEvent` (`src/lib/inventory-history.ts`): "Cost changed" never shows a value; a unit's job-driven status reads "Put on job J-…", "Sold when J-… was completed", "Back on hold: J-… was reopened". |
| `PublicationControls` (`publication-card.tsx`) | The product page's Publication card (D26): status pill and what it means; the manual moves as buttons from `publicationActions` (over `manualPublicationTargets`): Make internal, Publish, Unpublish, Archive listing, Restore; never Sold; a sold product offers only Archive listing with "Sold items return to public automatically if the sale is reversed."; no Publish for a unique product without an available unit. Buttons are keyed by status and disabled for 400 ms after each change (`useArmedAfter`). While not public: "Publishing needs" with a tick or cross per requirement (`publicationChecklist`: a name, a sale price, a public photo, and for unique products an available unit, computed from the loaded data; the database stays the authority), Publish disabled and described by "Still needed: …". Refusals (`publication_requires_*`, `publication_sold_by_sale`) show their mapped message inline and as a toast. Then the QR label URL (`CopyText`) and `PublicPreviewPanel`. Moves only for manage_inventory; everyone sees the status, URL and preview. |
| `PublicPreviewPanel` (server or client, `public-preview.tsx`) | "What the public sees": the record's `reporting.public_items` row as staff read it (name, price, availability, condition for a unit, the public photo count), or "Not public. Anonymous scans show nothing." Read-only, also on the unit page. |
| `CopyText` | A value as selectable monospace text with Copy (Clipboard API; without it, e.g. plain http on a LAN iPad, it selects the text and says to copy it). The QR URL comes from the one server helper `src/lib/qr.ts` (`qrUrl`), never from an env read in a page. |
| `SplitToUniqueButton` / `SplitToUniqueSheet` | "Split off as unique item" on a counted product's Stock card, only for staff with adjust_stock and manage_inventory (D28): name (the product's), Take from (active locations holding stock, with counts), serial, "Condition (shown publicly when published)", sale price (the product's to start with) and a required reason (480 characters: the ledger adds "Split to U-…: "). The new product id and unit id are `newId()`s made when the sheet opens; success toasts "Split off as U-…" and opens the new unit. |
| `NewLocationButton`, `EditLocationButton`, `LocationActiveSwitch` (`location-controls.tsx`) | Settings → Locations (manage_inventory): a sheet with name, kind (`Select`: Shop floor, Workshop, Storage, Off-site) and sort order, the new location's `newId()` as its key; the Active `Switch` applies at once with `useOptimistic` and a toast, and a location still holding stock snaps back with the `location_has_stock` error toast. |
| `CameraPermission` (`camera-permission.tsx`) | The camera's state when there is no picture: Phase 0's messages (checking, allow, allowed, blocked with the iPhone Settings path, unsupported) plus "needs a secure connection" and "would not start", with "Allow camera" / "Try again" where pressing helps. `cameraErrorState` maps getUserMedia errors onto them. |
| `Scanner` (`scanner.tsx`) | The Scan screen; see "Scanning" below. |

### Inventory

- **Screens.** `/inventory` (search by P- number, SKU, name or brand;
  All · Low stock · Archived as links keeping `?q=`; rows with `StockBadge`
  and a publication pill when public or sold; New product for
  manage_inventory; a Movements link), `/products/[id]` (large P- number,
  publication pill, stock by location with the total, low-stock and
  "recount needed" notes, units for unique products, prices, photos,
  recent movements, history, archive), `/units/[id]` (large U- number,
  status, location, condition, serial, ownership, the bike and "On job
  J-…" / "Sold on job J-…", prices, photos, movements, history, write
  off) and `/inventory/movements` (product chip, location segments, kind
  chips All / Jobs / Adjustments / Transfers, "Load more" by `?before=`).
  Each has a `loading.tsx`; an unknown id is not-found. The Inventory tab
  and rail item stay active on `/products` and `/units` (`also` in
  `nav.ts`).
- **Permissions shown as absence.** Adjust stock and Write off need
  adjust_stock; Transfer, Edit details, Add unit, New product and Archive
  need manage_inventory; anyone may add a part to a job. Buttons a staff
  member cannot use are not rendered.
- **Cost and yield gating.** Products, units and movements have no column
  grant on their costs, so the domain lists columns (never `select *`) and
  reads cost, expected yield and Cult Commons from `product_costs`,
  `inventory_unit_costs` and `inventory_movement_costs` only for view_costs
  holders; the DTO otherwise has no such key. Product and unit pages show
  them under "Cost and yield (staff with cost access only)".
- **Selling prices** shown anywhere come from `public.selling_prices`
  (`private.selling_price`), never recomputed in TS, so Phase 6's
  consignment price flows through; edit forms edit the product default and
  the unit's own price.
- **Stock photos** are Internal or Public only (stock has no customer;
  `attachment_stock_never_customer`): "Public photos appear on the QR page
  once the item is published."
- **Parts on jobs.** A part line shows its P-/U- number (linked) and what
  is left where it came from; voiding says "Voiding returns 2 to Shop floor
  (a reversal is recorded; nothing is deleted)." and toasts "Returned to
  stock"; a reopen of a job with a unit line adds "U-000001 goes back on
  hold for this job. To return it to stock, void its line after
  reopening." (D25); the timeline reads "Used 2 × … (P-…) from Shop floor"
  and "Returned 2 × … to Shop floor".
- **Publication card** (`PublicationControls`, after Prices and Units on
  the product page): status, the manual moves, the requirement checklist
  with Publish disabled until all are met, the QR label URL with Copy and
  "What the public sees". The unit page has a read-only "Public listing"
  card: "Listing follows P-… (its product's publication status)", a link
  to change it there, its QR URL and its own `public_items` row.
- **Split off as unique item** sits with Adjust stock and Transfer on a
  counted product's Stock card (both permissions); the new item is a draft
  at the same location and keeps the source's cost (D28).
- **Locations settings** (`/settings/locations`, listed in Settings): the
  services-settings pattern: readable by every staff member, with its own
  `loading.tsx` (no permission gate below it; `/settings` itself keeps
  none), edit controls only with manage_inventory. Rows show kind and sort
  order, a "Default" pill on the default location (active, lowest sort
  order, then name: `listLocations`' `defaultLocationId`) and "Inactive";
  Add and Edit open a sheet, Active is a switch applied at once. Nothing is
  deleted; a location holding stock cannot be switched off.
- **Bike stock card**: a bike that is a unique unit shows a "Stock" card on
  its page, "In stock as U-000001 · Available" (`unitStatusLabel`; "Stock
  unit U-… · Sold" once it has left stock) linking to the unit, with the
  note that it cannot go to a customer or be archived while in stock. The
  transfer sheet and `ArchiveControl` show the `bike_in_stock` message when
  that is refused.

### Scanning

- **Scan screen** (`/scan`, `Scanner`): mobile-first; the square
  viewfinder (a yellow-bordered square over a dimmed `<video playsInline
  muted autoPlay>`) fills the width on phones and is capped at `max-w-md`
  on iPad; "Hold the label inside the square."; a Torch on/off toggle when
  `track.getCapabilities().torch`; under it, always, "Or type the code on
  the label" (`autoCapitalize="characters"`, autocomplete off,
  `enterKeyHint="go"`) with Open, which goes to `/q/{code}` when it parses
  (a short ID in any case, or a pasted BICII label URL) and otherwise says
  "Enter a code like P-000123". It works with no camera at all. The page
  pads its bottom like every page, so the raised Scan tab and toasts never
  cover the field.
- **Decoder choice**: `BarcodeDetector` when it exists and
  `getSupportedFormats()` includes `qr_code`, run at most ~6 times a second
  on `requestVideoFrameCallback` (else a throttled `requestAnimationFrame`);
  otherwise `@zxing/browser`'s `BrowserQRCodeReader.decodeFromVideoElement`,
  imported dynamically only then, so ZXing (~470 KB) is never in the first
  load.
- **Camera lifecycle**: `getUserMedia({ video: { facingMode: "environment" } })`
  starts at once when access is already granted, otherwise after "Allow
  camera". Every track stops on unmount, on `visibilitychange` to hidden
  and on `pagehide`, and before navigating away on a hit; the camera
  restarts when the page is visible again. A session counter makes a late
  async step of an old start give up. Errors map onto `CameraPermission`'s
  messages (blocked, unsupported, needs HTTPS, would not start).
- **What a code means** (`interpretScan`, `src/lib/scan.ts`): a BICII label
  is `{base}/q/{shortId}` for an accepted public base (`scanBases()` in
  `src/lib/qr.ts`: today `NEXT_PUBLIC_PUBLIC_SITE_URL`; Phase 8 adds the
  database QR base there and nowhere else), a `/q/{shortId}` URL on the
  Admin's own origin, or a bare short ID. A hit vibrates (30 ms), stops the
  camera and pushes `/q/{shortId}`. Anything else shows "Not a BICII
  label" with the text cut to 60 characters, keeps scanning and ignores the
  same text for 2 s. A foreign code is **never** opened, followed, fetched
  or rendered as a link, whatever its scheme.
- **The /q resolver** (`/q/[shortId]`, the only Admin /q route):
  `requireStaff()`, then `resolveShortId` (`src/lib/domain/scan.ts`: the
  prefix picks the table, RLS-scoped, archived records included) and
  `redirect()` to the page from `hrefForRecord` (`src/lib/ids.ts`, also used
  by search hits). An unknown code renders the not-found content in the
  shell: "No record with P-999999", Scan again and Search. It has no
  `loading.tsx`: a loading boundary would commit a 200 before the redirect
  (see "Loading"). Later phases extend `resolveShortId` (C- and S- in Phase
  6, PO- in Phase 7) instead of adding routes.
- **Header short-ID jump**: see `HeaderSearch`; the same /q route answers
  it, so a typed B-/J-/P-/U- number and a scanned label land the same way.

### Workshop

- **Cost visibility.** Cost, yield and Cult Commons figures exist in a
  job's data only for staff with `view_costs`: the domain reads lines from
  the base table's cost-free columns (or `work_order_line_items_staff`)
  and totals from `work_order_totals` (or `work_order_totals_staff`), so
  a DTO for anyone else has no `costs` key to hide. Screens never filter
  numbers out of a fuller object; entering a cost (a service override or a
  manual line's cost) is offered only with `view_costs` and refused by the
  action and the RPC otherwise (D14). The timeline carries no costs for
  anyone.
- **Intake photos follow creation.** `record_attachment` needs the job row
  to exist, so the wizard creates the job first and lands on
  `/jobs/{id}?intake=photos`: the "Intake photos" card comes first there,
  with the camera prominent, the upload tiles and "Done" (which drops
  `?intake`). The upload queue lives above the pages, so leaving early
  loses nothing.
- **The board** (`/jobs`, SPEC §7.2): a list of rows by group rather than
  columns, so it works one-handed on a phone (Kanban is optional). Order:
  title with "New job" (on phones a full-width button at the top instead),
  the view switch, the job number box (`SearchField`, exact number however
  typed) and Filters, the active filter chips, the group chips with counts,
  then one section per non-empty group, oldest check-in first (the
  longest-waiting bike on top). "All open" shows every group but Closed;
  a group chip shows that group alone; Closed lists jobs collected or
  cancelled in the last 30 days (any time when a job number is typed),
  newest first, 50 at a time with "Show more". Counts follow every filter
  but the group. The board reads at most the newest 300 open jobs; past
  that it shows the usual truncation notice and says "Counts cover the
  newest 300 open jobs." Empty states differ per view ("No jobs assigned
  to you — pick one from Unassigned", with a link there).
- **Services settings** (`/settings/services`, every staff member): the
  services by category with price and Inactive / Not public badges, the
  cost only with view_costs, Active / Archived (`ArchivedFilter`), and the
  note "Changing a price or cost affects new job lines only; existing lines
  keep their snapshot." The Cult Commons card (view_costs only) shows the
  rate in force large, scheduled rates (admins: Cancel) and earlier ones
  with who set them and when, cancelled ones marked "Cancelled". It has a
  `loading.tsx` (no permission gate below it).
- **Job page order** (phone): header (J- number, status, overdue badge,
  bike, customer with tap-to-call, check-in date and age), status actions,
  intake photos (intake only), requested work and condition, lines with
  totals, photos; then people (`AssignmentsCard`), dates (each stamp its
  own row: completed and collected never merge), notes (always shown:
  `ApprovalSwitch`, internal and completion notes, Add note / Add
  diagnosis) and the timeline, a second column on wide screens. "Edit" on
  Requested work opens the details sheet.

### Today

`/` (SPEC §19.1; PLAN D30–D35), components in `src/components/domain/today/`
(server unless noted), reads in `src/lib/domain/reports.ts` over the Phase
5 read RPCs, shapes and wording in `src/lib/reports.ts`.

- **The database decides which day is today** (D35). The page asks
  `today_dashboard` for the `?day=` given (a real `YYYY-MM-DD` before this
  server's shop day), else for null; if the database refuses an explicit
  day as in its future (clocks either side of Singapore midnight) it asks
  again with null, so a day choice never errors. Every other read, label,
  the Next-day link (disabled on today) and the date input's `max` use the
  `day` and `is_today` the database returned. A garbage `?day=` is today,
  and so is one before `EARLIEST_SHOP_DAY` (2000-01-01, the date input's
  `min`; Previous day is disabled on it). `parseShopDay` reads years
  0001-9999 as themselves and `shiftShopDay` only returns days that parse
  back, so no derived day (the week strip's) can throw while rendering.
- **Flows vs snapshot** (D31). "Today" / "On Sat, 3 Oct": Checked in,
  Started, Completed, Ready for collection, Collected (Cancelled when > 0),
  the jobs whose current stamp falls on the day; each links to its list in
  Activity. "Right now" (today only): Received, Waiting, Ready to start,
  In progress, Awaiting collection ("Completed, not yet collected": the
  Completed and Ready for collection statuses together, D31, so it never
  shares a name with the flow tile, the status or the board's Ready for
  collection column) and Overdue ("Open more than 7 days",
  `OVERDUE_AFTER_DAYS`), the current snapshot grouped as `BOARD_GROUPS`,
  each linking to the board filtered the same way (`TILE_LINKS`). A past
  day has no snapshot, no low stock and no "Needs attention".
- **Permissions** (D30). Money needs View financial reports: without it
  the section is not rendered at all. Inside it, COGS, Yield, Cult Commons
  and BICII after Cult Commons need View costs too; without it one line
  says "Costs, yield and Cult Commons need the View costs permission." The
  database returns hidden figures as NULL and the DTO keeps them null; the
  UI never derives one. Workshop, stock and exception counts are for all
  active staff; an adjustment's value at cost only with View costs.
- **Money notes.** Danger: the loss note (D1). Warning: "Provisional: N
  lines have no cost entered…" (D14). On a past day, muted: "Counts jobs
  completed on this day. If one is reopened, it moves to the day it is
  completed again." (D32; words, not colour).
- **Placeholders are extension points.** `AppointmentsSection` shows
  Scheduled / Arrived / No-shows as "—" with "Arrives with appointments"
  (sr-only "Not tracked yet") until Phase 2 fills the columns; its
  `children` takes Phase 2's appointment list. Consignment sales and New
  consignor liability say "Arrives with consignment" until Phase 6. The
  `ExceptionList` is the list Phase 9 links from `/reports/exceptions`.
- **Streaming.** The dashboard row loads first; each list (financial
  entries, adjustments, low stock, exceptions, activity, last 7 days) is a
  `SectionLoader` (async) in its own `<Suspense>` with a `SectionSkeleton`,
  and a failed read logs and shows "Couldn't load this. Refresh the page to
  try again." in place. Still no `loading.tsx` at the group root (see
  "Loading").
- **Layout.** Phone: one column, two-column tile grids, 44 px targets;
  from md three or four columns and the lists side by side. Numbers are
  `font-display tabular-nums`. Every tile is a `<dl>`/`<dt>`/`<dd>`; a
  linked tile's name is "Completed: 3"; money tiles show the currency
  code; section headings are `<h2>`. A money amount never leaves its card:
  the tile's `<dl>` is a size container, the amount's size is a share of
  its width picked by the amount's length (`moneySizeClass`, capped at the
  usual size, floored at 1rem) and the currency code wraps under it when
  both do not fit, so "$400.00" stays large in a half-width phone tile and
  "$12,345.67" shrinks beside the iPad side rail.

| Component | Notes |
|---|---|
| `StatTile`, `MoneyTile`, `TileGrid`, `TodaySection` (`stat-tile.tsx`) | A figure as `<dl>` with label, value, hint, optional link, tone (value colour only) and `notTracked` ("—" and `NOT_TRACKED`, "Not tracked yet", for screen readers: the one source of that wording); money formatted with a real minus sign and its currency, scaled to the tile (see Layout); the grid; a section with its `<h2>`. |
| `AppointmentsSection` | The Phase 2 slot, above. |
| `DayNavigator` (client) | ‹ Previous day / Today / Next day › links and a `next/form` GET form (`<input type="date" name="day">` with `min` and `max`, "Go"); works before hydration; once hydrated a picked date submits after a 600 ms pause (typing a year passes through "0002"). |
| `RefreshButton` (client) | "Updated 10:42 am" and Refresh: `router.refresh()` in a transition with a spinner; returning to the tab refreshes once the figures are a minute old. |
| `ActivityList` | One flow's jobs from `work_order_activity_on`: J- number, status pill, Overdue badge, customer, bike, sale total; the heading's id is the flow tile's anchor. Checked in, Completed and Collected always; Started, Ready for collection and Cancelled when not empty; "Nothing happened on this day" for a quiet day. |
| `AdjustmentList` | The day's adjustments and damaged stock: signed delta, P- link, reason, type · location · actor · time, a "Significant" badge (D33) and the value at cost when present. Significant ones first, then newest first; the first `ADJUSTMENT_ROWS` (5) listed and the rest behind a `<details>` "Show N more" (no JavaScript), so an opening stock count does not push "Needs attention" screens down. |
| `LowStockList` | The first 5 of P4's `reporting.low_stock` (largest shortfall first) with `StockBadge`; "See all" opens `/inventory?filter=low`. |
| `ExceptionList` | D34 exceptions, danger first: pill (tone and words; Overdue is danger, as on the Overdue tile and the board's badge, while Not collected and other warnings are waiting), short ID, subject, `exceptionCopy` sentence; rows link through `exceptionHref` (a line opens its job via `/q/J-…`); unknown kinds render a generic sentence; keyed by `exceptionKeys` (a product below zero at two locations is two rows); Today lists the 20 most urgent and, when there are more, says "Showing the 20 most urgent of 45" under them (Phase 9 makes it a link to `/reports/exceptions`); EmptyState "Nothing needs attention". |
| `FinancialEntries` | `<details id="financial-entries">` "What makes up these figures" (open with `?entries=open`): the day's `financial_lines` grouped by job (J- link), description, quantity, sale, and yield and Cult Commons when visible; "Sold at a loss" and "Cost pending" badges. It adds nothing up. |
| `WeekStrip` | "Last 7 days" ending at the day shown: completed, collected, and gross sales, yield and Cult Commons when visible; each day links to `/?day=`; the day shown has `aria-current="date"` and a bold row. A table from md, stacked cards on a phone. |
| `SectionLoader`, `SectionSkeleton`, `SectionError` (`section-loader.tsx`) | The streaming pattern above. |

### Photos and images

- Photos are shown with `next/image` **unoptimized** (a plain lazy `<img>`
  with width and height), not through the image optimizer, so there is no
  `images.remotePatterns` entry for Storage: internal photos are
  short-lived signed URLs (5 minutes, minted on every render, one
  `createSignedUrls` call per record), which the optimizer would fetch and
  cache on the server under URLs that change every render, keeping private
  photos in a server cache; and the devstack's Storage is on a loopback
  address the optimizer refuses without `dangerouslyAllowLocalIP`. Public
  photos use their public URL. Thumbnails are therefore the uploaded
  photos (at most 2048 px, typically 200–600 KB), loaded lazily.
- A signed URL that has expired by the time it loads (a page left open)
  triggers one `router.refresh()` (at most once a minute) to mint new ones.
- Who sees what: **Internal**, staff only; **Customer**, staff and the
  bike's current owner (or the customer, for a customer-record photo) on
  the BICII website once customer accounts launch (Phase 11); both live in
  the private `media-internal` bucket. A job photo's Customer level means
  the job's customer. **Public**, anyone with the link (`media-public`);
  never for a customer record (D13) or a job (D19): the app refuses before
  copying anything to `media-public`, and the database refuses too. Changing to or from
  Public moves the object between buckets (`src/lib/domain/attachments.ts`
  explains the order of steps and what a failure leaves); whatever a failed
  cleanup leaves is removed the next time the record is shown.

### Search

- Lists are search-first: an empty query shows recently updated records,
  a query shows `staff_search` hits (exact B- numbers and serial numbers
  first; serials ignore case, spaces and dashes).
- `/search` groups hits by kind (Customers, Bikes, Jobs, Products,
  Units), the group with the best hit first: an exact J- number
  ("j-000004", "J000004") puts Jobs first, an exact P- number or SKU puts
  Products first. The search fields are labelled "Search customers, bikes,
  jobs and stock". Product hits show the RPC's subtitle ("SKU · brand · 34
  in stock"), unit hits their status first ("Available · Shop floor ·
  S/N …"). An exact short ID typed in the header skips the results and
  opens the record (`/q`). Archived search returns no jobs.
  Recent searches are kept per device in `localStorage`
  (`src/lib/recent-searches.ts`: every access in try/catch, at most eight,
  newest first) when a query is submitted or a result opened, and shown
  before anything is typed. They never reach the server.
