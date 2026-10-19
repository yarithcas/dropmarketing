-- RLS and helper tests for 0004_team_workspaces.sql (two organizations, three users).
-- Run against a scratch database after 0001_init.sql and 0004_team_workspaces.sql:
--   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/0004_team_workspaces.test.sql
-- Everything runs in one transaction that is rolled back. Any failed check raises.
--
-- Alice owns organization A (Business) and a second workspace W billed under A.
-- Bob is a member of A. Carol only has her personal organization C.

\set ON_ERROR_STOP on
\o /dev/null
begin;

create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then
    raise exception 'FAILED: %', label;
  end if;
end;
$$;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
end;
$$;

-- Fixtures (as the table owner) ---------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com', '{"name": "Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com', '{"name": "Bob"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com', '{"name": "Carol"}');

create temp table fx on commit drop as
select
  (select organization_id from public.organization_members where user_id = '00000000-0000-0000-0000-00000000000a') as org_a,
  (select organization_id from public.organization_members where user_id = '00000000-0000-0000-0000-00000000000b') as org_b,
  (select organization_id from public.organization_members where user_id = '00000000-0000-0000-0000-00000000000c') as org_c,
  '00000000-0000-0000-0000-0000000000f1'::uuid as org_w;
grant select on fx to authenticated;

update public.subscriptions set plan = 'business' where organization_id = (select org_a from fx);
insert into public.organizations (id, name, billing_organization_id) select org_w, 'Alice second', org_a from fx;
insert into public.subscriptions (organization_id, plan, status) select org_w, 'free', 'active' from fx;
-- (now() is constant in a transaction: later memberships get explicit timestamps)
insert into public.organization_members (organization_id, user_id, role, created_at)
select org_w, '00000000-0000-0000-0000-00000000000a'::uuid, 'owner', now() + interval '1 minute' from fx
union all select org_a, '00000000-0000-0000-0000-00000000000b'::uuid, 'member', now() + interval '1 minute' from fx;

insert into public.collections (id, user_id, organization_id, name, visibility)
select '00000000-0000-0000-0000-0000000000c1'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid, org_a, 'Alice private', 'private' from fx
union all select '00000000-0000-0000-0000-0000000000c2'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid, org_a, 'Alice team', 'team' from fx
union all select '00000000-0000-0000-0000-0000000000c3'::uuid, '00000000-0000-0000-0000-00000000000c'::uuid, org_c, 'Carol team', 'team' from fx;
insert into public.collection_items (collection_id, item_type, ref_id, label) values
  ('00000000-0000-0000-0000-0000000000c1', 'product', 'p1', 'Private item'),
  ('00000000-0000-0000-0000-0000000000c2', 'product', 'p2', 'Team item'),
  ('00000000-0000-0000-0000-0000000000c3', 'product', 'p3', 'Carol item');
insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by)
select org_a, 'dave@example.com', 'member', repeat('a', 64), '00000000-0000-0000-0000-00000000000a' from fx;

-- Helpers and constraints (owner) ----------------------------------------------
select pg_temp.check(public.org_plan((select org_w from fx)) = 'business', 'W is billed under A (business)');
select pg_temp.check(public.org_plan((select org_c from fx)) = 'free', 'C is free');
select pg_temp.check(public.default_organization_for('00000000-0000-0000-0000-00000000000b') = (select org_b from fx), 'Bob defaults to his owned workspace');

do $$
begin
  insert into public.organization_invitations (organization_id, email, token_hash) select org_a, 'Mixed@Example.com', repeat('b', 64) from fx;
  raise exception 'FAILED: non-normalized invitation email accepted';
exception when check_violation then null;
end $$;
do $$
begin
  insert into public.organization_invitations (organization_id, email, token_hash) select org_a, 'dave@example.com', repeat('c', 64) from fx;
  raise exception 'FAILED: two open invitations for one address';
exception when unique_violation then null;
end $$;
do $$
begin
  insert into public.organizations (name, billing_organization_id) select 'nested', org_w from fx;
  raise exception 'FAILED: nested billing organization accepted';
