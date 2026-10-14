import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DemoDataset } from "../demo/generate";
import type { AdQuery, ProductQuery } from "../queries";
import { normalizeDomain } from "../queries";
import { addDays } from "../dates";
import type { Advertisement, OpportunityScore, ProductMetrics, Product, ProductObservation, ProductWithMetrics, Store, StoreProduct, StoreSnapshot } from "../types";
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

export function rowToAd(r: Row): Advertisement {
  return {
    id: r.id as string,
    productId: (r.product_id as string) ?? null,
    advertiser: r.advertiser as string,
    platform: r.platform as Advertisement["platform"],
    country: r.country as Advertisement["country"],
    language: r.language as Advertisement["language"],
    format: r.format as Advertisement["format"],
    headline: (r.headline as string) ?? "",
    copy: (r.copy as string) ?? "",
    cta: r.cta as Advertisement["cta"],
    landingDomain: (r.landing_domain as string) ?? null,
    landingUrl: (r.landing_url as string) ?? null,
    category: r.category as Advertisement["category"],
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
    currency: r.currency as string,
    productCount: num(r.product_count),
    socials: (r.socials as Store["socials"]) ?? [],
    technology: (r.technology as Store["technology"]) ?? { platform: "unknown", verified: false },
    country: r.country as Store["country"],
    firstSeen: r.first_seen as string,
    source: { connector: r.source_connector as string, kind: r.is_demo ? "demo" : (r.source_kind as Store["source"]["kind"]), observedAt: r.observed_at as string },
    hue: Number(r.hue ?? 0),
  };
}

const escapeLike = (s: string) => s.replace(/[%_\\,()]/g, (c) => `\\${c}`);

export async function listProductsDb(db: SupabaseClient, q: ProductQuery): Promise<Page<ProductWithMetrics>> {
  let query = db.from("products").select("*, product_metrics!inner(*)", { count: "exact" });
  if (q.q) query = query.or(`name.ilike.%${escapeLike(q.q)}%,description.ilike.%${escapeLike(q.q)}%,tags.cs.{${escapeLike(q.q.toLowerCase())}}`);
  if (q.category.length) query = query.in("category", q.category);
  if (q.country.length) query = query.overlaps("countries", q.country);
  if (q.platform.length) query = query.overlaps("channels", q.platform);
  if (q.productType.length) query = query.in("product_type", q.productType);
  if (q.priceMin != null) query = query.gte("price_estimate", q.priceMin);
  if (q.priceMax != null) query = query.lte("price_estimate", q.priceMax);
  if (q.firstFrom) query = query.gte("first_detected", q.firstFrom);
  if (q.firstTo) query = query.lte("first_detected", q.firstTo);
  if (q.shippingVerified != null) query = query.eq("shipping->>verified", String(q.shippingVerified));
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
  if (q.q) query = query.or(`copy.ilike.%${escapeLike(q.q)}%,headline.ilike.%${escapeLike(q.q)}%,advertiser.ilike.%${escapeLike(q.q)}%`);
  if (q.advertiser) query = query.ilike("advertiser", `%${escapeLike(q.advertiser)}%`);
  if (q.domain) query = query.ilike("landing_domain", `%${escapeLike(normalizeDomain(q.domain))}%`);
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
      minPrice: Number(s.min_price ?? 0),
      maxPrice: Number(s.max_price ?? 0),
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
    storeProducts: sps.map(
      (r): StoreProduct => ({ storeId: r.store_id as string, productId: (r.product_id as string) ?? null, title: r.title as string, price: Number(r.price), currency: r.currency as string, firstSeen: r.first_seen as string }),
    ),
    storeSnapshots,
    observations,
  };
}
