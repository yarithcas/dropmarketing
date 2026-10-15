import "server-only";
import { getDemoDataset, type DemoDataset } from "../demo/generate";
import type { AdQuery, ProductQuery, StoreQuery } from "../queries";
import { normalizeDomain } from "../queries";
import { computeMetrics, scoreProduct, trendGrowth, type TrendValue } from "../scoring";
import type {
  Advertisement,
  Category,
  Country,
  ProductObservation,
  ProductWithMetrics,
  Store,
  StoreProduct,
  StoreSnapshot,
  TimeRange,
} from "../types";
import { CATEGORIES, COUNTRIES } from "../types";
import { RANGE_DAYS, addDays, daysBetween } from "../dates";
import { features } from "./env";
import { supabaseAdmin } from "./supabase";
import { loadLiveDataset } from "./supabase-repository";
import frLocale from "@/locales/fr.json";
import enLocale from "@/locales/en.json";
import esLocale from "@/locales/es.json";
import deLocale from "@/locales/de.json";
import itLocale from "@/locales/it.json";
import { connectorStatus } from "../connectors/registry";
import {
  coverageStart,
  discoverySeries,
  evidenceGrowth,
  historyCovers,
  nicheEmergence,
  productSources,
  sampleOf,
  searchInterestTrend,
  signalCoverage,
  sourceCollector,
  windows,
  type DiscoverySeries,
  type EntrySources,
  type Growth,
  type NicheEmergence,
  type Sample,
  type SearchTrend,
  type SignalCoverage,
} from "../trends";

/** Accent- and case-insensitive text folding for search. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Category key plus its name in every supported language, folded — so "cuisine" or "beauté" find kitchen/beauty. */
const CATEGORY_TERMS: Record<Category, string[]> = Object.fromEntries(
  CATEGORIES.map((c) => [c, [c, ...[frLocale, enLocale, esLocale, deLocale, itLocale].map((l) => fold((l.categories as Record<string, string>)[c]))]]),
) as Record<Category, string[]>;

function categoryMatches(c: Category, needle: string) {
  const n = fold(needle);
  return CATEGORY_TERMS[c].some((term) => term.includes(n));
}

/**
 * Research data access. In demo mode everything is served from the
 * deterministic in-memory demo dataset. In production the same interface is
 * served by the Supabase repository (see ./supabase-repository.ts) fed by the
 * ingestion connectors.
 */

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DataMeta {
  mode: "demo" | "live";
  asOf: string;
  sources: string[];
}

export interface ProductDetail {
  product: ProductWithMetrics;
  observations: ProductObservation[];
  ads: Advertisement[];
  stores: (Store & { listing: StoreProduct })[];
  similar: ProductWithMetrics[];
  trends: Record<TimeRange, TrendValue>;
}

export interface StoreDetail {
  store: Store;
  listings: StoreProduct[];
  snapshots: StoreSnapshot[];
  ads: Advertisement[];
  products: ProductWithMetrics[];
}

export interface TrendReport {
  range: TimeRange;
  asOf: string;
  /** First day of the observed history; growth needs the previous window inside it. */
  coverageStart: string | null;
  trending: (ProductWithMetrics & { trend: TrendValue })[];
  declining: (ProductWithMetrics & { trend: TrendValue })[];
  /** Products first detected inside the selected window. */
  emerging: ProductWithMetrics[];
  /** Growth is null (with its status) unless the previous window is observed and holds the MIN_AGGREGATE sample. */
  categories: ({ category: Category; adsActive: number; products: number; newAdvertisers: number; sample: WindowSamples } & Growth)[];
  countries: ({ country: Country; adsInRange: number; previous: number; sample: WindowSamples } & Growth)[];
  series: { date: string; [category: string]: number | string }[];
  insufficient: number;
}

type WindowSamples = { current: Sample; previous: Sample };
type Sourced<T> = T & { sources: EntrySources };

