-- Business workspaces, team collaboration and role-based access.
--
-- Organization = workspace. A user can belong to several organizations; the
-- active one is chosen server-side (httpOnly cookie, always re-validated
-- against organization_members). Workspaces created by a Business owner are
-- billed under that owner's organization (billing_organization_id), so the
-- plan of a workspace is the active subscription of
-- coalesce(billing_organization_id, id).
--
-- Membership, invitation and workspace writes happen only in server routes
-- with the service role, after role and plan checks: authenticated users get
-- no write policy on organizations, organization_members or invitations.

-- ---------------------------------------------------------------------------
-- Organizations: billing parent
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column billing_organization_id uuid references public.organizations (id) on delete set null,
  add constraint organizations_billing_not_self check (billing_organization_id is null or billing_organization_id <> id);
create index organizations_billing_idx on public.organizations (billing_organization_id);

-- One level only: a billing organization pays for itself and is never billed elsewhere.
create or replace function public.check_billing_organization()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.billing_organization_id is not null and (
    exists (select 1 from public.organizations p where p.id = new.billing_organization_id and p.billing_organization_id is not null)
    or exists (select 1 from public.organizations c where c.billing_organization_id = new.id)
  ) then
    raise exception 'billing_organization_nested' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger organizations_billing_check before insert or update of billing_organization_id on public.organizations
  for each row execute function public.check_billing_organization();

-- ---------------------------------------------------------------------------
-- Helpers (security definer: they read memberships regardless of RLS)
-- ---------------------------------------------------------------------------
create or replace function public.has_org_role(org uuid, roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_members m where m.organization_id = org and m.user_id = auth.uid() and m.role = any (roles));
$$;

-- True when the caller and `other` share at least one organization.
create or replace function public.is_teammate(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid() and theirs.user_id = other
  );
$$;

-- A user's default workspace: oldest owned membership, else oldest membership.
create or replace function public.default_organization_for(uid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.organization_id from public.organization_members m
  where m.user_id = uid
  order by (m.role = 'owner') desc, m.created_at, m.organization_id
  limit 1;
$$;
revoke execute on function public.default_organization_for(uuid) from public, anon, authenticated;

-- Plan of a workspace: the best active (or trialing) subscription of the
-- organization that pays for it, coalesce(billing_organization_id, id); else Free.
-- Same signature as public.org_plan in 0003_plan_limits.sql (when present), so
-- anything resolving a plan through it follows the billing organization.
create or replace function public.org_plan(org uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.plan from public.subscriptions s
      where s.organization_id = coalesce((select o.billing_organization_id from public.organizations o where o.id = org), org)
        and s.status in ('active', 'trialing')
      order by case s.plan when 'business' then 3 when 'pro' then 2 else 1 end desc
      limit 1),
    'free')
$$;

