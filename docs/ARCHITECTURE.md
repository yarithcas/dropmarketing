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
   ├─ server/scan.ts  ← /api/cron/scan   background job: ingest → aggregate → score → alerts
   ├─ server/shopify.ts                  merchant OAuth, HMAC, encrypted tokens, sync
   └─ server/stripe.ts + billing routes  checkout, portal, verified webhook
   ▼
Supabase Postgres (supabase/migrations/0001_init.sql) — RLS on every table
```

## Modes

| | Demo mode (no env) | Live mode (Supabase configured) |
|---|---|---|
| Research data | deterministic in-memory demo dataset | Postgres, written by connectors / seed |
| Auth | optional demo profile cookie | Supabase Auth (email + password), `/app` protected by middleware |
| Workspace | `localStorage`, seeded per language | `collections`, `collection_items`, `watchlists`, `alerts`, `notifications` with RLS |
| Plan | demo plan cookie (Pro by default) | `subscriptions` updated only by Stripe webhook |
| Usage limits | in-memory per visitor | `usage_events` table |
| Alerts | manual check against demo snapshot, labelled | Vercel Cron → `/api/cron/scan` → notifications + email |

If Supabase is configured but contains no research rows, the UI shows empty states — demo data is never
presented as live.

## Opportunity score (0–100)

Six components, each linearly normalized to 0–100 (bounds in `NORMALIZATION`), weighted:
trend momentum 25 %, advertising traction 20 %, estimated gross margin 20 %, competition & saturation 15 %,
differentiation 10 %, freshness & evidence quality 10 %. Missing components are excluded and weights
re-normalized. The score is **withheld** (“Insufficient data”) with < 14 days of observations, < 3 ads, or
≥ 2 missing components. A confidence level, positive/negative signals and next steps are derived from the
same inputs. The UI shows the formula on every product page.

## Security

- Secrets only in server env (`lib/server/env.ts`, `import "server-only"`); `/api/session` exposes booleans.
- Zod validation on every query/body; same-origin check on state-changing routes; per-IP rate limiting.
- Postgres RLS: research tables read-only for authenticated users; user tables owner-only; integration
  tokens readable only by the service role (column grants revoked).
- Shopify: OAuth `state` cookie + HMAC verification, read-only scopes, AES-256-GCM token encryption.
- Stripe: plan changes only via signature-verified webhook.
- CSV exports neutralize spreadsheet formula injection. Security headers set in `next.config.ts`.
- GDPR: JSON export and account deletion (cascading deletes, subscription cancellation).

## Internationalization

`src/locales/{fr,en,es,de,it}.json` (French default). A Vitest suite enforces identical keys and
placeholders across languages and that every key used in the source exists. Dates, numbers and currencies
use `Intl` with the selected locale; calculations never depend on locale.