/** Trends page payload: the report plus per-entry sources, search interest, niches and discovery frequency. */
export interface TrendInsights extends Omit<TrendReport, "trending" | "declining" | "emerging" | "categories" | "countries"> {
  trending: Sourced<TrendReport["trending"][number] & { search: SearchTrend | null }>[];
  declining: Sourced<TrendReport["declining"][number] & { search: SearchTrend | null }>[];
  emerging: Sourced<ProductWithMetrics>[];
  categories: Sourced<TrendReport["categories"][number]>[];
  countries: Sourced<TrendReport["countries"][number]>[];
  niches: NicheEmergence[];
  /** Niches with new entrants whose evidence is below the minimum. */
  nichesInsufficient: number;
  discovery: DiscoverySeries;
  /** Products in the selection that carry search-interest values, and the connectors behind them. */
  searchInterest: { products: number; connectors: string[] };
  signals: SignalCoverage[];
}

let productCache: { ds: DemoDataset; products: ProductWithMetrics[] } | null = null;
let live: { ds: DemoDataset; loadedAt: number; mode: DataMeta["mode"]; sources: string[] } | null = null;
let loading: Promise<void> | null = null;
const LIVE_TTL_MS = 60_000;

function ds(): DemoDataset {
  return live?.ds ?? getDemoDataset();
}

/**
 * Ensures the working dataset is loaded. Without Supabase this is the demo
 * dataset. With Supabase it is the database snapshot (refreshed every minute);
 * if the database has no research rows yet, the app shows empty states rather
 * than demo data, so nothing synthetic is ever presented as live.
 */
export async function ensureDataset(): Promise<void> {
  if (!features().supabaseAdmin) return;
  if (live && Date.now() - live.loadedAt < LIVE_TTL_MS) return;
  loading ??= (async () => {
    try {
      const db = supabaseAdmin()!;
      const d = await loadLiveDataset(db);
      const sources = Array.from(new Set(d.products.map((p) => p.source.connector).concat(d.ads.map((a) => a.source.connector))));
      const allDemo = d.products.length > 0 && d.products.every((p) => p.source.kind === "demo");
      live = { ds: d, loadedAt: Date.now(), mode: allDemo ? "demo" : "live", sources: sources.length ? sources : ["none"] };
    } finally {
      loading = null;
    }
  })();
  await loading;
}

export function isLiveDb(): boolean {
  return live != null;
}

export function meta(): DataMeta {
  if (live) return { mode: live.mode, asOf: live.ds.snapshot, sources: live.sources };
  return { mode: "demo", asOf: ds().snapshot, sources: ["demo"] };
}

export function allProducts(): ProductWithMetrics[] {
  const d = ds();
  if (productCache?.ds === d) return productCache.products;
  const products = d.products.map((p) => {
    const obs = d.observations[p.id] ?? [];
    const metrics = computeMetrics(p, obs, d.ads, d.storeProducts, d.snapshot);
    return { ...p, metrics, score: scoreProduct(p, metrics, obs, d.snapshot) };
  });
  productCache = { ds: d, products };
  return products;
}

function matchesText(hay: (string | null | undefined)[], q?: string) {
  if (!q) return true;
  const needle = fold(q);
  return hay.some((h) => h != null && fold(h).includes(needle));
}

function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

const nullsLast = (v: number | null | undefined, dir: 1 | -1) => (v == null ? Number.POSITIVE_INFINITY : dir * v);

