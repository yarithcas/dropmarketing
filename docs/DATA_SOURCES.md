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
| media (0007) | `[]` (the API returns no media URL) | `ad.videos[].url` + `cover_image_url`, `ad.image_urls[]` (HTTPS only) | `media[]` entries (HTTPS only) |

`ad_snapshot_url` is deliberately not requested from Meta: it embeds the API access token. Migration 0005
replaces previously stored snapshot URLs with the tokenless public page and resets the placeholder values
the old mapping stored (format `image`/`video`, CTA `learn_more`, category `home`, TikTok language `en`),
and marks observations after an ad's last delivery day inactive. One country is queried at a time; an ad
reaching several queried countries is stored once with the first country it was found in. The UI links the
library page (`target=_blank`, `rel="noopener noreferrer nofollow"`); library pages are never embedded, and
creatives are played only from media URLs the provider returns for display (see *Ad media* below).

### Ad media (videos and images) — migration 0007

`advertisements.media` (jsonb, default `[]`) holds only media URLs a provider **officially returns for
display**: `{type: video|image, url, posterUrl?, source, authorized: true}`. The `ad_media_valid()` check
(0007) rejects non-HTTPS URLs, URLs carrying an `access_token`, unknown types and more than 10 entries;
`safeHttpsUrl()` (mapping) and `rowToMedia()` (read path) apply the same rules.

- **TikTok Commercial Content API**: `ad.videos[].url` / `cover_image_url` and `ad.image_urls[]` are stored as
  returned. These are provider-signed CDN URLs that may expire; they are refreshed at each sync and never
  downloaded, proxied or re-hosted. When a URL no longer plays, the player shows an error and links to the
  official TikTok Ad Library page instead.
- **Meta Ad Library API**: no media URL is exposed (`ad_snapshot_url` embeds the access token and is never
  requested), so Meta ads have no playable media. The UI links out to the public Ad Library page
  ("Watch the video in the official ad library", `target=_blank`, `rel="noopener noreferrer nofollow"`); the
  Ad Library cannot be framed and is never embedded.
- **Licensed feed**: an optional `media` array of `{type: "video"|"image", url, poster_url?}`. Only include media
  your contract licenses you to **display** to your users.
