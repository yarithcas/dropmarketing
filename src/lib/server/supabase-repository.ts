import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DemoDataset } from "../demo/generate";
import type { AdQuery, ProductQuery } from "../queries";
import { normalizeDomain } from "../queries";
import { addDays } from "../dates";
import type { AdMedia, Advertisement, OpportunityScore, ProductMetrics, Product, ProductObservation, ProductWithMetrics, SourceRef, Store, StoreProduct, StoreSnapshot } from "../types";
import type { Page } from "./repository";

/**
 * Live data access (Supabase/Postgres). Large listings (products, ads) are
 * filtered, sorted and paginated in the database using the indexes defined in
 * the migration. Smaller derived views (trends, overview, reports) use a
 * cached snapshot loaded by `loadLiveDataset`.
 */

type Row = Record<string, unknown>;
const num = (v: unknown) => (v == null ? null : Number(v));

export function rowToProduct(r: Row): Product {
  return {
    id: r.id as string,
    name: r.name as string,
    category: r.category as Product["category"],
    description: (r.description as string) ?? "",
    productType: r.product_type as Product["productType"],
    tags: (r.tags as string[]) ?? [],
    priceEstimate: num(r.price_estimate),
    supplierCostEstimate: num(r.supplier_cost_estimate),
    currency: r.currency as Product["currency"],
    channels: (r.channels as Product["channels"]) ?? [],
    countries: (r.countries as Product["countries"]) ?? [],
    shipping: (r.shipping as Product["shipping"]) ?? { verified: false },
    differentiation: num(r.differentiation),
    firstDetected: r.first_detected as string,
    lastDetected: r.last_detected as string,
    source: { connector: r.source_connector as string, kind: r.is_demo ? "demo" : (r.source_kind as Product["source"]["kind"]), observedAt: r.observed_at as string, url: (r.source_url as string) ?? undefined },
    hue: Number(r.hue ?? 0),
    imageUrl: (r.image_url as string) ?? null,
  };
}

function rowToMetrics(m: Row): { metrics: ProductMetrics; score: OpportunityScore } {
  return {
    metrics: {
      adsObserved: Number(m.ads_observed),
      adsActive: Number(m.ads_active),
      advertisersObserved: Number(m.advertisers_observed),
      storesObserved: Number(m.stores_observed),
      trendGrowth: num(m.trend_growth_30d),
      competition: m.competition as ProductMetrics["competition"],
      saturation: Number(m.saturation),
      grossMargin: num(m.gross_margin),
      observationCount: Number(m.observation_count),
    },
    score: m.score_detail as OpportunityScore,
  };
}

const https = (v: unknown) => (typeof v === "string" && v.startsWith("https://") ? v : null);

/** Authorized media from the jsonb column (0007); malformed or non-HTTPS entries are dropped. */
export function rowToMedia(v: unknown): AdMedia[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((m): AdMedia[] => {
    if (!m || typeof m !== "object") return [];
    const e = m as Record<string, unknown>;
    const url = https(e.url);
    if (!url || (e.type !== "video" && e.type !== "image") || e.authorized !== true || /[?&]access_token=/i.test(url)) return [];
    const posterUrl = https(e.posterUrl);
    return [{ type: e.type, url, ...(posterUrl ? { posterUrl } : {}), source: typeof e.source === "string" ? e.source : "", authorized: true }];
  });
}

export function rowToAd(r: Row): Advertisement {
  const productId = (r.product_id as string) ?? null;
  const category = (r.category as Advertisement["category"]) ?? null;
  return {
    id: r.id as string,
    productId,
    // A basis left over after the product was deleted (FK set null) is meaningless.
    productMatchBasis: productId ? ((r.product_match_basis as Advertisement["productMatchBasis"]) ?? null) : null,
    advertiser: r.advertiser as string,
    platform: r.platform as Advertisement["platform"],
    country: r.country as Advertisement["country"],
    language: (r.language as string) ?? null,
    format: ((r.format as Advertisement["format"]) ?? "unknown"),
    headline: (r.headline as string) ?? "",
    copy: (r.copy as string) ?? "",
    cta: ((r.cta as Advertisement["cta"]) ?? "unknown"),
    landingDomain: (r.landing_domain as string) ?? null,
    landingUrl: (r.landing_url as string) ?? null,
    category,
    categoryBasis: category ? ((r.category_basis as Advertisement["categoryBasis"]) ?? null) : null,
    snapshotUrl: https(r.snapshot_url),
    placements: (r.placements as string[]) ?? [],
    media: rowToMedia(r.media),
    firstSeen: r.first_seen as string,
    lastSeen: r.last_seen as string,
    source: { connector: r.connector as string, kind: r.is_demo ? "demo" : (r.source_kind as Advertisement["source"]["kind"]), observedAt: r.observed_at as string },
    hue: Number(r.hue ?? 0),
  };
}

