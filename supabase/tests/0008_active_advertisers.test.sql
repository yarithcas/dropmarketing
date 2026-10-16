-- Tests for 0008_active_advertisers.sql against the shared fixture tests/fixtures/active-advertisers.json,
-- which tests/active-advertisers.test.ts also checks against src/lib/advertisers.ts: same input, same
-- expected identities, activity counts and qualifying ads on both sides.
-- Run from the repository root (the fixture path is relative) against a scratch database with every
-- migration applied:
--   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/0008_active_advertisers.test.sql
-- Everything runs in one transaction that is rolled back. Any failed check raises.

\set ON_ERROR_STOP on
\set fixture `cat tests/fixtures/active-advertisers.json`
\o /dev/null
begin;

create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then
    raise exception 'FAILED: %', label;
  end if;
end;
$$;

create temp table fx on commit drop as select (:'fixture')::jsonb as j;

-- 1. Advertiser identity -------------------------------------------------------------------------
select pg_temp.check(public.advertiser_key(c ->> 0) = c ->> 1, format('advertiser_key(%L): expected %L, got %L', c ->> 0, c ->> 1, public.advertiser_key(c ->> 0)))
from fx, jsonb_array_elements(j -> 'keyCases') c;

-- 2. Fixture ads (as the table owner) --------------------------------------------------------------
insert into public.advertisements (id, connector, external_id, advertiser, platform, country, language, format, category, first_seen, last_seen, ended, source_kind, observed_at)
select 'fixture-' || (e ->> 'id'), 'fixture', e ->> 'id', e ->> 'advertiser', 'meta', 'FR', 'fr', 'video', 'home',
       (e ->> 'firstSeen')::date, (e ->> 'lastSeen')::date, coalesce((e ->> 'ended')::boolean, false), 'measured', now()
from fx, jsonb_array_elements(j -> 'ads') e;

-- Unrelated rows must not leak into the fixture's results.
insert into public.advertisements (id, connector, external_id, advertiser, platform, country, language, format, category, first_seen, last_seen, source_kind, observed_at)
select 'noise-' || g, 'noise', 'noise-' || g, 'Noise Brand ' || (g % 7), 'meta', 'FR', 'fr', 'video', 'home', date '2026-09-01', date '2026-10-12', 'measured', now()
from generate_series(1, 70) g;

select pg_temp.check(a.advertiser_key = public.advertiser_key(a.advertiser), format('generated advertiser_key for %L', a.advertiser))
from public.advertisements a;

select pg_temp.check(count(distinct advertiser_key) = 13, 'fixture advertisers grouped into 13 identities')
from public.advertisements where connector = 'fixture';

-- 3. Activity and qualifying ads, per threshold case ----------------------------------------------
do $$
declare
  fixture jsonb := (select j from fx);
  as_of date := (fixture ->> 'asOf')::date;
  keys text[] := (select array_agg(distinct advertiser_key) from public.advertisements where connector = 'fixture');
  c jsonb;
  got jsonb;
  got_ids jsonb;
  expected_ids jsonb;
