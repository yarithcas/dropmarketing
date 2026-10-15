# Architecture

```
Browser (React client components, i18next, Recharts)
   │  fetch /api/*  (JSON, Zod-validated)
   ▼
Next.js route handlers ── guard(): rate limit · auth (live) · plan metering · dataset load
   │
   ├─ lib/server/repository.ts          research reads (demo dataset or cached DB snapshot)
   ├─ lib/server/supabase-repository.ts DB-side filtering/sorting/pagination (live mode)
   ├─ lib/scoring.ts                     transparent opportunity score (pure)
   ├─ lib/profitability.ts               unit economics (pure, locale-independent)
   ├─ lib/alerts.ts + server/alert-runner.ts  rule evaluation → notifications (+ email)
   ├─ lib/analyst/*  + server/ai.ts      rule-based analyst / Claude with structured output
   ├─ lib/connectors/*                   ingestion connectors (official APIs, licensed, public pages)
   ├─ server/scan.ts  ← /api/cron/scan   background job: due connectors → aggregate → score → alerts → retention
   ├─ lib/monitoring.ts                  due-ness, plan filtering, live-data filter, retention cutoffs (pure)
   ├─ server/shopify.ts                  merchant OAuth, HMAC, encrypted tokens, sync
   └─ server/stripe.ts + billing routes  checkout, portal, verified webhook
   ▼
Supabase Postgres (supabase/migrations/*.sql) — RLS on every table
Supabase Postgres (supabase/migrations/*.sql, applied in order) — RLS on every table
```

## Modes

| | Demo mode (no env) | Live mode (Supabase configured) |
|---|---|---|
| Research data | deterministic in-memory demo dataset | Postgres, written by connectors / seed |
| Auth | optional demo profile cookie | Supabase Auth (email + password), `/app` protected by middleware |
| Workspace | `localStorage`, seeded per language | `collections`, `collection_items`, `watchlists`, `alerts`, `notifications` with RLS |
| Plan | demo plan cookie (Pro by default) | `subscriptions` updated only by Stripe webhook |
| Usage limits | in-memory per visitor | `usage_events` table |
| Alerts | manual check against demo snapshot, labelled | Vercel Cron → `/api/cron/scan` → notifications + email, on live data only |

If Supabase is configured but contains no research rows, the UI shows empty states — demo data is never
presented as live. Alert rules are never evaluated on demo data in live mode: without real research rows a
run is recorded as skipped. Scheduling and retention: see [DATA_SOURCES.md](DATA_SOURCES.md#scheduling).

## Opportunity score (0–100)

Six components, each linearly normalized to 0–100 (bounds in `NORMALIZATION`), weighted:
trend momentum 25 %, advertising traction 20 %, estimated gross margin 20 %, competition & saturation 15 %,
differentiation 10 %, freshness & evidence quality 10 %. Missing components are excluded and weights
re-normalized. The score is **withheld** (“Insufficient data”) with < 14 days of observations, < 3 ads, or
≥ 2 missing components. A confidence level, positive/negative signals and next steps are derived from the
same inputs. The UI shows the formula on every product page.

## Workspaces, teams and roles (live mode)

- **Organization = workspace.** A user can belong to several (`organization_members`, roles `owner` · `admin` ·
  `member`). Sign-up still creates a personal workspace. The active one comes from the httpOnly `th_org` cookie,
  re-validated on every request against `my_workspaces()`; fallback = the oldest owned membership
  (`lib/team.ts#pickActiveWorkspace`). `getSession()` exposes `organizationId`, `role`, `billingOrganizationId`
  and all memberships.
- **Billing.** Workspaces created by a Business owner/admin are billed under the active workspace's billing
  organization (`organizations.billing_organization_id`, one level). The plan of a workspace is the active
  subscription of `coalesce(billing_organization_id, id)` (`public.org_plan()`). Checkout and portal act on that
  billing organization and require owner/admin there (`lib/server/roles.ts`, 403 `role_required`).
- **Limits.** `entitlements.workspaces` counts the billing organization plus the workspaces it pays for;
  `entitlements.seats` counts distinct members across them plus open, unexpired invitations
  (`lib/team.ts#seatUsage`). Invitations require a plan with more than one seat (Business).
- **Invitations.** `organization_invitations` stores the normalized email, role (`admin`/`member`), a SHA-256 hash
  of a 32-byte token (the raw token only exists in the link), inviter and a 7-day expiry. The link is always
  returned to the inviter and also emailed when `RESEND_API_KEY` is set. `/app/invite?token=…` lets the signed-in
  user whose confirmed email matches accept it; a lost link is replaced, never shown again.
- **Routes.** `/api/team` (members, invitations, seats, `canManage`), `/api/team/invitations[/:id[/link]]`,
  `/api/team/invitations/{lookup,accept}`, `/api/team/members/:userId` (role change, removal, leave — never the
  last owner), `/api/workspaces[/:id]` (list, create, rename) and `/api/workspaces/switch`. Membership,
  invitation and workspace writes use the service role after role, plan and seat checks; clients have no
  write policy on those tables.
- **Data scoping.** `collections`, `watchlists`, `alerts` and `notifications` carry `organization_id` (backfilled
  from each user's first organization; inserts without one default to it). `loadWorkspace`/`applyOpDb` work on
  the active workspace only; each member gets a lazily created swipe file per workspace. Collections are
  `private` or `team`: members read team collections and their items (RLS), only the creator edits them.
- SQL checks for these policies: `supabase/tests/0004_team_workspaces.test.sql` (two organizations, three users).

## Security

- Secrets only in server env (`lib/server/env.ts`, `import "server-only"`); `/api/session` exposes booleans.
- Zod validation on every query/body; same-origin check on state-changing routes; per-IP rate limiting.
- Postgres RLS: research tables read-only for authenticated users; user tables owner-only (team collections
  readable by workspace members); integration tokens and invitation token hashes readable only by the
  service role (column grants revoked).
- Postgres RLS: research tables read-only for authenticated users; user tables owner-only (alert runs
  included); operations logs (`connector_runs`, `scan_runs`) and integration tokens readable only by the
  service role; API routes return connector errors as short categories, never raw provider messages.
- Shopify: OAuth `state` cookie + HMAC verification, read-only scopes, AES-256-GCM token encryption.
- Stripe: plan changes only via signature-verified webhook.
- CSV exports neutralize spreadsheet formula injection. Security headers set in `next.config.ts`.
- GDPR: JSON export and account deletion (cascading deletes, subscription cancellation).

## Internationalization

`src/locales/{fr,en,es,de,it}.json` (French default). A Vitest suite enforces identical keys and
placeholders across languages and that every key used in the source exists. Dates, numbers and currencies
use `Intl` with the selected locale; calculations never depend on locale.
