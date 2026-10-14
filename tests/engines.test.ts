import { describe, expect, it } from "vitest";
import { allProducts, datasetForEngines, getProduct, listAds, listProducts, listStores, trendReport } from "@/lib/server/repository";
import { evaluateRule } from "@/lib/alerts";
import { addDays } from "@/lib/dates";
import { generateDemoDataset } from "@/lib/demo/generate";
import { rulesAnalyst, detectIntent } from "@/lib/analyst/rules";
import { rulesCreativeAnalysis } from "@/lib/analyst/creative";
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
});

describe("demo workspace seed", () => {
  it("is localized and references real record ids", () => {
    const fr = demoWorkspace("fr");
    expect(fr.collections[0].name).toBe("Produits à tester");
    const ids = new Set(allProducts().map((p) => p.id));
    expect(fr.collections[0].items.every((i) => ids.has(i.refId))).toBe(true);
  });
});