exception when check_violation then null;
end $$;

-- Alice (owner of A and W) -----------------------------------------------------
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');

select pg_temp.check((select count(*) from public.my_workspaces()) = 2, 'Alice has 2 workspaces (A and W)');
select pg_temp.check((select plan from public.my_workspaces() where organization_id = (select org_w from fx)) = 'business', 'my_workspaces: W plan follows A');
select pg_temp.check((select billing_organization_id from public.my_workspaces() where organization_id = (select org_w from fx)) = (select org_a from fx), 'my_workspaces: W billed by A');
select pg_temp.check((select member_count from public.my_workspaces() where organization_id = (select org_a from fx)) = 2, 'A has 2 members');
select pg_temp.check((select count(*) from public.organization_invitations) = 1, 'owner reads invitations');
do $$
begin
  perform token_hash from public.organization_invitations;
  raise exception 'FAILED: token_hash readable by a client';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  insert into public.organization_invitations (organization_id, email, token_hash) select org_a, 'eve@example.com', repeat('d', 64) from fx;
  raise exception 'FAILED: client inserted an invitation';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform * from public.org_member_directory(array[(select org_a from fx)]);
  raise exception 'FAILED: member directory callable by clients';
exception when insufficient_privilege then null;
end $$;

-- Inserts without a workspace land in the default (oldest owned) one; one swipe file per workspace.
insert into public.collections (user_id, name, kind) values ('00000000-0000-0000-0000-00000000000a', 'Swipe file', 'swipe');
select pg_temp.check((select organization_id from public.collections where kind = 'swipe') = (select org_a from fx), 'default workspace on insert');
do $$
begin
  insert into public.collections (user_id, organization_id, name, kind) select '00000000-0000-0000-0000-00000000000a', org_a, 'Swipe 2', 'swipe' from fx;
  raise exception 'FAILED: second swipe file in one workspace';
exception when unique_violation then null;
end $$;
insert into public.collections (user_id, organization_id, name, kind) select '00000000-0000-0000-0000-00000000000a', org_w, 'Swipe file', 'swipe' from fx;

-- The same item can be watched once per workspace.
insert into public.watchlists (user_id, organization_id, item_type, ref_id, label) select '00000000-0000-0000-0000-00000000000a', org_a, 'product', 'p1', 'P1' from fx;
insert into public.watchlists (user_id, organization_id, item_type, ref_id, label) select '00000000-0000-0000-0000-00000000000a', org_w, 'product', 'p1', 'P1' from fx;
do $$
begin
  insert into public.watchlists (user_id, organization_id, item_type, ref_id, label) select '00000000-0000-0000-0000-00000000000a', org_w, 'product', 'p1', 'P1' from fx;
  raise exception 'FAILED: duplicate watch in one workspace';
exception when unique_violation then null;
end $$;

-- Notifications follow the workspace of their alert.
insert into public.alerts (id, user_id, organization_id, name, type)
select '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', org_w, 'Rule', 'daily_summary' from fx;
insert into public.notifications (user_id, alert_id, key) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'k');
select pg_temp.check((select organization_id from public.notifications) = (select org_w from fx), 'notification workspace from alert');

-- No writes into a workspace one does not belong to.
do $$
begin
  insert into public.collections (user_id, organization_id, name) select '00000000-0000-0000-0000-00000000000a', org_c, 'Intruder' from fx;
  raise exception 'FAILED: collection created in a foreign workspace';
-- (with 0003_plan_limits.sql the Free plan of C may refuse it first)
exception when insufficient_privilege or check_violation then null;
end $$;
do $$
begin
  insert into public.watchlists (user_id, organization_id, item_type, ref_id, label) select '00000000-0000-0000-0000-00000000000a', org_c, 'product', 'p9', 'x' from fx;
  raise exception 'FAILED: watch created in a foreign workspace';
