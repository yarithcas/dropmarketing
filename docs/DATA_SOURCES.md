# Data sources & connectors

Every connector implements `lib/connectors/types.ts` and documents authentication, permitted access,
rate limits, fields, sync frequency and retention (also shown in **Settings → Integrations**).
Unconfigured connectors report `skipped / not_configured`; nothing is simulated.

| Connector | Access | Auth | Rate limit | Frequency | Raw retention |
|---|---|---|---|---|---|
| `meta_ad_library` | Official Meta Ad Library API (`/ads_archive`) | access token (identity-verified app) | 200/h | daily | 365 d |
| `tiktok_commercial_content` | TikTok Commercial Content API (approved researchers) | OAuth client credentials | 1000/day | daily | 365 d |
| `pinterest_ads_repository` | Reserved for an authorized Pinterest transparency feed | token | 100/min | daily | 365 d |
| `search_trends` | Authorized search-interest provider | API key | 60/min | daily | 730 d |
| `public_storefronts` | Public `products.json` listings only; robots.txt checked; identified UA; 1 req/s/host | none | 1/s | weekly | 180 d |
| `licensed_dataset` | Contracted third-party feed (JSON) | API key | 10/min | daily | 730 d |
| `shopify_admin` | The merchant's **own** store via OAuth, read-only scopes | OAuth (merchant) | 2/s | daily | 400 d |
| `demo` | Synthetic sample data | — | — | static | — |

## Scheduling

`/api/cron/scan` (`Authorization: Bearer $CRON_SECRET`) runs one scan of `lib/server/scan.ts`. The scan is
driven by due-ness, not by which scheduler called it, so any cadence works: the default `vercel.json` calls it
**once a day** (05:15 UTC, plus a Monday 05:30 safety-net call — Vercel's free Hobby plan only accepts daily crons); an hourly cron on a paid plan
or an external scheduler can call it more often (see [DEPLOYMENT.md](DEPLOYMENT.md#background-jobs)). The rules
live in `lib/monitoring.ts` and are unit-tested.

Periods are UTC calendar periods: hour, 6-hour block (00/06/12/18 h), day, ISO week (from Monday). A task is
due once per period, at the first scan of that period:

| Task | Due when | With the default daily cron |
|---|---|---|
| Connector sync | no successful run (`connector_runs`) yet in the current `syncFrequency` period | `daily` connectors daily, `weekly` connectors on Mondays, `hourly`/`every6h` connectors once a day |
| Alert rule | `alerts.last_scheduled_at` before the current rule period (`hourly`, `daily`, `weekly`) | `hourly` and `daily` rules once a day, `weekly` rules on Mondays |
| Retention purge | no successful purge (`scan_runs.retention`) yet today | daily |

- Unconfigured connectors are not called; a failed or skipped sync is retried at the next scan. `demo` is
  never synced, and the merchant's own Shopify store (`shopify_admin`) is synced per merchant by the Shopify
  job, not by this scan.
- Daily aggregates and scores are recomputed only when the scan ingested records, so stale data is never
  re-dated as today's.
- Rules are evaluated only for users whose current plan includes alerts (`organization_members →
  organizations → subscriptions`, active or trialing — `resolveUserPlans` in `lib/server/scan.ts`), and at
  most `entitlements.alertRules` active rules per user, oldest first. Rules over the limit are not evaluated
  and the run says so (`rule_limit`).
- Rules are evaluated on **live research data only**: the database snapshot without demo-seeded rows. If it is
  empty, the run is recorded as `skipped` (`no_live_data`) and no notification is written; if it cannot be
  loaded (`data_unavailable`), the rules stay due and are retried at the next scan. The synthetic demo dataset
  is never used. `alert_runs.data_as_of` is the latest day the real rows cover.
- A rule's scheduled turn is over (`last_scheduled_at` set to the scan start) once it was evaluated, skipped
  without live data, or over the plan limit. Manual checks ("Run check now") evaluate all allowed rules on the
  same live data, are recorded in `alert_runs` too, and do not move the schedule.
- Alert emails go to the rule owner's address (looked up with the service role); `notifications.emailed_at`
  is set only when Resend accepted the email, and only on the notifications of that run.
- Logs: `connector_runs` (one row per sync, service role only), `alert_runs` (one row per user and run,
  readable by that user only, `message` holds a reason code), `scan_runs` (one row per scan: connector
  decisions, ingested records, evaluation summary, retention counts; service role only). The Alerts page reports
  the last ingestion that stored records separately from the last scheduled evaluation of the user's rules, and
  says when no connector is configured; connector errors are shown as categories, never as raw provider
  messages.

## Retention

Once a day the scan computes the cutoffs (`retentionCutoffs()` in `lib/monitoring.ts`, unit-tested), calls
`purge_expired_data()` (`supabase/migrations/0002_monitoring.sql`, service role only) and logs the cutoffs and
deleted row counts in `scan_runs.retention`. Rows dated strictly before a cutoff are deleted; as a safety net,
nothing younger than 30 days is ever purged.

| Data | Kept for |
|---|---|
| Raw research rows per connector (ads and ad observations, product observations, store snapshots, trend signals, licensed products) | the connector's raw retention (table above) |
| Public storefront listings (`store_products`) | 180 d after last seen (`public_storefronts`) |
| Merchant's own Shopify daily sales | 400 d (`shopify_admin`) |
| Usage events | 13 months |
| Run logs (`connector_runs`, `alert_runs`, `scan_runs`) | 90 d |
| Read notifications | 180 d (unread notifications are kept) |

Derived daily aggregates (`product_observations` with `source_connector = 'aggregate'`) and product metrics are
kept as history, except for a research product that is itself purged (not detected by its connector within the
connector's window): its derived rows are deleted with it. Demo-seeded rows are never purged automatically
(remove them with the SQL in `scripts/seed-demo.ts`). Day windows are UTC days counted back from the purge date;
13 months are calendar months.

## Provenance

`products`, `advertisements`, `stores`, `product_observations`, `store_snapshots` and `trend_signals`
store `source_connector`, `source_kind` (`measured | estimate | ai | demo`) and `observed_at`. Ads are
deduplicated on `(connector, external_id)`; observations on `(product_id, date, source_connector)`;
store listings on `(store_id, external_id)`. Historical rows are kept for trend computation.

## What is never shown

Ad spend, impressions, conversions, ROAS, competitor revenue, conversion rates or margins are not
displayed unless an authorized provider supplies them — and then labelled with method and confidence.
Store revenue is explicitly “not estimated” when evidence is insufficient (always, with public data only).

## Licensed provider feed format

`LICENSED_DATA_PROVIDER_URL` must return `{ "products": [ … ], "ads": [ … ] }`. Products match the `products` columns (`id`, `name`, `category`, `first_detected`, `last_detected`, optional prices, `shipping`, `image_url` — HTTPS images you are licensed to display). Only whitelisted columns are written. Each ad matches the `advertisements`
table columns (`id`, `external_id`, `advertiser`, `platform`, `country`, `language`, `format`, `headline`,
`copy`, `cta`, `category`, `first_seen`, `last_seen`, `observed_at`, optional `product_id`, `landing_domain`).