export function listProducts(q: ProductQuery): Page<ProductWithMetrics> {
  let items = allProducts().filter((p) => {
    const m = p.metrics;
    if (q.q && !matchesText([p.name, p.description, ...p.tags], q.q) && !categoryMatches(p.category, q.q)) return false;
    if (q.category.length && !q.category.includes(p.category)) return false;
    if (q.country.length && !p.countries.some((c) => q.country.includes(c))) return false;
    if (q.platform.length && !p.channels.some((c) => q.platform.includes(c))) return false;
    if (q.competition.length && !q.competition.includes(m.competition)) return false;
    if (q.productType.length && !q.productType.includes(p.productType)) return false;
    if (q.priceMin != null && (p.priceEstimate == null || p.priceEstimate < q.priceMin)) return false;
    if (q.priceMax != null && (p.priceEstimate == null || p.priceEstimate > q.priceMax)) return false;
    if (q.marginMin != null && (m.grossMargin == null || m.grossMargin * 100 < q.marginMin)) return false;
    if (q.growthMin != null && (m.trendGrowth == null || m.trendGrowth < q.growthMin)) return false;
    if (q.firstFrom && p.firstDetected < q.firstFrom) return false;
    if (q.firstTo && p.firstDetected > q.firstTo) return false;
    if (q.shippingVerified != null && p.shipping.verified !== q.shippingVerified) return false;
    // Sourcing characteristics only count when verified.
    if (q.warehouse.length && !(p.shipping.verified && p.shipping.warehouse && q.warehouse.includes(p.shipping.warehouse))) return false;
    if (q.maxDeliveryDays != null && !(p.shipping.verified && p.shipping.deliveryDays && p.shipping.deliveryDays[1] <= q.maxDeliveryDays)) return false;
    return true;
  });
  const sorters: Record<ProductQuery["sort"], (a: ProductWithMetrics, b: ProductWithMetrics) => number> = {
    score: (a, b) => nullsLast(a.score.overall, -1) - nullsLast(b.score.overall, -1),
    newest: (a, b) => b.firstDetected.localeCompare(a.firstDetected),
    growth: (a, b) => nullsLast(a.metrics.trendGrowth, -1) - nullsLast(b.metrics.trendGrowth, -1),
    margin: (a, b) => nullsLast(a.metrics.grossMargin, -1) - nullsLast(b.metrics.grossMargin, -1),
    competition: (a, b) => a.metrics.saturation - b.metrics.saturation,
  };
  items = [...items].sort((a, b) => sorters[q.sort](a, b) || a.name.localeCompare(b.name));
  return paginate(items, q.page, q.pageSize);
}

export function getProduct(id: string): ProductDetail | null {
  const d = ds();
  const product = allProducts().find((p) => p.id === id);
  if (!product) return null;
  const obs = d.observations[id] ?? [];
  const listings = d.storeProducts.filter((sp) => sp.productId === id);
  const stores = listings
    .map((listing) => ({ ...d.stores.find((s) => s.id === listing.storeId)!, listing }))
    .sort((a, b) => a.listing.price - b.listing.price);
  const similar = allProducts()
    .filter((p) => p.id !== id && (p.category === product.category || p.tags.some((t) => product.tags.includes(t))))
    .sort((a, b) => nullsLast(a.score.overall, -1) - nullsLast(b.score.overall, -1))
    .slice(0, 4);
  const trends = Object.fromEntries((["24h", "7d", "30d", "90d"] as TimeRange[]).map((r) => [r, trendGrowth(obs, r, d.snapshot)])) as Record<
    TimeRange,
    TrendValue
  >;
  return {
    product,
    observations: obs,
    ads: d.ads.filter((a) => a.productId === id).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)),
    stores,
    similar,
    trends,
  };
}

