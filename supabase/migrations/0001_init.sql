-- TrendHunter initial schema
-- Research data is written only by background jobs (service role) and is
-- readable by authenticated users. User-owned data is protected by RLS.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Accounts, organizations, subscriptions
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text,
  locale text not null default 'fr' check (locale in ('fr', 'en', 'es', 'de', 'it')),
  currency text not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  status text not null default 'active',
  stripe_customer_id text,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_org_idx on public.subscriptions (organization_id);
create index subscriptions_customer_idx on public.subscriptions (stripe_customer_id);

create or replace function public.is_member(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_members m where m.organization_id = org and m.user_id = auth.uid());
$$;

-- New user => profile + personal organization + free subscription
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  insert into public.profiles (user_id, name, locale) values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    case when new.raw_user_meta_data ->> 'locale' in ('fr', 'en', 'es', 'de', 'it') then new.raw_user_meta_data ->> 'locale' else 'fr' end
  );
  insert into public.organizations (name) values (coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)) || ' workspace') returning id into org;
  insert into public.organization_members (organization_id, user_id, role) values (org, new.id, 'owner');
  insert into public.subscriptions (organization_id, plan, status) values (org, 'free', 'active');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Research data (provenance on every row)
-- ---------------------------------------------------------------------------
create table public.products (
  id text primary key,
  name text not null,
  category text not null,
  description text not null default '',
  image_url text, -- only from authorized sources (licensed feed, supplier); null => generated thumbnail
  product_type text not null default 'physical',
  tags text[] not null default '{}',
  price_estimate numeric(12, 2),
  supplier_cost_estimate numeric(12, 2),
  currency text not null default 'EUR',
  channels text[] not null default '{}',
  countries text[] not null default '{}',
  shipping jsonb not null default '{"verified": false}',
  -- Typed projections of verified sourcing data for server-side filtering
  shipping_verified boolean generated always as (coalesce((shipping ->> 'verified')::boolean, false)) stored,
  shipping_warehouse text generated always as (case when (shipping ->> 'verified')::boolean then shipping ->> 'warehouse' end) stored,
  delivery_days_max smallint generated always as (case when (shipping ->> 'verified')::boolean then (shipping -> 'deliveryDays' ->> 1)::smallint end) stored,
  differentiation smallint check (differentiation between 0 and 100),
  first_detected date not null,
  last_detected date not null,
  source_connector text not null,
  source_kind text not null check (source_kind in ('measured', 'estimate', 'ai', 'demo')),
  source_url text,
  observed_at timestamptz not null,
  is_demo boolean not null default false,
  hue smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_category_idx on public.products (category);
create index products_sourcing_idx on public.products (shipping_verified, shipping_warehouse, delivery_days_max);
create index products_first_detected_idx on public.products (first_detected desc);
create index products_tags_idx on public.products using gin (tags);
create index products_countries_idx on public.products using gin (countries);
create index products_channels_idx on public.products using gin (channels);
create index products_name_trgm_idx on public.products using gin (name gin_trgm_ops);

-- Materialized per-product metrics + transparent score (recomputed by the scan job)
create table public.product_metrics (
  product_id text primary key references public.products (id) on delete cascade,
  as_of date not null,
  ads_observed int not null default 0,
  ads_active int not null default 0,
  advertisers_observed int not null default 0,
  stores_observed int not null default 0,
  trend_growth_30d numeric(8, 1),
  competition text not null check (competition in ('low', 'medium', 'high')),
  saturation smallint not null,
  gross_margin numeric(5, 3),
  observation_count int not null default 0,
  score smallint,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  score_detail jsonb not null,
  computed_at timestamptz not null default now()
);
create index product_metrics_score_idx on public.product_metrics (score desc nulls last);
create index product_metrics_growth_idx on public.product_metrics (trend_growth_30d desc nulls last);
create index product_metrics_margin_idx on public.product_metrics (gross_margin desc nulls last);
create index product_metrics_saturation_idx on public.product_metrics (saturation);

create table public.product_observations (
  product_id text not null references public.products (id) on delete cascade,
  date date not null,
  ads_active int not null default 0,
  new_advertisers int not null default 0,
  stores_observed int not null default 0,
  search_interest smallint,
  source_connector text not null,
  source_kind text not null,
  observed_at timestamptz not null,
  primary key (product_id, date, source_connector)
);

create table public.advertisements (
  id text primary key,
  connector text not null,
  external_id text not null,
  product_id text references public.products (id) on delete set null,
  advertiser text not null,
  platform text not null,
  country text not null,
  language text not null,
  format text not null,
  headline text not null default '',
  copy text not null default '',
  cta text not null default 'learn_more',
  landing_domain text,
  landing_url text,
  snapshot_url text,
  category text not null,
  first_seen date not null,
  last_seen date not null,
  source_kind text not null,
  observed_at timestamptz not null,
  is_demo boolean not null default false,
  hue smallint not null default 0,
  unique (connector, external_id)
);
create index advertisements_product_idx on public.advertisements (product_id);
create index advertisements_first_seen_idx on public.advertisements (first_seen desc);
create index advertisements_last_seen_idx on public.advertisements (last_seen desc);
create index advertisements_filters_idx on public.advertisements (platform, country, language, format);
create index advertisements_domain_idx on public.advertisements (landing_domain);
create index advertisements_copy_trgm_idx on public.advertisements using gin ((headline || ' ' || copy || ' ' || advertiser) gin_trgm_ops);

create table public.ad_observations (
  ad_id text not null references public.advertisements (id) on delete cascade,
  date date not null,
  active boolean not null,
  connector text not null,
  observed_at timestamptz not null,
  primary key (ad_id, date, connector)
);

create table public.stores (
  id text primary key,
  name text not null,
  domain text not null unique,
  description text not null default '',
  categories text[] not null default '{}',
  currency text not null,
  product_count int,
  socials jsonb not null default '[]',
  technology jsonb not null default '{"platform": "unknown", "verified": false}',
  country text,
  first_seen date not null,
  source_connector text not null,
  source_kind text not null,
  observed_at timestamptz not null,
  is_demo boolean not null default false,
  hue smallint not null default 0
);
create index stores_name_trgm_idx on public.stores using gin (name gin_trgm_ops);
create index stores_categories_idx on public.stores using gin (categories);

create table public.store_products (
  id bigint generated always as identity primary key,
  store_id text not null references public.stores (id) on delete cascade,
  product_id text references public.products (id) on delete set null,
  external_id text not null,
  title text not null,
  price numeric(12, 2) not null,
  currency text not null,
  first_seen date not null,
  last_seen date not null,
  unique (store_id, external_id)
);
create index store_products_product_idx on public.store_products (product_id);

create table public.store_snapshots (
  store_id text not null references public.stores (id) on delete cascade,
  date date not null,
  product_count int not null,
  min_price numeric(12, 2),
  max_price numeric(12, 2),
  connector text not null,
  observed_at timestamptz not null,
  primary key (store_id, date)
);

create table public.trend_signals (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('product', 'category', 'tag')),
  ref text not null,
  date date not null,
  signal text not null,
  value numeric not null,
  connector text not null,
  observed_at timestamptz not null,
  unique (scope, ref, date, signal, connector)
);

