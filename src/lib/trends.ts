import type { ConnectorCategory } from "./connectors/types";
import type { DemoDataset } from "./demo/generate";
import type { Advertisement, Category, Product, ProductObservation, ProvenanceKind, SourceRef, TimeRange } from "./types";
import { CATEGORIES } from "./types";
import { RANGE_DAYS, addDays } from "./dates";

/**
 * Pure computations behind the Trends page: evidence-gated growth, niche
 * emergence, discovery frequency, per-entry sources and signal coverage.
 * Everything is derived from stored records; when the evidence is too thin
 * the value is withheld (null + status) rather than estimated.
 */

export type TrendDataset = Pick<DemoDataset, "products" | "ads" | "stores" | "storeProducts" | "observations">;

export interface Windows {
  n: number;
  asOf: string;
  /** First day of the selected window (inclusive). */
  curStart: string;
  /** First day of the previous window of equal length (inclusive); it ends the day before curStart. */
  prevStart: string;
}

export function windows(range: TimeRange, asOf: string): Windows {
  const n = RANGE_DAYS[range];
  const curStart = addDays(asOf, -(n - 1));
  return { n, asOf, curStart, prevStart: addDays(curStart, -n) };
}

const inCurrent = (day: string, w: Windows) => day >= w.curStart && day <= w.asOf;
const inPrevious = (day: string, w: Windows) => day >= w.prevStart && day < w.curStart;
/** An ad counts as active in a window when its observed run overlaps it. */
const activeIn = (a: Advertisement, from: string, to: string) => a.firstSeen <= to && a.lastSeen >= from;

export type GrowthStatus = "ok" | "insufficient_data" | "insufficient_history" | "new_activity" | "no_activity";

export interface Growth {
  growth: number | null;
  status: GrowthStatus;
}

/**
 * Minimum sample behind an aggregate growth figure (category, country, niche),
 * the aggregate counterpart of MIN_EVIDENCE: a single product needs
 * MIN_EVIDENCE.adsObserved (3) ads to be scored; an aggregate percentage needs
 * a base of at least 10 distinct ads coming from at least 3 products, so that
 * one campaign or one product cannot produce a headline percentage
 * (3 ads → 11 ads is not "+266.7 %").
 */
export const MIN_AGGREGATE = { ads: 10, products: 3 } as const;

/** Distinct ads and contributing products behind one window of an aggregate. */
export interface Sample {
  ads: number;
  products: number;
}

export const sampleOk = (s: Sample) => s.ads >= MIN_AGGREGATE.ads && s.products >= MIN_AGGREGATE.products;

/** Distinct ads active in [from, to] and the number of products they belong to. */
export function sampleOf(ads: Advertisement[], from: string, to: string): Sample {
  const active = ads.filter((a) => activeIn(a, from, to));
  return { ads: active.length, products: new Set(active.map((a) => a.productId).filter(Boolean)).size };
}

/**
 * Window-over-window growth under the minimum-evidence rule: the previous
 * window must lie inside the observed history and its sample — the base of
 * the ratio — must reach MIN_AGGREGATE. Otherwise no percentage is given.
 * `current` / `previous` are the compared quantities (ads, or active-ad days);
 * the samples count the distinct ads and products behind them.
 */
export function evidenceGrowth(current: number, previous: number, o: { historyOk: boolean; previousSample: Sample; currentSample: Sample }): Growth {
  if (!o.historyOk) return { growth: null, status: "insufficient_history" };
  if (current === 0 && previous === 0) return { growth: null, status: "no_activity" };
  if (previous === 0) return { growth: null, status: sampleOk(o.currentSample) ? "new_activity" : "insufficient_data" };
  if (!sampleOk(o.previousSample)) return { growth: null, status: "insufficient_data" };
  return { growth: Math.round(((current - previous) / previous) * 1000) / 10, status: "ok" };
}

/** Coverage is computed once per loaded dataset (the observation map is replaced on reload). */
const coverageCache = new WeakMap<object, string | null>();

/**
 * First day covered by the observation history. Ads alone do not define
 * coverage: connectors return ads that were still running when collection
 * started, so earlier windows would be under-counted.
 */
export function coverageStart(observations: Record<string, ProductObservation[]>): string | null {
  const cached = coverageCache.get(observations);
  if (cached !== undefined) return cached;
  let min: string | null = null;
  for (const rows of Object.values(observations)) for (const o of rows) if (min == null || o.date < min) min = o.date;
  coverageCache.set(observations, min);
  return min;
}