-- The caller's workspaces with their role, effective plan and member count.
create or replace function public.my_workspaces()
returns table (organization_id uuid, name text, role text, plan text, billing_organization_id uuid, member_count int, created_at timestamptz, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select
    o.id,
    o.name,
    m.role,
    public.org_plan(o.id),
    coalesce(o.billing_organization_id, o.id),
    (select count(*)::int from public.organization_members x where x.organization_id = o.id),
    o.created_at,
    m.created_at
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = auth.uid()
  order by m.created_at, o.id;
$$;
revoke execute on function public.my_workspaces() from public, anon;
grant execute on function public.my_workspaces() to authenticated;

-- Member directory (names and emails) for team management and seat counting.
-- Service role only: routes call it after checking the caller's membership.
create or replace function public.org_member_directory(orgs uuid[])
returns table (organization_id uuid, user_id uuid, role text, name text, email text, joined_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select m.organization_id, m.user_id, m.role, p.name, u.email, m.created_at
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where m.organization_id = any (orgs)
  order by m.created_at, m.user_id;
$$;
revoke execute on function public.org_member_directory(uuid[]) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.org_member_directory(uuid[]) to service_role;
    grant execute on function public.default_organization_for(uuid) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Invitations (only a SHA-256 hash of the token is stored)
-- ---------------------------------------------------------------------------
create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254 and position('@' in email) > 1),
  role text not null default 'member' check (role in ('admin', 'member')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
-- One open invitation per address and workspace (re-inviting replaces it).
create unique index organization_invitations_pending_idx on public.organization_invitations (organization_id, email) where accepted_at is null;

alter table public.organization_invitations enable row level security;
create policy "admins read invitations" on public.organization_invitations for select
  using (public.has_org_role(organization_id, array['owner', 'admin']));
-- Token hashes never leave the server; writes go through service-role routes.
revoke all on public.organization_invitations from anon, authenticated;
grant select (id, organization_id, email, role, invited_by, expires_at, accepted_at, accepted_by, created_at)
  on public.organization_invitations to authenticated;

-- Teammates can see each other's display name.
create policy "teammates read profiles" on public.profiles for select using (public.is_teammate(user_id));

-- ---------------------------------------------------------------------------
-- Workspace scoping of user data
-- ---------------------------------------------------------------------------
alter table public.notifications add column if not exists organization_id uuid references public.organizations (id) on delete cascade;
alter table public.collections add column if not exists visibility text not null default 'private' check (visibility in ('private', 'team'));

-- Backfill rows written before workspaces existed with each user's first organization.
update public.collections set organization_id = public.default_organization_for(user_id) where organization_id is null;
update public.watchlists set organization_id = public.default_organization_for(user_id) where organization_id is null;
update public.alerts set organization_id = public.default_organization_for(user_id) where organization_id is null;
update public.notifications n
  set organization_id = coalesce((select a.organization_id from public.alerts a where a.id = n.alert_id), public.default_organization_for(n.user_id))
  where organization_id is null;

-- Inserts that omit the workspace (older code paths, background jobs) land in the user's default one.
create or replace function public.set_default_organization()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null then
    new.organization_id := public.default_organization_for(new.user_id);
  end if;
  return new;
end;
$$;

-- Notifications follow the workspace of the alert that produced them.
create or replace function public.set_notification_organization()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null and new.alert_id is not null then
    select a.organization_id into new.organization_id from public.alerts a where a.id = new.alert_id;
  end if;
  if new.organization_id is null then
    new.organization_id := public.default_organization_for(new.user_id);
  end if;
  return new;
end;
$$;

create trigger collections_default_org before insert on public.collections for each row execute function public.set_default_organization();
create trigger watchlists_default_org before insert on public.watchlists for each row execute function public.set_default_organization();
create trigger alerts_default_org before insert on public.alerts for each row execute function public.set_default_organization();
create trigger notifications_default_org before insert on public.notifications for each row execute function public.set_notification_organization();

-- The same item can be watched in several workspaces.
alter table public.watchlists drop constraint if exists watchlists_user_id_item_type_ref_id_key;
alter table public.watchlists add constraint watchlists_user_org_item_key unique nulls not distinct (user_id, organization_id, item_type, ref_id);

-- One swipe file per user and workspace (created lazily by the server). Extra
-- swipe collections from before this migration become standard collections.
update public.collections c set kind = 'standard'
where c.kind = 'swipe' and exists (
  select 1 from public.collections d
  where d.kind = 'swipe' and d.user_id = c.user_id and d.organization_id is not distinct from c.organization_id
    and (d.created_at, d.id) < (c.created_at, c.id)
);
create unique index collections_swipe_unique_idx on public.collections (user_id, organization_id) where kind = 'swipe';

create index collections_org_idx on public.collections (organization_id, visibility);
create index watchlists_org_user_idx on public.watchlists (organization_id, user_id);
create index alerts_org_user_idx on public.alerts (organization_id, user_id);
create index notifications_user_org_idx on public.notifications (user_id, organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: creators edit their rows only inside workspaces they belong to;
-- members read "team" collections (and their items) of their workspaces.
-- ---------------------------------------------------------------------------
drop policy if exists "own collections" on public.collections;
create policy "own collections" on public.collections for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_member(organization_id));
create policy "members read team collections" on public.collections for select
  using (visibility = 'team' and public.is_member(organization_id));

drop policy if exists "own collection items" on public.collection_items;
create policy "own collection items" on public.collection_items for all
  using (exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid() and public.is_member(c.organization_id)));
create policy "members read team collection items" on public.collection_items for select
  using (exists (select 1 from public.collections c where c.id = collection_id and c.visibility = 'team' and public.is_member(c.organization_id)));

drop policy if exists "own watchlist" on public.watchlists;
create policy "own watchlist" on public.watchlists for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_member(organization_id));

drop policy if exists "own alerts" on public.alerts;
create policy "own alerts" on public.alerts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_member(organization_id));
