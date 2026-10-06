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
directory holds the reasoning. Numbers are allocated by track (2026-10-06),
never "the next free": D43–D59 main line (labels D56–D59), D60–D69
purchasing (D60–D66 used), D70–D79 staff email sign-in, D80–D89 Shopify,
D90–D99 staff roles, D100–D119 reporting, D120–D139 public site; records
ADR-017 labels, ADR-018 purchasing, ADR-019 email sign-in, ADR-020
Shopify, ADR-021 staff roles, ADR-022 reporting, ADR-023 public site (a
record lands with its track, so a gap in the numbers here is expected).
ADR-001 stays at its original
path because code and migration comments cite it as "ADR-001".

| Record | Decisions covered | Status (2026-10-05) | Revisit trigger |
|---|---|---|---|
| [ADR-001](../ADR-001-architecture.md) | Architecture: stack, layers, auth, migrations, Supabase boundary, caching, PWA, observability, layout | Proposed in PR #1 (open draft); implemented on the stacked branches through Phase 2 | PR #1 merges (becomes accepted) |
| [ADR-002](ADR-002-devstack.md) | Docker-free devstack instead of the auth shim | Accepted (implemented, used by CI) | First hosted staging project; a pinned service version change |
| [ADR-003](ADR-003-customer-access.md) | Staff-only base tables, customer `my_*` RPCs, explicit anonymous projections | Accepted (implemented and tested) | Phase 11 public-site integration / customer sign-up |
| [ADR-004](ADR-004-cult-commons.md) | SPEC §10 rule, D1, D21 | SPEC §10 fixed by the brief; D1, D21 accepted | A new explicit rule for negative yield (SPEC §10) |
| [ADR-005](ADR-005-staff-sign-in-and-delegation.md) | D10 (as first built: email + password), D11 | D10 changed by the owner 2026-10-05 and superseded by ADR-019 (email codes, integrated 2026-10-06); D11 accepted, ceiling unchanged; since ADR-021 restated for roles by D93 | The owner answers question 1 or 20 (D93) |
| [ADR-006](ADR-006-customer-and-public-visibility.md) | D8, D12, D13, D17, D19, D42 | D12 owner-confirmed; others accepted | Phase 11 shows these to customers |
| [ADR-007](ADR-007-short-ids-and-qr-base.md) | D9 | Accepted; QR base open until Phase 8 | Phase 8 (labels) starts |
| [ADR-008](ADR-008-work-order-lifecycle.md) | D15, D16, D18, D20, D22 | D15 owner-confirmed (with its reopen deviation); others accepted | Phase 9 reporting restates periods |
| [ADR-009](ADR-009-line-pricing-and-cost-pending.md) | D14 | Owner-confirmed with clarification | Owner picks one of the cost-pending options |
| [ADR-010](ADR-010-stock-and-units-on-jobs.md) | D6, D23–D29 | D24 amended, D27 changed (implemented by Phase 6, D44), D29 owner-confirmed; others accepted | First D29 workaround (proposed) |
| [ADR-011](ADR-011-recognition-and-financial-reporting.md) | D3, D30–D34 | D32 owner-confirmed; others accepted | Phase 9 reporting |
| [ADR-012](ADR-012-shop-time-zone-and-currency.md) | D35 | Accepted | A second shop, time zone or currency |
| [ADR-013](ADR-013-appointments.md) | D2, D36–D41 | Accepted | Phase 11 customer booking; reschedule or messaging requested |
| [ADR-014](ADR-014-defaults-for-unbuilt-phases.md) | D4, D5, D7 | Accepted defaults; D4 implemented by Phase 6, D5 by Phase 7 (refined by D63), D7 implemented for retail refunds by Phase 6 (D49); online D7 not implemented | Phase 10 starts |
| [ADR-015](ADR-015-documentation-stack.md) | D43 DOCS-STACK | Accepted | Toolkit version change; an issue tracker is adopted |
| [ADR-016](ADR-016-consignment-and-sales.md) | D44–D55 (consignment and in-store sales; D54 and D55 from the Phase 6 review), the implementation of the owner's D27 change, D4 | Accepted: build defaults, owner to confirm; implemented by Phase 6; D53 and D55 have open questions | Owner confirms a row; D53 or D55 answered; Phase 9 refund reporting (D49) |
| [ADR-018](ADR-018-purchasing.md) | D60–D66 (purchasing), the implementation of D5 | D60 accepted, owner informed; since ADR-021 (staff roles, built) it covers only the exception case, a mechanic granted `manage_purchasing`, as managers see costs through their role; D61–D66 accepted: build defaults, owner to confirm; implemented by Phase 7 | Owner confirms a row or objects to the D60 exception case; purchase reports (Phase 9) |
| [ADR-019](ADR-019-staff-email-sign-in.md) | D10 (email one-time codes, the owner's change of 2026-10-05), D70–D72 | D10 owner decision, built; D70–D72 accepted: build defaults, owner to confirm; integrated with main and purchasing 2026-10-06 | Phase 11 customer sign-in; the first hosted project (the staff roles trigger was reviewed with ADR-021: sign-in unchanged) |
| [ADR-021](ADR-021-staff-roles.md) | D90–D94 (staff roles admin, manager, mechanic; exceptions on top; role administration; refunds for managers, amending D49 and restating D11) | D90, D91, D94 owner decisions 2026-10-06, built (database, app, staff screens; integration-reviewed); D92 accepted, owner to confirm; D93 owner decision with a build-default part, owner to confirm (owner question 20) | The owner confirms D92/D93; a fourth role; a new permission; a hosted project before this lands |
| [ADR-022](ADR-022-reporting.md) | D100–D105 (period reporting: date bases, restatement, refunds beside gross, mechanic attribution, shop-currency totals, purchases and stock value); D106–D108 (stock reconciliation without a balance cache, the unsettled-consignment alert, per-kind exception visibility) | Accepted: build defaults, owner to confirm (owner questions 21 and 22; D102 is the build default for question 12); database built in Phase 9 steps 1 and 3, screens in steps 2 and 4 (2026-10-06; Phase 9 complete on `feat/p9-reporting`, not pushed) | The owner answers question 12, 21 or 22; a measured report slowdown (R-059); Phase 10's online refunds and its merge (R-058) |