function rowToStore(r: Row): Store {
  return {
    id: r.id as string,
    name: r.name as string,
    domain: r.domain as string,
    description: (r.description as string) ?? "",
    categories: (r.categories as Store["categories"]) ?? [],
    currency: (r.currency as string) ?? null,
    productCount: num(r.product_count),
    socials: (r.socials as Store["socials"]) ?? [],
    technology: (r.technology as Store["technology"]) ?? { platform: "unknown", verified: false },
    country: (r.country as Store["country"]) ?? null,
    firstSeen: r.first_seen as string,
    source: { connector: r.source_connector as string, kind: r.is_demo ? "demo" : (r.source_kind as Store["source"]["kind"]), observedAt: r.observed_at as string },
    hue: Number(r.hue ?? 0),
  };
}

export function rowToStoreProduct(r: Row): StoreProduct {
  return {
    storeId: r.store_id as string,
    productId: (r.product_id as string) ?? null,
    title: r.title as string,
    price: Number(r.price),
    currency: (r.currency as string) ?? null,
    firstSeen: r.first_seen as string,
    ...(r.source_connector
      ? { source: { connector: r.source_connector as string, kind: (r.source_kind as SourceRef["kind"]) ?? "measured", observedAt: (r.observed_at as string) ?? `${r.last_seen as string}T00:00:00Z` } }
      : {}),
  };
}

/*
 * Search filters. User input never reaches PostgREST filter syntax unquoted:
 * - likeLiteral escapes the LIKE metacharacters (% _ and the escape character \),
 * - pgrstQuote double-quotes a value inside a logic tree such as or=(...), where
 *   PostgREST honours reserved characters (, . : ( ) { }) only outside quotes and
 *   unescapes \x to x inside them (so \ and " are escaped).
 * Without quoting, q = "x,id.neq.zz" would add an OR condition matching every
 * row, and ")" or "}" would make PostgREST reject the request.
 */
