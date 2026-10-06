# ADR-019: Staff sign in with emailed one-time codes

Date: 2026-10-05 (built on `feat/auth-email-otp` from Phase 5's head);
integrated with main and purchasing 2026-10-06. Status: D10 changed by the
owner 2026-10-05 and built; D70–D72 accepted (build defaults within the
owner's change, not individually confirmed). Decision owner: Abhishek
Cherian George (owner) for business meaning; defaults proposed by the
build agent. Supersedes the password half of
[ADR-005](ADR-005-staff-sign-in-and-delegation.md) (D10 as first built);
D11, the delegation ceiling, stays in ADR-005.

## Context

Phase 0 signed staff in with Supabase email + password, and an invite
showed the inviter the new login's temporary password, so a manager could
keep a second login at their own permission level (D11's residual risk).
On 2026-10-05 the owner changed staff sign-in to Supabase email one-time
codes (the owner's note "D11 changed (staff email OTP)"; D11 on that note is
the sign-in method, recorded here as D10). The Admin is an installed PWA
used on shop phones and iPads; staff addresses are not secret; Supabase
Auth is shared with the public site, which will sign customers in with
codes too (Phase 11).

## Decision and rationale

| D | Rule (short) | Status | Implemented in |
|---|---|---|---|
| D10 | `/login` asks for an email, Auth emails a 6-digit code (`signInWithOtp`, `shouldCreateUser: false`), the person types it (`verifyOtp`, type `email`). Codes only, no clickable links. No password anywhere in the Admin; no staff login has a known password (seed, invites and the pre-deploy reset store the hash of a random secret). Invites create the Auth user without a password through the admin API | Owner decision 2026-10-05; built | `src/app/(auth)/login/`, `src/lib/auth/otp.ts`, `src/lib/auth/sign-in-errors.ts`, `src/lib/admin/staff-logins.ts`, `supabase/templates/`; `tests/e2e/auth.spec.ts`, `tests/e2e/staff.spec.ts`, `tests/db/stack.smoke.test.ts` |
| D70 | Code rules: 6 digits, 10 minutes, newest only, once; resend after 60 s; one message for every bad code; an unknown email, Auth's per-address refusal and a sent code look the same ("Check your email"); limits that do not depend on the address say so; only active staff are admitted after a code | Accepted | `src/lib/auth/otp.ts`, `src/lib/auth/sign-in-errors.ts`, `src/app/(auth)/login/actions.ts`; `tests/unit/sign-in-errors.test.ts`, `tests/unit/otp.test.ts`, `tests/e2e/auth.spec.ts` |
| D71 | Deactivation deletes the person's Auth sessions and refresh tokens in the same transaction (trigger `staff_revoke_sessions`); an access token already issued is refused by `requireStaff`, RLS and the RPC guards until it expires | Accepted | `20261005005000_staff_session_revocation.sql`; `tests/db/staff-sessions.test.ts`, `tests/db/staff-sessions.stack.test.ts`, `tests/unit/session-guard.test.ts`, `tests/e2e/staff.spec.ts` |
| D72 | The Admin's own sign-in limits per client address and per email (5-minute windows: requests 10 and 5, verifications 20 and 10), counted in Postgres before Auth is asked | Accepted | `20261005006000_sign_in_throttle.sql`, `src/lib/auth/sign-in-limits.ts`, `src/lib/admin/sign-in-throttle.ts`; `tests/db/sign-in-throttle.test.ts`, `tests/db/sign-in-throttle.stack.test.ts`, `tests/unit/sign-in-limits.test.ts` |

Full text: [PLAN §6](../PLAN.md#6-open-decisions-for-the-owner), rows D10,
D11 and D70–D72.

Codes, not links: a link opens in the mail app's browser, not in the
installed Admin, so the session would land in the wrong place. The
devstack runs a small generic mail catcher (`scripts/devstack/mailcatcher.mjs`)
so the real Auth email path is exercised locally and in CI; it knows
nothing about staff, so Phase 11 can read customer codes from it too.

## Alternatives actually considered

| Option | Why chosen or rejected |
|---|---|
| Keep email + password, add a forced change on first sign-in | Rejected by the owner's change; still leaves passwords to manage on shared shop devices |
| Magic links | Rejected: the link opens outside the installed PWA (D70) |
| Invite links with a password set by the invitee | Not needed: an invite now creates no password and only the invited mailbox receives codes |
| Relying on Auth's per-IP limits alone | Rejected (D72): the Admin's server calls Auth, so every visitor shares one bucket |
| Ending sessions through the Auth admin API on deactivation | Rejected (D71): a trigger fires for every writer and commits or rolls back with the deactivation |

## Consequences

- Email delivery is part of signing in: hosted projects need a custom SMTP
  provider, the code-only templates and the Auth settings in
  [RUNBOOK "Hosted Supabase projects"](../RUNBOOK.md#hosted-supabase-projects-staging-and-production);
  none of it is verified ([R-039](../RISKS.md#r-039--hosted-email-delivery-and-auth-settings-are-unverified)).
- Logins created before the switch keep their old password until RUNBOOK's
  required reset runs ([R-035](../RISKS.md#r-035--logins-created-before-email-codes-keep-a-known-password-until-the-pre-deploy-reset)).
- Auth's password grant and password change stay reachable with the anon
  key ([R-036](../RISKS.md#r-036--auths-password-grant-and-password-change-stay-reachable)).
- Auth's `/otp` endpoint tells a direct API caller whether an address has a
  login ([R-037](../RISKS.md#r-037--auths-otp-endpoint-reveals-whether-an-address-has-a-login)).
- A visitor who knows a staff email can delay its sign-in
  ([R-038](../RISKS.md#r-038--a-visitor-who-knows-a-staff-email-can-delay-its-sign-in)).
- Tests sign in through codes only: the E2E helper reads them from the mail
  catcher, and API and stack helpers generate them with the service-role
  admin API; the seeded customer login (Chloe Lim) has no usable password
  either.

## Revisit trigger

The staff roles (D90–D99, ADR-021) change who may invite; the public site
starts signing customers in (Phase 11); the first hosted project is set
up; Auth's `/otp` behaviour for unknown emails changes. Since
[ADR-021](ADR-021-staff-roles.md) (2026-10-06): the roles trigger fired
and was reviewed; invites now pick a role (D93), and the sign-in method,
D70–D72 and R-035 to R-039 are unchanged.

## Evidence and links

- Branch `feat/auth-email-otp` (PR #10), merged with
  `origin/feat/p7-purchasing` on 2026-10-06.
- [RISKS R-035 to R-039](../RISKS.md#r-035--logins-created-before-email-codes-keep-a-known-password-until-the-pre-deploy-reset).
- [ADR-001 A3](../ADR-001-architecture.md#a3-authentication-and-authorization),
  [ADR-005](ADR-005-staff-sign-in-and-delegation.md).
