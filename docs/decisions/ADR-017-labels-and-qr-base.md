# ADR-017: Labels and the QR base

Date: 2026-10-05 (Phase 8, `feat/p8-labels`). Status: per row below; every
row is "Accepted: build default, not individually confirmed by the owner".
Decision owner: Abhishek Cherian George (owner) for business meaning;
defaults proposed by the build agent. Supersedes the open part of
[ADR-007](ADR-007-short-ids-and-qr-base.md) (where the QR base comes from);
ADR-007's short-ID format and URL shape stand.

Status update 2026-10-05 (Phase 8 step 1): the database layer of every row
below is built (`supabase/migrations/20261004003800_labels.sql`) and tested
(`tests/db/labels.test.ts`, `tests/db/labels-concurrency.test.ts`); the
screens, `src/lib/qr.ts` and `src/lib/printing/` come in the next steps.

Status update 2026-10-05 (Phase 8 step 2): the app side is built. D9's
display and scan rule: `src/lib/qr.ts` (`getQrBase`, `qrUrl`, `scanBases`)
with `isValidQrBase` in `src/lib/ids.ts` (`tests/unit/qr-base.test.ts`,
`tests/unit/qr-base-sources.test.ts`, `tests/e2e/print-view.spec.ts` on an
environment base distinct from the database base). D56's cap in
`createPrintJobAction` (`src/app/(staff)/labels/actions.ts`); D58's
price line in `src/lib/printing/compose.ts` (`0.00` prints, null does not:
`tests/unit/printing/compose.test.ts`); D59's open-only rendering in the
print view (`src/app/(print)/print/labels/[jobId]/page.tsx`), the PDF route
(`src/app/api/labels/[jobId]/pdf/route.ts`, 409 for a finished job) and the
confirmation (`src/components/domain/print-job-controls.tsx`). The record
pages' Labels card and the settings screens come in step 3.

## Context

SPEC §15 says a QR contains only the item's stable URL or ID, never
financial data, and that an anonymous scan shows only published
information. SPEC §16 asks for printing from a phone or iPad (open the
record, Print Label, quantity, printer, print), N identical labels for bulk
stock, one label per unique item, a printing abstraction (template, print
job, printer profile and adapter) and browser print or PDF as the fallback
until BICII's printers are known. SPEC §31 asks for bulk labels "in
arbitrary quantity". The brief does not say where the QR's base address
comes from, how many labels one request may print, what price a label
shows, or when a browser print counts as printed. ADR-007 left the base
open until this phase: Phase 2 stored `shop_settings.public_site_url` as
informational and the environment variable `NEXT_PUBLIC_PUBLIC_SITE_URL`
was the base.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D9 (base) | The QR payload is exactly `{shop_settings.public_site_url}/q/{short_id}`. For printing it is computed only in the database by `private.qr_payload`, with no fallback: a missing, null or malformed address raises `public_site_url_invalid` and nothing prints until an admin sets it. The column check accepts exactly what `qr_payload` accepts (http(s), a host, an optional path, no query or fragment, at most 200 characters). Every QR URL the Admin displays comes from the same column through `src/lib/qr.ts` (`getQrBase()` / `qrUrl()`, Phase 8 step 2); `NEXT_PUBLIC_PUBLIC_SITE_URL` survives only as an additional accepted scan base in `scanBases()`, so labels printed against it keep scanning | Accepted: build default, not individually confirmed by the owner | Database: `20261004003800_labels.sql` (`private.qr_payload`, `shop_settings_public_site_url_check`); `tests/fixtures/qr-bases.ts`, `tests/db/labels.test.ts` ("QR payload (D9)") |
| D56 | Label quantity per print job: one job prints 1–500 labels of a quantity-tracked product, or 1–10 of a unit or bike (default 1). A per-job cap, not a limit on labels (SPEC §31 "arbitrary quantity"): more labels = another job, and the sheet says how many remain | Accepted: build default, not individually confirmed by the owner | `create_print_job` (`label_quantity_out_of_range`), `print_jobs_quantity_check`, `print_jobs_unique_quantity_check`; `tests/db/labels.test.ts` ("quantity limits per job") |
| D57 | Labels for unique items: unique-tracked products are labelled per unit (U-); `reporting.public_items` exposes published units as their own U- rows, so a U- label resolves publicly once published; a P- label for a unique product is refused (`label_unique_product_needs_unit`); a unit linked to a bike shows the bike's size/colour as an identity line and keeps its U- QR; a bike tag (B-) may be printed for any non-archived bike and resolves to "not found" publicly | Accepted: build default, not individually confirmed by the owner | `private.label_content`; `tests/db/labels.test.ts` ("a unique unit's label is distinct", "a printed label resolves publicly") |
| D58 | Price on a label: exactly `private.selling_price(product_id, inventory_unit_id)`, the single function `reporting.public_items`, the in-store sale default (`private.sell_line`), `add_inventory_line` and later Shopify use (latest definition `20261004003300_consignment.sql`); never reproduced inline. NULL → no price line (never "$0.00" for a missing price); 0 → "0.00" (D24 as amended: 0 is a known price). The printed price is a snapshot; record pages warn when the current price differs from the last printed label's | Accepted: build default, not individually confirmed by the owner | `private.label_content`; `tests/db/labels.test.ts` ("the price on a label") |
| D59 | When a print counts as printed: browsers cannot report printer success, so staff confirm each job as printed, or failed with a reason; unconfirmed jobs stay `rendered` and are listed under "To confirm". Only open jobs (queued/rendered) can be rendered for printing (print view, PDF route); printed and failed jobs are history, and "Print again" always creates a new job linked by `reprint_of_id` from the record page with a fresh preview | Accepted: build default, not individually confirmed by the owner | `private.print_job_transition_allowed`, `set_print_job_status`, `print_jobs_enforce_rules`; `tests/fixtures/print-transitions.ts`, `tests/db/labels.test.ts` ("print job status machine"), `tests/db/labels-concurrency.test.ts` |

