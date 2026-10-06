# Handover: go-live and remaining work (2026-10-06, written 18:xx SGT)

Read this first in the new session. It is written by the build session that
ran phases 0-10 and roles. That session (call it BUILD) keeps building on
branches and pushing them; it can push git but can no longer use the GitHub
API for this repository after the transfer to `georgieboys`. The new session
(call it GO-LIVE) owns PRs, merges, the database and the deploy.

The repository is public: no secrets, keys or connection strings in this file,
in docs, in PRs or in chat. Times are SGT (UTC+8) for the owner.

## Owner decisions and authorisations (verbatim where quoted)

- "lets go and build and merge all as soon as you can" and "you have my go
  ahead to get all done and push everything live": merge green PRs to main;
  apply migrations to the hosted Supabase project; deploy.
- "I want the admin side up first. Shopify can wait after admin is live."
  then "Ok let's go live and build after": go live with what is on main now
  (phases 0-7, staff email sign-in, staff roles); labels, reporting and
  Shopify follow as normal updates.
- First admin login: george@chaosactive.com (owner confirmed).
- The public site PR from Phase 11 (repo georgieboys/BICII) may be merged once
  green, after the admin app is live on the same database.
- Staff roles: admin / manager / mechanic, managers get every permission except
  manage_staff and may refund; per-person exceptions stay (merged in #13).
- Owner answers still open: consignment questions 9-14 in docs/PRODUCT.md, the
  D44-D55 defaults, reporting's refund netting (question 12), D60 (accepted as
  built for the exception case, owner informed).

## State of the repository (main = a1aebf6)

Merged into main: #1 plan, #2 foundation, #3 customers/bikes, #4 workshop,
#5 inventory, #6 finance/Today, #7 appointments, #8 docs stack, #11 consignment,
#9 purchasing, #10 staff email sign-in, #13 staff roles.

Open or in progress (BUILD session):
- PR #12 labels (`feat/p8-labels`): `main` merged in locally and integrated
  (commits 51718b8, 01cb3da incl. the receive screen "Print N labels"); its
  final gate is running in BUILD; BUILD will push the branch when green. PR #12
  then needs its body refreshed and merging once CI is green.
- Shopify (`feat/p10-shopify`): built, reviewed, gate green on its own; BUILD
  integrates it on top of the integrated labels branch, then pushes it. No PR
  yet: open one into main (label `e2e`) after #12.
- Reporting (`feat/p9-reporting`): build step 4 of 4 in BUILD, then review,
  fixes, gate; BUILD pushes the branch; open its PR into main (label `e2e`).
- Phase 11 public site: not started. Briefs and the plan are in docs/PLAN.md
  Phase 11; numbering D120-D139, ADR-023, R-065..R-074, migrations must sort
  after everything live (see "Migrations after go-live").

Merge order: #12 labels, then Shopify, then reporting (whichever merges second
must merge main first), then Phase 11 (both repos).

## Hosted Supabase (project "bicii-book", ref jyqldiqfwrdnvlqibgvi, ap-southeast-1)

- Exactly ONE migration is applied: `20261004000100_foundation`. Its history
  row was corrected to version `20261004000100`, name `foundation`, so the
  Supabase CLI matches the file.
- The other 46 migrations on main are NOT applied. Applying them through the
  Supabase MCP connector stalls: the connector holds any statement containing a
  delete (even inside a function body) for the user's confirmation.
- Recommended: a GitHub Actions workflow `.github/workflows/migrate.yml` that
  runs `npx supabase@2.119.0 db push --db-url "$SUPABASE_DB_URL"` (with a
  `--dry-run` step first, never `--include-seed`) on workflow_dispatch and on
  pushes to main that touch `supabase/migrations/**`. The owner adds the GitHub
  Actions secret `SUPABASE_DB_URL` (session pooler connection string) to
  georgieboys/bicii-book; never print it. Run it once to load the 46 files,
  then `get_advisors` (security + performance) and report findings.
- Supabase added `public.rls_auto_enable()` (event trigger helper, EXECUTE to
  anon/authenticated); not ours; may trip the API-surface meta test or the
  advisors; note it, do not drop it without the owner.
- Never apply `supabase/seed.sql` to the hosted project.

### Owner checklist in the Supabase dashboard (from docs/RUNBOOK.md)
1. Emails -> SMTP: custom provider (password typed in the dashboard only).
2. Emails -> Templates: Magic Link = `supabase/templates/magic_link.html`,
   subject "Your BICII sign-in code"; Confirm signup = `confirmation.html`,
   subject "Your BICII code" (both `{{ .Token }}`, no link).
3. Providers -> Email: enabled; OTP length 6; expiry 600 s; new sign-ups off;
   "Secure password change" on.
4. Rate limits: 60 s between emails to one address; sign-ins and token
   verifications at least 150 per 5 minutes per IP; hourly email cap with
   headroom.
5. URL configuration: Site URL = the Admin production URL; redirect URLs for
   Vercel previews.
6. Data API exposed schemas: public and reporting (plus graphql_public), never
   private.
7. After migrations: buckets media-internal (private) and media-public exist;
   no hand-made buckets or extra policies.
8. Test SMTP: send a magic link to the owner's address; it must contain a
   6-digit code and no link.
9. First admin: create the user george@chaosactive.com (auto-confirm, no
   usable password), then run the RUNBOOK's `insert into public.staff ... 'admin'`
   SQL (exactly one row); sign in with a code; invite others from Settings ->
   Staff.
10. The RUNBOOK's "replace staff passwords" step does not apply (never had
    password logins).

## Vercel

- Team: abhishekcheriangeorge (team_0xyAmXN8FLgzLRjW5O3mauFA).
- Project `bicii-book` (prj_EA2dE3nhYeML0Pe61sowqIZUcfla) created, framework
  Next.js, Node 22.x, functions in sin1, deployment protection = standard
  (production domain public, previews protected).
- Environment variables already set (production + preview):
  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (public anon key),
  NEXT_PUBLIC_PUBLIC_SITE_URL (https://bicii.vercel.app), LOG_LEVEL,
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY.
- Missing: SUPABASE_SERVICE_ROLE_KEY (owner pastes it in the Vercel dashboard,
  Sensitive; without it nobody can sign in). Shopify variables later.
- Not yet linked to Git: the Vercel GitHub app could not see the repo under the
  old owner. Link `georgieboys/bicii-book` (Settings -> Git -> Connect),
  production branch main. The existing Vercel project `bicii` is the public
  site (bicii.vercel.app); do not touch it until Phase 11.
- After the database is loaded and the service-role key is set: deploy main,
  open the sign-in page, request a code for the first admin.

## Migrations after go-live (important)

Hosted migrations must only ever be appended. Labels (20261004003800...),
Shopify (20261004003900-0042xx) and any reconciling files sort BEFORE
migrations already live. Before merging any of them after go-live, rename their
files to a prefix later than the newest live migration (e.g. the current UTC
timestamp), keeping their relative order, and check every object they redefine
against the live definitions (staff_search, has_permission and permission
checks from staff roles, refunds, sales/stock functions). Then the migrate
workflow applies them on merge.

## Conventions

AGENTS.md is the contract (Next.js 16 rules, non-negotiable business semantics,
documentation maintenance contract, numbering ranges). PR bodies follow
.github/pull_request_template.md and end with the Claude Code footer; label
`e2e` on app PRs; merge with merge commits (never squash a stacked branch).
