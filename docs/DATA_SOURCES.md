# Data sources & connectors

Every connector implements `lib/connectors/types.ts` and documents authentication, permitted access,
rate limits, fields, sync frequency and retention (also shown in **Settings → Integrations**).
Unconfigured connectors report `skipped / not_configured`; nothing is simulated. Connectors without an
implemented provider mapping (`pinterest_ads_repository`, `search_trends`) are shown as **Not available yet**
and report `skipped / not_available`, whatever credentials are set.

| Connector | Access | Auth | Rate limit | Frequency | Raw retention |
|---|---|---|---|---|---|
| `meta_ad_library` | Official Meta Ad Library API (`/ads_archive`) | access token (identity-verified app) | 200/h | daily | 365 d |
| `tiktok_commercial_content` | TikTok Commercial Content API (approved researchers) | OAuth client credentials | 1000/day | daily | 365 d |
| `pinterest_ads_repository` | **Not available yet** — reserved for an authorized Pinterest transparency feed | token | 100/min | daily | 365 d |
| `search_trends` | **Not available yet** — authorized search-interest provider | API key | 60/min | daily | 730 d |
| `public_storefronts` | Public Shopify `products.json` / `meta.json` / `cart.js` and WooCommerce Store API only; robots.txt checked per path; identified UA; 1 req/s/host | none | 1/s | weekly | 180 d |
| `licensed_dataset` | Contracted third-party feed (JSON) | API key | 10/min | daily | 730 d |
| `shopify_admin` | The merchant's **own** store via OAuth, read-only scopes | OAuth (merchant) | 2/s | every 6 h | 400 d |
| `demo` | Synthetic sample data | — | — | static | — |

## Request handling

All provider requests go through `lib/connectors/http.ts`: `AbortSignal` timeouts, pacing derived from
the declared rate limit (sliding window, at least 1 s between requests), and at most 2 retries with
exponential backoff for network errors, timeouts, 429 and 5xx, honouring `Retry-After` (waits over 30 s
end the attempt). 401/403 and robots.txt refusals are never retried or worked around. Each run also has a
time budget (Meta 75 s, TikTok 60 s, storefronts 75 s, licensed 30 s) and a request budget (Meta 150,
TikTok 200); keyword and domain lists start at a different item each day so a cut-short run does not
always drop the same tail. Meta Graph throttling codes (4, 17, 32, 613, 80000, 80004) and usage headers ≥ 90 %
stop the run.

Runs end `success`, `partial` (records stored but some failed, or the run stopped at a budget or rate limit)
or `failed`. A record counts as stored only when its upsert returned no error.

## Field mappings (what is stored, and what stays unknown)

| Field | Meta Ad Library | TikTok Commercial Content | Licensed feed |
|---|---|---|---|
| headline / copy | `ad_creative_link_titles[0]` / `ad_creative_bodies[0]` | empty (not returned) | as supplied |
| language | `languages` (ISO 639-1) | null | as supplied |
| format | `unknown` (not exposed) | from `ad.videos` / `ad.image_urls`, else `unknown` | supplied value if valid, else `unknown` |
| CTA | `unknown` (not exposed) | `unknown` | supplied value if valid, else `unknown` |
| landing domain / URL | `ad_creative_link_captions` when it is a host name / null | null / null | as supplied (HTTPS URLs only) |
| country | the single country queried (`ad_reached_countries=[X]`) | the `country_code` queried | as supplied |
| active (ad_observations) | no `ad_delivery_stop_time`, or stop ≥ today | `last_shown_date` ≥ yesterday | `last_seen` ≥ yesterday |
| snapshot_url | tokenless `https://www.facebook.com/ads/library/?id=…` | `https://library.tiktok.com/ads/detail/?ad_id=…` | HTTPS only |
| placements | `publisher_platforms` | — | as supplied |

`ad_snapshot_url` is deliberately not requested from Meta: it embeds the API access token. Migration 0005
replaces previously stored snapshot URLs with the tokenless public page and resets the placeholder values
the old mapping stored (format `image`/`video`, CTA `learn_more`, category `home`, TikTok language `en`),
and marks observations after an ad's last delivery day inactive. One country is queried at a time; an ad
reaching several queried countries is stored once with the first country it was found in. The UI links the
library page (`target=_blank`, `rel="noopener noreferrer nofollow"`); creatives are never embedded or hotlinked.

