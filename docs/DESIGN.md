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
| `Card`, `EmptyState`, `Skeleton`, `Spinner`, `PageHeader` | Layout and feedback. `Card` never clips (no `overflow-hidden`), so pickers, menus and focus rings inside it can extend past its edge; flush content rounds its own corners. Its header wraps: an action too wide to sit beside the title (a half-width card on iPad) moves under it rather than squeezing it. |
| `RowList`, `RowLink` | Edge-to-edge list of tappable rows (More, Settings, Staff; later jobs, products, customers). Rows use the inset focus ring and round their own first/last corners; the list does not clip. |
| `SearchPicker` (client) | ARIA 1.2 combobox + listbox; async `search(query)` (may be a Server Action), debounce, stale-response guard, ↑/↓/Enter/Escape, hidden input for forms. `action` adds a last option ("Create new customer") reached with the arrows and Enter like any result. Optional pickers (`clearable`, default `!required`) can go back to nothing: a 44px clear button, emptying the field and leaving it, or Escape on an empty field; `onSelect(null)` reports it. SPEC §22: use it instead of any large `<select>`. |
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
| `HeaderSearch` (client) | The global search field: a `next/form` GET form to `/search?q=` (works before hydration), remembered in recent searches on submit; `/` focuses it from anywhere on a keyboard. On `/search` it steps aside for the page's own field. |
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
| `ShortId` (server) | A human short ID in monospace, never wrapped; `large` is the identity header of a record (the number on the bike's label). |
| `CustomerSheet`, `NewCustomerButton`, `EditCustomerButton` | New/edit customer. Creating opens the new customer's page. |
| `BikeSheet`, `NewBikeButton`, `EditBikeButton` | New/edit bike. A new bike's owner is preset (from a customer's page), picked (`CustomerPicker`), or none (shop and consigned bikes). The edit form has no owner: ownership changes only by transfer. Creating opens the bike, ready for photos. |
| `TransferOwnershipButton` | Sheet: new owner (a customer via `CustomerPicker`, or the shop) and a required reason, kept in the bike's ownership history. The current owner is listed but not choosable. |
| `CustomerPicker` | `SearchPicker` over active customers (`staff_search`), via a Server Action. |
| `ArchiveControl` | Archive (confirmed) / unarchive a customer or bike, with what archiving does in a sentence. |
| `CaptureButton` | The camera control for every photo (intake reuses it): "Take photo" (`<input type=file accept="image/*" capture="environment">`, opens the rear camera on phones) and "Choose photos" (library, several at once). Each file is decoded with its EXIF orientation (`createImageBitmap(…, { imageOrientation: "from-image" })`, `<img>` fallback), scaled to at most 2048 px on the long edge and re-encoded as JPEG 0.85 (`prepare-photo.ts`, sizing in `src/lib/images.ts`); re-encoding also drops EXIF, GPS included. A file the browser cannot decode (HEIC outside Safari) is uploaded as is when it is an accepted photo type. Then: a signed upload URL from the server, upload with the browser Supabase client straight to Storage with byte progress, record. Optimistic thumbnails with status and progress; up to two photos in flight. The queue lives above the pages (`PhotoUploadsProvider` in the staff layout, `upload-store.ts`), so uploads finish after leaving the record and their tiles are there again on coming back. A failure keeps the photo and its preview on its tile (Retry, Discard); one error toast per record ("3 photos not saved", Retry all) updates in place and is never pushed out; the header shows "N photos not saved" on every screen, linking to the record; closing or reloading the tab while any photo is unsaved asks first. Retry resumes at the failed step: once the object is in Storage only recording is retried (unless the server says it is missing). Photos are labelled "New photo 3", not by file name (iPhone captures are all image.jpg). A file Storage refuses (type, size) is not retried and says to save it as JPEG. The page refreshes once when a record's queue drains, not once per photo (each refresh re-signs every photo). A photo picked before hydration is picked up when React attaches. An undecodable original keeps its metadata, so it is recorded without dimensions and can never be made public. |
| `PhotoGrid` | A record's photos: thumbnails (visibility badge when not internal) that open `PhotoViewer`, with `CaptureButton` under them (hidden for archived records). |
| `ReasonConfirm` | The two-step destructive pattern with a required reason (below, "Forms"), shared by voiding a line and cancelling or reopening a job: focus in the reason field, the confirm button in a new position with a new key, presses ignored for 400 ms, and a dismiss button that returns focus to the first button. The dismiss button says what it keeps where "Cancel" would be ambiguous: "Keep job" beside "Cancel job", "Keep line" beside "Void line", "Back" for a reopen. `onConfirmingChange` lets a sheet hide its own submit while the confirmation is open. |
| `IntakeWizard` | `/jobs/new` (SPEC §7.1): one step at a time with "Step 2 of 5" and a progress bar, Back/Next as 48px buttons kept above the tab bar, Enter advancing on a keyboard (not in a textarea, a picker or a sheet). Customer (one `SearchPicker` over customers and bikes; a bike selects its owner; "New customer" opens `CustomerSheet` with `onCreated`), Bike (the customer's active bikes as large cards with an "Open job J-…" chip; "Add bike" opens `BikeSheet` with the owner preset and `onCreated`), Work (requested work, condition on arrival), People (lead as single-select chips, "Me" first, Unassigned allowed; additional staff as toggles; active staff only, D22), Services (chips by category, a filter above 12, −/+ quantity, a preview subtotal and, only with view_costs, a Cult Commons preview), then Review with Edit per section. It owns the job's and each service line's `newId()` key, so a double tap or retry makes one job. Draft: `src/lib/intake-draft.ts`, one per device under `bicii.intake-draft.v1` (ids, labels, typed text; guarded like recent searches), offered back as "Continue the intake you started at 10:42?" / Discard, cleared on success; Continue drops services no longer offered and staff no longer active (they could not be seen or removed, and the job would be refused every time) and says what it removed. A bike whose owner is archived is "Owned by … (archived)", never a shop bike: choosing it says to unarchive the owner or transfer the bike. If the bikes cannot be loaded, an error with "Try again" replaces the skeleton. The progress bar has one segment per counted step, full at "Step 5 of 5". Rendered only in the browser (the draft is in localStorage). |
| `JobStatusActions` | The usual next steps (`primaryActions`) as large buttons with a toast, disabled for 400 ms after every status change (the next step's button lands under the finger). "Collected…" is final (D15), so it opens a confirmation naming the job and the customer, focus on Back, "Mark collected" disabled for 400 ms. "Change status": a sheet listing the other allowed moves (`allowedTransitions`) with nothing pre-selected, an optional note and, when Collected is picked, that it is final; plus Reopen and Cancel as `ReasonConfirm` (D15, D16), during which the sheet's own submit is hidden. Nothing for a collected or cancelled job. |
| `LineTable` | A job's lines, dense (`text-dense`, `tabular-nums`): description, qty, unit price, total, and with view_costs unit cost, yield and Cult Commons per line. Its layout follows its own width (container queries: 28rem without costs, 42rem with), not the screen's, since the lines card is narrow on an iPad; narrower, each line is a stacked row. Voided lines stay, struck through with who, when and why, behind "Show voided". Each live line of an open job has `VoidLineControl`. A manual line added without a cost shows a "Cost pending" badge to everyone (D14), and "—" as its unit cost. |
| `VoidLineControl` | "Void…" on a line: `ReasonConfirm` calling `voidLine`. |
| `AddServiceButton` / `AddServiceSheet` | `SearchPicker` over active services (price and category shown), quantity with steppers, the price prefilled and editable by anyone (D14), the cost field only with view_costs, a live line-total preview; the sheet's `newId()` line key makes a repeat submit add one line. Disabled with "Completed jobs are locked. Reopen to change lines." once the job is completed. |
| `ManualLineButton` / `ManualLineSheet` | Description, quantity, unit price and (view_costs only) cost, with the same preview, key and lock. Left without a cost, the line is marked cost pending (D14); the sheet says so (to view_costs holders: "Enter 0 when there is no direct cost"). |
| `TotalsSummary` (server) | The compact summary row under the lines (SPEC §22, not a modal): the running sale total for everyone; with view_costs also Cost, Yield, Cult Commons (with the rate when every line shares it) and BICII yield after Cult Commons, from `work_order_totals_staff`, marked "Provisional" while a live line has no cost entered (D14), with what to do about it. |
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
- `/search` groups hits by kind (Customers, Bikes, Jobs), the group with
  the best hit first: an exact J- number ("j-000004", "J000004") puts Jobs
  first. The search fields are labelled "Search customers, bikes and
  jobs". Archived search returns no jobs.
  Recent searches are kept per device in `localStorage`
  (`src/lib/recent-searches.ts`: every access in try/catch, at most eight,
  newest first) when a query is submitted or a result opened, and shown
  before anything is typed. They never reach the server.