export function listAds(q: AdQuery): Page<Advertisement & { productName: string | null }> {
  const d = ds();
  const names = new Map(d.products.map((p) => [p.id, p.name]));
  let items = d.ads.filter((a) => {
    if (!matchesText([a.copy, a.headline, a.advertiser, names.get(a.productId ?? "")], q.q)) return false;
    if (q.advertiser && !a.advertiser.toLowerCase().includes(q.advertiser.toLowerCase())) return false;
    if (q.domain && !(a.landingDomain ?? "").includes(normalizeDomain(q.domain))) return false;
    if (q.productId && a.productId !== q.productId) return false;
    if (q.platform.length && !q.platform.includes(a.platform)) return false;
    if (q.country.length && !q.country.includes(a.country)) return false;
    if (q.language.length && !(a.language && (q.language as readonly string[]).includes(a.language))) return false;
    if (q.format.length && !q.format.includes(a.format)) return false;
    if (q.category.length && !(a.category && q.category.includes(a.category))) return false;
    if (q.cta.length && !q.cta.includes(a.cta)) return false;
    if (q.firstFrom && a.firstSeen < q.firstFrom) return false;
    if (q.firstTo && a.firstSeen > q.firstTo) return false;
    if (q.lastFrom && a.lastSeen < q.lastFrom) return false;
    if (q.lastTo && a.lastSeen > q.lastTo) return false;
    if (q.activeOnly && a.lastSeen < addDays(d.snapshot, -2)) return false;
    return true;
  });
  const sorters: Record<AdQuery["sort"], (a: Advertisement, b: Advertisement) => number> = {
    newest: (a, b) => b.firstSeen.localeCompare(a.firstSeen),
    recent: (a, b) => b.lastSeen.localeCompare(a.lastSeen),
    longest: (a, b) => daysBetween(b.firstSeen, b.lastSeen) - daysBetween(a.firstSeen, a.lastSeen),
  };
  items = [...items].sort((a, b) => sorters[q.sort](a, b) || a.id.localeCompare(b.id));
  const page = paginate(items, q.page, q.pageSize);
  return { ...page, items: page.items.map((a) => ({ ...a, productName: names.get(a.productId ?? "") ?? null })) };
}

export function getAd(id: string) {
  const d = ds();
  const ad = d.ads.find((a) => a.id === id);
  if (!ad) return null;
  const product = ad.productId ? allProducts().find((p) => p.id === ad.productId) ?? null : null;
  const store = d.stores.find((s) => s.domain === ad.landingDomain) ?? null;
  // Ads without a product link are not "related" to each other.
  const related = ad.productId ? d.ads.filter((a) => a.productId === ad.productId && a.id !== ad.id).slice(0, 6) : [];
  return { ad, product, store, related };
}

export function listStores(q: StoreQuery): Page<Store & { adsCount: number; trackedProducts: number }> {
  const d = ds();
  const needle = q.q ? q.q.toLowerCase() : "";
  const asDomain = q.q ? normalizeDomain(q.q) : "";
  const items = d.stores
    .filter((s) => {
      if (needle) {
        const listings = d.storeProducts.filter((sp) => sp.storeId === s.id);
        const hit =
          s.name.toLowerCase().includes(needle) ||
          s.domain.includes(asDomain) ||
          s.categories.some((c) => c.includes(needle)) ||
          listings.some((l) => l.title.toLowerCase().includes(needle));
        if (!hit) return false;
      }
      if (q.category.length && !s.categories.some((c) => q.category.includes(c))) return false;
      if (q.country.length && !(s.country && q.country.includes(s.country))) return false;
      if (q.platform.length && !q.platform.includes(s.technology.platform)) return false;
      return true;
    })
    .map((s) => ({
      ...s,
      adsCount: d.ads.filter((a) => a.landingDomain === s.domain).length,
      trackedProducts: d.storeProducts.filter((sp) => sp.storeId === s.id && sp.productId).length,
    }))
    .sort((a, b) => b.adsCount - a.adsCount || a.name.localeCompare(b.name));
  return paginate(items, q.page, q.pageSize);
}

export function getStore(id: string): StoreDetail | null {
  const d = ds();
  const store = d.stores.find((s) => s.id === id);
  if (!store) return null;
  const listings = d.storeProducts.filter((sp) => sp.storeId === id).sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));
  const ids = new Set(listings.map((l) => l.productId).filter(Boolean));
  return {
    store,
    listings,
    snapshots: d.storeSnapshots[id] ?? [],
    ads: d.ads.filter((a) => a.landingDomain === store.domain).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)),
    products: allProducts().filter((p) => ids.has(p.id)),
  };
}

