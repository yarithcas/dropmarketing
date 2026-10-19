import { z } from "zod";
import { CALLS_TO_ACTION, CATEGORIES, COUNTRIES, CREATIVE_FORMATS, LANGUAGES, PLATFORMS } from "../types";
import type { AdMedia, CallToAction, Category, CategoryBasis, Country, CreativeFormat, Platform, ProductMatchBasis } from "../types";
import { addDays } from "../dates";
import { hashString } from "../demo/generate";
import { classifyCategory, matchProduct, type MatchableProduct } from "./matching";
import type { SearchTerm } from "./types";

/**
 * Pure mappings from provider payloads to database rows. Only fields the
 * provider actually returns are mapped; anything else is stored as unknown
 * (null / "unknown"). Values inferred by TrendHunter carry an explicit basis
 * (product_match_basis / category_basis) so they are shown as estimates.
 */

/** Row written to public.advertisements (migrations 0001 + 0005). */
export interface AdRow {
  id: string;
  connector: string;
  external_id: string;
  product_id: string | null;
  product_match_basis: ProductMatchBasis | null;
  advertiser: string;
  platform: Platform;
  country: Country;
  language: string | null;
  format: CreativeFormat;
  headline: string;
  copy: string;
  cta: CallToAction;
  landing_domain: string | null;
  landing_url: string | null;
  snapshot_url: string | null;
  placements: string[];
  /** Media URLs the provider returns for display (migration 0007); [] when none. */
  media: AdMedia[];
  category: Category | null;
  category_basis: CategoryBasis | null;
  first_seen: string;
  last_seen: string;
  source_kind: "measured" | "estimate";
  observed_at: string;
  hue: number;
}

/** An ad plus whether it was still being delivered on the observation day (→ ad_observations.active). */
export interface AdRecord {
  row: AdRow;
  active: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}/;

/** HTTPS URL without credentials or access tokens; null for anything else (javascript:, http:, malformed). */
export function safeHttpsUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 2048) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    u.searchParams.delete("access_token");
    return u.toString();
  } catch {
    return null;
  }
}

/** At most this many media entries are kept per ad. */
export const MAX_AD_MEDIA = 10;

/**
 * Authorized media entry from a provider value: HTTPS, tokenless URLs only
 * (safeHttpsUrl), deduplicated, capped at MAX_AD_MEDIA. Anything else is dropped.
 */
export function adMedia(items: { type: AdMedia["type"]; url: unknown; posterUrl?: unknown }[], source: string): AdMedia[] {
  const out: AdMedia[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const url = safeHttpsUrl(it.url);
    if (!url || seen.has(url) || out.length >= MAX_AD_MEDIA) continue;
    seen.add(url);
    const posterUrl = safeHttpsUrl(it.posterUrl);
    out.push({ type: it.type, url, ...(posterUrl ? { posterUrl } : {}), source, authorized: true });
  }
  return out;
}

/** Public, tokenless Ad Library page of a Meta ad. */
export const metaLibraryUrl = (id: string) => `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
/** Public TikTok Ad Library page of an ad. */
export const tiktokLibraryUrl = (id: string) => `https://library.tiktok.com/ads/detail/?ad_id=${encodeURIComponent(id)}`;

/** ISO 639-1 code from a provider language list, preferring a language the UI supports; null when absent. */
export function pickLanguage(langs: unknown): string | null {
  const codes = (Array.isArray(langs) ? langs : [langs]).filter((l): l is string => typeof l === "string" && /^[a-z]{2,3}$/i.test(l)).map((l) => l.toLowerCase());
  return codes.find((c) => (LANGUAGES as readonly string[]).includes(c)) ?? codes[0] ?? null;
}

const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Domain shown as the link caption of a Meta ad ("EXAMPLE.COM", "shop.example.com/sale").
 * Only a caption that is itself a host name counts; free text ("Free delivery") gives null.
 */
