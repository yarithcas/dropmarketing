import { describe, expect, it } from "vitest";
import { competitionFrom, grossMargin, normalize, scoreProduct, SCORE_WEIGHTS, trendGrowth } from "@/lib/scoring";
import { addDays } from "@/lib/dates";
import type { Product, ProductMetrics, ProductObservation } from "@/lib/types";

const asOf = "2026-10-12";
const obs = (days: number, f: (i: number) => number): ProductObservation[] =>
  Array.from({ length: days }, (_, i) => ({
    productId: "p",
    date: addDays(asOf, -(days - 1 - i)),
    adsActive: f(i),
    newAdvertisers: 0,
    storesObserved: 1,
    searchInterest: null,
    source: { connector: "test", kind: "measured", observedAt: asOf },
  }));

const product: Product = {
  id: "p",
  name: "Test",
  category: "fitness",
  description: "",
  productType: "physical",
  tags: [],
  priceEstimate: 40,
  supplierCostEstimate: 10,
  currency: "EUR",
  channels: ["meta"],
  countries: ["FR"],
  shipping: { verified: true },
  differentiation: 60,
  firstDetected: addDays(asOf, -120),
  lastDetected: asOf,
  source: { connector: "test", kind: "measured", observedAt: asOf },
  hue: 0,
};

const metrics = (o: Partial<ProductMetrics> = {}): ProductMetrics => ({
  adsObserved: 20,
  adsActive: 10,
  advertisersObserved: 6,
  storesObserved: 3,
  trendGrowth: 50,
  competition: "medium",
  saturation: 50,
  grossMargin: 0.75,
  observationCount: 120,
  ...o,
});

describe("normalize", () => {
  it("maps linearly and clamps", () => {
    expect(normalize(50, 0, 100)).toBe(50);
    expect(normalize(-10, 0, 100)).toBe(0);
    expect(normalize(200, 0, 100)).toBe(100);
    expect(normalize(0, 30, 0)).toBe(100); // inverse mapping
    expect(normalize(5, 5, 5)).toBe(0);
  });
});

describe("weights", () => {
  it("sum to 1", () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe("trendGrowth", () => {
  it("compares the mean of the window with the previous window", () => {
    const o = obs(60, (i) => (i < 30 ? 10 : 15));
    expect(trendGrowth(o, "30d", asOf)).toMatchObject({ pct: 50, status: "ok" });
  });
  it("reports insufficient history instead of inventing a number", () => {
    expect(trendGrowth(obs(40, () => 5), "30d", asOf)).toMatchObject({ pct: null, status: "insufficient_history" });
  });
  it("reports new activity when the baseline is zero", () => {
    expect(trendGrowth(obs(14, (i) => (i < 7 ? 0 : 3)), "7d", asOf)).toMatchObject({ pct: null, status: "new_activity" });
  });
});

describe("grossMargin / competition", () => {
  it("computes margin and handles missing inputs", () => {
    expect(grossMargin(40, 10)).toBe(0.75);
    expect(grossMargin(null, 10)).toBeNull();
    expect(grossMargin(0, 10)).toBeNull();
  });
  it("derives competition levels", () => {
    expect(competitionFrom(0, 0).level).toBe("low");
    expect(competitionFrom(12, 6).level).toBe("high");
  });
});

describe("scoreProduct", () => {
  const o = obs(120, (i) => (i < 90 ? 6 : 9));
  it("is the weighted mean of normalized components", () => {
    const s = scoreProduct(product, metrics(), o, asOf);
    const expected = Math.round(s.components.reduce((a, c) => a + c.weight * (c.value as number), 0));
    expect(s.overall).toBe(expected);
    expect(s.overall).toBeGreaterThan(0);
    expect(s.overall).toBeLessThanOrEqual(100);
  });
  it("re-normalizes weights when one component is missing", () => {
    const s = scoreProduct({ ...product, differentiation: null }, metrics(), o, asOf);
    const avail = s.components.filter((c) => c.value != null);
    const w = avail.reduce((a, c) => a + c.weight, 0);
    expect(s.overall).toBe(Math.round(avail.reduce((a, c) => a + c.weight * (c.value as number), 0) / w));
  });
  it("withholds the score when evidence is insufficient", () => {
    const s = scoreProduct(product, metrics({ observationCount: 5, adsObserved: 1 }), obs(5, () => 1), asOf);
    expect(s.overall).toBeNull();
    expect(s.insufficientReasons.map((r) => r.key)).toEqual(expect.arrayContaining(["insufficient.observations", "insufficient.ads"]));
  });
  it("produces explainable signals and next steps", () => {
    const s = scoreProduct(product, metrics({ grossMargin: 0.4, competition: "high" }), o, asOf);
    const neg = s.negatives.map((x) => x.key);
    expect(neg).toContain("signals.margin_thin");
    expect(neg).toContain("signals.competition_high");
    expect(s.nextSteps.map((x) => x.key)).toContain("steps.small_budget_test");
  });
});
