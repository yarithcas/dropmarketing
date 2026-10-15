import type { Category, ProductWithMetrics } from "../types";
import { CATEGORIES } from "../types";
import type { AnalystIntent, AnalystResponse, AnalystSection, Recommendation, Text } from "./types";
import { COMPARE_MAX, COMPARE_MIN } from "./types";

/**
 * Deterministic analyst used when no AI provider is configured (and as a
 * fallback). It only restates facts present in the product records; every
 * statement maps to a field of the record it cites.
 */

const CATEGORY_WORDS: Record<Category, string[]> = {
  fitness: ["fitness", "sport", "gym", "workout", "exercise", "entraînement", "musculation", "deporte", "ejercicio", "allenamento", "palestra", "training", "pilates"],
  home: ["home", "maison", "hogar", "casa", "zuhause", "wohnen", "décor", "decor", "deco"],
  kitchen: ["kitchen", "cuisine", "cocina", "cucina", "küche", "cooking"],
  beauty: ["beauty", "beauté", "belleza", "bellezza", "schönheit", "skincare", "soin", "hair", "cheveux"],
  pets: ["pet", "pets", "animaux", "chien", "chat", "dog", "cat", "mascota", "perro", "gato", "haustier", "hund", "katze", "animali", "cane", "gatto"],
  tech: ["tech", "gadget", "électronique", "electronics", "tecnología", "tecnologia", "technik", "elettronica"],
  outdoor: ["outdoor", "camping", "plein air", "aire libre", "aperto", "draußen"],
  baby: ["baby", "bébé", "bebé", "bambino", "neonato", "kleinkind", "toddler"],
  fashion: ["fashion", "mode", "moda", "vêtement", "clothing", "accessoire"],
  wellness: ["wellness", "bien-être", "bienestar", "benessere", "sleep", "sommeil", "sueño", "schlaf", "sonno", "relax"],
  auto: ["auto", "car", "voiture", "coche", "macchina", "fahrzeug"],
  office: ["office", "bureau", "oficina", "ufficio", "büro", "remote", "télétravail", "desk"],
};

const INTENT_WORDS: Record<Exclude<AnalystIntent, "find">, string[]> = {
  compare: ["compare", "comparer", "compara", "comparar", "confronta", "vergleich", " vs", "versus"],
  angles: ["angle", "angles", "hook", "accroche", "ángulo", "angoli", "werbe", "creative", "créa", "ad idea", "idées de pub", "idee pubblicit"],
  risks: ["risk", "risque", "riesgo", "rischi", "risiko", "danger"],
  checklist: ["checklist", "check-list", "launch", "lancer", "lancement", "lanzamiento", "lancio", "start", "liste de contrôle"],
  analyze: ["analy", "strength", "weakness", "forces", "faiblesses", "fortalezas", "debilidades", "punti di forza", "stärken", "schwächen"],
};

/**
 * Intent of the question. An explicit request is kept even when the context
 * does not allow answering it yet (e.g. "compare" with fewer than two products):
 * the engines then ask for the missing products instead of answering another question.
 */
export function detectIntent(question: string, productIds: string[]): AnalystIntent {
  const q = ` ${question.toLowerCase()} `;
  for (const intent of ["compare", "angles", "risks", "checklist", "analyze"] as const) {
    if (INTENT_WORDS[intent].some((w) => q.includes(w))) return intent;
  }
  if (productIds.length >= 2) return "compare";
  if (productIds.length === 1) return "analyze";
  return "find";
}

export function detectCategories(question: string): Category[] {
  const q = question.toLowerCase();
  return CATEGORIES.filter((c) => CATEGORY_WORDS[c].some((w) => q.includes(w)));
}

function wantsModerateCompetition(q: string) {
  return /(moderate|modérée|modere|moderada|moderata|mittel|medium|low competition|faible concurrence|poca competencia|bassa concorrenza|wenig wettbewerb)/i.test(q);
}

const pctOf = (m: number | null) => (m == null ? null : Math.round(m * 100));

