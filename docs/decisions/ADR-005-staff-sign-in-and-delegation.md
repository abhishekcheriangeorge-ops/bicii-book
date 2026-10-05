# ADR-005: Staff sign-in method and the staff-management delegation ceiling

Date: D10 2026-10-04 (PR #1); D11 2026-10-04 (PR #2); D10 changed by the
owner 2026-10-05. Status: D10 changed by the owner 2026-10-05 and
superseded by [ADR-019](ADR-019-staff-email-sign-in.md) (email codes,
integrated 2026-10-06); D11 accepted (build default, not individually
confirmed).
Decision owner: Abhishek Cherian George (owner) for business meaning;
defaults proposed by the build agent.

Status update 2026-10-06: the email-code sign-in is integrated into the
main line ([ADR-019](ADR-019-staff-email-sign-in.md), D10 rewritten, D70–D72).
D10 as first built (email + password) is superseded by ADR-019; D11's
ceiling is unchanged; its temporary-password residual risk is gone for
every invite (no password is created or shown) and, for logins created
before the switch, once RUNBOOK's required reset has run
([R-035](../RISKS.md#r-035--logins-created-before-email-codes-keep-a-known-password-until-the-pre-deploy-reset)).
The owner's note "D11 changed" is read as the sign-in method, as the
orchestrator's owner-decision list records. The sections below are kept as
written on 2026-10-05.

## Context

SPEC §4 asks for staff authentication and granular permissions, but does
not say how staff sign in or who may grant permissions (SPEC §4.2). Staff
logins are created by admins through the Supabase Auth admin API.

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D10 | Staff sign in with Supabase email + password; invitations by an admin from Staff settings; no magic links in MVP | Changed by the owner 2026-10-05: staff sign-in moves to Supabase email OTP. That work is on the parallel track and is not on this branch; this branch still signs in with email + password | `/login` (`src/app/(auth)/login/actions.ts`), `src/lib/admin/staff-logins.ts`; `tests/e2e/auth.spec.ts`, `tests/e2e/staff.spec.ts` |
| D11 | Delegation ceiling: a non-admin `manage_staff` holder grants or revokes only permissions they hold, never `manage_staff`, never on their own or an admin's row; may invite (role staff) and deactivate/reactivate non-admins; admins unrestricted | Accepted; ceiling unchanged in code | `20261004000500_staff_history.sql`; `tests/db/staff-history.test.ts`, `tests/unit/auth-helpers.test.ts` |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner), rows D10
and D11.

The owner's note of 2026-10-05 reads "D11 changed (staff email OTP)". On this
branch the sign-in method is D10 and D11 is the delegation ceiling, so the
change is recorded against D10. D11's stated residual risk (an inviter sees
the new login's temporary password, so a manager could keep a second login
at their own permission level) is expected to disappear with OTP, because no
password would be shown; that is unverified until the OTP work merges. The
owner is asked to confirm this mapping
([RISKS R-004](../RISKS.md#r-004--staff-sign-in-change-pending-email-otp)).

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| Invite links (named in D11) | Not in MVP; would close the temporary-password residual risk |
| Forced password change on first sign-in (named in D11) | Not in MVP; same purpose |
| Magic links (excluded by D10) | Excluded for MVP by D10; superseded in direction by the owner's OTP change |

## Consequences

- Until OTP merges, the invite screen shows a generated temporary password
  to the inviter (`src/app/(staff)/settings/staff/new/invite-form.tsx`).
- RUNBOOK's hosted Auth steps ("Hosted Supabase projects") describe email +
  password settings and will need revising when OTP merges.
- Hosted email delivery (SMTP), which OTP needs, is not configured anywhere.

## Revisit trigger

The email OTP work is integrated into this line (then D10 gets a superseding
record or row), or the owner answers the D10/D11 mapping question.

## Evidence and links

- [RISKS R-004](../RISKS.md#r-004--staff-sign-in-change-pending-email-otp).
- [ADR-001 A3](../ADR-001-architecture.md#a3-authentication-and-authorization).
- No `feat/auth-email-otp` ref exists locally or on origin (checked
  2026-10-05 with `git for-each-ref` and `git ls-remote --heads origin`).