exception when insufficient_privilege or check_violation then null;
end $$;
do $$
begin
  update public.organization_members set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000b';
  if found then
    raise exception 'FAILED: client changed a role';
  end if;
end $$;

-- Bob (member of A) ------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');

select pg_temp.check((select count(*) from public.my_workspaces()) = 2, 'Bob has 2 workspaces');
select pg_temp.check((select role from public.my_workspaces() where organization_id = (select org_a from fx)) = 'member', 'Bob is a member of A');
select pg_temp.check((select array_agg(name order by name) from public.collections) = array['Alice team'], 'Bob reads only the team collection of A');
select pg_temp.check((select array_agg(label) from public.collection_items) = array['Team item'], 'Bob reads only team items of A');
select pg_temp.check((select count(*) from public.organization_invitations) = 0, 'members do not read invitations');
select pg_temp.check((select name from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a') = 'Alice', 'teammates read display names');
select pg_temp.check((select count(*) from public.profiles where user_id = '00000000-0000-0000-0000-00000000000c') = 0, 'no profile outside teams');
select pg_temp.check((select count(*) from public.organization_members where organization_id = (select org_a from fx)) = 2, 'Bob sees A''s members');

-- Read-only access to a teammate's shared collection.
update public.collections set name = 'Hijacked' where id = '00000000-0000-0000-0000-0000000000c2';
delete from public.collections where id = '00000000-0000-0000-0000-0000000000c2';
delete from public.collection_items where collection_id = '00000000-0000-0000-0000-0000000000c2';
select pg_temp.check((select name from public.collections where id = '00000000-0000-0000-0000-0000000000c2') = 'Alice team', 'shared collection unchanged');
select pg_temp.check((select count(*) from public.collection_items where collection_id = '00000000-0000-0000-0000-0000000000c2') = 1, 'shared items unchanged');
do $$
begin
  insert into public.collection_items (collection_id, item_type, ref_id, label) values ('00000000-0000-0000-0000-0000000000c2', 'product', 'p7', 'x');
  raise exception 'FAILED: item added to a teammate''s collection';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  insert into public.collections (user_id, name) values ('00000000-0000-0000-0000-00000000000a', 'Forged owner');
  raise exception 'FAILED: collection created for another user';
exception when insufficient_privilege then null;
end $$;

-- Bob shares a collection in A: Alice can read it.
insert into public.collections (id, user_id, organization_id, name, visibility)
select '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-00000000000b', org_a, 'Bob team', 'team' from fx;

-- Carol (no shared organization) ---------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');

select pg_temp.check((select array_agg(name) from public.collections) = array['Carol team'], 'Carol reads only her own collections');
select pg_temp.check((select array_agg(label) from public.collection_items) = array['Carol item'], 'Carol reads only her own items');
select pg_temp.check((select count(*) from public.organizations) = 1, 'Carol reads only her organization');
select pg_temp.check((select count(*) from public.organization_members) = 1, 'Carol reads only her membership');
select pg_temp.check((select count(*) from public.subscriptions) = 1, 'Carol reads only her subscription');
select pg_temp.check((select count(*) from public.organization_invitations) = 0, 'Carol reads no invitation');
select pg_temp.check((select count(*) from public.my_workspaces()) = 1, 'Carol has one workspace');
select pg_temp.check((select count(*) from public.profiles) = 1, 'Carol reads only her profile');

-- Alice again: reads Bob's shared collection, not his private data.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.collections where user_id = '00000000-0000-0000-0000-00000000000b') = 1, 'Alice reads Bob''s team collection');

-- Removed members lose access to the team's shared collections.
reset role;
delete from public.organization_members where user_id = '00000000-0000-0000-0000-00000000000b' and organization_id = (select org_a from fx);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.collections where user_id = '00000000-0000-0000-0000-00000000000a') = 0, 'former member reads nothing of A');
select pg_temp.check((select count(*) from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a') = 0, 'former teammate profile hidden');

reset role;
\o
select 'all team workspace checks passed' as result;
rollback;
