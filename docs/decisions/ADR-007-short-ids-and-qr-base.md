# ADR-007: Short IDs and the QR base URL

Date: 2026-10-04 (PR #1; refined through PR #7). Status: accepted (build
default, not individually confirmed by the owner); the QR base source stays
open until Phase 8. Decision owner: Abhishek Cherian George (owner) for
business meaning; defaults proposed by the build agent.

## Context

SPEC §15 and §24 require human-readable short IDs and QR labels that open a
public page for an item while staff scanning reach the record. The brief
does not fix the ID format, the URL shape or where the public site's base URL
comes from.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D9 | Short IDs are `B-/J-/P-/U-/C-/PO-/S-` + 6 digits; QR payload = `{public_site_url}/q/{short_id}`; the Admin answers `/q/{short_id}` for staff and redirects to the record (its only `/q` route); `shop_settings.public_site_url` is stored but informational; until Phase 8 decides between it and `NEXT_PUBLIC_PUBLIC_SITE_URL`, the environment variable is the QR base | Accepted; base source open until Phase 8 | `private.next_short_id` (`20261004000100_foundation.sql`), `src/lib/ids.ts`, `src/lib/qr.ts` (`getQrBase`, `scanBases`), `src/app/(staff)/q/[shortId]/page.tsx`, `shop_settings.public_site_url` (`20261004002800_schedule.sql`); `tests/db/short-id.test.ts`, `tests/unit/ids.test.ts`, `tests/unit/scan.test.ts`, `tests/e2e/scan.spec.ts` |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner), row D9.
Rationale (inferred): one QR serves both audiences, because the public page
and the staff redirect share the same path; every QR shown or scanned goes
through `src/lib/qr.ts`, so Phase 8's choice is a change in one file.

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| `shop_settings.public_site_url` as the QR base (named in D9) | Deferred to Phase 8; the environment variable is the base until then |

## Consequences

- A label encodes the environment's public site URL; a label printed for
  another environment's URL is "Not a BICII label" to this one's scanner
  ([RISKS R-013](../RISKS.md#r-013--qr-base-undecided-until-phase-8)).
- Phase 8 must keep the environment's base in `scanBases()` so earlier
  labels still scan.
- Short-ID sequences are never reused (see DATA-MODEL §17).

## Revisit trigger

Phase 8 (QR and labels) starts.

## Evidence and links

- [PLAN Phase 8](../PLAN.md#phase-8--qr-and-labels),
  [DATA-MODEL §17](../DATA-MODEL.md#17-sequences-and-short-ids).