/** True when the previous window lies entirely inside the observed history. */
export const historyCovers = (coverage: string | null, w: Windows) => coverage != null && coverage <= w.prevStart;

// ---------------------------------------------------------------- Sources

export interface EntrySources {
  /** Connector ids that supplied the records behind the entry. */
  connectors: string[];
  kinds: ProvenanceKind[];
  /** Latest observation date (YYYY-MM-DD) among those records. */
  lastObserved: string | null;
}

/** Accumulates the provenance of the records behind one entry. */
export function sourceCollector() {
  const connectors = new Set<string>();
  const kinds = new Set<ProvenanceKind>();
  let last: string | null = null;
  return {
    add(ref: SourceRef | undefined, day?: string | null) {
      if (!ref) return;
      connectors.add(ref.connector);
      kinds.add(ref.kind);
      const d = (day ?? ref.observedAt)?.slice(0, 10);
      if (d && (last == null || d > last)) last = d;
    },
    merge(e: EntrySources) {
      for (const c of e.connectors) connectors.add(c);
      for (const k of e.kinds) kinds.add(k);
      if (e.lastObserved && (last == null || e.lastObserved > last)) last = e.lastObserved;
    },
    done(): EntrySources {
      return { connectors: [...connectors].sort(), kinds: [...kinds].sort(), lastObserved: last };
    },
  };
}

/** Sources of one product: its record, its daily observations and its ads, up to `asOf`. */
export function productSources(p: Product, obs: ProductObservation[], ads: Advertisement[], asOf: string): EntrySources {
  const s = sourceCollector();
  s.add(p.source, p.lastDetected <= asOf ? p.lastDetected : asOf);
  for (const o of obs) if (o.date <= asOf) s.add(o.source, o.date);
  for (const a of ads) if (a.firstSeen <= asOf) s.add(a.source, a.lastSeen <= asOf ? a.lastSeen : asOf);
  return s.done();
}

// ---------------------------------------------------------------- Search interest

export interface SearchTrend {
  pct: number | null;
  status: "ok" | "insufficient_history" | "new_activity" | "no_activity";
  /** Latest index value (0-100). */
  latest: number | null;
  connectors: string[];
}

/**
 * Search-interest change over the window vs the previous one, using only days
 * that carry a search-interest value. Null when the product has no such value
 * at all (no search-interest source behind it) — never a zero.
 */
export function searchInterestTrend(obs: ProductObservation[], w: Windows): SearchTrend | null {
  const rows = obs.filter((o) => o.searchInterest != null && o.date <= w.asOf);
  if (!rows.length) return null;
  const cur = rows.filter((o) => inCurrent(o.date, w));
  const prev = rows.filter((o) => inPrevious(o.date, w));
  const mean = (rs: ProductObservation[]) => rs.reduce((s, o) => s + (o.searchInterest as number), 0) / rs.length;
  const base = { latest: rows.at(-1)!.searchInterest, connectors: [...new Set(rows.map((o) => o.source.connector))].sort() };
  if (cur.length < w.n || prev.length < w.n) return { ...base, pct: null, status: "insufficient_history" };
  const c = mean(cur);
  const p = mean(prev);
  if (c === 0 && p === 0) return { ...base, pct: null, status: "no_activity" };
  if (p === 0) return { ...base, pct: null, status: "new_activity" };
  return { ...base, pct: Math.round(((c - p) / p) * 1000) / 10, status: "ok" };
}

// ---------------------------------------------------------------- Niche emergence

export interface WindowCount {
  current: number;
  previous: number;
}

export interface NicheEmergence {
  kind: "category" | "tag";
  /** Category key or tag text. */
  value: string;
  /** For tags: the most frequent category of its products (display only). */
  category: Category;
  products: number;
  newProducts: WindowCount;
  newAdvertisers: WindowCount;
  activeAds: WindowCount & Growth;
  emerging: boolean;
  sources: EntrySources;
}

/** Documented emergence thresholds (shown in the UI next to the list). */
export const EMERGENCE = { minEntrants: 2, minGrowthPct: 20 } as const;

/**
 * Niche = a category, or a tag shared by at least MIN_AGGREGATE.products
 * products. A niche is emerging when, within the selected window vs the
 * previous window of equal length:
 * - at least EMERGENCE.minEntrants new products or advertisers entered it, more than before;
 * - its active ads grew by EMERGENCE.minGrowthPct % or more, or rose from
 *   below the minimum sample to above it;
 * - the current window holds at least the minimum sample (MIN_AGGREGATE ads
 *   from MIN_AGGREGATE products) and the previous window is fully observed.
 * Niches that have new entrants but not enough evidence are counted, not listed.
 */