export function trendReport(range: TimeRange, categories: Category[] = [], countries: Country[] = []): TrendReport {
  const d = ds();
  const asOf = d.snapshot;
  const pool = allProducts().filter(
    (p) => (!categories.length || categories.includes(p.category)) && (!countries.length || p.countries.some((c) => countries.includes(c))),
  );
  const withTrend = pool.map((p) => ({ ...p, trend: trendGrowth(d.observations[p.id] ?? [], range, asOf) }));
  const measured = withTrend.filter((p) => p.trend.pct != null);
  const trending = measured.filter((p) => (p.trend.pct as number) > 0).sort((a, b) => (b.trend.pct as number) - (a.trend.pct as number));
  const declining = measured.filter((p) => (p.trend.pct as number) < 0).sort((a, b) => (a.trend.pct as number) - (b.trend.pct as number));

  const n = RANGE_DAYS[range];
  const w = windows(range, asOf);
  const { curStart, prevStart } = w;
  const prevEnd = addDays(curStart, -1);
  // New products honour the selected window (not a fixed look-back).
  const emerging = pool.filter((p) => p.firstDetected >= curStart && p.firstDetected <= asOf).sort((a, b) => b.firstDetected.localeCompare(a.firstDetected));
  const coverage = coverageStart(d.observations);
  const covered = historyCovers(coverage, w);
  const poolIds = new Set(pool.map((p) => p.id));
  const poolAds = d.ads.filter((a) => a.productId && poolIds.has(a.productId) && a.firstSeen <= asOf);

  const cats = (categories.length ? categories : [...CATEGORIES]).map((category) => {
    const ps = pool.filter((p) => p.category === category);
    let cur = 0;
    let prev = 0;
    let newAdv = 0;
    let fullHistory = ps.length > 0;
    for (const p of ps) {
      const obs = d.observations[p.id] ?? [];
      const c = obs.filter((o) => o.date >= curStart && o.date <= asOf);
      const pr = obs.filter((o) => o.date >= prevStart && o.date < curStart);
      cur += c.reduce((s, o) => s + o.adsActive, 0);
      prev += pr.reduce((s, o) => s + o.adsActive, 0);
      newAdv += c.reduce((s, o) => s + o.newAdvertisers, 0);
      if (pr.length < n && p.firstDetected < prevStart) fullHistory = false;
    }
    // Growth compares active-ad days; the evidence is the distinct ads (and their products) behind each window.
    // The previous window must also lie inside the dataset's observed history (`covered`).
    const catAds = poolAds.filter((a) => a.category === category);
    const sample = { current: sampleOf(catAds, curStart, asOf), previous: sampleOf(catAds, prevStart, prevEnd) };
    const growth: Growth = ps.length
      ? evidenceGrowth(cur, prev, { historyOk: fullHistory && covered, previousSample: sample.previous, currentSample: sample.current })
      : { growth: null, status: "no_activity" };
    const last = ps.reduce((s, p) => s + (p.metrics.adsActive ?? 0), 0);
    return { category, ...growth, sample, adsActive: last, products: ps.length, newAdvertisers: newAdv };
  });

  const cn = (countries.length ? countries : [...COUNTRIES]).map((country) => {
    const ads = d.ads.filter((a) => a.country === country && (!categories.length || (a.category != null && categories.includes(a.category))) && a.firstSeen <= asOf);
    const sample = { current: sampleOf(ads, curStart, asOf), previous: sampleOf(ads, prevStart, prevEnd) };
    const inRange = sample.current.ads;
    const previous = sample.previous.ads;
    // Same rule as categories: covered history and a minimum sample (MIN_AGGREGATE) behind the previous window.
    return { country, adsInRange: inRange, previous, sample, ...evidenceGrowth(inRange, previous, { historyOk: covered, previousSample: sample.previous, currentSample: sample.current }) };
  });

  // Daily active ads per category over the selected window (min 14 days for readability).
  const span = Math.max(14, n);
  const topCats = [...cats].sort((a, b) => b.adsActive - a.adsActive).slice(0, 4).map((c) => c.category);
  const series: TrendReport["series"] = [];
  for (let i = span - 1; i >= 0; i--) {
    const date = addDays(asOf, -i);
    const row: TrendReport["series"][number] = { date };
    for (const c of topCats) {
      row[c] = pool
        .filter((p) => p.category === c)
        .reduce((s, p) => s + ((d.observations[p.id] ?? []).find((o) => o.date === date)?.adsActive ?? 0), 0);
    }
    series.push(row);
  }

  return {
    range,
    asOf,
    coverageStart: coverage,
    trending: trending.slice(0, 12),
    declining: declining.slice(0, 8),
    emerging: emerging.slice(0, 8),
    categories: cats.sort((a, b) => (b.growth ?? -Infinity) - (a.growth ?? -Infinity)),
    countries: cn.sort((a, b) => b.adsInRange - a.adsInRange),
    series,
    insufficient: withTrend.length - measured.length,
  };
}

