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
directory holds the reasoning. New main-line rows take D43–D59; D60 and up
are already used by the purchasing track (`feat/p7-purchasing`, D60–D66) and
are reconciled when that branch is integrated. ADR-001 stays at its original
path because code and migration comments cite it as "ADR-001".

| Record | Decisions covered | Status (2026-10-05) | Revisit trigger |
|---|---|---|---|
| [ADR-001](../ADR-001-architecture.md) | Architecture: stack, layers, auth, migrations, Supabase boundary, caching, PWA, observability, layout | Proposed in PR #1 (open draft); implemented on the stacked branches through Phase 2 | PR #1 merges (becomes accepted) |
| [ADR-002](ADR-002-devstack.md) | Docker-free devstack instead of the auth shim | Accepted (implemented, used by CI) | First hosted staging project; a pinned service version change |
| [ADR-003](ADR-003-customer-access.md) | Staff-only base tables, customer `my_*` RPCs, explicit anonymous projections | Accepted (implemented and tested) | Phase 11 public-site integration / customer sign-up |
| [ADR-004](ADR-004-cult-commons.md) | SPEC §10 rule, D1, D21 | SPEC §10 fixed by the brief; D1, D21 accepted | A new explicit rule for negative yield (SPEC §10) |
| [ADR-005](ADR-005-staff-sign-in-and-delegation.md) | D10, D11 | D10 changed by the owner 2026-10-05 (email OTP, parallel track); D11 accepted | Email OTP merges into this line |
| [ADR-006](ADR-006-customer-and-public-visibility.md) | D8, D12, D13, D17, D19, D42 | D12 owner-confirmed; others accepted | Phase 11 shows these to customers |
| [ADR-007](ADR-007-short-ids-and-qr-base.md) | D9 | Accepted; QR base open until Phase 8 | Phase 8 (labels) starts |
| [ADR-008](ADR-008-work-order-lifecycle.md) | D15, D16, D18, D20, D22 | D15 owner-confirmed (with its reopen deviation); others accepted | Phase 9 reporting restates periods |
| [ADR-009](ADR-009-line-pricing-and-cost-pending.md) | D14 | Owner-confirmed with clarification | Owner picks one of the cost-pending options |
| [ADR-010](ADR-010-stock-and-units-on-jobs.md) | D6, D23–D29 | D24 amended, D27 changed (implemented by Phase 6, D44), D29 owner-confirmed; others accepted | First D29 workaround (proposed) |
| [ADR-011](ADR-011-recognition-and-financial-reporting.md) | D3, D30–D34 | D32 owner-confirmed; others accepted | Phase 9 reporting |
| [ADR-012](ADR-012-shop-time-zone-and-currency.md) | D35 | Accepted | A second shop, time zone or currency |
| [ADR-013](ADR-013-appointments.md) | D2, D36–D41 | Accepted | Phase 11 customer booking; reschedule or messaging requested |
| [ADR-014](ADR-014-defaults-for-unbuilt-phases.md) | D4, D5, D7 | Accepted defaults; D4 implemented by Phase 6, D7 implemented for retail refunds by Phase 6 (D49), D5 and online D7 not implemented on this branch | Phases 7 and 10 start |
| [ADR-015](ADR-015-documentation-stack.md) | D43 DOCS-STACK | Accepted | Toolkit version change; an issue tracker is adopted |
| [ADR-016](ADR-016-consignment-and-sales.md) | D44–D53 (consignment and in-store sales), the implementation of the owner's D27 change, D4 | Accepted: build defaults, owner to confirm; implemented by Phase 6; D53 has an open question | Owner confirms a row; D53 answered; Phase 9 refund reporting (D49) |
