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
| `Input`, `Textarea`, `NumberInput` (client) | `NumberInput` is `type="text"` + `inputMode` (decimal for money, numeric for quantity); values stay strings — parse with `lib/money`. Optional −/+ steppers. |
| `Checkbox`, `Switch` (client) | Checkbox is native and styled; Switch is `role="switch"` for settings that apply immediately. |
| `Sheet` (client) | Modal dialog: bottom sheet on phones, right panel at `md`+. Inerts the rest of the page, traps Tab, Escape closes, focus returns to the opener. `dismissible={false}` while a commit is pending. Without a footer the body pads for the iPhone home indicator. While open it moves toasts above its footer (`--toast-inset-bottom`). |
| `ToastProvider`, `useToast` (client) | Polite live region for confirmations, `role="alert"` for errors (errors persist until dismissed). Mounted in the root layout. On phones it sits above the tab bar (never over Scan); an open Sheet lifts it above its Save/Cancel row. Optional `action` (`{ label, onAction }`, e.g. "Retry" on a failed upload) adds one button that runs it and dismisses the toast; toasts with an action stay until dismissed and are never pushed out (at most four show; a new toast pushes out the oldest plain one). Optional `key`: a toast with the same key replaces the one on screen in place (one "3 photos not saved" per record, not one per photo); `dismiss` takes the id or the key. The provider outlives navigation, so a Retry still works after the screen that failed was left. |
| `Badge`, `StatusPill` | Tone = the status tokens; pills always carry text. |
| `Card`, `EmptyState`, `Skeleton`, `Spinner`, `PageHeader` | Layout and feedback. `Card` never clips (no `overflow-hidden`), so pickers, menus and focus rings inside it can extend past its edge; flush content rounds its own corners. Its header wraps: an action too wide to sit beside the title (a half-width card on iPad) moves under it rather than squeezing it. |
| `RowList`, `RowLink` | Edge-to-edge list of tappable rows (More, Settings, Staff; later jobs, products, customers). Rows use the inset focus ring and round their own first/last corners; the list does not clip. |
| `SearchPicker` (client) | ARIA 1.2 combobox + listbox; async `search(query)` (may be a Server Action), debounce, stale-response guard, ↑/↓/Enter/Escape, hidden input for forms. `action` adds a last option ("Create new customer") reached with the arrows and Enter like any result. Optional pickers (`clearable`, default `!required`) can go back to nothing: a 44px clear button, emptying the field and leaving it, or Escape on an empty field; `onSelect(null)` reports it. SPEC §22: use it instead of any large `<select>`. |
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
| `PhotoViewer` | Sheet: the photo enlarged (tap for full size), who can see it (`SegmentedControl` Internal / Customer / Public, applied immediately with `useOptimistic` and a toast; each level explained; Public disabled on a customer record, PLAN D13), caption, and delete with a reason (two steps; Cancel returns focus to "Delete photo…"). A change that went through but could not remove the old copy from Storage is reported as done, with "Finish" (toast and inline), not as a failure; the next showing of the record finishes it anyway. |

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
  the private `media-internal` bucket. **Public**, anyone with the link
  (`media-public`); never for a customer record. Changing to or from
  Public moves the object between buckets (`src/lib/domain/attachments.ts`
  explains the order of steps and what a failure leaves); whatever a failed
  cleanup leaves is removed the next time the record is shown.

### Search

- Lists are search-first: an empty query shows recently updated records,
  a query shows `staff_search` hits (exact B- numbers and serial numbers
  first; serials ignore case, spaces and dashes).
- `/search` groups hits by kind, the group with the best hit first.
  Recent searches are kept per device in `localStorage`
  (`src/lib/recent-searches.ts`: every access in try/catch, at most eight,
  newest first) when a query is submitted or a result opened, and shown
  before anything is typed. They never reach the server.