### Estimated product links and categories

Inferred values are always stored with a basis and shown as estimates (`Est.` tag):

- `product_match_basis`: `source` (provider-supplied, licensed feed only), `search_term` (the ad was returned
  by the provider search for a tracked product's exact name), `token_overlap` (`lib/connectors/matching.ts`:
  case/accent-folded tokens of ≥ 3 letters, stop words and marketing qualifiers removed, light plural folding;
  a product qualifies when ≥ 60 % and at least two of its name tokens appear in the ad text — or its single
  name token plus one tag; the best score wins and ties link nothing). Demo products are never linked to real ads.
- `category_basis`: `source`, `product` (category of the linked product) or `keyword_classifier`
  (majority vote over a fixed fr/en/es/de/it keyword lexicon on the ad text, or on the search term when the
  provider returns no text; ties or no hit → null).

### Public storefronts

For each domain (public host names only; IP literals and reserved suffixes are skipped), robots.txt is read
(RFC 9309 longest-match, `Crawl-delay` honoured up to 10 s; an unavailable robots.txt means no crawl) and
every path — including its query string — is checked before it is requested:

- Shopify `/products.json` (≤ 4 pages of 250): a valid response with listings sets technology `shopify`,
  `verified: true`. `/meta.json` gives name, country, shop currency and the published product count;
  `/cart.js` (usually disallowed by Shopify's default robots.txt) gives the presented currency. The listing
  currency is the shop currency unless `/cart.js` presents another one (then it is ambiguous → null).
- WooCommerce Store API `/wp-json/wc/store/products` (≤ 4 pages of 100): a valid response sets `woocommerce`,
  `verified: true`; currency from `prices.currency_code`, total from `X-WP-Total`.
- Anything else: no row is written and the technology stays unknown.

The `stores` row is created (or updated with detected values only) before listings are upserted, so listings
never reference a missing store. Demo store profiles are never touched. A snapshot is written only when the
listing count is reliably known; min/max price only for a complete crawl.

## Provenance

`products`, `advertisements`, `stores`, `store_products` (since 0005), `product_observations`, `store_snapshots`
and `trend_signals` store `source_connector`, `source_kind` (`measured | estimate | ai | demo`) and `observed_at`. Ads are
deduplicated on `(connector, external_id)`; observations on `(product_id, date, source_connector)`;
store listings on `(store_id, external_id)`. Historical rows are kept for trend computation.

## What is never shown

Ad spend, impressions, conversions, ROAS, competitor revenue, conversion rates or margins are not
displayed unless an authorized provider supplies them — and then labelled with method and confidence.
Store revenue is explicitly “not estimated” when evidence is insufficient (always, with public data only).

## Licensed provider feed format

`LICENSED_DATA_PROVIDER_URL` must return `{ "products": [ … ], "ads": [ … ] }`. Products match the `products` columns (`id`, `name`, `category`, `first_detected`, `last_detected`, optional prices, `shipping`, `image_url` — HTTPS images you are licensed to display). Only whitelisted columns are written. Each ad matches the `advertisements`
table columns (`id`, `external_id`, `advertiser`, `platform`, `country`, `language`, `format`, `headline`,
`copy`, `cta`, `category`, `first_seen`, `last_seen`, `observed_at`, optional `product_id`, `landing_domain`,
`landing_url`, `snapshot_url` (HTTPS only), `placements`). Rows failing validation are counted as failed, not stored;
unknown enum values are stored as `unknown`/null, and `product_id` is kept only when it references a known product.
`LICENSED_DATA_PROVIDER_URL` must use HTTPS (the key is sent as a bearer token).

## Search filter safety

Free-text search on products and ads builds PostgREST `or=(…)` filters with every value double-quoted
(backslash and quote escaped) after escaping LIKE metacharacters, so input such as `x,id.neq.zz`, `)` or `}`
stays inside a single `ilike` value (`tests/postgrest-filter.test.ts`). Database errors return
`500 database_error` without details.
