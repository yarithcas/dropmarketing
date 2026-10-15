import "server-only";
import { allProducts, datasetForEngines, meta, trendReport } from "./repository";
import { addDays, daysBetween } from "../dates";
import { csvRow } from "../csv";
import { CATEGORIES, type Advertisement, type Category, type Product, type ProductObservation, type ProvenanceKind, type SourceRef, type Store } from "../types";

/** Generated research reports. Every figure is derived from stored observations; sources are listed. */

export type ReportId = `market-${Category}` | "weekly-opportunities" | "competitive-landscape";

export function reportCatalog() {
  return [
    { id: "weekly-opportunities" as const, kind: "weekly", advanced: false },
    { id: "competitive-landscape" as const, kind: "competitive", advanced: true },
    ...CATEGORIES.map((c) => ({ id: `market-${c}` as const, kind: "market", category: c, advanced: false })),
  ];
}

export function isReportId(id: string): id is ReportId {
  return reportCatalog().some((r) => r.id === id);
}

/** Provenance of the records a report uses: one row per connector and data kind. */
export interface ReportSource {
  connector: string;
  /** Provenance kind as stored on the records (a licensed dataset supplies estimates, the demo connector demo data). */
  kind: ProvenanceKind;
  /** First and last observation dates (YYYY-MM-DD) among those records. */
  from: string;
  to: string;
  records: { products: number; ads: number; observations: number; stores: number };
}

/**
 * Per-connector provenance computed from the records actually used: each
 * record contributes its own connector, kind and observation dates (capped at
 * the snapshot date), so a mixed database never labels demo or estimated rows
 * as measured, and every connector gets its own collection period.
 */
export function reportSources(
  used: { products: Product[]; ads: Advertisement[]; observations: ProductObservation[]; stores: Store[] },
  asOf: string,
): ReportSource[] {
  const rows = new Map<string, ReportSource>();
  const cap = (day: string) => (day > asOf ? asOf : day);
  const add = (ref: SourceRef | undefined, type: keyof ReportSource["records"], from: string, to: string) => {
    if (!ref) return;
    const k = `${ref.connector}|${ref.kind}`;
    const lo = cap(from.slice(0, 10));
    const hi = cap(to.slice(0, 10));
    const r = rows.get(k) ?? { connector: ref.connector, kind: ref.kind, from: lo, to: hi, records: { products: 0, ads: 0, observations: 0, stores: 0 } };
    r.records[type]++;
    if (lo < r.from) r.from = lo;
    if (hi > r.to) r.to = hi;
    rows.set(k, r);
  };
  for (const p of used.products) add(p.source, "products", p.firstDetected, p.lastDetected);
  for (const a of used.ads) if (a.firstSeen <= asOf) add(a.source, "ads", a.firstSeen, a.lastSeen);
  for (const o of used.observations) if (o.date <= asOf) add(o.source, "observations", o.date, o.date);
  for (const st of used.stores) add(st.source, "stores", st.firstSeen, st.source?.observedAt ?? st.firstSeen);
  return [...rows.values()].sort((a, b) => a.connector.localeCompare(b.connector) || a.kind.localeCompare(b.kind));
}

