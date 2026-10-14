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
| `shopify_admin` | The merchant's **own** store via OAuth, read-only scopes | OAuth (merchant) | 2/s | every 6 h | 400 d |
| `demo` | Synthetic sample data | — | — | static | — |

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

`LICENSED_DATA_PROVIDER_URL` must return `{ "ads": [ … ] }` where each ad matches the `advertisements`
table columns (`id`, `external_id`, `advertiser`, `platform`, `country`, `language`, `format`, `headline`,
`copy`, `cta`, `category`, `first_seen`, `last_seen`, `observed_at`, optional `product_id`, `landing_domain`).
