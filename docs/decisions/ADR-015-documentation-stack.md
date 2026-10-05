# ADR-015: Adopt the Vibe Code Docs Stack, keeping the existing document names

Date: 2026-10-05. Status: accepted (PLAN §6 row D43, DOCS-STACK).
Decision owner: Abhishek Cherian George (owner directive of 2026-10-05);
the mapping below proposed by the build agent.

## Context

The repository had a build plan, an architecture record, a data model, a
testing strategy, a design system and a runbook, but no single place for the
current state, known risks, decision status or user tasks. Code, migrations
and CI cite existing documents by name and section ("ADR-001",
"DATA-MODEL §n", RUNBOOK section names). The owner directed on 2026-10-05
that the repository follow Vibe Code Docs Stack v0.2.0
(https://github.com/abhishekcheriangeorge-ops/vibe-code-docs-stack).

## Decision and rationale

Adopt the standard with one canonical home per responsibility, keeping
existing names wherever code or docs cite them:

| Responsibility | Home |
|---|---|
| Entry point and reading paths | `README.md` |
| Current state and next action | `NOW.md` |
| Agent contract | `AGENTS.md` (`CLAUDE.md` stays the one-line `@AGENTS.md` import) |
| Purpose, users, scope, domain rules, owner questions | `docs/PRODUCT.md` |
| Original requirement (verbatim, historical, still the requirement) | `docs/SPEC.md` |
| Phases and the decision index | `docs/PLAN.md` (§6 with Status and Record columns) |
| Architecture decision of record | `docs/ADR-001-architecture.md` (stays at this path) |
| Observed design | `docs/ARCHITECTURE.md` |
| Decision records | `docs/decisions/` ([README](README.md), ADR-002 onward) |
| Data authority, meaning, access, lifecycle, contracts | `docs/DATA-MODEL.md` (the standard's DATA.md; sections never renumbered) |
| Test strategy | `docs/TESTING.md` |
| Design system | `docs/DESIGN.md` |
| Setup, commands, conventions | `docs/ENGINEERING.md` |
| Environments, administration, release, diagnosis, recovery | `docs/OPERATIONS.md` |
| Step-by-step operator procedures | `docs/RUNBOOK.md` (linked from OPERATIONS) |
| Problems, shortcuts, gaps | [`docs/RISKS.md`](../RISKS.md) |
| Staff tasks | `docs/USER-GUIDE.md` |
| PR documentation-impact question | `.github/pull_request_template.md` |
| MIT notice for adapted templates | `LICENSES/vibe-code-docs-stack.txt` |

Further rules:

- Decision numbers: new main-line PLAN §6 rows take D43–D59; D60 and up are
  used by the purchasing track (`feat/p7-purchasing` has D60–D66) and are
  never reused here. Status update 2026-10-06: numbers, records and risk
  entries are now allocated per track (AGENTS.md item 2, PLAN §6); the
  purchasing track's D60–D66 kept their numbers at its integration, with
  ADR-018 and R-030–R-034.
- Backlog: there is no issue tracker in use (0 GitHub issues on
  2026-10-05). The backlog is the PLAN §2 phases plus the next actions in
  RISKS, with NOW naming the next action.
- Every phase updates the affected canonical docs with its code, adds a
  record here for each new decision (plus its PLAN §6 row), records known
  problems in RISKS with evidence, and updates NOW at the end.

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| Rename `DATA-MODEL.md` to `DATA.md` | Rejected: cited as "DATA-MODEL §n" across code, migrations and docs |
| Fold `RUNBOOK.md` into `OPERATIONS.md` | Rejected: migrations (`20261004000500_staff_history.sql`, `20261004002000_inventory_reporting.sql`), `src/lib/domain/staff.ts` and `.github/workflows/ci.yml` cite RUNBOOK by name, and a docs pass may not edit them |
| Copy ADR-001 into `docs/decisions/` | Rejected: two copies of one record |

## Consequences

- More documents to keep current; each PR states its documentation impact
  (`.github/pull_request_template.md`).
- PLAN §6 stays the one-line index, so a decision's status is visible next
  to its rule; the reasoning lives in one record.
- The templates are adapted under the MIT licence; the notice is kept in
  `LICENSES/vibe-code-docs-stack.txt`.

## Revisit trigger

A new version of the docs stack is adopted, or an issue tracker is adopted
(then it becomes the backlog).

## Evidence and links

- [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner) row D43.
- [Decision records index](README.md).
