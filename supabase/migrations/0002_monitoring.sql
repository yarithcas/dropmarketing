-- TrendHunter monitoring: per-user alert runs, rule scheduling, private operations logs, scan log and data
-- retention. Applies after 0001_init.sql. Background jobs use the service role (bypasses RLS); end users only
-- ever read their own alert runs.

-- ---------------------------------------------------------------------------
-- Alert runs belong to one user
-- ---------------------------------------------------------------------------
-- Rows written before this migration were system-wide (no owner, possibly evaluated against demo data):
-- they cannot be attributed to anyone and must not be shown, so they are dropped.
delete from public.alert_runs;

alter table public.alert_runs
  add column user_id uuid not null references auth.users (id) on delete cascade,
  add column data_as_of date,
  add column emails_sent int not null default 0;
create index alert_runs_user_idx on public.alert_runs (user_id, started_at desc);
create index alert_runs_started_idx on public.alert_runs (started_at);

comment on column public.alert_runs.message is
  'Machine-readable reason code (no_live_data, data_unavailable, rule_limit, email_failed, evaluation_failed; see lib/monitoring.ts RUN_REASONS). Never raw provider or database error text: users read this row.';
comment on column public.alert_runs.data_as_of is 'Latest day covered by the live research data the rules were evaluated against (null when not evaluated).';

drop policy "read runs" on public.alert_runs;
create policy "own runs read" on public.alert_runs for select to authenticated using (user_id = auth.uid());
-- Writes (scheduled scan, manual checks after the session check) go through the service role only.
revoke insert, update, delete on public.alert_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rule scheduling: a rule is due when its last scheduled turn started before the current UTC period of its
-- frequency (hour, day, ISO week; lib/monitoring.ts → isRuleDue). Set by scheduled runs only; manual checks
-- do not move it.
-- ---------------------------------------------------------------------------
alter table public.alerts add column last_scheduled_at timestamptz;
comment on column public.alerts.last_scheduled_at is
  'Start of the last scheduled scan that gave this rule its turn (evaluated, skipped without live data, or over the plan limit).';

-- ---------------------------------------------------------------------------
-- Connector runs are platform operations logs: no end-user access at all.
-- Server routes read them with the service role and return sanitized error categories.
-- ---------------------------------------------------------------------------
drop policy "read runs" on public.connector_runs;
revoke all on public.connector_runs from anon, authenticated;
create index connector_runs_started_idx on public.connector_runs (started_at);
create index connector_runs_success_idx on public.connector_runs (connector, started_at desc) where status = 'success';

-- ---------------------------------------------------------------------------
-- One row per scheduled scan: connector decisions, ingestion, evaluation summary and retention counts
-- (retention is null when the daily purge was not due).
-- ---------------------------------------------------------------------------
create table public.scan_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  connectors jsonb not null default '{}',
  records int not null default 0,
  evaluation jsonb not null default '{}',
  retention jsonb,
  error text
);
create index scan_runs_started_idx on public.scan_runs (started_at desc);
create index scan_runs_purged_idx on public.scan_runs (started_at desc) where retention ->> 'status' = 'success';
alter table public.scan_runs enable row level security;
revoke all on public.scan_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
create index usage_events_created_idx on public.usage_events (created_at);
create index notifications_read_created_idx on public.notifications (created_at) where read;
create index ad_observations_connector_date_idx on public.ad_observations (connector, date);
create index product_observations_connector_date_idx on public.product_observations (source_connector, date);