export function buildReport(id: ReportId) {
  const d = datasetForEngines();
  const m = meta();
  const category = id.startsWith("market-") ? (id.slice(7) as Category) : null;
  const products = allProducts().filter((p) => !category || p.category === category);
  const scored = products.filter((p) => p.score.overall != null).sort((a, b) => (b.score.overall as number) - (a.score.overall as number));
  const ids = new Set(products.map((p) => p.id));
  const ads = d.ads.filter((a) => a.productId && ids.has(a.productId));
  const trend = trendReport("30d", category ? [category] : []);
  const margins = products.filter((p) => p.metrics.grossMargin != null).map((p) => p.metrics.grossMargin as number);
  const buckets = [
    { label: "<50%", min: 0, max: 0.5 },
    { label: "50–65%", min: 0.5, max: 0.65 },
    { label: "65–80%", min: 0.65, max: 0.8 },
    { label: "≥80%", min: 0.8, max: 1.01 },
  ].map((b) => ({ label: b.label, count: margins.filter((x) => x >= b.min && x < b.max).length }));
  const storeIds = new Set(d.storeProducts.filter((sp) => sp.productId && ids.has(sp.productId)).map((sp) => sp.storeId));
  const stores = d.stores
    .filter((s) => storeIds.has(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain,
      listings: d.storeProducts.filter((sp) => sp.storeId === s.id).length,
      relevantListings: d.storeProducts.filter((sp) => sp.storeId === s.id && sp.productId && ids.has(sp.productId)).length,
      ads: d.ads.filter((a) => a.landingDomain === s.domain).length,
    }))
    .sort((a, b) => b.relevantListings - a.relevantListings || b.ads - a.ads)
    .slice(0, id === "competitive-landscape" ? 12 : 6);
  const longAds = [...ads].sort((a, b) => daysBetween(b.firstSeen, b.lastSeen) - daysBetween(a.firstSeen, a.lastSeen)).slice(0, 4);
  const weekly = id === "weekly-opportunities";
  const opportunities = (weekly ? scored.filter((p) => p.lastDetected >= addDays(m.asOf, -7)) : scored).slice(0, weekly ? 8 : 5);

  return {
    id,
    category,
    kind: weekly ? "weekly" : id === "competitive-landscape" ? "competitive" : "market",
    generatedAt: new Date().toISOString(),
    asOf: m.asOf,
    dataMode: m.mode,
    overview: {
      products: products.length,
      scored: scored.length,
      adsObserved: ads.length,
      adsActive: products.reduce((s, p) => s + p.metrics.adsActive, 0),
      advertisers: new Set(ads.map((a) => a.advertiser)).size,
      stores: storeIds.size,
      medianMargin: margins.length ? [...margins].sort((a, b) => a - b)[Math.floor(margins.length / 2)] : null,
      growth: category ? trend.categories.find((c) => c.category === category)?.growth ?? null : null,
    },
    opportunities: opportunities.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      score: p.score.overall,
      confidence: p.score.confidence,
      trendGrowth: p.metrics.trendGrowth,
      grossMargin: p.metrics.grossMargin,
      price: p.priceEstimate,
      cost: p.supplierCostEstimate,
      currency: p.currency,
      ads: p.metrics.adsObserved,
      competition: p.metrics.competition,
    })),
    trendSeries: trend.series,
    adExamples: longAds.map((a) => ({
      id: a.id,
      advertiser: a.advertiser,
      platform: a.platform,
      format: a.format,
      headline: a.headline,
      excerpt: a.copy.length > 140 ? `${a.copy.slice(0, 137)}…` : a.copy,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
    })),
    competitors: stores,
    margins: { buckets, note: "estimate" },
    risks: ["reports.risks.estimates", "reports.risks.saturation", "reports.risks.supplier", "reports.risks.policy", "reports.risks.sample"],
    experiments: ["reports.experiments.sample", "reports.experiments.creativeTest", "reports.experiments.landing", "reports.experiments.price", "reports.experiments.killCriteria"],
    sources: reportSources(
      {
        products,
        ads,
        observations: products.flatMap((p) => d.observations[p.id] ?? []),
        stores: d.stores.filter((s) => storeIds.has(s.id)),
      },
      m.asOf,
    ),
  };
}
export type Report = ReturnType<typeof buildReport>;

/** CSV export. Cells go through csvRow: numbers stay numeric, formula-like text is neutralised, unknown values are empty. */
export function reportCsv(r: Report): string {
  const lines = [
    ["section", "name", "score", "confidence", "trend_30d_pct", "est_gross_margin_pct", "est_price", "est_cost", "currency", "ads_observed", "competition"].join(","),
    ...r.opportunities.map((o) =>
      csvRow(["opportunity", o.name, o.score, o.confidence, o.trendGrowth, o.grossMargin == null ? null : Math.round(o.grossMargin * 1000) / 10, o.price, o.cost, o.currency, o.ads, o.competition]),
    ),
    "",
    ["section", "store", "domain", "listings", "relevant_listings", "ads_observed"].join(","),
    ...r.competitors.map((s) => csvRow(["competitor", s.name, s.domain, s.listings, s.relevantListings, s.ads])),
    "",
    ["section", "source", "data_kind", "products", "ads", "observations", "stores", "collected_from", "collected_to"].join(","),
    ...r.sources.map((s) => csvRow(["source", s.connector, s.kind, s.records.products, s.records.ads, s.records.observations, s.records.stores, s.from, s.to])),
  ];
  return lines.join("\n");
}