Rationale:

- D9: the base is a fact about the shop, not about a deployment, and a
  printed label outlives any deployment. Keeping it in the database lets an
  admin set it once for every device and lets the database refuse to print
  a label that would point nowhere. No fallback, because a label printed
  against a guessed base (an environment default such as a preview URL)
  is a physical object that cannot be recalled.
- D56: a per-job cap keeps one print job to what one device renders and
  one roll holds, while "arbitrary quantity" stays true by starting another
  job (inferred from SPEC §31; no printer has been inspected).
- D57: a unique item's QR must open that item, so the unit carries the
  label; the bike's size and colour are what staff read off a frame on a
  rack (SPEC §16 "Unique bikes may include additional identity text").
- D58: one price function means the label, the public page, the sale
  default and Shopify can never disagree at the moment of printing; the
  NULL / 0 distinction follows the owner's D24 amendment.
- D59: a browser print dialog reports nothing back, so only a person can
  say the labels came out; making that explicit keeps the job history
  honest.

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| `NEXT_PUBLIC_PUBLIC_SITE_URL` as the QR base (the pre-Phase 8 default) | Rejected: a per-deployment value; a preview or staging deployment would print labels pointing at itself, and the database could not compute or check the payload |
| The database base with the environment variable as fallback | Rejected: a silent fallback prints labels against whatever the deployment happens to say; refusing to print until the address is set is recoverable, a wrong label on a frame is not |
| A per-print anonymous RPC, an anon Supabase client and a `/preview` route to show "what the public sees" | Rejected: the existing `PublicPreviewPanel` (publication card on product and unit pages) reads `reporting.public_items`, which is role-independent (tested: identical rows to anon and staff), and Phase 11 owns the public page (`public.public_item` / `public_item_detail`) |
| One `entity_type` / `entity_id` pair on `print_jobs` (DATA-MODEL §12's first draft) | Rejected: no foreign key, so a job could point at nothing; three typed foreign keys with a kind check keep archived records referenced (SPEC §23) |
| A template per printer profile (the first draft's `printer_profiles.label_template_id`) | Rejected: one default template per label kind and one default printer are simpler to pick on a phone; a profile carries only adapter settings |
| Hardware adapters (network raw, Bluetooth) now | Rejected: SPEC §16 says not to hard-code a protocol before inspecting the printers; the enum values exist and `printer_profiles_adapter_available` keeps them unusable until Phase 12 |
| No quantity cap (SPEC §31 read literally) | Rejected for one job: an unbounded job is an unbounded render on a phone; the cap is per job, not per label |

## Consequences

- Printing is off on a database whose `shop_settings.public_site_url` is
  unset or invalid (`public_site_url_invalid`); setting it is an admin's
  first step (RUNBOOK, OPERATIONS).
- Changing the address later does not change labels already printed: they
  keep encoding the old base
  ([RISKS R-013](../RISKS.md#r-013--changing-the-qr-base-leaves-printed-labels-on-the-old-address)).
- The label text is limited to public fields plus identifiers by one
  function and a database whitelist of content keys, so a later template
  field cannot leak a cost.
- Every print is history: jobs are never deleted, and archived records keep
  their jobs.
- D59 exhausts the D43–D59 main-line range
  ([RISKS R-028](../RISKS.md#r-028--the-main-line-decision-range-d43d59-is-exhausted)).

## Revisit trigger

BICII's label printers are inspected (Phase 12: adapter, sizes, quantity
cap); the public site's address changes; the owner confirms or changes a
row.

## Evidence and links

- [PLAN Phase 8](../PLAN.md#phase-8--qr-and-labels), [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner) rows D9, D56–D59.
- [DATA-MODEL §11](../DATA-MODEL.md#11-qr-identity-and-publication),
  [§12](../DATA-MODEL.md#12-label-printing).
- `supabase/migrations/20261004003800_labels.sql`, `tests/db/labels.test.ts`,
  `tests/db/labels-concurrency.test.ts`.