-- Deletes rows past their retention window and returns the number of deleted rows per table.
-- `cutoffs` (built by lib/monitoring.ts → retentionCutoffs; rows dated strictly before a cutoff are deleted):
--   connectors                { "<connector id>": "YYYY-MM-DD" }  raw research rows per connector
--   store_listings_before     date: public storefront listings not seen since (store_products has no connector column)
--   own_store_sales_before    date: merchants' own Shopify daily sales
--   usage_events_before       timestamptz: usage events
--   run_logs_before           timestamptz: connector_runs, alert_runs, scan_runs
--   read_notifications_before timestamptz: notifications already read
-- Safety net: a missing cutoff, or one less than 30 days in the past, skips that category. Demo-seeded rows
-- (is_demo, connector 'demo') are never purged here, and derived aggregates (source_connector 'aggregate') are
-- kept as history.
create or replace function public.purge_expired_data(cutoffs jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  min_day constant date := current_date - 30;
  min_ts constant timestamptz := now() - interval '30 days';
  c record;
  cutoff date;
  cutoff_ts timestamptz;
  n bigint;
  ads bigint := 0;
  ad_obs bigint := 0;
  product_obs bigint := 0;
  snapshots bigint := 0;
  signals bigint := 0;
  research_products bigint := 0;
  listings bigint := 0;
  own_sales bigint := 0;
  usage bigint := 0;
  connector_logs bigint := 0;
  alert_logs bigint := 0;
  scan_logs bigint := 0;
  read_notifications bigint := 0;
begin
  for c in select key as connector, value from jsonb_each(coalesce(cutoffs -> 'connectors', '{}'::jsonb)) loop
    cutoff := (c.value #>> '{}')::date;
    continue when cutoff is null or cutoff > min_day or c.connector in ('demo', 'aggregate');
    delete from public.ad_observations where connector = c.connector and date < cutoff;
    get diagnostics n = row_count; ad_obs := ad_obs + n;
    delete from public.advertisements where connector = c.connector and last_seen < cutoff and not is_demo;
    get diagnostics n = row_count; ads := ads + n;
    delete from public.product_observations where source_connector = c.connector and date < cutoff;
    get diagnostics n = row_count; product_obs := product_obs + n;
    delete from public.store_snapshots where connector = c.connector and date < cutoff;
    get diagnostics n = row_count; snapshots := snapshots + n;
    delete from public.trend_signals where connector = c.connector and date < cutoff;
    get diagnostics n = row_count; signals := signals + n;
    delete from public.products where source_connector = c.connector and last_detected < cutoff and not is_demo;
    get diagnostics n = row_count; research_products := research_products + n;
  end loop;

  cutoff := (cutoffs ->> 'store_listings_before')::date;
  if cutoff <= min_day then
    delete from public.store_products sp using public.stores s
      where s.id = sp.store_id and not s.is_demo and sp.last_seen < cutoff;
    get diagnostics listings = row_count;
  end if;

  cutoff := (cutoffs ->> 'own_store_sales_before')::date;
  if cutoff <= min_day then
    delete from public.own_store_daily_sales where date < cutoff;
    get diagnostics own_sales = row_count;
  end if;

  cutoff_ts := (cutoffs ->> 'usage_events_before')::timestamptz;
  if cutoff_ts <= min_ts then
    delete from public.usage_events where created_at < cutoff_ts;
    get diagnostics usage = row_count;
  end if;

  cutoff_ts := (cutoffs ->> 'run_logs_before')::timestamptz;
  if cutoff_ts <= min_ts then
    delete from public.connector_runs where started_at < cutoff_ts;
    get diagnostics connector_logs = row_count;
    delete from public.alert_runs where started_at < cutoff_ts;
    get diagnostics alert_logs = row_count;
    delete from public.scan_runs where started_at < cutoff_ts;
    get diagnostics scan_logs = row_count;
  end if;

  cutoff_ts := (cutoffs ->> 'read_notifications_before')::timestamptz;
  if cutoff_ts <= min_ts then
    delete from public.notifications where read and created_at < cutoff_ts;
    get diagnostics read_notifications = row_count;
  end if;

  return jsonb_build_object(
    'advertisements', ads,
    'ad_observations', ad_obs,
    'product_observations', product_obs,
    'store_snapshots', snapshots,
    'trend_signals', signals,
    'products', research_products,
    'store_products', listings,
    'own_store_daily_sales', own_sales,
    'usage_events', usage,
    'connector_runs', connector_logs,
    'alert_runs', alert_logs,
    'scan_runs', scan_logs,
    'notifications', read_notifications
  );
end;
$$;

-- Only background jobs may purge: no execute for end users (Supabase grants functions to anon/authenticated by default).
revoke all on function public.purge_expired_data(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.purge_expired_data(jsonb) to service_role;
  end if;
end;
$$;
