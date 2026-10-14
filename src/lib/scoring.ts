import type {
  Advertisement,
  CompetitionLevel,
  Confidence,
  OpportunityScore,
  Product,
  ProductMetrics,
  ProductObservation,
  ScoreComponent,
  Signal,
  StoreProduct,
  TimeRange,
} from "./types";
import { RANGE_DAYS, addDays, daysBetween } from "./dates";

/**
 * Transparent opportunity scoring.
 *
 * Every component is normalized to 0-100 with a documented linear mapping and
 * then combined with fixed weights. Missing inputs are excluded and the
 * remaining weights are re-normalized; when too much is missing the score is
 * withheld ("Insufficient data") rather than guessed.
 */

export const SCORE_WEIGHTS: Record<ScoreComponent["key"], number> = {
  trend: 0.25,
  ads: 0.2,
  margin: 0.2,
  competition: 0.15,
  differentiation: 0.1,
  freshness: 0.1,
};

/** Documented normalization bounds, exposed so the UI can explain them. */
export const NORMALIZATION = {
  trendGrowthPct: [-50, 150],
  adsActiveLog: [0, Math.log1p(25)],
  advertisers: [1, 12],
  grossMargin: [0.2, 0.8],
  freshnessDays: [30, 0],
  observationDays: [7, 90],
  adsObserved: [3, 25],
  competitionAdvertisers: [0, 12],
  competitionStores: [0, 6],
} as const;

export const MIN_EVIDENCE = { observationDays: 14, adsObserved: 3 } as const;

/** Linear map of x from [lo, hi] onto [0, 100], clamped. Works with lo > hi (inverse). */
export function normalize(x: number, lo: number, hi: number): number {
  if (hi === lo) return 0;
  const t = (x - lo) / (hi - lo);
  return Math.round(Math.max(0, Math.min(1, t)) * 1000) / 10;
}

export interface TrendValue {
  pct: number | null;
  status: "ok" | "insufficient_history" | "new_activity" | "no_activity";
  current: number;
  previous: number;
}

/**
 * Growth of the mean daily active-ad count over `range` vs the preceding
 * window of the same length. Requires the previous window to be fully observed.
 */
export function trendGrowth(obs: ProductObservation[], range: TimeRange, asOf: string, metric: "adsActive" | "searchInterest" = "adsActive"): TrendValue {
  const n = RANGE_DAYS[range];
  const curStart = addDays(asOf, -(n - 1));
  const prevStart = addDays(curStart, -n);
  const cur = obs.filter((o) => o.date >= curStart && o.date <= asOf);
  const prev = obs.filter((o) => o.date >= prevStart && o.date < curStart);
  const val = (o: ProductObservation) => (metric === "adsActive" ? o.adsActive : o.searchInterest ?? 0);
  const mean = (rows: ProductObservation[]) => (rows.length ? rows.reduce((s, o) => s + val(o), 0) / rows.length : 0);
  const current = mean(cur);
  const previous = mean(prev);
  if (prev.length < n || cur.length < n) return { pct: null, status: "insufficient_history", current, previous };
  if (previous === 0 && current === 0) return { pct: null, status: "no_activity", current, previous };
  if (previous === 0) return { pct: null, status: "new_activity", current, previous };
  return { pct: Math.round(((current - previous) / previous) * 1000) / 10, status: "ok", current, previous };
}

export function competitionFrom(advertisers: number, stores: number): { saturation: number; level: CompetitionLevel } {
  const [a0, a1] = NORMALIZATION.competitionAdvertisers;
  const [s0, s1] = NORMALIZATION.competitionStores;
  const saturation = Math.round(normalize(advertisers, a0, a1) * 0.5 + normalize(stores, s0, s1) * 0.5);
  return { saturation, level: saturation < 35 ? "low" : saturation < 65 ? "medium" : "high" };
}

export function grossMargin(price: number | null, cost: number | null): number | null {
  if (price == null || cost == null || price <= 0) return null;
  return Math.round(((price - cost) / price) * 1000) / 1000;
}

export function computeMetrics(
  product: Product,
  obs: ProductObservation[],
  ads: Advertisement[],
  storeProducts: StoreProduct[],
  asOf: string,
): ProductMetrics {
  const pAds = ads.filter((a) => a.productId === product.id && a.firstSeen <= asOf);
  const advertisers = new Set(pAds.map((a) => a.advertiser)).size;
  const stores = new Set(storeProducts.filter((s) => s.productId === product.id && s.firstSeen <= asOf).map((s) => s.storeId)).size;
  const last = obs.filter((o) => o.date <= asOf).at(-1);
  const { saturation, level } = competitionFrom(advertisers, stores);
  return {
    adsObserved: pAds.length,
    adsActive: last?.adsActive ?? 0,
    advertisersObserved: advertisers,
    storesObserved: stores,
    trendGrowth: trendGrowth(obs, "30d", asOf).pct,
    competition: level,
    saturation,
    grossMargin: grossMargin(product.priceEstimate, product.supplierCostEstimate),
    observationCount: obs.filter((o) => o.date <= asOf).length,
  };
}

