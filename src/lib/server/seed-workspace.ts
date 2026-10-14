import "server-only";
import { allProducts, datasetForEngines } from "./repository";
import { daysBetween } from "../dates";
import type { Workspace } from "../workspace";

/** Example workspace for demo visitors, built from real demo-dataset ids. */
export function demoWorkspace(now = new Date().toISOString()): Workspace {
  const d = datasetForEngines();
  const products = allProducts();
  const scored = products.filter((p) => p.score.overall != null).sort((a, b) => (b.score.overall as number) - (a.score.overall as number));
  const item = (type: "product" | "ad" | "store", refId: string, label: string, note = "", tags: string[] = []) => ({
    id: `seed_${type}_${refId}`,
    type,
    refId,
    label,
    note,
    tags,
    addedAt: now,
  });
  const longAds = [...d.ads].sort((a, b) => daysBetween(b.firstSeen, b.lastSeen) - daysBetween(a.firstSeen, a.lastSeen));
  return {
    collections: [
      {
        id: "seed_col_test",
        name: "Products to Test",
        description: "Shortlist for small-budget validation tests.",
        kind: "standard",
        createdAt: now,
        items: scored.slice(0, 4).map((p) => item("product", p.id, p.name, "Verify supplier quote before testing.", ["test"])),
      },
      {
        id: "seed_col_fitness",
        name: "Trending Fitness Products",
        description: "Fitness products with rising observed ad activity.",
        kind: "standard",
        createdAt: now,
        items: products
          .filter((p) => p.category === "fitness" && (p.metrics.trendGrowth ?? 0) > 0)
          .map((p) => item("product", p.id, p.name, "", ["fitness"])),
      },
      {
        id: "seed_col_ads",
        name: "Competitor Ad Inspiration",
        description: "Long-running creatives to study (observation length is not proof of profitability).",
        kind: "standard",
        createdAt: now,
        items: longAds.slice(0, 4).map((a) => item("ad", a.id, `${a.advertiser} — ${a.headline}`, "", ["inspiration"])),
      },
      {
        id: "seed_col_margin",
        name: "High-Margin Opportunities",
        description: "Estimated gross margin ≥ 75% (estimates, not supplier quotes).",
        kind: "standard",
        createdAt: now,
        items: products
          .filter((p) => (p.metrics.grossMargin ?? 0) >= 0.75 && p.score.overall != null)
          .slice(0, 6)
          .map((p) => item("product", p.id, p.name, "", ["margin"])),
      },
      {
        id: "seed_col_swipe",
        name: "Swipe file",
        description: "",
        kind: "swipe",
        createdAt: now,
        items: longAds.slice(4, 6).map((a) => item("ad", a.id, `${a.advertiser} — ${a.headline}`)),
      },
    ],
    watchlist: [
      ...scored.slice(0, 2).map((p) => ({ id: `seed_w_${p.id}`, type: "product" as const, refId: p.id, label: p.name, addedAt: now })),
      ...d.stores.slice(0, 1).map((s) => ({ id: `seed_w_${s.id}`, type: "store" as const, refId: s.id, label: s.name, addedAt: now })),
    ],
    alertRules: [
      {
        id: "seed_rule_fitness",
        name: "Fitness trend +30%",
        type: "trend_increase",
        target: { category: "fitness" },
        thresholdPct: 30,
        frequency: "daily",
        channels: { inApp: true, email: false },
        active: true,
        createdAt: now,
      },
      {
        id: "seed_rule_summary",
        name: "Daily opportunities summary",
        type: "daily_summary",
        target: {},
        frequency: "daily",
        channels: { inApp: true, email: false },
        active: true,
        createdAt: now,
      },
      ...d.stores.slice(0, 1).map((s) => ({
        id: "seed_rule_store",
        name: `New products at ${s.name}`,
        type: "competitor_new_products" as const,
        target: { storeId: s.id },
        frequency: "weekly" as const,
        channels: { inApp: true, email: false },
        active: false,
        createdAt: now,
      })),
    ],
    notifications: [],
    alertHistory: [],
  };
}