create table public.connector_runs (
  id bigint generated always as identity primary key,
  connector text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed', 'skipped')),
  records int not null default 0,
  error text
);
create index connector_runs_connector_idx on public.connector_runs (connector, started_at desc);

-- ---------------------------------------------------------------------------
-- User workspace
-- ---------------------------------------------------------------------------
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  description text not null default '',
  kind text not null default 'standard' check (kind in ('standard', 'swipe')),
  created_at timestamptz not null default now()
);
create index collections_user_idx on public.collections (user_id);

create table public.collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  item_type text not null check (item_type in ('product', 'ad', 'store')),
  ref_id text not null,
  label text not null,
  note text not null default '',
  tags text[] not null default '{}',
  added_at timestamptz not null default now(),
  unique (collection_id, item_type, ref_id)
);

create table public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  item_type text not null check (item_type in ('product', 'store', 'category')),
  ref_id text not null,
  label text not null,
  added_at timestamptz not null default now(),
  unique (user_id, item_type, ref_id)
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  name text not null,
  type text not null check (type in ('trend_increase', 'new_advertiser', 'new_product_in_category', 'competitor_new_products', 'daily_summary')),
  target jsonb not null default '{}',
  threshold_pct numeric,
  frequency text not null default 'daily' check (frequency in ('hourly', 'daily', 'weekly')),
  channels jsonb not null default '{"inApp": true, "email": false}',
  active boolean not null default true,
  last_evaluated_at timestamptz,
  created_at timestamptz not null default now()
);
create index alerts_active_idx on public.alerts (active, frequency);

