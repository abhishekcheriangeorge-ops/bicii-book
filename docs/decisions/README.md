# Decision records

Each consequential decision has one record here, written with the headings of
the Vibe Code Docs Stack decision template (context, decision and rationale,
alternatives actually considered, consequences, revisit trigger, evidence).
A record's status is one of: accepted (a build default the owner has not
individually confirmed), owner-confirmed, amended or changed by the owner
(with the date), proposed, superseded, or not implemented on this branch.
A record is never rewritten to change its history: a later decision gets a
new record (or a dated status change) that links the one it supersedes.
[PLAN §6](../PLAN.md#6-open-decisions-for-the-owner) stays the one-line
index of the D-numbered rows, with each row's status and record; this
directory holds the reasoning. Decision numbers and records are allocated
in ranges (the orchestrator's allocation of 2026-10-06), so parallel tracks
never collide: D43–D59 the main line (used up by Phases 6 and 8), D60–D69
purchasing (`feat/p7-purchasing`, D60–D66 used; ADR-018), D70–D79 staff
email sign-in (ADR-019), D80–D89 Shopify (Phase 10, ADR-020), D90–D99
staff roles (ADR-021), D100–D119 Phase 9 reporting (ADR-022), D120–D139
Phase 11 public site (ADR-023), D140 and up later work. Ranges used on
other tracks are reconciled when those branches are integrated.
ADR-001 stays at its original
path because code and migration comments cite it as "ADR-001".

| Record | Decisions covered | Status (2026-10-05) | Revisit trigger |
|---|---|---|---|
| [ADR-001](../ADR-001-architecture.md) | Architecture: stack, layers, auth, migrations, Supabase boundary, caching, PWA, observability, layout | Proposed in PR #1 (open draft); implemented on the stacked branches through Phase 2 | PR #1 merges (becomes accepted) |
| [ADR-002](ADR-002-devstack.md) | Docker-free devstack instead of the auth shim | Accepted (implemented, used by CI) | First hosted staging project; a pinned service version change |
| [ADR-003](ADR-003-customer-access.md) | Staff-only base tables, customer `my_*` RPCs, explicit anonymous projections | Accepted (implemented and tested) | Phase 11 public-site integration / customer sign-up |
| [ADR-004](ADR-004-cult-commons.md) | SPEC §10 rule, D1, D21 | SPEC §10 fixed by the brief; D1, D21 accepted | A new explicit rule for negative yield (SPEC §10) |
| [ADR-005](ADR-005-staff-sign-in-and-delegation.md) | D10, D11 | D10 changed by the owner 2026-10-05 (email OTP, parallel track); D11 accepted | Email OTP merges into this line |
| [ADR-006](ADR-006-customer-and-public-visibility.md) | D8, D12, D13, D17, D19, D42 | D12 owner-confirmed; others accepted | Phase 11 shows these to customers |
| [ADR-007](ADR-007-short-ids-and-qr-base.md) | D9 | Accepted; QR base decided in Phase 8 by ADR-017 | Short-ID format change |
| [ADR-008](ADR-008-work-order-lifecycle.md) | D15, D16, D18, D20, D22 | D15 owner-confirmed (with its reopen deviation); others accepted | Phase 9 reporting restates periods |
| [ADR-009](ADR-009-line-pricing-and-cost-pending.md) | D14 | Owner-confirmed with clarification | Owner picks one of the cost-pending options |
| [ADR-010](ADR-010-stock-and-units-on-jobs.md) | D6, D23–D29 | D24 amended, D27 changed (implemented by Phase 6, D44), D29 owner-confirmed; others accepted | First D29 workaround (proposed) |
| [ADR-011](ADR-011-recognition-and-financial-reporting.md) | D3, D30–D34 | D32 owner-confirmed; others accepted | Phase 9 reporting |
| [ADR-012](ADR-012-shop-time-zone-and-currency.md) | D35 | Accepted | A second shop, time zone or currency |
| [ADR-013](ADR-013-appointments.md) | D2, D36–D41 | Accepted | Phase 11 customer booking; reschedule or messaging requested |
| [ADR-014](ADR-014-defaults-for-unbuilt-phases.md) | D4, D5, D7 | Accepted defaults; D4 implemented by Phase 6, D7 implemented for retail refunds by Phase 6 (D49) and for online refunds by Phase 10 (D85, ADR-020), D5 not implemented on this branch | The purchasing track is integrated (D5) |
| [ADR-015](ADR-015-documentation-stack.md) | D43 DOCS-STACK | Accepted | Toolkit version change; an issue tracker is adopted |
| [ADR-016](ADR-016-consignment-and-sales.md) | D44–D55 (consignment and in-store sales; D54 and D55 from the Phase 6 review), the implementation of the owner's D27 change, D4 | Accepted: build defaults, owner to confirm; implemented by Phase 6; D53 and D55 have open questions | Owner confirms a row; D53 or D55 answered; Phase 9 refund reporting (D49) |
| [ADR-017](ADR-017-labels-and-qr-base.md) | D9 (QR base), D56–D59 (labels) | Accepted: build defaults, not individually confirmed by the owner; built in Phase 8 (steps 1–4, `feat/p8-labels`) | Label printers inspected (Phase 12); the public address changes; owner confirms a row |
| [ADR-020](ADR-020-shopify.md) | D80–D89 (Shopify: online price and recognition, unique products, stock, location, publishing and catalogue, refunds, access and customer linking, retries, rejected deliveries and retention, tax basis and test/POS orders); applies D7 to online refunds | Accepted: build defaults, owner to confirm; D89's tax basis and Shopify POS OPEN for the owner; built by Phase 10 (`feat/p10-shopify`) | Owner answers D89 or confirms a row; the first real Shopify store (R-011); Phase 9's refund-reporting row |