export function scoreProduct(product: Product, metrics: ProductMetrics, obs: ProductObservation[], asOf: string): OpportunityScore {
  const N = NORMALIZATION;
  const t30 = trendGrowth(obs, "30d", asOf);
  const t7 = trendGrowth(obs, "7d", asOf);
  const trendPct = t30.pct ?? t7.pct;
  const daysSince = daysBetween(product.lastDetected, asOf);

  const comp = (key: ScoreComponent["key"], value: number | null, provenance: ScoreComponent["provenance"]): ScoreComponent => ({
    key,
    weight: SCORE_WEIGHTS[key],
    value: value == null ? null : Math.round(value),
    provenance,
  });

  const kind = product.source.kind === "demo" ? "demo" : null;
  const adsValue =
    metrics.adsObserved > 0
      ? normalize(Math.log1p(metrics.adsActive), N.adsActiveLog[0], N.adsActiveLog[1]) * 0.6 +
        normalize(metrics.advertisersObserved, N.advertisers[0], N.advertisers[1]) * 0.4
      : null;
  const freshness = normalize(daysSince, N.freshnessDays[0], N.freshnessDays[1]);
  const evidence =
    normalize(metrics.observationCount, N.observationDays[0], N.observationDays[1]) * 0.5 +
    normalize(metrics.adsObserved, N.adsObserved[0], N.adsObserved[1]) * 0.5;

  const components: ScoreComponent[] = [
    comp("trend", trendPct == null ? null : normalize(trendPct, N.trendGrowthPct[0], N.trendGrowthPct[1]), kind ?? "measured"),
    comp("ads", adsValue, kind ?? "measured"),
    comp("margin", metrics.grossMargin == null ? null : normalize(metrics.grossMargin, N.grossMargin[0], N.grossMargin[1]), kind ?? "estimate"),
    comp("competition", metrics.adsObserved > 0 ? 100 - metrics.saturation : null, kind ?? "estimate"),
    comp("differentiation", product.differentiation, kind ?? "estimate"),
    comp("freshness", freshness * 0.5 + evidence * 0.5, kind ?? "measured"),
  ];

  const insufficientReasons: Signal[] = [];
  if (metrics.observationCount < MIN_EVIDENCE.observationDays)
    insufficientReasons.push({ key: "insufficient.observations", params: { n: metrics.observationCount, min: MIN_EVIDENCE.observationDays } });
  if (metrics.adsObserved < MIN_EVIDENCE.adsObserved)
    insufficientReasons.push({ key: "insufficient.ads", params: { n: metrics.adsObserved, min: MIN_EVIDENCE.adsObserved } });
  const missing = components.filter((c) => c.value == null);
  if (missing.length >= 2) insufficientReasons.push({ key: "insufficient.components", params: { n: missing.length } });

  const available = components.filter((c) => c.value != null);
  const wsum = available.reduce((s, c) => s + c.weight, 0);
  const overall = insufficientReasons.length || wsum === 0 ? null : Math.round(available.reduce((s, c) => s + c.weight * (c.value as number), 0) / wsum);

  const confidence: Confidence =
    missing.length === 0 && metrics.observationCount >= 60 && metrics.adsObserved >= 10 && daysSince <= 7
      ? "high"
      : metrics.observationCount >= 21 && metrics.adsObserved >= 5 && missing.length <= 1
        ? "medium"
        : "low";

  const positives: Signal[] = [];
  const negatives: Signal[] = [];
  const nextSteps: Signal[] = [];
  const gm = metrics.grossMargin;

  if (trendPct != null && trendPct >= 40) positives.push({ key: "signals.trend_strong", params: { pct: trendPct } });
  if (t30.status === "new_activity") positives.push({ key: "signals.new_activity" });
  if (metrics.advertisersObserved >= 5) positives.push({ key: "signals.ads_diverse", params: { n: metrics.advertisersObserved } });
  if (gm != null && gm >= 0.65) positives.push({ key: "signals.margin_high", params: { pct: Math.round(gm * 100) } });
  if (metrics.competition === "low" && metrics.adsObserved > 0) positives.push({ key: "signals.competition_low" });
  if ((product.differentiation ?? 0) >= 55) positives.push({ key: "signals.differentiated" });
  if (daysSince <= 3) positives.push({ key: "signals.fresh" });
  if (product.shipping.verified) positives.push({ key: "signals.shipping_verified" });

  if (trendPct != null && trendPct <= -15) negatives.push({ key: "signals.trend_declining", params: { pct: trendPct } });
  if (t30.status === "insufficient_history") negatives.push({ key: "signals.short_history" });
  if (gm != null && gm < 0.5) negatives.push({ key: "signals.margin_thin", params: { pct: Math.round(gm * 100) } });
  if (gm == null) negatives.push({ key: "signals.margin_unknown" });
  if (metrics.competition === "high") negatives.push({ key: "signals.competition_high", params: { n: metrics.advertisersObserved } });
  if (product.differentiation != null && product.differentiation <= 25) negatives.push({ key: "signals.low_differentiation" });
  if (daysSince > 14) negatives.push({ key: "signals.stale", params: { days: daysSince } });
  if (metrics.advertisersObserved > 0 && metrics.advertisersObserved < 3) negatives.push({ key: "signals.few_advertisers" });
  if (!product.shipping.verified) negatives.push({ key: "signals.shipping_unverified" });

  if (product.supplierCostEstimate != null) nextSteps.push({ key: "steps.verify_supplier" });
  if (!product.shipping.verified) nextSteps.push({ key: "steps.verify_shipping" });
  if (metrics.adsObserved > 0) nextSteps.push({ key: "steps.study_creatives" });
  if (metrics.storesObserved > 0) nextSteps.push({ key: "steps.check_competitor_pricing" });
  if ((product.differentiation ?? 0) < 40) nextSteps.push({ key: "steps.differentiate_offer" });
  if (overall == null || (trendPct != null && trendPct < 0)) nextSteps.push({ key: "steps.monitor_trend" });
  nextSteps.push({ key: "steps.small_budget_test" });

  return { overall, components, confidence, positives, negatives, nextSteps, insufficientReasons };
}