export function recommendation(p: ProductWithMetrics): Recommendation {
  const m = p.metrics;
  const why: Text[] = p.score.positives.slice(0, 4).map((s) => ({ key: s.key, params: s.params }));
  if (!why.length) why.push({ key: "analyst.rules.noStrongSignal" });
  const evidence: Text[] = [
    { key: "analyst.evidence.ads", params: { ads: m.adsObserved, advertisers: m.advertisersObserved, active: m.adsActive } },
    { key: "analyst.evidence.stores", params: { n: m.storesObserved } },
    m.trendGrowth == null ? { key: "analyst.evidence.trendUnknown" } : { key: "analyst.evidence.trend", params: { pct: m.trendGrowth } },
    m.grossMargin == null ? { key: "analyst.evidence.marginUnknown" } : { key: "analyst.evidence.margin", params: { pct: pctOf(m.grossMargin)!, price: p.priceEstimate ?? 0, cost: p.supplierCostEstimate ?? 0 } },
    { key: "analyst.evidence.window", params: { first: p.firstDetected, last: p.lastDetected, n: m.observationCount } },
  ];
  const risks: Text[] = p.score.negatives.length ? p.score.negatives.slice(0, 4).map((s) => ({ key: s.key, params: s.params })) : fallbackRisks(p);
  const missing: Text[] = [];
  if (!p.shipping.verified) missing.push({ key: "analyst.missing.shipping" });
  if (p.supplierCostEstimate != null) missing.push({ key: "analyst.missing.supplierQuote" });
  if (p.supplierCostEstimate == null) missing.push({ key: "analyst.missing.cost" });
  missing.push({ key: "analyst.missing.salesData" });
  if (p.differentiation == null) missing.push({ key: "analyst.missing.differentiation" });
  const validation: Text[] = p.score.nextSteps.slice(0, 4).map((s) => ({ key: s.key, params: s.params }));
  return { productId: p.id, productName: p.name, score: p.score.overall, why, evidence, risks, missing, confidence: p.score.confidence, validation };
}

/** Below these, the record's history / ad sample is flagged as a limit (60 days ≈ two 30-day trend windows). */
const FALLBACK_SHORT_HISTORY_DAYS = 60;
const FALLBACK_FEW_ADS = 10;

/**
 * Risks shown when the score raised no negative signal: an explicit "no
 * specific risk signal detected" statement followed by the data-quality limits
 * of the record (each one a fact of the record), so the section never
 * disappears and never invents a risk.
 */
export function fallbackRisks(p: ProductWithMetrics): Text[] {
  const m = p.metrics;
  const out: Text[] = [];
  if (p.score.confidence !== "high") out.push({ key: p.score.confidence === "low" ? "analyst.risks.fallback.confidenceLow" : "analyst.risks.fallback.confidenceMedium" });
  if (!p.shipping.verified) out.push({ key: "analyst.risks.fallback.shippingUnverified" });
  if (m.grossMargin != null) out.push({ key: "analyst.risks.fallback.marginEstimate", params: { pct: pctOf(m.grossMargin)! } });
  if (m.observationCount < FALLBACK_SHORT_HISTORY_DAYS) out.push({ key: "analyst.risks.fallback.shortHistory", params: { n: m.observationCount } });
  if (m.adsObserved < FALLBACK_FEW_ADS) out.push({ key: "analyst.risks.fallback.fewAds", params: { n: m.adsObserved } });
  if (m.trendGrowth == null) out.push({ key: "analyst.risks.fallback.trendUnknown" });
  if (p.source.kind === "demo") out.push({ key: "analyst.risks.fallback.demo" });
  return [{ key: "analyst.risks.fallback.none" }, ...out.slice(0, 4)];
}
function anglesFor(p: ProductWithMetrics): AnalystSection {
  const tag = p.tags[0] ?? p.category;
  const tag2 = p.tags[1] ?? tag;
  return {
    title: { key: "analyst.angles.title", params: { name: p.name } },
    items: [
      { key: "analyst.angles.problem", params: { tag } },
      { key: "analyst.angles.demo", params: { name: p.name } },
      { key: "analyst.angles.oldWay", params: { tag: tag2 } },
      { key: "analyst.angles.routine", params: { tag } },
      { key: "analyst.angles.gift", params: { name: p.name } },
      { key: "analyst.angles.proofNote" },
    ],
  };
}

const CHECKLIST: Text[] = [
  "analyst.checklist.sample",
  "analyst.checklist.unitEconomics",
  "analyst.checklist.legal",
  "analyst.checklist.shippingPolicy",
  "analyst.checklist.productPage",
  "analyst.checklist.payments",
  "analyst.checklist.tracking",
  "analyst.checklist.creatives",
  "analyst.checklist.testBudget",
  "analyst.checklist.kpis",
  "analyst.checklist.support",
].map((key) => ({ key }));

const GENERIC_RISKS: Text[] = ["analyst.risks.supplier", "analyst.risks.ip", "analyst.risks.adPolicy", "analyst.risks.returns", "analyst.risks.saturation", "analyst.risks.compliance"].map((key) => ({ key }));

/** Why a record is offered as a candidate (mirrors the ranking of `pickCandidates`). */
function suggestionReason(p: ProductWithMetrics, cats: Category[]): Text {
  return cats.length ? { key: "analyst.suggest.reasonCategory", params: { score: p.score.overall ?? 0, category: p.category } } : { key: "analyst.suggest.reason", params: { score: p.score.overall ?? 0 } };
}