export function nicheEmergence(
  products: Product[],
  ads: Advertisement[],
  observations: Record<string, ProductObservation[]>,
  w: Windows,
  historyOk: boolean,
): { niches: NicheEmergence[]; insufficient: number } {
  const prevEnd = addDays(w.curStart, -1);
  const adsByProduct = new Map<string, Advertisement[]>();
  for (const a of ads) if (a.productId) (adsByProduct.get(a.productId) ?? adsByProduct.set(a.productId, []).get(a.productId)!).push(a);

  const groups: { kind: NicheEmergence["kind"]; value: string; members: Product[] }[] = [];
  for (const c of CATEGORIES) {
    const members = products.filter((p) => p.category === c);
    if (members.length) groups.push({ kind: "category", value: c, members });
  }
  const byTag = new Map<string, Product[]>();
  for (const p of products) for (const t of new Set(p.tags)) (byTag.get(t) ?? byTag.set(t, []).get(t)!).push(p);
  for (const [value, members] of byTag) if (members.length >= MIN_AGGREGATE.products) groups.push({ kind: "tag", value, members });

  let insufficient = 0;
  const assessed = groups.map(({ kind, value, members }): NicheEmergence => {
    const nAds = members.flatMap((p) => adsByProduct.get(p.id) ?? []).filter((a) => a.firstSeen <= w.asOf);
    const firstByAdvertiser = new Map<string, string>();
    for (const a of nAds) if (!firstByAdvertiser.has(a.advertiser) || a.firstSeen < firstByAdvertiser.get(a.advertiser)!) firstByAdvertiser.set(a.advertiser, a.firstSeen);
    const firsts = [...firstByAdvertiser.values()];
    const cur = sampleOf(nAds, w.curStart, w.asOf);
    const prev = sampleOf(nAds, w.prevStart, prevEnd);
    const active = { current: cur.ads, previous: prev.ads };
    const newProducts = { current: members.filter((p) => inCurrent(p.firstDetected, w)).length, previous: members.filter((p) => inPrevious(p.firstDetected, w)).length };
    const newAdvertisers = { current: firsts.filter((d) => inCurrent(d, w)).length, previous: firsts.filter((d) => inPrevious(d, w)).length };
    const growth = evidenceGrowth(active.current, active.previous, { historyOk, previousSample: prev, currentSample: cur });
    const entrants = newProducts.current + newAdvertisers.current;
    const entering = entrants >= EMERGENCE.minEntrants && entrants > newProducts.previous + newAdvertisers.previous;
    const enough = historyOk && sampleOk(cur);
    const rising =
      growth.status === "new_activity" || (growth.status === "insufficient_data" && !sampleOk(prev)) || (growth.growth != null && growth.growth >= EMERGENCE.minGrowthPct);
    if (entering && !enough) insufficient++;
    const s = sourceCollector();
    for (const p of members) s.add(p.source, p.lastDetected <= w.asOf ? p.lastDetected : w.asOf);
    for (const a of nAds) s.add(a.source, a.lastSeen <= w.asOf ? a.lastSeen : w.asOf);
    for (const p of members) {
      const last = (observations[p.id] ?? []).filter((o) => o.date <= w.asOf).at(-1);
      if (last) s.add(last.source, last.date);
    }
    const cats = new Map<Category, number>();
    for (const p of members) cats.set(p.category, (cats.get(p.category) ?? 0) + 1);
    return {
      kind,
      value,
      category: kind === "category" ? (value as Category) : [...cats.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      products: members.length,
      newProducts,
      newAdvertisers,
      activeAds: { ...active, ...growth },
      emerging: entering && enough && rising,
      sources: s.done(),
    };
  });

  const niches = assessed
    .filter((n) => n.emerging)
    .sort(
      (a, b) =>
        b.newAdvertisers.current - a.newAdvertisers.current ||
        b.newProducts.current - a.newProducts.current ||
        b.activeAds.current - a.activeAds.current ||
        a.value.localeCompare(b.value),
    );
  return { niches, insufficient };
}

// ---------------------------------------------------------------- Discovery frequency

export interface DiscoverySeries {
  /** One row per 7-day bucket ending on asOf; `date` is the bucket's first day. Null = before the observed history. */
  rows: ({ date: string; total: number | null } & Partial<Record<Category, number | null>>)[];
  /** Categories with the most discoveries over the period, most first (chart series). */
  top: Category[];
  byCategory: { category: Category; count: number }[];
}

/** New products detected per week, overall and per category. */
export function discoverySeries(products: Product[], asOf: string, weeks: number, coverage: string | null, focus: Category[] = []): DiscoverySeries {
  const rows: DiscoverySeries["rows"] = [];
  const totals = new Map<Category, number>();
  for (let i = weeks - 1; i >= 0; i--) {
    const end = addDays(asOf, -7 * i);
    const start = addDays(end, -6);
    const observed = coverage != null && end >= coverage;
    const hits = observed ? products.filter((p) => p.firstDetected >= start && p.firstDetected <= end) : [];
    const row: DiscoverySeries["rows"][number] = { date: start, total: observed ? hits.length : null };
    for (const c of CATEGORIES) {
      const n = hits.filter((p) => p.category === c).length;
      row[c] = observed ? n : null;
      if (n) totals.set(c, (totals.get(c) ?? 0) + n);
    }
    rows.push(row);
  }
  const byCategory = [...totals.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  const top = (focus.length ? focus.filter((c) => totals.has(c)) : byCategory.map((c) => c.category)).slice(0, 3);
  return { rows, top, byCategory };
}

// ---------------------------------------------------------------- Signal coverage

export const SIGNALS = ["advertising_activity", "new_advertisers", "stores_observed", "search_interest", "social_engagement", "source_popularity", "discovery_frequency"] as const;
export type SignalKey = (typeof SIGNALS)[number];
export type SignalStatus = "connected" | "configured" | "demo" | "not_connected";

/** Connector categories able to supply each signal (see lib/connectors/registry.ts). Empty: no connector exists for it. */
const SIGNAL_PROVIDERS: Record<SignalKey, ConnectorCategory[]> = {
  advertising_activity: ["ads", "licensed"],
  new_advertisers: ["ads", "licensed"],
  stores_observed: ["stores"],
  search_interest: ["trends"],
  social_engagement: [],
  source_popularity: [],
  discovery_frequency: ["licensed"],
};

export interface SignalCoverage {
  key: SignalKey;
  status: SignalStatus;
  /** Connectors that can supply the signal, and which of them are configured on this deployment. */
  providers: string[];
  configured: string[];
  /** Connectors whose records actually carry the signal in the working dataset. */
  sources: EntrySources;
}

export interface ConnectorState {
  id: string;
  category: string;
  configured: boolean;
}

/**
 * Status of every signal the product uses, from the connector configuration
 * and from the records present: "connected" when real (non-demo) records carry
 * it, "demo" when only demo records do, "configured" when a provider is set up
 * but no record carries it yet, otherwise "not_connected".
 */
export function signalCoverage(d: TrendDataset, connectors: ConnectorState[]): SignalCoverage[] {
  const collect = (key: SignalKey) => {
    const s = sourceCollector();
    switch (key) {
      case "advertising_activity":
        for (const a of d.ads) s.add(a.source, a.lastSeen);
        break;
      case "new_advertisers":
        for (const a of d.ads) if (a.advertiser) s.add(a.source, a.firstSeen);
        break;
      case "stores_observed": {
        const linked = new Set(d.storeProducts.filter((sp) => sp.productId).map((sp) => sp.storeId));
        for (const st of d.stores) if (linked.has(st.id)) s.add(st.source);
        break;
      }
      case "search_interest":
        for (const rows of Object.values(d.observations)) for (const o of rows) if (o.searchInterest != null) s.add(o.source, o.date);
        break;
      case "discovery_frequency":
        for (const p of d.products) s.add(p.source, p.firstDetected);
        break;
      default:
        // Social engagement and source popularity: no record in the data model carries them.
        break;
    }
    return s.done();
  };
  return SIGNALS.map((key) => {
    const providers = connectors.filter((c) => (SIGNAL_PROVIDERS[key] as string[]).includes(c.category));
    const configured = providers.filter((c) => c.configured).map((c) => c.id);
    const sources = collect(key);
    const real = sources.kinds.some((k) => k !== "demo");
    const status: SignalStatus = real ? "connected" : sources.kinds.includes("demo") ? "demo" : configured.length ? "configured" : "not_connected";
    return { key, status, providers: providers.map((c) => c.id), configured, sources };
  });
}
