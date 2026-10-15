-- Shopify integration: revocation, scheduled daily sync, store currency,
-- daily inventory history and manual market matches.
--
-- All writes go through the server (service role, src/lib/server/shopify.ts).
-- Clients can only read rows of their own integrations.

-- ---------------------------------------------------------------------------
-- Connections
-- ---------------------------------------------------------------------------
-- A revoked integration (app uninstalled, 401/403 from Shopify) keeps its row so
-- the owner sees the status and can reconnect, but its token is deleted.
alter table public.connected_integrations alter column access_token_encrypted drop not null;
alter table public.connected_integrations
  add constraint connected_integrations_revoked_without_token
    check (status <> 'revoked' or access_token_encrypted is null),
  add constraint connected_integrations_active_with_token
    check (status = 'revoked' or access_token_encrypted is not null);

-- Automatic sync schedule: due when the last sync (or attempt) is older than the interval.
alter table public.connected_integrations
  add column sync_interval_hours integer not null default 24 check (sync_interval_hours between 1 and 168),
  add column last_attempt_at timestamptz;

create index connected_integrations_shop_idx on public.connected_integrations (provider, external_account);

grant select (sync_interval_hours, last_attempt_at) on public.connected_integrations to authenticated;

-- ---------------------------------------------------------------------------
-- Store currency (prices and revenue are shown in the store's own currency)
-- ---------------------------------------------------------------------------
alter table public.own_store_products
  add column currency text check (currency ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------
-- Daily inventory snapshots (one row per product and day, kept 400 days)
-- ---------------------------------------------------------------------------
create table public.own_store_inventory_snapshots (
  integration_id uuid not null references public.connected_integrations (id) on delete cascade,
  product_external_id text not null,
  date date not null,
  inventory integer not null,
  primary key (integration_id, product_external_id, date)
);

-- ---------------------------------------------------------------------------
-- Manual market matches. No row: automatic name-similarity estimate.
-- market_product_id null: the owner stated there is no comparable product.
-- Removing a tracked product reverts its manual matches to the estimate.
-- ---------------------------------------------------------------------------
create table public.own_store_market_matches (
  integration_id uuid not null references public.connected_integrations (id) on delete cascade,
  product_external_id text not null,
  market_product_id text references public.products (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (integration_id, product_external_id)
);

alter table public.own_store_inventory_snapshots enable row level security;
alter table public.own_store_market_matches enable row level security;

create policy "own store inventory" on public.own_store_inventory_snapshots for select
  using (exists (select 1 from public.connected_integrations i where i.id = integration_id and i.user_id = auth.uid()));
create policy "own store matches" on public.own_store_market_matches for select
  using (exists (select 1 from public.connected_integrations i where i.id = integration_id and i.user_id = auth.uid()));

revoke insert, update, delete, truncate on public.own_store_inventory_snapshots from authenticated, anon;
revoke insert, update, delete, truncate on public.own_store_market_matches from authenticated, anon;