export function rulesAnalyst(question: string, productIds: string[], all: ProductWithMetrics[]): AnalystResponse {
  const intent = detectIntent(question, productIds);
  const selected = productIds.map((id) => all.find((p) => p.id === id)).filter((p): p is ProductWithMetrics => Boolean(p));
  const cats = detectCategories(question);
  const sources = (ps: ProductWithMetrics[]) => ps.map((p) => ({ label: p.name, href: `/app/products/${p.id}` }));
  const base = { engine: "rules" as const, intent, disclaimer: { key: "analyst.disclaimer" }, notice: { key: "analyst.rulesNotice" } };
  // Without a selection, single-product answers use the top candidate and say so explicitly.
  const autoPicked = (targets: ProductWithMetrics[]): Text | undefined =>
    selected.length || !targets.length
      ? undefined
      : { key: cats.length ? "analyst.context.autoPickedCategory" : "analyst.context.autoPicked", params: { names: targets.map((p) => p.name).join(", "), categories: cats.join(", ") } };

  if (intent === "compare" && selected.length < COMPARE_MIN) {
    // Never compare records the user did not choose: ask for a selection and offer candidates, with the reason for each.
    const picks = pickCandidates(all, cats, question)
      .filter((p) => !selected.some((s) => s.id === p.id))
      .slice(0, 3);
    return {
      engine: "rules",
      intent,
      summary: selected.length
        ? { key: "analyst.summary.compareNeedsMore", params: { name: selected[0].name, min: COMPARE_MIN, max: COMPARE_MAX } }
        : { key: "analyst.summary.compareNeedsProducts", params: { min: COMPARE_MIN, max: COMPARE_MAX } },
      recommendations: [],
      sections: [],
      sources: [],
      disclaimer: base.disclaimer,
      needsProducts: { min: COMPARE_MIN, max: COMPARE_MAX, selected: selected.length },
      suggestions: picks.map((p) => ({ id: p.id, name: p.name, score: p.score.overall, reason: suggestionReason(p, cats) })),
    };
  }
  if (intent === "checklist") {
    return { ...base, summary: { key: "analyst.summary.checklist" }, recommendations: selected.map(recommendation), sections: [{ title: { key: "analyst.checklist.title" }, items: CHECKLIST }], sources: sources(selected) };
  }
  if (intent === "angles") {
    const targets = selected.length ? selected : pickCandidates(all, cats, question).slice(0, 1);
    return {
      ...base,
      summary: targets.length ? { key: "analyst.summary.angles", params: { n: targets.length } } : { key: "analyst.summary.findNone" },
      contextNote: autoPicked(targets),
      recommendations: [],
      sections: targets.map(anglesFor),
      sources: sources(targets),
    };
  }
  if (intent === "risks") {
    const targets = selected.length ? selected : pickCandidates(all, cats, question).slice(0, 3);
    return {
      ...base,
      summary: { key: "analyst.summary.risks" },
      contextNote: autoPicked(targets),
      recommendations: targets.map(recommendation),
      sections: [{ title: { key: "analyst.risks.title" }, items: GENERIC_RISKS }],
      sources: sources(targets),
    };
  }
  if (intent === "compare" || intent === "analyze") {
    // "compare" reaches this point only with at least COMPARE_MIN selected records.
    const targets = selected.length ? selected : pickCandidates(all, cats, question).slice(0, 1);
    const ranked = [...targets].sort((a, b) => (b.score.overall ?? -1) - (a.score.overall ?? -1));
    const summary: Text =
      intent === "compare"
        ? ranked[0].score.overall == null
          ? { key: "analyst.summary.compareInsufficient" }
          : { key: "analyst.summary.compare", params: { best: ranked[0].name, score: ranked[0].score.overall, n: ranked.length } }
        : ranked.length
          ? { key: "analyst.summary.analyze", params: { name: ranked[0].name } }
          : { key: "analyst.summary.findNone" };
    return { ...base, summary, contextNote: autoPicked(ranked), recommendations: ranked.map(recommendation), sections: [], sources: sources(ranked) };
  }
  // find
  const candidates = pickCandidates(all, cats, question).slice(0, 5);
  return {
    ...base,
    summary: candidates.length
      ? { key: cats.length ? "analyst.summary.findCategory" : "analyst.summary.find", params: { n: candidates.length, categories: cats.join(", ") } }
      : { key: "analyst.summary.findNone" },
    recommendations: candidates.map(recommendation),
    sections: [],
    sources: sources(candidates),
  };
}

export function pickCandidates(all: ProductWithMetrics[], cats: Category[], question: string): ProductWithMetrics[] {
  const moderate = wantsModerateCompetition(question);
  return all
    .filter((p) => p.score.overall != null)
    .filter((p) => !cats.length || cats.includes(p.category))
    .filter((p) => !moderate || p.metrics.competition !== "high")
    .sort((a, b) => {
      const ta = (a.metrics.trendGrowth ?? 0) > 0 ? 5 : 0;
      const tb = (b.metrics.trendGrowth ?? 0) > 0 ? 5 : 0;
      return (b.score.overall as number) + tb - ((a.score.overall as number) + ta);
    });
}