export function captionDomain(captions: string[] | null | undefined): string | null {
  for (const raw of captions ?? []) {
    const c = raw.trim().toLowerCase().replace(/^https:\/\//, "").replace(/[/?#].*$/, "").replace(/^www\./, "");
    if (HOST.test(c)) return c;
  }
  return null;
}

/** YYYYMMDD (number or string) → YYYY-MM-DD; null when malformed. */
export function ymd(v: unknown): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(v ?? ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Product link and category inferred by TrendHunter — always estimates:
 * 1. the tracked product whose name was the provider search term ("search_term");
 * 2. otherwise token overlap between the ad text and product names/tags ("token_overlap");
 * then the category of the linked product ("product"), otherwise the keyword
 * classifier over the ad text, or the search term when the provider returns no
 * text ("keyword_classifier"), otherwise null.
 */
export function inferLinks(text: string, products: MatchableProduct[], search?: SearchTerm | null) {
  const keywordProduct = search?.productId ? products.find((p) => p.id === search.productId) : undefined;
  const matched = keywordProduct ? null : matchProduct(text, products);
  const product = keywordProduct ?? (matched ? products.find((p) => p.id === matched.productId) : undefined);
  const classified = product ? null : classifyCategory(text.trim() ? text : (search?.term ?? ""));
  return {
    product_id: product?.id ?? null,
    product_match_basis: keywordProduct ? ("search_term" as const) : product ? ("token_overlap" as const) : null,
    category: product?.category ?? classified,
    category_basis: product ? ("product" as const) : classified ? ("keyword_classifier" as const) : null,
  };
}

const first = (v: string[] | null | undefined) => (v ?? []).find((s) => s.trim())?.trim() ?? "";

// ---------------------------------------------------------------------------
// Meta Ad Library API (/ads_archive)
// ---------------------------------------------------------------------------

/**
 * Fields requested from /ads_archive — and the only ones mapped. ad_snapshot_url
 * is deliberately not requested: it embeds the API access token. The tokenless
 * public Ad Library page (built from the ad id) is stored instead.
 */
export const META_FIELDS = [
  "id",
  "page_name",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_creative_link_descriptions",
  "ad_creative_link_captions",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "languages",
  "publisher_platforms",
];

const metaAdSchema = z.object({
  id: z.union([z.string().min(1), z.number()]).transform(String),
  page_name: z.string().min(1),
  ad_creative_bodies: z.array(z.string()).nullish(),
  ad_creative_link_titles: z.array(z.string()).nullish(),
  ad_creative_link_descriptions: z.array(z.string()).nullish(),
  ad_creative_link_captions: z.array(z.string()).nullish(),
  ad_delivery_start_time: z.string().regex(DAY),
  ad_delivery_stop_time: z.string().regex(DAY).nullish(),
  languages: z.array(z.string()).nullish(),
  publisher_platforms: z.array(z.string()).nullish(),
});

/** Lower-case placement identifiers (facebook, instagram, audience_network, …). */
const placements = (v: string[] | null | undefined) => Array.from(new Set((v ?? []).map((p) => p.trim().toLowerCase()).filter((p) => /^[a-z_]{2,40}$/.test(p)))).slice(0, 10);

/**
 * `country` is the single country queried (ad_reached_countries=[country]),
 * so the ad is known to have reached it. Format and CTA are not exposed by the
 * API and stay "unknown"; the landing domain is the link caption when that is
 * a host name, and the full landing URL is not exposed (null).
 */
export function metaAdRecord(raw: unknown, country: Country, today: string, observedAt: string, products: MatchableProduct[], search?: SearchTerm | null): AdRecord | null {
  const p = metaAdSchema.safeParse(raw);
  if (!p.success) return null;
  const a = p.data;
  const stop = a.ad_delivery_stop_time?.slice(0, 10) ?? null;
  const ended = stop != null && stop < today;
  const text = [...(a.ad_creative_link_titles ?? []), ...(a.ad_creative_bodies ?? []), ...(a.ad_creative_link_descriptions ?? [])].join(" ");
  return {
    active: !ended,
    row: {
      id: `meta-${a.id}`,
      connector: "meta_ad_library",
      external_id: a.id,
      ...inferLinks(text, products, search),
      advertiser: a.page_name.slice(0, 300),
      platform: "meta",
      country,
      language: pickLanguage(a.languages),
      format: "unknown",
      headline: first(a.ad_creative_link_titles).slice(0, 500),
      copy: first(a.ad_creative_bodies).slice(0, 5000),
      cta: "unknown",
      landing_domain: captionDomain(a.ad_creative_link_captions),
      landing_url: null,
      snapshot_url: metaLibraryUrl(a.id),
      placements: placements(a.publisher_platforms),
      // The Ad Library API returns no media URL (only ad_snapshot_url, which embeds the token): link out instead.
      media: [],
      first_seen: a.ad_delivery_start_time.slice(0, 10),
      // Still delivering → observed running today; otherwise the reported stop date.
      last_seen: ended ? stop : today,
      source_kind: "measured",
      observed_at: observedAt,
      hue: hashString(a.id) % 360,
    },
  };
}

/** Graph API error codes that mean "throttled" (application, user, page and custom limits). */
export const META_THROTTLE_CODES = new Set([4, 17, 32, 613, 80000, 80004]);

/** Highest percentage in Meta's X-App-Usage / X-Business-Use-Case-Usage headers (null when absent). */
export function metaUsagePct(headers: Headers): number | null {
  let max: number | null = null;
  for (const name of ["x-app-usage", "x-business-use-case-usage"]) {
    const raw = headers.get(name);
    if (!raw) continue;
    try {
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object")
          for (const [k, x] of Object.entries(v)) {
            if (typeof x === "number" && /call_count|total_time|total_cputime/.test(k)) max = Math.max(max ?? 0, x);
            else walk(x);
          }
      };
      walk(JSON.parse(raw));
    } catch {
      // Malformed header: ignored.
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// TikTok Commercial Content API (/v2/research/adlib/ad/query/)
// ---------------------------------------------------------------------------

export const TIKTOK_FIELDS = ["ad.id", "ad.first_shown_date", "ad.last_shown_date", "ad.videos", "ad.image_urls", "advertiser.business_name"];

const tiktokAdSchema = z.object({
  ad: z.object({
    id: z.union([z.string().min(1), z.number()]).transform(String),
    first_shown_date: z.union([z.string(), z.number()]),
    last_shown_date: z.union([z.string(), z.number()]),
    videos: z.array(z.unknown()).nullish(),
    image_urls: z.array(z.unknown()).nullish(),
  }),
  advertiser: z.object({ business_name: z.string().min(1) }),
});

/**
 * Media the Commercial Content API returns for display: `ad.videos[]` ({ url, cover_image_url },
 * or a bare URL string) and `ad.image_urls[]`. The URLs are provider-signed and may expire; they are
 * stored as returned (HTTPS only) and refreshed at each sync, never downloaded or re-hosted.
 */
export function tiktokMedia(videos: unknown[] | null | undefined, images: unknown[] | null | undefined): AdMedia[] {
  const vids = (videos ?? []).map((v) =>
    typeof v === "string" ? { type: "video" as const, url: v } : v && typeof v === "object" ? { type: "video" as const, url: (v as Record<string, unknown>).url, posterUrl: (v as Record<string, unknown>).cover_image_url } : { type: "video" as const, url: null },
  );
  const imgs = (images ?? []).map((u) => ({ type: "image" as const, url: u }));
  return adMedia([...vids, ...imgs], "tiktok_commercial_content");
}

/** TikTok ids are int64: quote long integers before JSON.parse so they are not rounded. */
export function parseJsonKeepingIds(text: string): unknown {
  return JSON.parse(text.replace(/("(?:id|business_id)"\s*:\s*)(\d{16,})/g, '$1"$2"'));
}

/**
 * The query endpoint returns no ad text, language, CTA or landing page, so
 * those stay empty/unknown. Format is read from the media the API lists. With
 * no text to match, the product link comes only from the search term.
 */
export function tiktokAdRecord(raw: unknown, country: Country, today: string, observedAt: string, products: MatchableProduct[], search?: SearchTerm | null): AdRecord | null {
  const p = tiktokAdSchema.safeParse(raw);
  if (!p.success) return null;
  const { ad, advertiser } = p.data;
  const firstSeen = ymd(ad.first_shown_date);
  const lastSeen = ymd(ad.last_shown_date);
  if (!firstSeen || !lastSeen) return null;
  const images = ad.image_urls?.length ?? 0;
  const format: CreativeFormat = ad.videos?.length ? "video" : images > 1 ? "carousel" : images === 1 ? "image" : "unknown";
  return {
    // The library is refreshed with about a day of delay.
    active: lastSeen >= addDays(today, -1),
    row: {
      id: `tiktok-${ad.id}`,
      connector: "tiktok_commercial_content",
      external_id: ad.id,
      ...inferLinks("", products, search),
      advertiser: advertiser.business_name.slice(0, 300),
      platform: "tiktok",
      country,
      language: null,
      format,
      headline: "",
      copy: "",
      cta: "unknown",
      landing_domain: null,
      landing_url: null,
      snapshot_url: tiktokLibraryUrl(ad.id),
      placements: [],
      media: tiktokMedia(ad.videos, ad.image_urls),
      first_seen: firstSeen,
      last_seen: lastSeen,
      source_kind: "measured",
      observed_at: observedAt,
      hue: hashString(ad.id) % 360,
    },
  };
}

// ---------------------------------------------------------------------------
// Licensed provider feed
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().max(max).nullish();
const licensedAdSchema = z.object({
  id: z.string().min(1).max(200),
  external_id: z.string().min(1).max(200).nullish(),
  product_id: z.string().max(200).nullish(),
  advertiser: z.string().min(1).max(300),
  platform: z.enum(PLATFORMS),
  country: z.enum(COUNTRIES),
  language: z.string().regex(/^[a-z]{2,3}$/i).nullish(),
  format: z.string().nullish(),
  headline: text(500),
  copy: text(5000),
  cta: z.string().nullish(),
  landing_domain: z.string().max(253).regex(/^[a-z0-9.-]+$/i).nullish(),
  landing_url: z.string().nullish(),
  snapshot_url: z.string().nullish(),
  placements: z.array(z.string()).nullish(),
  /** Media the provider licenses for display (HTTPS only). */
  media: z
    .array(z.object({ type: z.enum(["video", "image"]), url: z.string(), poster_url: z.string().nullish() }))
    .max(50)
    .nullish(),
  category: z.string().nullish(),
  first_seen: z.string().regex(DAY),
  last_seen: z.string().regex(DAY),
  observed_at: z.string().nullish(),
});

const oneOf = <T extends string>(values: readonly T[], v: unknown): T | null => (typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : null);

/**
 * Feed rows are validated; values outside our enums become unknown rather
 * than being coerced. A provider product_id is kept only when it references a
 * known product; otherwise the text matcher may supply an estimate.
 */
export function licensedAdRecord(raw: unknown, today: string, observedAt: string, products: MatchableProduct[]): AdRecord | null {
  const p = licensedAdSchema.safeParse(raw);
  if (!p.success) return null;
  const a = p.data;
  const headline = a.headline ?? "";
  const copy = a.copy ?? "";
  const inferred = inferLinks(`${headline} ${copy}`, products);
  const sourceProduct = a.product_id ? products.find((x) => x.id === a.product_id) : undefined;
  const sourceCategory = oneOf(CATEGORIES, a.category);
  const lastSeen = a.last_seen.slice(0, 10);
  return {
    active: lastSeen >= addDays(today, -1),
    row: {
      id: a.id,
      connector: "licensed_dataset",
      external_id: a.external_id ?? a.id,
      product_id: sourceProduct?.id ?? inferred.product_id,
      product_match_basis: sourceProduct ? "source" : inferred.product_match_basis,
      advertiser: a.advertiser,
      platform: a.platform,
      country: a.country,
      language: a.language?.toLowerCase() ?? null,
      format: oneOf(CREATIVE_FORMATS, a.format) ?? "unknown",
      headline,
      copy,
      cta: oneOf(CALLS_TO_ACTION, a.cta) ?? "unknown",
      landing_domain: a.landing_domain?.toLowerCase().replace(/^www\./, "") ?? null,
      landing_url: safeHttpsUrl(a.landing_url),
      snapshot_url: safeHttpsUrl(a.snapshot_url),
      placements: placements(a.placements),
      media: adMedia((a.media ?? []).map((m) => ({ type: m.type, url: m.url, posterUrl: m.poster_url })), "licensed_dataset"),
      category: sourceCategory ?? sourceProduct?.category ?? inferred.category,
      category_basis: sourceCategory ? "source" : sourceProduct ? "product" : inferred.category_basis,
      first_seen: a.first_seen.slice(0, 10),
      last_seen: lastSeen,
      source_kind: "estimate",
      observed_at: a.observed_at && !Number.isNaN(Date.parse(a.observed_at)) ? a.observed_at : observedAt,
      hue: hashString(a.id) % 360,
    },
  };
}

const licensedProductSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(300),
  category: z.enum(CATEGORIES),
  first_detected: z.string().regex(DAY),
  last_detected: z.string().regex(DAY),
});

/** Columns a licensed product row may set; anything else in the payload is ignored. */
const PRODUCT_COLS = ["description", "product_type", "tags", "price_estimate", "supplier_cost_estimate", "currency", "channels", "countries", "shipping", "differentiation", "source_url"];

/** Whitelisted, validated products row from the licensed feed; null when required fields are missing or invalid. */
export function licensedProductRow(raw: unknown, observedAt: string): Record<string, unknown> | null {
  const p = licensedProductSchema.safeParse(raw);
  if (!p.success) return null;
  const r = raw as Record<string, unknown>;
  return {
    ...Object.fromEntries(PRODUCT_COLS.filter((c) => r[c] !== undefined).map((c) => [c, r[c]])),
    ...p.data,
    image_url: safeHttpsUrl(r.image_url),
    source_connector: "licensed_dataset",
    source_kind: "estimate",
    observed_at: typeof r.observed_at === "string" && !Number.isNaN(Date.parse(r.observed_at)) ? r.observed_at : observedAt,
    is_demo: false,
  };
}

// ---------------------------------------------------------------------------
// Sync planning helpers
// ---------------------------------------------------------------------------

/**
 * Search terms with the tracked product each one names. Context terms are
 * kept only when their product is a real (non-demo) tracked product; plain
 * keywords are paired with the product of exactly that name, if any.
 */
export function searchTermsFor(ctx: { keywords: string[]; searchTerms?: SearchTerm[] }, products: MatchableProduct[]): SearchTerm[] {
  const ids = new Set(products.map((p) => p.id));
  const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const list = ctx.searchTerms ?? ctx.keywords.map((term) => ({ term, productId: null }));
  const seen = new Set<string>();
  const out: SearchTerm[] = [];
  for (const s of list) {
    const term = s.term.trim().replace(/\s+/g, " ").slice(0, 100);
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push({ term, productId: s.productId && ids.has(s.productId) ? s.productId : (byName.get(key) ?? null) });
  }
  return out;
}

/** Valid query countries from the context, deduplicated (FR when none). */
/**
 * Keywords the ad connectors search for: the TRACKED_KEYWORDS list (comma, semicolon or new line separated)
 * first, then the product names already in the database; case-insensitive duplicates dropped, at most `max`.
 */
export function connectorKeywords(tracked: string | undefined, productNames: string[], max = 50): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...(tracked ?? "").split(/[,;\n]/), ...productNames]) {
    const term = raw.trim().replace(/\s+/g, " ").slice(0, 100);
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
  }
  return out.slice(0, max);
}

export function queryCountries(countries: string[]): Country[] {
  const list = Array.from(new Set(countries.map((c) => c.toUpperCase()))).filter((c): c is Country => (COUNTRIES as readonly string[]).includes(c));
  return list.length ? list : ["FR"];
}

/**
 * Starts the list at a different item each day, so a run cut short by its
 * time or request budget does not always drop the same tail.
 */
export function rotateDaily<T>(list: T[], today: string): T[] {
  if (list.length < 2) return list;
  const start = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000) % list.length;
  return [...list.slice(start), ...list.slice(0, start)];
}
