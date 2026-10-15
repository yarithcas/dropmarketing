-- TrendHunter 0007: authorized ad media (playable videos / images).
-- Applies after 0005_provenance.sql.
--
-- * Only media URLs a provider officially returns for display are stored (TikTok Commercial Content API
--   ad.videos[].url / cover_image_url and ad.image_urls; a licensed feed's media entries). Nothing is
--   scraped, downloaded or re-hosted; Meta's Ad Library API returns no media URL, so Meta rows keep [].
-- * Every URL is HTTPS and carries no access token (Meta's ad_snapshot_url embeds one and is never stored).
-- * Entry shape: {"type": "video"|"image", "url": "https://…", "posterUrl"?: "https://…",
--   "source": "<connector>", "authorized": true}.

create or replace function public.ad_media_valid(m jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_typeof(m) = 'array'
    and jsonb_array_length(m) <= 10
    and not exists (
      select 1
      from jsonb_array_elements(m) as e(v)
      where jsonb_typeof(e.v) is distinct from 'object'
         or coalesce(e.v ->> 'type', '') not in ('video', 'image')
         or jsonb_typeof(e.v -> 'url') is distinct from 'string'
         or (e.v ->> 'url') !~ '^https://'
         or (e.v ->> 'url') ~* '[?&]access_token='
         or length(e.v ->> 'url') > 2048
         or (
           e.v ? 'posterUrl' and jsonb_typeof(e.v -> 'posterUrl') <> 'null'
           and (
             jsonb_typeof(e.v -> 'posterUrl') <> 'string'
             or (e.v ->> 'posterUrl') !~ '^https://'
             or (e.v ->> 'posterUrl') ~* '[?&]access_token='
             or length(e.v ->> 'posterUrl') > 2048
           )
         )
         or jsonb_typeof(e.v -> 'source') is distinct from 'string'
         or (e.v -> 'authorized') is distinct from 'true'::jsonb
    )
$$;

comment on function public.ad_media_valid(jsonb) is
  'True when every entry is {type video|image, url https (tokenless), optional posterUrl https, source, authorized true}; at most 10 entries.';

alter table public.advertisements
  add column if not exists media jsonb not null default '[]'::jsonb;

alter table public.advertisements
  drop constraint if exists advertisements_media_valid;
alter table public.advertisements
  add constraint advertisements_media_valid check (public.ad_media_valid(media));

comment on column public.advertisements.media is
  'Authorized creative media returned by the source for display (TikTok Commercial Content API videos/images, licensed feed). HTTPS, tokenless, never re-hosted; provider URLs may expire and are refreshed at each sync. [] when none (always for Meta).';
