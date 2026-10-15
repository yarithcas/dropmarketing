import { describe, expect, it } from "vitest";
import { allProducts, datasetForEngines, getProduct, listAds, listProducts, listStores, trendInsights, trendReport } from "@/lib/server/repository";
import { buildReport, reportCsv, reportSources } from "@/lib/server/reports";
import { evaluateRule } from "@/lib/alerts";
import { addDays } from "@/lib/dates";
import { generateDemoDataset } from "@/lib/demo/generate";
import { rulesAnalyst, detectIntent, recommendation } from "@/lib/analyst/rules";
import { extractCopyCues, rulesCreativeAnalysis } from "@/lib/analyst/creative";
import { MIN_EVIDENCE } from "@/lib/scoring";
import { MIN_AGGREGATE, coverageStart, evidenceGrowth, sampleOk } from "@/lib/trends";
import type { Advertisement } from "@/lib/types";
import { adQuerySchema, normalizeDomain, productQuerySchema, storeQuerySchema } from "@/lib/queries";
import { demoWorkspace } from "@/lib/server/seed-workspace";

const pq = (o: Record<string, unknown> = {}) => productQuerySchema.parse(o);

describe("demo dataset", () => {
  it("is deterministic and internally consistent", () => {
    const a = generateDemoDataset();
    const b = generateDemoDataset();
    expect(a.ads.length).toBe(b.ads.length);
    expect(a.ads[10]).toEqual(b.ads[10]);
    for (const p of a.products) {
      const obs = a.observations[p.id];
      const last = obs.at(-1)!;
      const active = a.ads.filter((x) => x.productId === p.id && x.firstSeen <= last.date && x.lastSeen >= last.date).length;
      expect(last.adsActive).toBe(active); // observations are derived from ads
    }
    expect(a.stores.every((s) => s.domain.endsWith(".example"))).toBe(true); // never real domains
    expect(a.products.every((p) => p.source.kind === "demo")).toBe(true);
  });
});

describe("product search", () => {
  it("applies every filter server-side", () => {
    const all = listProducts(pq({ pageSize: 100 }));
    const fit = listProducts(pq({ category: "fitness", pageSize: 100 }));
    expect(fit.items.every((p) => p.category === "fitness")).toBe(true);
    expect(fit.total).toBeLessThan(all.total);
    expect(listProducts(pq({ priceMin: 40, pageSize: 100 })).items.every((p) => (p.priceEstimate ?? 0) >= 40)).toBe(true);
    expect(listProducts(pq({ marginMin: 80, pageSize: 100 })).items.every((p) => (p.metrics.grossMargin ?? 0) * 100 >= 80)).toBe(true);
    expect(listProducts(pq({ competition: "low", pageSize: 100 })).items.every((p) => p.metrics.competition === "low")).toBe(true);
    expect(listProducts(pq({ platform: "tiktok", pageSize: 100 })).items.every((p) => p.channels.includes("tiktok"))).toBe(true);
    expect(listProducts(pq({ q: "pilates", pageSize: 100 })).items.length).toBeGreaterThan(0);
  });
  it("sorts by each documented criterion", () => {
    const byScore = listProducts(pq({ sort: "score", pageSize: 100 })).items.map((p) => p.score.overall).filter((x) => x != null) as number[];
    expect(byScore).toEqual([...byScore].sort((a, b) => b - a));
    const newest = listProducts(pq({ sort: "newest", pageSize: 100 })).items.map((p) => p.firstDetected);
    expect(newest).toEqual([...newest].sort().reverse());
    const comp = listProducts(pq({ sort: "competition", pageSize: 100 })).items.map((p) => p.metrics.saturation);
    expect(comp).toEqual([...comp].sort((a, b) => a - b));
  });
  it("paginates", () => {
    const p1 = listProducts(pq({ pageSize: 10, page: 1 }));
    const p2 = listProducts(pq({ pageSize: 10, page: 2 }));
    expect(p1.items[0].id).not.toBe(p2.items[0].id);
    expect(p1.total).toBe(allProducts().length);
  });
  it("returns product detail with history, ads and stores", () => {
    const d = getProduct("smart-jump-rope-with-counter")!;
    expect(d.observations.length).toBeGreaterThan(30);
    expect(d.ads.length).toBe(d.product.metrics.adsObserved);
    expect(Object.keys(d.trends)).toEqual(["24h", "7d", "30d", "90d"]);
  });
});

