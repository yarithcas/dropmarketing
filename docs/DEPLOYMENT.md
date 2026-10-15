# Production deployment

TrendHunter runs anywhere Next.js 15 runs (Vercel recommended for built-in Cron). Each service below is
optional; the app reports in **Settings → Integrations** whether it is configured, and falls back to a
clearly labelled demo behaviour when it is not.

## 1. Required for a real multi-user product

### Supabase (database, auth, RLS)
1. Create a project at supabase.com.
2. Run the migration: `supabase db push` (or paste `supabase/migrations/0001_init.sql` into the SQL editor).
3. Auth → URL configuration: site URL = `NEXT_PUBLIC_APP_URL`, redirect URL = `${APP_URL}/auth/callback`.
4. Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only).
5. Optional: `npm run seed:demo` to load the labelled demo dataset into the database.

### Background jobs
- Set `CRON_SECRET` (random string). `vercel.json` schedules `/api/cron/scan` hourly (alerts),
  daily (ingestion + scoring + alerts) and weekly. Vercel sends `Authorization: Bearer $CRON_SECRET`.
- Other schedulers: `curl -H "Authorization: Bearer $CRON_SECRET" https://app/api/cron/scan?frequency=daily`.
- Results are logged in `connector_runs` and `alert_runs`; the Alerts page shows the last successful scan
  and recent failures.

## 2. Payments — Stripe
1. Create two recurring Prices (Pro, Business) → `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`.
2. `STRIPE_SECRET_KEY` (server only).
3. Webhook endpoint `${APP_URL}/api/billing/webhook` with events `checkout.session.completed`,
   `customer.subscription.created|updated|deleted` → `STRIPE_WEBHOOK_SECRET`.
4. Enable the Customer Portal (cancellation, plan switching).
Plans are granted **only** by the verified webhook. Until all four values are set, demo billing is used.

## 3. AI analyst — Anthropic
- `ANTHROPIC_API_KEY` (server only); `ANTHROPIC_MODEL` defaults to `claude-opus-5-5`.
- Requests use structured outputs, adaptive thinking, and server-side refusal fallbacks
  (`server-side-fallback-2026-07-01`, `fallbacks: "default"`). Only platform records are sent to the model;
  recommendations citing unknown ids are dropped. Without a key the deterministic rule-based analyst runs.

## 4. Shopify (merchant's own store)
1. Create an app in the Shopify Partner dashboard; App URL = `${APP_URL}`; allowed redirect URL =
   `${APP_URL}/api/integrations/shopify/callback`.
2. `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_SCOPES` (default `read_products,read_orders,read_inventory`),
   `SHOPIFY_API_VERSION`.
3. `ENCRYPTION_KEY` — `openssl rand -base64 32` (AES-256-GCM for access tokens at rest).
4. For order data older than 60 days Shopify requires `read_all_orders` approval (not requested by default).
5. Run migration `supabase/migrations/0006_shopify.sql` (revocation, daily inventory snapshots, manual market
   matches, store currency).
6. Webhooks — all delivered to `${APP_URL}/api/integrations/shopify/webhooks`, which verifies
   `X-Shopify-Hmac-Sha256` (base64 HMAC-SHA256 of the raw body with `SHOPIFY_API_SECRET`) and rejects
   unsigned requests with 401:
   | Topic | Effect |
   | --- | --- |
   | `app/uninstalled` | every connection to that shop is marked `revoked` and its token deleted |
   | `customers/data_request`, `customers/redact` | acknowledged: no customer personal data is stored (orders are aggregated per product and day) |
   | `shop/redact` | deletes all synced data of that shop (products, sales, inventory history, matches) and any token |
   With the Shopify CLI, declare them in `shopify.app.toml` and run `shopify app deploy`:
   ```toml
   [webhooks]
   api_version = "2025-07"

     [[webhooks.subscriptions]]
     topics = ["app/uninstalled"]
     uri = "https://YOUR_APP_URL/api/integrations/shopify/webhooks"

     [[webhooks.subscriptions]]
     compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]
     uri = "https://YOUR_APP_URL/api/integrations/shopify/webhooks"
   ```
   Without the CLI: set the three compliance webhook URLs in the Partner Dashboard (App setup → Compliance
   webhooks) and subscribe `app/uninstalled` to the same URL. The mandatory compliance webhooks are required for
   App Store distribution.
7. Automatic sync: the daily cron calls `syncDueShopifyIntegrations()` (`lib/server/shopify.ts`), which syncs
   every non-revoked connection whose last sync is older than its interval (`sync_interval_hours`, default 24)
   and within the owner's plan store limit. Requires `CRON_SECRET` + the service role key; otherwise only
   "Sync now" runs and the store page says so. Any 401/403 from Shopify marks the connection revoked and deletes
   the token; the user sees a translated message with a "Reconnect" action.
8. Store limits: Pro 1, Business 5 (`entitlements.shopifyStores`). Stores beyond the limit after a downgrade are
   neither synced nor shown, but can always be disconnected.

## 5. Email alerts — Resend
`RESEND_API_KEY`, `EMAIL_FROM` (verified domain). Without it, alerts are in-app only and the UI says so.

## 6. Data connectors
See [DATA_SOURCES.md](DATA_SOURCES.md). Each requires approval/terms from the provider:
- Meta Ad Library API: identity-verified Meta developer app → `META_AD_LIBRARY_ACCESS_TOKEN`.
- TikTok Commercial Content API: approved research access → `TIKTOK_RESEARCH_CLIENT_KEY/SECRET`.
- Pinterest / search trends / licensed dataset: provider contracts → respective variables.
- `STOREFRONT_CRAWLER_ENABLED=true` only after legal review for your jurisdictions.

## 7. Before going live — checklist
- [ ] Replace the legal templates (`legal.*` keys) with reviewed texts and company details.
- [ ] Set `NEXT_PUBLIC_APP_URL` to the production origin (OAuth/Stripe redirects use it).
- [ ] Put the rate limiter behind a shared store (Redis/Upstash) for multi-instance deployments
      (`lib/server/rate-limit.ts` is per instance).
- [ ] Configure a cookie-consent banner if you add analytics/advertising cookies.
- [ ] Run `npm run typecheck && npm test && npm run test:e2e`.
- [ ] Monitor `connector_runs` failures and Stripe webhook deliveries.

## Known limitations of this MVP
- Team invitations and multiple workspaces (Business plan) have the data model (`organizations`,
  `organization_members`) but no invitation UI yet.
- Pinterest and search-trends connectors define the interface but need a provider mapping once access
  terms are confirmed.
- The TikTok Commercial Content request body follows the public documentation and should be verified
  against the provider's current API version when access is granted.
- Demo product descriptions and ad copy are data, not interface text, and are not translated.