/** Status of every trend signal, from the connector configuration and the records present. */
export function signalCoverageReport(): SignalCoverage[] {
  return signalCoverage(ds(), connectorStatus());
}

/**
 * Trends page view: `trendReport` plus, for every entry, the connectors and
 * last observation date behind it, search interest where a source supplies it,
 * niche emergence and the weekly discovery frequency.
 */
export function trendInsights(range: TimeRange, categories: Category[] = [], countries: Country[] = []): TrendInsights {
  const d = ds();
  const asOf = d.snapshot;
  const base = trendReport(range, categories, countries);
  const w = windows(range, asOf);
  const pool = allProducts().filter(
    (p) => (!categories.length || categories.includes(p.category)) && (!countries.length || p.countries.some((c) => countries.includes(c))),
  );
  const adsByProduct = new Map<string, Advertisement[]>();
  for (const a of d.ads) if (a.productId) (adsByProduct.get(a.productId) ?? adsByProduct.set(a.productId, []).get(a.productId)!).push(a);
  const sourced = <T extends ProductWithMetrics>(p: T) => ({ ...p, sources: productSources(p, d.observations[p.id] ?? [], adsByProduct.get(p.id) ?? [], asOf) });
  const withSearch = <T extends ProductWithMetrics>(p: T) => ({ ...sourced(p), search: searchInterestTrend(d.observations[p.id] ?? [], w) });

  const categoriesOut = base.categories.map((c) => {
    const s = sourceCollector();
    for (const p of pool.filter((x) => x.category === c.category)) {
      s.merge(productSources(p, d.observations[p.id] ?? [], adsByProduct.get(p.id) ?? [], asOf));
    }
    return { ...c, sources: s.done() };
  });
  const countriesOut = base.countries.map((c) => {
    const s = sourceCollector();
    for (const a of d.ads)
      if (a.country === c.country && (!categories.length || (a.category != null && categories.includes(a.category))) && a.firstSeen <= asOf) s.add(a.source, a.lastSeen <= asOf ? a.lastSeen : asOf);
    return { ...c, sources: s.done() };
  });

  const coverage = base.coverageStart;
  const { niches, insufficient: nichesInsufficient } = nicheEmergence(pool, d.ads.filter((a) => !countries.length || countries.includes(a.country)), d.observations, w, historyCovers(coverage, w));
  // Weekly buckets covering both comparison windows (at least 8 weeks, at most 26).
  const weeks = Math.min(26, Math.max(8, Math.ceil((2 * w.n) / 7)));
  const firstDetected = pool.map((p) => p.firstDetected).sort()[0] ?? null;
  const discovery = discoverySeries(pool, asOf, weeks, coverage ?? firstDetected, categories);
  const searchRows = pool.flatMap((p) => (d.observations[p.id] ?? []).filter((o) => o.searchInterest != null));
  const searchProducts = new Set(searchRows.map((o) => o.productId)).size;

  return {
    ...base,
    trending: base.trending.map(withSearch),
    declining: base.declining.map(withSearch),
    emerging: base.emerging.map(sourced),
    categories: categoriesOut,
    countries: countriesOut,
    niches: niches.slice(0, 8),
    nichesInsufficient,
    discovery,
    searchInterest: { products: searchProducts, connectors: [...new Set(searchRows.map((o) => o.source.connector))].sort() },
    signals: signalCoverageReport(),
  };
}