describe("ads and stores", () => {
  it("filters ads", () => {
    const r = listAds(adQuerySchema.parse({ platform: "meta", format: "video", pageSize: 100 }));
    expect(r.items.every((a) => a.platform === "meta" && a.format === "video")).toBe(true);
    expect(r.items.every((a) => !("impressions" in a) && !("spend" in a))).toBe(true); // no fabricated metrics
  });
  it("finds stores by pasted URL", () => {
    const s = datasetForEngines().stores[0];
    const r = listStores(storeQuerySchema.parse({ q: `https://www.${s.domain}/collections/all` }));
    expect(r.items.map((x) => x.id)).toContain(s.id);
    expect(normalizeDomain("HTTPS://WWW.Shop.com/x")).toBe("shop.com");
  });
});

describe("trends", () => {
  it("only reports growth when history is sufficient", () => {
    const t = trendReport("90d");
    expect(t.trending.every((p) => p.trend.status === "ok")).toBe(true);
    expect(t.insufficient).toBeGreaterThan(0);
  });
  it("withholds category and country growth when the previous window starts before the observed history", () => {
    const d = datasetForEngines();
    expect(coverageStart(d.observations)).toBe("2026-04-24");
    const t = trendReport("90d");
    expect(t.coverageStart).toBe("2026-04-24");
    expect(t.countries.every((c) => c.growth == null)).toBe(true);
    expect(t.categories.every((c) => c.growth == null && c.status === "insufficient_history")).toBe(true);
  });
  it("withholds aggregate growth below the minimum sample", () => {
    expect(MIN_AGGREGATE.ads).toBeGreaterThanOrEqual(MIN_EVIDENCE.adsObserved);
    // 3 → 11 ads from a single product is not "+266.7 %".
    const be = trendReport("7d", ["baby"], ["BE"]);
    expect(be.countries[0].previous).toBeLessThan(MIN_AGGREGATE.ads);
    expect(be.countries[0]).toMatchObject({ growth: null, status: "insufficient_data" });
    expect(be.categories[0].growth).toBeNull();
    const ca = trendReport("30d", ["auto"], ["CA"]);
    expect(ca.countries[0].growth).toBeNull();
    for (const range of ["24h", "7d", "30d"] as const) {
      const t = trendReport(range);
      for (const row of [...t.categories, ...t.countries]) if (row.growth != null) expect(sampleOk(row.sample.previous)).toBe(true);
      expect(t.countries.some((c) => c.growth != null)).toBe(true);
    }
  });
  it("computes evidence-gated growth", () => {
    const big = { ads: 12, products: 4 };
    expect(evidenceGrowth(20, 10, { historyOk: true, previousSample: big, currentSample: big })).toEqual({ growth: 100, status: "ok" });
    expect(evidenceGrowth(20, 10, { historyOk: false, previousSample: big, currentSample: big }).status).toBe("insufficient_history");
    expect(evidenceGrowth(11, 3, { historyOk: true, previousSample: { ads: 3, products: 1 }, currentSample: { ads: 11, products: 1 } })).toEqual({ growth: null, status: "insufficient_data" });
    expect(evidenceGrowth(30, 20, { historyOk: true, previousSample: { ads: 20, products: 2 }, currentSample: big }).growth).toBeNull();
    expect(evidenceGrowth(15, 0, { historyOk: true, previousSample: { ads: 0, products: 0 }, currentSample: big }).status).toBe("new_activity");
    expect(evidenceGrowth(0, 0, { historyOk: true, previousSample: { ads: 0, products: 0 }, currentSample: { ads: 0, products: 0 } }).status).toBe("no_activity");
  });
  it("detects emerging niches at category and tag level within the selected range", () => {
    const t = trendInsights("30d");
    expect(t.niches.length).toBeGreaterThan(0);
    expect(t.niches.some((n) => n.kind === "category")).toBe(true);
    expect(t.niches.some((n) => n.kind === "tag")).toBe(true);
    for (const n of t.niches) {
      expect(n.newProducts.current + n.newAdvertisers.current).toBeGreaterThan(n.newProducts.previous + n.newAdvertisers.previous);
      expect(n.activeAds.current).toBeGreaterThanOrEqual(MIN_AGGREGATE.ads);
      expect(n.sources.connectors).toEqual(["demo"]);
    }
    // No observed previous window, no emergence claim.
    expect(trendInsights("90d").niches).toEqual([]);
    // New products honour the selected window.
    const w7 = trendInsights("7d");
    expect(w7.emerging.every((p) => p.firstDetected >= addDays(w7.asOf, -6))).toBe(true);
  });
  it("counts weekly product discoveries, null before the observed history", () => {
    const t = trendInsights("90d");
    const rows = t.discovery.rows;
    expect(rows.at(-1)!.date).toBe(addDays(t.asOf, -6));
    expect(rows[0].total).toBeNull();
    const counted = rows.reduce((s, r) => s + (r.total ?? 0), 0);
    const inSpan = allProducts().filter((p) => p.firstDetected >= rows.find((r) => r.total != null)!.date && p.firstDetected <= t.asOf).length;
    expect(counted).toBe(inSpan);
    expect(t.discovery.byCategory.reduce((s, c) => s + c.count, 0)).toBe(counted);
  });
  it("lists sources per entry and signal coverage from the records present", () => {
    const t = trendInsights("30d");
    for (const e of [...t.trending, ...t.declining, ...t.categories, ...t.countries.filter((c) => c.adsInRange)]) {
      expect(e.sources.connectors).toEqual(["demo"]);
      expect(e.sources.lastObserved! <= t.asOf).toBe(true);
    }
    const status = Object.fromEntries(t.signals.map((s) => [s.key, s.status]));
    expect(status).toMatchObject({ advertising_activity: "demo", search_interest: "demo", social_engagement: "not_connected", source_popularity: "not_connected" });
    expect(t.signals.some((s) => s.status === "connected")).toBe(false);
    // Demo observations carry a search-interest index, so it is shown with its source.
    expect(t.searchInterest.products).toBeGreaterThan(0);
    expect(t.trending.some((p) => p.search?.pct != null)).toBe(true);
  });
});

