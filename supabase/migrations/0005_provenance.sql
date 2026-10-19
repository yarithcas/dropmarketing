-- TrendHunter 0005: truthful connector mappings and listing provenance.
-- Applies after 0001_init.sql (independent of 0002-0004).
--
-- * Values a provider does not disclose are stored as unknown (null / 'unknown'), never as a guess.
-- * Values inferred by TrendHunter carry an explicit basis column, so they are shown as estimates.
-- * Store listings record which connector observed them and when.
-- * Connector runs can end 'partial' (some records stored, some failed or the run was cut short).

-- ---------------------------------------------------------------------------
-- Advertisements
-- ---------------------------------------------------------------------------
alter table public.advertisements
  alter column language drop not null,
  alter column category drop not null,
  alter column cta set default 'unknown',
  add column product_match_basis text check (product_match_basis in ('source', 'search_term', 'token_overlap')),
  add column category_basis text check (category_basis in ('source', 'product', 'keyword_classifier')),
  add column placements text[] not null default '{}';

comment on column public.advertisements.language is 'ISO 639-1 code as reported by the source; null when the source does not report it.';
comment on column public.advertisements.format is 'video | image | carousel as reported by the source; ''unknown'' when not disclosed (e.g. Meta Ad Library API).';
comment on column public.advertisements.cta is 'Call to action as reported by the source; ''unknown'' when not disclosed.';
comment on column public.advertisements.category is 'Null when neither the source nor an estimate (see category_basis) provides one.';
comment on column public.advertisements.product_match_basis is
  'How product_id was assigned. source = given by the data provider; search_term = the tracked product whose name was the provider search term (estimate); token_overlap = deterministic token overlap between ad text and product names/tags (estimate, lib/connectors/matching.ts).';
comment on column public.advertisements.category_basis is
  'How category was assigned. source = given by the data provider; product = category of the linked product (estimate); keyword_classifier = deterministic multilingual keyword classifier (estimate).';
comment on column public.advertisements.placements is 'Placements reported by the source (Meta publisher_platforms), lower case.';
comment on column public.advertisements.snapshot_url is 'HTTPS page of the ad in the platform''s public ad library (tokenless). Linked, never embedded.';

-- Rows stored before this migration by the official-API connectors carried fixed placeholder values.
-- Meta: format 'image', cta 'learn_more', category 'home', and ad_snapshot_url (which embeds the API access token).
update public.advertisements
set format = 'unknown',
    cta = 'unknown',
    category = null,
    category_basis = null,
    snapshot_url = 'https://www.facebook.com/ads/library/?id=' || external_id
where connector = 'meta_ad_library' and not is_demo;
-- TikTok: format 'video', cta 'learn_more', category 'home', language 'en' (the query endpoint returns none of them).
update public.advertisements
set format = 'unknown',
    cta = 'unknown',
    category = null,
    category_basis = null,
    language = null,
    snapshot_url = 'https://library.tiktok.com/ads/detail/?ad_id=' || external_id
where connector = 'tiktok_commercial_content' and not is_demo;
-- Product links that existed before (demo generator, licensed feed) were supplied by the source.
update public.advertisements set product_match_basis = 'source' where product_id is not null and product_match_basis is null;
update public.advertisements set category_basis = 'source' where category is not null and category_basis is null;

alter table public.advertisements
  add constraint advertisements_snapshot_url_https check (snapshot_url is null or snapshot_url ~ '^https://');

-- Observations were written active=true for every fetched ad, including stopped ones.
-- Meta reports the delivery stop date (last_seen): later observation days were not active.
update public.ad_observations o
set active = false
from public.advertisements a
where a.id = o.ad_id and o.active and not a.is_demo and a.connector = 'meta_ad_library' and o.date > a.last_seen;
-- TikTok / licensed feeds report the last shown date, refreshed with about a day of delay.
update public.ad_observations o
set active = false
from public.advertisements a
where a.id = o.ad_id and o.active and not a.is_demo and a.connector in ('tiktok_commercial_content', 'licensed_dataset') and o.date > a.last_seen + 1;

-- ---------------------------------------------------------------------------
-- Stores and listings
-- ---------------------------------------------------------------------------
alter table public.stores alter column currency drop not null;
comment on column public.stores.currency is 'ISO 4217 code read from a public storefront endpoint (Shopify /meta.json or /cart.js, WooCommerce Store API); null when not exposed.';
comment on column public.stores.technology is '{"platform": shopify|woocommerce|unknown, "verified": bool}; verified only when the platform''s public endpoint returned a valid response.';

alter table public.store_products
  alter column currency drop not null,
  add column source_connector text,
  add column source_kind text check (source_kind in ('measured', 'estimate', 'ai', 'demo')),
  add column observed_at timestamptz;

comment on column public.store_products.currency is 'Currency of the displayed price as exposed by the storefront; null when unknown or ambiguous.';
comment on column public.store_products.source_connector is 'Connector that observed the listing (public_storefronts, demo).';
comment on column public.store_products.observed_at is 'When the listing was last observed.';

-- Listings written before this migration came from the demo seed or the storefront crawler,
-- which hard-coded the currency to EUR (products.json does not state it).
update public.store_products sp
set source_connector = case when s.is_demo then 'demo' else 'public_storefronts' end,
    source_kind = case when s.is_demo then 'demo' else 'measured' end,
    observed_at = sp.last_seen::timestamptz,
    currency = case when s.is_demo then sp.currency end
from public.stores s
where s.id = sp.store_id and sp.source_connector is null;

-- ---------------------------------------------------------------------------
-- Connector runs
-- ---------------------------------------------------------------------------
alter table public.connector_runs drop constraint if exists connector_runs_status_check;
alter table public.connector_runs
  add constraint connector_runs_status_check check (status in ('running', 'success', 'partial', 'failed', 'skipped'));
comment on column public.connector_runs.status is 'partial = some records stored while others failed, or the run stopped at its time/request budget or a rate limit.';