create table public.alert_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  origin text not null check (origin in ('scheduled', 'manual')),
  rules int not null default 0,
  matches int not null default 0,
  status text not null check (status in ('running', 'success', 'failed', 'skipped')),
  message text
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  alert_id uuid references public.alerts (id) on delete set null,
  key text not null,
  params jsonb not null default '{}',
  link text,
  read boolean not null default false,
  origin text not null default 'scheduled',
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  template text not null,
  params jsonb not null default '{}',
  content jsonb not null,
  created_at timestamptz not null default now()
);

create table public.connected_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('shopify')),
  external_account text not null,
  scopes text[] not null default '{}',
  access_token_encrypted text not null,
  status text not null default 'connected' check (status in ('connected', 'error', 'revoked')),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, external_account)
);

create table public.own_store_products (
  integration_id uuid not null references public.connected_integrations (id) on delete cascade,
  external_id text not null,
  title text not null,
  status text,
  price numeric(12, 2),
  inventory int,
  updated_at timestamptz not null default now(),
  primary key (integration_id, external_id)
);

create table public.own_store_daily_sales (
  integration_id uuid not null references public.connected_integrations (id) on delete cascade,
  product_external_id text not null,
  date date not null,
  units int not null default 0,
  revenue numeric(12, 2) not null default 0,
  primary key (integration_id, product_external_id, date)
);

create table public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  feature text not null,
  created_at timestamptz not null default now()
);
create index usage_events_lookup_idx on public.usage_events (user_id, feature, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.products enable row level security;
alter table public.product_metrics enable row level security;
alter table public.product_observations enable row level security;
alter table public.advertisements enable row level security;
alter table public.ad_observations enable row level security;
alter table public.stores enable row level security;
alter table public.store_products enable row level security;
alter table public.store_snapshots enable row level security;
alter table public.trend_signals enable row level security;
alter table public.connector_runs enable row level security;
alter table public.collections enable row level security;
alter table public.collection_items enable row level security;
alter table public.watchlists enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_runs enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.connected_integrations enable row level security;
alter table public.own_store_products enable row level security;
alter table public.own_store_daily_sales enable row level security;
alter table public.usage_events enable row level security;

create policy "own profile" on public.profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "member reads org" on public.organizations for select using (public.is_member(id));
create policy "member reads memberships" on public.organization_members for select using (user_id = auth.uid() or public.is_member(organization_id));
create policy "member reads subscription" on public.subscriptions for select using (public.is_member(organization_id));

-- Research data: read-only for signed-in users; writes via service role only.
create policy "read research" on public.products for select to authenticated using (true);
create policy "read research" on public.product_metrics for select to authenticated using (true);
create policy "read research" on public.product_observations for select to authenticated using (true);
create policy "read research" on public.advertisements for select to authenticated using (true);
create policy "read research" on public.ad_observations for select to authenticated using (true);
create policy "read research" on public.stores for select to authenticated using (true);
create policy "read research" on public.store_products for select to authenticated using (true);
create policy "read research" on public.store_snapshots for select to authenticated using (true);
create policy "read research" on public.trend_signals for select to authenticated using (true);
create policy "read runs" on public.connector_runs for select to authenticated using (true);
create policy "read runs" on public.alert_runs for select to authenticated using (true);

-- User-owned data
create policy "own collections" on public.collections for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own collection items" on public.collection_items for all
  using (exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid()));
create policy "own watchlist" on public.watchlists for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own alerts" on public.alerts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notifications" on public.notifications for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own reports" on public.reports for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own usage read" on public.usage_events for select using (user_id = auth.uid());
create policy "own usage insert" on public.usage_events for insert with check (user_id = auth.uid());
-- Integrations: users can see status rows, but tokens are only ever read server-side with the service role.
create policy "own integrations read" on public.connected_integrations for select using (user_id = auth.uid());
create policy "own store data" on public.own_store_products for select
  using (exists (select 1 from public.connected_integrations i where i.id = integration_id and i.user_id = auth.uid()));
create policy "own store sales" on public.own_store_daily_sales for select
  using (exists (select 1 from public.connected_integrations i where i.id = integration_id and i.user_id = auth.uid()));
revoke all on public.connected_integrations from authenticated, anon;
grant select (id, user_id, organization_id, provider, external_account, scopes, status, last_sync_at, last_error, created_at, updated_at)
  on public.connected_integrations to authenticated;