describe("alerts", () => {
  const d = datasetForEngines();
  const ctx = { products: allProducts(), observations: d.observations, ads: d.ads, stores: d.stores, storeProducts: d.storeProducts, asOf: d.snapshot, since: addDays(d.snapshot, -7) };
  const base = { id: "r", name: "r", frequency: "daily" as const, channels: { inApp: true, email: false }, active: true, createdAt: "" };
  it("evaluates trend thresholds", () => {
    const m = evaluateRule({ ...base, type: "trend_increase", target: {}, thresholdPct: 1 }, ctx);
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((x) => (x.params.pct as number) >= 1)).toBe(true);
  });
  it("ignores paused rules", () => {
    expect(evaluateRule({ ...base, active: false, type: "trend_increase", target: {}, thresholdPct: 1 }, ctx)).toEqual([]);
  });
});

describe("analyst engines", () => {
  it("detects intents in several languages", () => {
    expect(detectIntent("Compare ces produits", ["a", "b"])).toBe("compare");
    expect(detectIntent("¿Qué riesgos tiene?", [])).toBe("risks");
    expect(detectIntent("Launch checklist", [])).toBe("checklist");
    expect(detectIntent("Quels produits marchent en fitness ?", [])).toBe("find");
  });
  it("only recommends existing records with evidence", () => {
    const r = rulesAnalyst("Quels produits gagnent en traction dans le fitness ?", [], allProducts());
    expect(r.recommendations.length).toBeGreaterThan(0);
    const ids = new Set(allProducts().map((p) => p.id));
    expect(r.recommendations.every((x) => ids.has(x.productId) && x.evidence.length > 0)).toBe(true);
    expect(r.recommendations.every((x) => allProducts().find((p) => p.id === x.productId)!.category === "fitness")).toBe(true);
  });
  it("analyzes a creative without copying it into variations", () => {
    const ad = datasetForEngines().ads[0];
    const a = rulesCreativeAnalysis(ad, null);
    expect(a.variations.length).toBe(5);
    expect(a.variations.every((v) => typeof v !== "string")).toBe(true);
  });
  it("keeps the compare intent and asks for products instead of answering another question", () => {
    expect(detectIntent("Compare these three products.", [])).toBe("compare");
    const none = rulesAnalyst("Compare these three products.", [], allProducts());
    expect(none.intent).toBe("compare");
    expect(none.needsProducts).toEqual({ min: 2, max: 5, selected: 0 });
    expect(none.recommendations).toEqual([]);
    expect(none.summary).toMatchObject({ key: "analyst.summary.compareNeedsProducts" });
    expect(none.suggestions!.length).toBeGreaterThan(0);
    expect(none.suggestions!.every((s) => typeof s.reason !== "string" && s.reason.key.startsWith("analyst.suggest."))).toBe(true);
    const one = rulesAnalyst("Compare these three products.", ["smart-jump-rope-with-counter"], allProducts());
    expect(one.needsProducts?.selected).toBe(1);
    expect(one.suggestions!.some((s) => s.id === "smart-jump-rope-with-counter")).toBe(false);
    const ids = allProducts().filter((p) => p.score.overall != null).slice(0, 3).map((p) => p.id);
    const three = rulesAnalyst("Compare these three products.", ids, allProducts());
    expect(three.needsProducts).toBeUndefined();
    expect(three.recommendations.map((r) => r.productId).sort()).toEqual([...ids].sort());
  });
  it("says which product was used when none is selected", () => {
    const r = rulesAnalyst("Analyze this product's strengths and weaknesses.", [], allProducts());
    expect(r.intent).toBe("analyze");
    expect(r.recommendations).toHaveLength(1);
    expect(r.contextNote).toMatchObject({ key: "analyst.context.autoPicked", params: { names: r.recommendations[0].productName } });
  });
  it("always lists potential risks, with a truthful fallback", () => {
    const products = allProducts();
    expect(products.every((p) => recommendation(p).risks.length > 0)).toBe(true);
    const clean = products.filter((p) => !p.score.negatives.length);
    expect(clean.length).toBeGreaterThan(0);
    for (const p of clean) {
      const risks = recommendation(p).risks;
      expect(risks[0]).toEqual({ key: "analyst.risks.fallback.none" });
      if (!p.shipping.verified) expect(risks).toContainEqual({ key: "analyst.risks.fallback.shippingUnverified" });
    }
  });
  it("derives the value proposition from the ad's own words", () => {
    const ads = datasetForEngines().ads;
    const vps = new Set<string>();
    for (const ad of ads.slice(0, 200)) {
      const a = rulesCreativeAnalysis(ad, null);
      const vp = a.valueProposition;
      expect(typeof vp !== "string" && vp.key.startsWith("creative.value.")).toBe(true);
      vps.add(JSON.stringify(vp));
      // Every quoted phrase comes from the headline or the copy.
      const text = `${ad.headline}\n${ad.copy}`.toLowerCase();
      for (const c of a.valueEvidence ?? []) expect(text.includes(c.quote.replace(/…$/, "").toLowerCase())).toBe(true);
      if (typeof vp !== "string") for (const v of Object.values(vp.params ?? {})) for (const q of String(v).match(/(?<=“)[^”]+(?=”)/g) ?? []) expect(text.includes(q.toLowerCase())).toBe(true);
    }
    expect(vps.size).toBeGreaterThan(10);
    const ad = ads[0];
    const plain: Advertisement = { ...ad, headline: "Our product", copy: "Available in three colours." };
    expect(rulesCreativeAnalysis(plain, null).valueProposition).toEqual({ key: "creative.value.notDeterminable" });
    expect(extractCopyCues({ ...plain, copy: "Le kit est conçu pour ranger vos câbles. Sans abonnement." }).map((c) => c.kind)).toEqual(["benefit", "offer"]);
  });
  it("says when there is no copy or no recorded format", () => {
    const ad = datasetForEngines().ads[0];
    const empty = rulesCreativeAnalysis({ ...ad, headline: "", copy: "  " }, null);
    expect(empty.noCopy).toBe(true);
    expect(empty.hook).toEqual({ key: "creative.noCopy.hook" });
    expect(empty.hookType).toBeNull();
    expect(empty.structure).toBeNull();
    expect(empty.valueProposition).toEqual({ key: "creative.noCopy.field" });
    expect(empty.triggers).toEqual([]);
    expect(rulesCreativeAnalysis({ ...ad, format: undefined as unknown as Advertisement["format"] }, null).format).toEqual({ key: "creative.formatInfo.unknown" });
    expect(rulesCreativeAnalysis({ ...ad, source: { ...ad.source, connector: "meta_ad_library", kind: "measured" } }, null).format).toEqual({ key: "creative.formatInfo.unknown" });
    expect(rulesCreativeAnalysis({ ...ad, format: "video" }, null).format).toEqual({ key: "creative.formatInfo.recorded", params: { format: "video" } });
    // Word fragments are not triggers ("organised" is not "ora", "ancora alle prese" is not "alle").
    const it_ = rulesCreativeAnalysis({ ...ad, language: "it", headline: "", copy: "Ancora alle prese con il disordine? Tutto organised." }, null);
    expect(it_.triggers).not.toContain("fomo");
    expect(it_.triggers).not.toContain("belonging");
  });
});