- **Terms caveat**: displaying provider media is subject to each provider's terms and to your approved use case
  (TikTok's Commercial Content API terms, your licensed-data contract). Check that your approval covers in-app
  display before enabling the connector in production; if it does not, leave the connector unconfigured or
  strip `media` from the feed — the UI then falls back to the official library link. Media are never shown as
  TrendHunter's own content and always carry a "Media supplied for display by …" source line.
- **Demo mode**: synthetic demo ads have no media. Their "video" is an original animated storyboard generated
  in the browser from the demo ad's own text and colour (`components/app/ad-player.tsx`, no external assets),
  always labelled "Generated video preview — demo" and never presented as an advertiser's creative. It starts
  paused and switches cards without movement under `prefers-reduced-motion`.
- **CSP**: the app currently sends no `Content-Security-Policy` header (see `next.config.ts`), so no
  `media-src` change is required. If one is added, `media-src`/`img-src` must allow `https:` hosts of the
  configured providers only (e.g. TikTok's CDN hosts), never `http:` or `data:` for media.

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

## Active advertisers (default quality bar) — migration 0008

Every list where TrendHunter *finds* ads shows, by default, only ads of **active advertisers**: advertisers
running at least **5 ads that are currently active and have each been running for at least 7 days**. The
rule is evaluated on the dataset's `asOf` day (live: today; demo: the rolling snapshot, i.e. yesterday UTC,
or `DEMO_SNAPSHOT`). One pure definition, `src/lib/advertisers.ts`, is used everywhere in TypeScript, and
migration `0008_active_advertisers.sql` implements the same rule in Postgres.

| Term | Definition |
|---|---|
| Active ad | `first_seen ≤ asOf` and `last_seen ≥ asOf − 2 days` — the same rule as Ad Spy's "Active ads only" filter and the overview's active-ad count (libraries refresh with about a day of delay and connectors sync daily). `ad_observations.active` remains the per-sync flag recorded by the connectors (see the mapping table above). |
| Advertiser identity | `advertiser_key(advertiser)`: Unicode NFKD, combining accents removed, lower case, whitespace runs collapsed, trimmed — "Maison Éclat", " maison  eclat " and "MAISON ECLAT" are one advertiser. Platforms are not part of the identity. Stored as the generated, indexed column `advertisements.advertiser_key`. |
| Qualifying advertiser | at least `MIN_ACTIVE_ADS = 5` of its ads are active on `asOf` **and** were first seen at least `MIN_ACTIVE_DAYS = 7` days before it (`first_seen ≤ asOf − 7 days`). |
| Shown by default | every ad (running or ended) of a qualifying advertiser; ads of other advertisers are hidden, never deleted. |

Per advertiser the app exposes `activeAds`, `activeSinceMinDays` (the count compared to the threshold) and
`oldestActiveFirstSeen`; the "Active advertiser" badge and its tooltip ("N active ads running for ≥ 7 days")
come from these values.

Where it applies:

- **Ad Spy** (`/api/ads`, `/app/ads`): `activeAdvertisers` is on unless `activeAdvertisers=false` — on every
  plan, with a visible switch. Totals and pagination describe the filtered set. Adjusting the thresholds
  (`minActiveAds` 1–50, `minActiveDays` 0–90) is an advanced filter (Pro and Business; stripped and reported
  for Free). The parameters are part of the metered search key: toggling or adjusting is a new search, page
  turns are not. The advertiser field suggests advertisers (`/api/advertisers`), active ones first and flagged.
- **Creatives** page lists (recent, long-running) — same default and switch.
- **Global search**: the ads group lists ads of active advertisers only (others are counted, with a link to
  them in Ad Spy); the advertisers group ranks active advertisers first and flags them.
- **Product and store pages** receive every ad (evidence is never dropped server-side), show ads of active
  advertisers by default with the badge, how many of the ads qualify, and a "show all ads" switch.

Live mode (Postgres, service role only, `SECURITY INVOKER`):

- `public.advertiser_activity(as_of date, min_days int default 7, keys text[] default null)` — per-advertiser
  activity on `as_of` (advertisers with at least one active ad; `keys` restricts it to one result page).
- `public.ads_of_active_advertisers(as_of date, min_ads int default 5, min_days int default 7)` — the ads of the
  qualifying advertisers, `setof advertisements`. `listAdsDb` calls it as a PostgREST RPC (arguments in the JSON
  body, never in a filter string) and applies the usual filters, order (sort column, then `id`, so pages never
  overlap), range and exact count to it. It has no `SET` clause so the planner inlines it and keeps using the
  `advertisements` indexes.
- Indexes: `advertisements (advertiser_key)` and `advertisements (last_seen, advertiser_key, first_seen)`.
- `supabase/tests/0008_active_advertisers.test.sql` and `tests/active-advertisers.test.ts` check the same
  boundary fixture (`tests/fixtures/active-advertisers.json`: exactly 5 / 4 ads, exactly 7 / 6 days, an
  inactive ad, the 2-day grace boundary, an ad starting after `asOf`, case/accent variants, decomposed accents
  and Unicode spaces) against both implementations.

Demo data: in the synthetic generator, 40 % of the base-window ads still running on the base day whose product
a store carries, and that the existing 55 % store-linking pass left with a brand advertiser, are run by one of
those stores (seeded per ad: 71 of 1,522 ads change advertiser and landing domain, plus the daily
new-advertiser counts derived from them; product ids, ad ids, dates, stores and the ads of later days are
unchanged). A realistic subset then qualifies every day:
9 of 179 advertisers / 521 of 1,522 ads on the pinned test date (2026-10-12; 7 / 378 before the change),
13 / 640 of 1,566 on 2026-10-14, and at least 9 advertisers and 521 ads on every day checked through 2028
(`tests/active-advertisers.test.ts` checks a full year at ≥ 8 advertisers and ≥ 40 ads).

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
`landing_url`, `snapshot_url` (HTTPS only), `placements`, `media` (see *Ad media*)). Rows failing validation are counted as failed, not stored;
unknown enum values are stored as `unknown`/null, and `product_id` is kept only when it references a known product.
`LICENSED_DATA_PROVIDER_URL` must use HTTPS (the key is sent as a bearer token).

## Search filter safety

Free-text search on products and ads builds PostgREST `or=(…)` filters with every value double-quoted
(backslash and quote escaped) after escaping LIKE metacharacters, so input such as `x,id.neq.zz`, `)` or `}`
stays inside a single `ilike` value (`tests/postgrest-filter.test.ts`). RPC arguments (active-advertiser
thresholds, advertiser keys) are sent in the JSON body of the call, not as filters. Database errors return
`500 database_error` without details.