export function overview() {
  const d = ds();
  const products = allProducts();
  const scored = products.filter((p) => p.score.overall != null);
  const asOf = d.snapshot;
  const week = addDays(asOf, -6);
  const top = [...scored].sort((a, b) => (b.score.overall as number) - (a.score.overall as number)).slice(0, 6);
  const newProducts = products.filter((p) => p.firstDetected >= addDays(asOf, -29)).length;
  const activeAds = d.ads.filter((a) => a.lastSeen >= addDays(asOf, -2)).length;
  const newAdsWeek = d.ads.filter((a) => a.firstSeen >= week).length;
  const series = [];
  for (let i = 59; i >= 0; i--) {
    const date = addDays(asOf, -i);
    series.push({
      date,
      activeAds: d.ads.filter((a) => a.firstSeen <= date && a.lastSeen >= date).length,
      newAds: d.ads.filter((a) => a.firstSeen === date).length,
    });
  }
  const recentAds = [...d.ads].sort((a, b) => b.firstSeen.localeCompare(a.firstSeen)).slice(0, 4);
  return {
    asOf,
    counts: { products: products.length, scored: scored.length, activeAds, newAdsWeek, newProducts, stores: d.stores.length },
    top,
    series,
    recentAds,
    trends: trendReport("7d").trending.slice(0, 5),
  };
}

export function globalSearch(q: string) {
  const d = ds();
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return { products: [], advertisers: [], ads: [], stores: [], niches: [] };
  const products = allProducts()
    .filter((p) => matchesText([p.name, ...p.tags], needle) || categoryMatches(p.category, needle))
    .slice(0, 6)
    .map((p) => ({ id: p.id, name: p.name, category: p.category, score: p.score.overall }));
  const advertisers = Array.from(new Set(d.ads.filter((a) => a.advertiser.toLowerCase().includes(needle)).map((a) => a.advertiser)))
    .slice(0, 5)
    .map((name) => ({ name, ads: d.ads.filter((a) => a.advertiser === name).length }));
  const ads = d.ads
    .filter((a) => a.copy.toLowerCase().includes(needle) || a.headline.toLowerCase().includes(needle))
    .slice(0, 5)
    .map((a) => ({ id: a.id, advertiser: a.advertiser, headline: a.headline, platform: a.platform }));
  const stores = d.stores
    .filter((s) => s.name.toLowerCase().includes(needle) || s.domain.includes(needle))
    .slice(0, 5)
    .map((s) => ({ id: s.id, name: s.name, domain: s.domain }));
  const tagHits = new Map<string, number>();
  for (const p of d.products) for (const t of p.tags) if (fold(t).includes(fold(needle))) tagHits.set(t, (tagHits.get(t) ?? 0) + 1);
  const matchedCats = CATEGORIES.filter((c) => categoryMatches(c, needle));
  // Market-trend context: 30-day active-ad growth per matched category (null when history is insufficient).
  const growth = matchedCats.length ? new Map(trendReport("30d", matchedCats).categories.map((c) => [c.category, c.growth])) : new Map<Category, number | null>();
  const niches = [
    ...matchedCats.map((c) => ({ kind: "category" as const, value: c, products: d.products.filter((p) => p.category === c).length, growth: growth.get(c) ?? null })),
    ...[...tagHits.entries()].map(([value, n]) => ({ kind: "tag" as const, value, products: n, growth: undefined })),
  ].slice(0, 6);
  return { products, advertisers, ads, stores, niches };
}

export function datasetForEngines() {
  return ds();
}