describe("reports", () => {
  it("lists per-connector provenance computed from the records used", () => {
    const r = buildReport("market-fitness");
    expect(r.sources).toHaveLength(1);
    const s = r.sources[0];
    expect(s).toMatchObject({ connector: "demo", kind: "demo" });
    const fitness = allProducts().filter((p) => p.category === "fitness");
    expect(s.records.products).toBe(fitness.length);
    expect(s.from).toBe(fitness.map((p) => p.firstDetected).sort()[0]);
    expect(s.to <= r.asOf).toBe(true);
  });
  it("never labels estimates or demo rows as measured in a mixed dataset", () => {
    const d = datasetForEngines();
    const p = d.products[0];
    const ad = d.ads.find((a) => a.productId === p.id)!;
    const licensed = { connector: "licensed_dataset", kind: "estimate" as const, observedAt: "2026-09-30T00:00:00Z" };
    const meta = { connector: "meta_ad_library", kind: "measured" as const, observedAt: "2026-10-10T00:00:00Z" };
    const rows = reportSources(
      {
        products: [{ ...p, source: licensed, firstDetected: "2026-06-01", lastDetected: "2026-09-30" }],
        ads: [{ ...ad, source: meta, firstSeen: "2026-08-01", lastSeen: "2026-12-31" }, ad],
        observations: [],
        stores: [],
      },
      "2026-10-12",
    );
    expect(rows.map((x) => [x.connector, x.kind, x.from, x.to])).toEqual([
      ["demo", "demo", ad.firstSeen, ad.lastSeen],
      ["licensed_dataset", "estimate", "2026-06-01", "2026-09-30"],
      ["meta_ad_library", "measured", "2026-08-01", "2026-10-12"],
    ]);
  });
  it("exports a CSV with numeric cells and neutralised text", () => {
    const r = buildReport("weekly-opportunities");
    const evil = { ...r, opportunities: [{ ...r.opportunities[0], name: "=HYPERLINK(1)", trendGrowth: -12.5 }] };
    const csv = reportCsv(evil);
    expect(csv).toContain('"opportunity","\'=HYPERLINK(1)"');
    expect(csv).toContain(",-12.5,");
    expect(csv).not.toContain("'-12.5");
    expect(csv).toContain('"source","demo","demo"');
  });
});

describe("demo workspace seed", () => {
  it("is localized and references real record ids", () => {
    const fr = demoWorkspace("fr");
    expect(fr.collections[0].name).toBe("Produits à tester");
    const ids = new Set(allProducts().map((p) => p.id));
    expect(fr.collections[0].items.every((i) => ids.has(i.refId))).toBe(true);
  });
});
