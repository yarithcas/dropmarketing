-- TrendHunter 0008: active advertisers — the default quality bar of Ad Spy and every ad list.
-- Applies after 0007_ad_media.sql.
--
-- Same rule as src/lib/advertisers.ts (keep both in sync; supabase/tests/0008_active_advertisers.test.sql
-- and tests/active-advertisers.test.ts check one shared fixture file against both):
--
-- * Advertiser identity = advertiser_key(advertiser): Unicode NFKD, combining accents (U+0300–U+036F)
--   removed, lower case, runs of ASCII whitespace collapsed to one space, trimmed.
--   'Maison Éclat', ' maison  eclat ' and 'MAISON ECLAT' are one advertiser.
-- * An ad is active on as_of when first_seen <= as_of and last_seen >= as_of - 2 days (the Ad Spy
--   "active ads only" rule: libraries refresh with about a day of delay and connectors sync daily).
-- * An advertiser qualifies on as_of when at least min_ads (default 5) of its active ads were first
--   seen at least min_days (default 7) days before as_of (first_seen <= as_of - min_days).
--   Every ad of a qualifying advertiser is listed; the others are hidden by default.
--
-- Access: advertiser_activity() and ads_of_active_advertisers() are called by the server with the
-- service role only (PostgREST RPC; arguments travel in the JSON body, never in filter strings).
-- Both are SECURITY INVOKER: the service role already reads every research row, so no definer
-- rights are needed. advertiser_key() is a pure function used by a generated column, executable
-- by everyone.

create or replace function public.advertiser_key(name text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select btrim(
    regexp_replace(
      lower(regexp_replace(normalize(coalesce(name, ''), NFKD), '[\u0300-\u036f]', '', 'g')),
      '[\t\n\v\f\r ]+', ' ', 'g'
    ),
    ' '
  )
$$;

comment on function public.advertiser_key(text) is
  'Advertiser identity: NFKD, accents removed, lower case, whitespace collapsed, trimmed. Mirrors advertiserKey() in src/lib/advertisers.ts.';

-- Stored so the identity is indexed and filterable (Ad Spy advertiser search uses it too).
alter table public.advertisements
  add column if not exists advertiser_key text generated always as (public.advertiser_key(advertiser)) stored;

comment on column public.advertisements.advertiser_key is
  'Normalized advertiser identity (advertiser_key(advertiser)); groups case/accent/spacing variants of one advertiser.';

create index if not exists advertisements_advertiser_key_idx on public.advertisements (advertiser_key);
-- Activity on a day = a range scan on last_seen; covering first_seen and the key allows index-only scans.
create index if not exists advertisements_activity_idx on public.advertisements (last_seen, advertiser_key, first_seen);

-- Per-advertiser activity on as_of: active ads, active ads running for at least min_days, oldest active
-- first_seen. Only advertisers with at least one active ad are returned; `keys` (optional) restricts the
-- result to some advertiser keys (the advertisers of one result page).
create or replace function public.advertiser_activity(as_of date, min_days integer default 7, keys text[] default null)
returns table (advertiser_key text, active_ads integer, active_since_min_days integer, oldest_active_first_seen date)
language sql
stable
parallel safe
set search_path = pg_catalog
as $$
  select a.advertiser_key,
         count(*)::integer,
         (count(*) filter (where a.first_seen <= as_of - min_days))::integer,
         min(a.first_seen)
  from public.advertisements a
  where a.last_seen >= as_of - 2
    and a.first_seen <= as_of
    and (keys is null or a.advertiser_key = any (keys))
  group by a.advertiser_key
$$;

comment on function public.advertiser_activity(date, integer, text[]) is
  'Active-advertiser statistics on as_of (active = first_seen <= as_of and last_seen >= as_of - 2). Mirrors advertiserActivity() in src/lib/advertisers.ts.';

-- Ads of the advertisers that qualify on as_of. Used as the base relation of Ad Spy (PostgREST applies
-- the usual filters, order, range and exact count to it, so totals describe the filtered set).
-- No SET clause and fully qualified names: the planner can inline this SQL function into the calling
-- query, so filters, ORDER BY and LIMIT use the advertisements indexes.
create or replace function public.ads_of_active_advertisers(as_of date, min_ads integer default 5, min_days integer default 7)
returns setof public.advertisements
language sql
stable
as $$
  select a.*
  from public.advertisements a
  where a.advertiser_key in (
    select s.advertiser_key
    from public.advertiser_activity(as_of, min_days) s
    where s.active_since_min_days >= min_ads
  )
$$;

comment on function public.ads_of_active_advertisers(date, integer, integer) is
  'Every ad of the advertisers with >= min_ads active ads first seen >= min_days days before as_of (defaults 5 and 7).';

grant execute on function public.advertiser_key(text) to public;

-- Server only (Supabase grants new functions to anon/authenticated by default).
revoke all on function public.advertiser_activity(date, integer, text[]) from public, anon, authenticated;
revoke all on function public.ads_of_active_advertisers(date, integer, integer) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.advertiser_activity(date, integer, text[]) to service_role;
    grant execute on function public.ads_of_active_advertisers(date, integer, integer) to service_role;
  end if;
end;
$$;