begin
  for c in select jsonb_array_elements(fixture -> 'cases') loop
    select coalesce(jsonb_object_agg(s.advertiser_key, jsonb_build_object(
             'activeAds', s.active_ads,
             'activeSinceMinDays', s.active_since_min_days,
             'oldestActiveFirstSeen', to_char(s.oldest_active_first_seen, 'YYYY-MM-DD'),
             'qualifies', s.active_since_min_days >= (c ->> 'minAds')::integer)), '{}'::jsonb)
      into got
      from public.advertiser_activity(as_of, (c ->> 'minDays')::integer, keys) s;
    perform pg_temp.check(got = c -> 'activity', format('%s: activity %s, expected %s', c ->> 'name', got, c -> 'activity'));

    select coalesce(jsonb_agg(a.external_id order by a.external_id), '[]'::jsonb)
      into got_ids
      from public.ads_of_active_advertisers(as_of, (c ->> 'minAds')::integer, (c ->> 'minDays')::integer) a
     where a.connector = 'fixture';
    select coalesce(jsonb_agg(v order by v), '[]'::jsonb) into expected_ids from jsonb_array_elements_text(c -> 'qualifyingAdIds') v;
    perform pg_temp.check(got_ids = expected_ids, format('%s: qualifying ads %s, expected %s', c ->> 'name', got_ids, expected_ids));
  end loop;

  -- Defaults are the product rule (5 ads, 7 days).
  perform pg_temp.check(
    (select count(*) from public.ads_of_active_advertisers(as_of) a where a.connector = 'fixture')
      = jsonb_array_length(fixture -> 'cases' -> 0 -> 'qualifyingAdIds'),
    'default thresholds = 5 ads / 7 days');
  -- Advertisers without an active ad are not returned.
  perform pg_temp.check(not exists (select 1 from public.advertiser_activity(as_of, 7, keys) s where s.advertiser_key = any (array(select jsonb_array_elements_text(fixture -> 'withoutActiveAds')))),
    'advertisers without active ads are absent');
  -- Without `keys`, every active advertiser is returned (fixture + noise).
  perform pg_temp.check((select count(*) from public.advertiser_activity(as_of)) = 11 + 7, 'unrestricted activity covers all active advertisers');
end;
$$;

-- 3b. advertisements.ended: a plain boolean defaulting to false (the ingestion writes it with every sync).
select pg_temp.check(not a.ended, 'ended defaults to false') from public.advertisements a where a.connector = 'noise';
select pg_temp.check(
  (select data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'
     from information_schema.columns where table_schema = 'public' and table_name = 'advertisements' and column_name = 'ended'),
  'advertisements.ended is boolean not null default false');

-- 4. Access: server (service role) only; invoker rights -------------------------------------------
select pg_temp.check(not has_function_privilege(r, 'public.advertiser_activity(date, integer, text[])', 'execute'), format('%s cannot call advertiser_activity', r))
from unnest(array['anon', 'authenticated']) r;
select pg_temp.check(not has_function_privilege(r, 'public.ads_of_active_advertisers(date, integer, integer)', 'execute'), format('%s cannot call ads_of_active_advertisers', r))
from unnest(array['anon', 'authenticated']) r;
select pg_temp.check(has_function_privilege('service_role', 'public.advertiser_activity(date, integer, text[])', 'execute')
                 and has_function_privilege('service_role', 'public.ads_of_active_advertisers(date, integer, integer)', 'execute'), 'service_role can call both')
where exists (select 1 from pg_roles where rolname = 'service_role');
select pg_temp.check(has_function_privilege('anon', 'public.advertiser_key(text)', 'execute'), 'advertiser_key is a public pure function');
select pg_temp.check(not p.prosecdef, format('%s is SECURITY INVOKER', p.proname))
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('advertiser_key', 'advertiser_activity', 'ads_of_active_advertisers');
select pg_temp.check(p.provolatile = 'i', 'advertiser_key is immutable') from pg_proc p where p.oid = 'public.advertiser_key(text)'::regprocedure;

-- 5. The Ad Spy query shape (PostgREST: arguments from the JSON body, filters, order, limit) is inlined
--    into an index-backed plan rather than materializing every qualifying ad.
create temp table plan_check (line text) on commit drop;
do $$
declare
  r record;
begin
  for r in execute $q$
    explain (format text)
    select pgrst_call.id
    from (select '{"as_of":"2026-10-12","min_ads":5,"min_days":7}'::json as json_data) pgrst_payload,
    lateral json_to_record(pgrst_payload.json_data) as pgrst_body(as_of date, min_ads integer, min_days integer),
    lateral public.ads_of_active_advertisers(as_of := pgrst_body.as_of, min_ads := pgrst_body.min_ads, min_days := pgrst_body.min_days) pgrst_call
    where pgrst_call.country = 'FR'
    order by pgrst_call.first_seen desc
    limit 24
  $q$ loop
    insert into plan_check values (r."QUERY PLAN");
  end loop;
end;
$$;
select pg_temp.check(not exists (select 1 from plan_check where line like '%Function Scan on ads_of_active_advertisers%'), 'ads_of_active_advertisers is inlined');

\o
select '0008_active_advertisers: all checks passed' as result;
rollback;
