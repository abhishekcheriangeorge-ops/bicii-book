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
| `ToastProvider`, `useToast` (client) | Polite live region for confirmations, `role="alert"` for errors (errors persist until dismissed). Mounted in the root layout. On phones it sits above the tab bar (never over Scan); an open Sheet lifts it above its Save/Cancel row. |
| `Badge`, `StatusPill` | Tone = the status tokens; pills always carry text. |
| `Card`, `EmptyState`, `Skeleton`, `Spinner`, `PageHeader` | Layout and feedback. `Card` never clips (no `overflow-hidden`), so pickers, menus and focus rings inside it can extend past its edge; flush content rounds its own corners. |
| `RowList`, `RowLink` | Edge-to-edge list of tappable rows (More, Settings, Staff; later jobs, products, customers). Rows use the inset focus ring and round their own first/last corners; the list does not clip. |
| `SearchPicker` (client) | ARIA 1.2 combobox + listbox; async `search(query)` (may be a Server Action), debounce, stale-response guard, ↑/↓/Enter/Escape, hidden input for forms. `action` adds a last option ("Create new customer") reached with the arrows and Enter like any result. Optional pickers (`clearable`, default `!required`) can go back to nothing: a 44px clear button, emptying the field and leaving it, or Escape on an empty field; `onSelect(null)` reports it. SPEC §22: use it instead of any large `<select>`. |
| `SegmentedControl`, `Tabs` (client) | Radiogroup and tablist with roving tabindex and arrow keys. |

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
- Destructive or commit steps (deactivate staff; later stock, payment and
  settlement reversals) are two steps: the first button opens a confirm
  block that asks for the reason (SPEC §22), puts focus in the reason field,
  places the confirm button in a different position with a different React
  `key` (so the first button's DOM node and focus are not reused), and
  ignores clicks for 400 ms after opening (a double tap). See
  `AccessControl` in `settings/staff/[staffId]/staff-controls.tsx`.

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

## App shell (`src/components/shell/`)

| Piece | Notes |
|---|---|
| `TabBar` (client) | Phones (< md): fixed bottom bar, Today · Jobs · **Scan** · Inventory · More. Scan is a raised 64px yellow disc. Pads for `env(safe-area-inset-bottom)`; pages pad their bottom to clear it. |
| `SideRail` (client) | md and up: sticky labelled rail with the mark, the four primary sections (Scan in yellow) and every More destination. |
| `AppHeader` | Sticky; mark (phones only), the global search entry (links to `/search`), and `ProfileChip` (initials → `/settings/profile`) streamed in `<Suspense>`. Clears `env(safe-area-inset-top)`. |
| `nav.ts` | Single source for tabs, More items and active-state matching. |
| `ComingSoon` | `PageHeader` + `EmptyState` naming the phase that builds a section. |
| `StatusScreen` | 401/403/404/500 pages. |
| `ServiceWorkerRegistration` | Registers `public/sw.js` in production builds only. |
