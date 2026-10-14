-- Plan limits enforced in the database, billing interval, search metering keys,
-- support requests, and no direct client access to research tables.
--
-- The application checks every limit before writing (src/lib/server/workspace-db.ts).
-- These triggers are defence in depth: RLS lets signed-in users write their own
-- rows through PostgREST with the public anon key, so limits must also hold there.

-- ---------------------------------------------------------------------------
-- Plan limits (must match src/lib/plans.ts; tests/plan-limits.test.ts checks it)
-- ---------------------------------------------------------------------------
create table public.plan_limits (
  plan text primary key check (plan in ('free', 'pro', 'business')),
  collections integer not null,
  saved_items integer not null,
  alert_rules integer not null,
  watchlists boolean not null,
  alerts boolean not null
);
insert into public.plan_limits (plan, collections, saved_items, alert_rules, watchlists, alerts) values
  ('free', 2, 20, 0, false, false),
  ('pro', 50, 1000, 25, true, true),
  ('business', 500, 10000, 200, true, true);
alter table public.plan_limits enable row level security;
create policy "read plan limits" on public.plan_limits for select to authenticated using (true);

-- Plan of an organization: its active (or trialing) subscription, else Free.
create or replace function public.org_plan(org uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.plan from public.subscriptions s
      where s.organization_id = org and s.status in ('active', 'trialing')
      order by case s.plan when 'business' then 3 when 'pro' then 2 else 1 end desc
      limit 1),
    'free')
$$;

-- Limits that apply to a user-owned row: the row's organization, else the user's first one.
create or replace function public.limits_for(uid uuid, org uuid)
returns public.plan_limits language sql stable security definer set search_path = public as $$
  select l.* from public.plan_limits l
  where l.plan = public.org_plan(coalesce(org,
    (select m.organization_id from public.organization_members m where m.user_id = uid order by m.created_at limit 1)))
$$;

create or replace function public.enforce_plan_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  lim public.plan_limits;
  owner uuid;
  org uuid;
  n integer;
begin
  if tg_table_name = 'collection_items' then
    select c.user_id, c.organization_id into owner, org from public.collections c where c.id = new.collection_id;
  else
    owner := new.user_id;
    org := new.organization_id;
  end if;
  if owner is null then
    return new;
  end if;
  -- Serialize concurrent writes of the same user so two inserts cannot both pass a count.
  perform pg_advisory_xact_lock(hashtext('plan_limits:' || owner::text));
  lim := public.limits_for(owner, org);

  if tg_table_name = 'collections' then
    select count(*) into n from public.collections where user_id = owner;
    if n >= lim.collections then
      raise exception 'limit_collections' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'collection_items' then
    select count(*) into n from public.collection_items i join public.collections c on c.id = i.collection_id where c.user_id = owner;
    if n >= lim.saved_items then
      raise exception 'limit_items' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'watchlists' then
    if not lim.watchlists then
      raise exception 'plan_required' using errcode = 'check_violation';
    end if;
    select count(*) into n from public.watchlists where user_id = owner;
    if n >= lim.saved_items then
      raise exception 'limit_items' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'alerts' then
    if tg_op = 'UPDATE' then
      -- Re-activating a rule requires a plan that includes alerts.
      if new.active and not old.active and not lim.alerts then
        raise exception 'plan_required' using errcode = 'check_violation';
      end if;
      return new;
    end if;
    if not lim.alerts then
      raise exception 'plan_required' using errcode = 'check_violation';
    end if;
    select count(*) into n from public.alerts where user_id = owner;
    if n >= lim.alert_rules then
      raise exception 'limit_rules' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger collections_plan_limits before insert on public.collections
  for each row execute function public.enforce_plan_limits();
create trigger collection_items_plan_limits before insert on public.collection_items
  for each row execute function public.enforce_plan_limits();
create trigger watchlists_plan_limits before insert on public.watchlists
  for each row execute function public.enforce_plan_limits();
create trigger alerts_plan_limits before insert or update of active on public.alerts
  for each row execute function public.enforce_plan_limits();

-- ---------------------------------------------------------------------------
-- Search metering: one usage event per distinct query and day (page turns are free)
-- ---------------------------------------------------------------------------
alter table public.usage_events add column query_key text;
create index usage_events_query_idx on public.usage_events (user_id, feature, query_key, created_at desc);

-- ---------------------------------------------------------------------------
-- Billing interval and cancellation state (written by the Stripe webhook only)
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column billing_interval text check (billing_interval in ('month', 'year')),
  add column cancel_at_period_end boolean not null default false;

-- ---------------------------------------------------------------------------
-- Support requests. Written by the server after a session check; priority is
-- derived from the plan on the server, never from the client.
-- ---------------------------------------------------------------------------
create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  plan text not null check (plan in ('free', 'pro', 'business')),
  priority boolean not null default false,
  category text not null check (category in ('question', 'bug', 'billing', 'data', 'other')),
  subject text not null check (char_length(subject) between 1 and 160),
  message text not null check (char_length(message) between 1 and 5000),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index support_requests_user_idx on public.support_requests (user_id, created_at desc);
alter table public.support_requests enable row level security;
create policy "own support requests" on public.support_requests for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Research data is served only by server routes (service role) that apply plan
-- metering, filters and export gating. No direct client reads.
-- ---------------------------------------------------------------------------
drop policy if exists "read research" on public.products;
drop policy if exists "read research" on public.product_metrics;
drop policy if exists "read research" on public.product_observations;
drop policy if exists "read research" on public.advertisements;
drop policy if exists "read research" on public.ad_observations;
drop policy if exists "read research" on public.stores;
drop policy if exists "read research" on public.store_products;
drop policy if exists "read research" on public.store_snapshots;
drop policy if exists "read research" on public.trend_signals;