export const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
export const pgrstQuote = (v: string) => `"${v.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
const clean = (q: string) => q.replace(/[\u0000-\u001f\u007f]/g, " ");

/** or() filter: `q` as a literal substring (ILIKE) of any of the columns. */
export function ilikeAny(columns: string[], q: string): string {
  const pattern = pgrstQuote(`%${likeLiteral(clean(q))}%`);
  return columns.map((c) => `${c}.ilike.${pattern}`).join(",");
}

/** or() condition: array column contains `value` as one element ({"value"} array literal, quoted for PostgREST). */
export function arrayContains(column: string, value: string): string {
  return `${column}.cs.${pgrstQuote(`{${pgrstQuote(clean(value))}}`)}`;
}

export async function listProductsDb(db: SupabaseClient, q: ProductQuery): Promise<Page<ProductWithMetrics>> {
  let query = db.from("products").select("*, product_metrics!inner(*)", { count: "exact" });
  if (q.q) query = query.or(`${ilikeAny(["name", "description"], q.q)},${arrayContains("tags", q.q.toLowerCase())}`);
  if (q.category.length) query = query.in("category", q.category);
  if (q.country.length) query = query.overlaps("countries", q.country);
  if (q.platform.length) query = query.overlaps("channels", q.platform);
  if (q.productType.length) query = query.in("product_type", q.productType);
  if (q.priceMin != null) query = query.gte("price_estimate", q.priceMin);
  if (q.priceMax != null) query = query.lte("price_estimate", q.priceMax);
  if (q.firstFrom) query = query.gte("first_detected", q.firstFrom);
  if (q.firstTo) query = query.lte("first_detected", q.firstTo);
  // Typed generated columns (see migration) so comparisons are numeric, not textual.
  if (q.shippingVerified != null) query = query.eq("shipping_verified", q.shippingVerified);
  if (q.warehouse.length) query = query.in("shipping_warehouse", q.warehouse);
  if (q.maxDeliveryDays != null) query = query.lte("delivery_days_max", q.maxDeliveryDays);
  if (q.competition.length) query = query.in("product_metrics.competition", q.competition);
  if (q.marginMin != null) query = query.gte("product_metrics.gross_margin", q.marginMin / 100);
  if (q.growthMin != null) query = query.gte("product_metrics.trend_growth_30d", q.growthMin);
  const order: Record<ProductQuery["sort"], [string, { ascending: boolean; nullsFirst?: boolean; referencedTable?: string }]> = {
    score: ["score", { ascending: false, nullsFirst: false, referencedTable: "product_metrics" }],
    newest: ["first_detected", { ascending: false }],
    growth: ["trend_growth_30d", { ascending: false, nullsFirst: false, referencedTable: "product_metrics" }],
    margin: ["gross_margin", { ascending: false, nullsFirst: false, referencedTable: "product_metrics" }],
    competition: ["saturation", { ascending: true, referencedTable: "product_metrics" }],
  };
  const [col, opts] = order[q.sort];
  // Ordering by an embedded column uses PostgREST's "table(column)" syntax.
  query = opts.referencedTable ? query.order(`${opts.referencedTable}(${col})`, { ascending: opts.ascending, nullsFirst: opts.nullsFirst }) : query.order(col, opts);
  const from = (q.page - 1) * q.pageSize;
  const { data, count, error } = await query.range(from, from + q.pageSize - 1);
  if (error) throw error;
  const items = (data ?? []).map((r: Row) => {
    const m = Array.isArray(r.product_metrics) ? (r.product_metrics[0] as Row) : (r.product_metrics as Row);
    return { ...rowToProduct(r), ...rowToMetrics(m) };
  });
  return { items, total: count ?? items.length, page: q.page, pageSize: q.pageSize };
}

export async function listAdsDb(db: SupabaseClient, q: AdQuery, asOf: string): Promise<Page<Advertisement & { productName: string | null }>> {
  let query = db.from("advertisements").select("*, products(name)", { count: "exact" });
  if (q.q) query = query.or(ilikeAny(["copy", "headline", "advertiser"], q.q));
  // Single-column filters are not parsed as a logic tree: only the LIKE metacharacters need escaping.
  if (q.advertiser) query = query.ilike("advertiser", `%${likeLiteral(q.advertiser)}%`);
  if (q.domain) query = query.ilike("landing_domain", `%${likeLiteral(normalizeDomain(q.domain))}%`);
  if (q.productId) query = query.eq("product_id", q.productId);
  if (q.platform.length) query = query.in("platform", q.platform);
  if (q.country.length) query = query.in("country", q.country);
  if (q.language.length) query = query.in("language", q.language);
  if (q.format.length) query = query.in("format", q.format);
  if (q.category.length) query = query.in("category", q.category);
  if (q.cta.length) query = query.in("cta", q.cta);
  if (q.firstFrom) query = query.gte("first_seen", q.firstFrom);
  if (q.firstTo) query = query.lte("first_seen", q.firstTo);
  if (q.lastFrom) query = query.gte("last_seen", q.lastFrom);
  if (q.lastTo) query = query.lte("last_seen", q.lastTo);
  if (q.activeOnly) query = query.gte("last_seen", addDays(asOf, -2));
  // "longest" needs a computed duration; approximate with earliest first_seen among recently active ads.
  query = q.sort === "recent" ? query.order("last_seen", { ascending: false }) : q.sort === "longest" ? query.order("first_seen", { ascending: true }) : query.order("first_seen", { ascending: false });
  const from = (q.page - 1) * q.pageSize;
  const { data, count, error } = await query.range(from, from + q.pageSize - 1);
  if (error) throw error;
  return {
    items: (data ?? []).map((r: Row) => ({ ...rowToAd(r), productName: ((r.products as Row | null)?.name as string) ?? null })),
    total: count ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}

async function all<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, cap = 50_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Loads a working snapshot of research data for derived views. Cached by the caller. */
export async function loadLiveDataset(db: SupabaseClient): Promise<DemoDataset> {
  const today = new Date().toISOString().slice(0, 10);
  const since = addDays(today, -180);
  const [products, obs, ads, stores, sps, snaps] = await Promise.all([
    all<Row>((a, b) => db.from("products").select("*").range(a, b)),
    all<Row>((a, b) => db.from("product_observations").select("*").gte("date", since).order("date").range(a, b), 500_000),
    all<Row>((a, b) => db.from("advertisements").select("*").gte("last_seen", addDays(today, -365)).range(a, b), 200_000),
    all<Row>((a, b) => db.from("stores").select("*").range(a, b)),
    all<Row>((a, b) => db.from("store_products").select("*").range(a, b), 200_000),
    all<Row>((a, b) => db.from("store_snapshots").select("*").order("date").range(a, b)),
  ]);
  const observations: Record<string, ProductObservation[]> = {};
  for (const o of obs) {
    (observations[o.product_id as string] ??= []).push({
      productId: o.product_id as string,
      date: o.date as string,
      adsActive: Number(o.ads_active),
      newAdvertisers: Number(o.new_advertisers),
      storesObserved: Number(o.stores_observed),
      searchInterest: num(o.search_interest),
      source: { connector: o.source_connector as string, kind: o.source_kind as ProductObservation["source"]["kind"], observedAt: o.observed_at as string },
    });
  }
  const storeSnapshots: Record<string, StoreSnapshot[]> = {};
  for (const s of snaps)
    (storeSnapshots[s.store_id as string] ??= []).push({
      date: s.date as string,
      productCount: Number(s.product_count),
      minPrice: num(s.min_price),
      maxPrice: num(s.max_price),
      source: { connector: s.connector as string, kind: "measured", observedAt: s.observed_at as string },
    });
  const productRows = products.map(rowToProduct);
  const latest = [...productRows.map((p) => p.lastDetected)].sort().at(-1);
  const allDemo = products.length > 0 && products.every((p) => p.is_demo);
  return {
    // Demo rows seeded into the database keep their fixed snapshot date.
    snapshot: allDemo && latest ? latest : today,
    products: productRows,
    ads: ads.map(rowToAd),
    stores: stores.map(rowToStore),
    storeProducts: sps.map(rowToStoreProduct),
    storeSnapshots,
    observations,
  };
}
