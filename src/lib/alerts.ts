import type { Advertisement, ProductObservation, ProductWithMetrics, Store, StoreProduct } from "./types";
import type { AlertRule } from "./workspace";
import { trendGrowth } from "./scoring";

/** Pure alert-rule evaluation. Used by the scheduled scan job and by manual demo checks. */

export interface AlertContext {
  products: ProductWithMetrics[];
  observations: Record<string, ProductObservation[]>;
  ads: Advertisement[];
  stores: Store[];
  storeProducts: StoreProduct[];
  asOf: string;
  /** Only events strictly after this day are considered new. */
  since: string;
}

export interface AlertMatch {
  ruleId: string;
  key: string;
  params: Record<string, string | number>;
  link: string | null;
}

export const DEFAULT_TREND_THRESHOLD = 30;

export function evaluateRule(rule: AlertRule, ctx: AlertContext): AlertMatch[] {
  if (!rule.active) return [];
  const out: AlertMatch[] = [];
  const m = (key: string, params: AlertMatch["params"], link: string | null) => out.push({ ruleId: rule.id, key, params, link });

  switch (rule.type) {
    case "trend_increase": {
      const threshold = rule.thresholdPct ?? DEFAULT_TREND_THRESHOLD;
      const pool = ctx.products.filter((p) => (rule.target.productId ? p.id === rule.target.productId : rule.target.category ? p.category === rule.target.category : true));
      for (const p of pool) {
        const t = trendGrowth(ctx.observations[p.id] ?? [], "7d", ctx.asOf);
        if (t.pct != null && t.pct >= threshold) m("alerts.match.trend_increase", { name: p.name, pct: t.pct }, `/app/products/${p.id}`);
      }
      break;
    }
    case "new_advertiser": {
      if (!rule.target.productId) break;
      const ads = ctx.ads.filter((a) => a.productId === rule.target.productId);
      const before = new Set(ads.filter((a) => a.firstSeen <= ctx.since).map((a) => a.advertiser));
      const fresh = new Set(ads.filter((a) => a.firstSeen > ctx.since && a.firstSeen <= ctx.asOf && !before.has(a.advertiser)).map((a) => a.advertiser));
      const name = ctx.products.find((p) => p.id === rule.target.productId)?.name ?? rule.target.productId;
      for (const adv of fresh) m("alerts.match.new_advertiser", { advertiser: adv, name }, `/app/ads?productId=${rule.target.productId}`);
      break;
    }
    case "new_product_in_category": {
      for (const p of ctx.products)
        if ((!rule.target.category || p.category === rule.target.category) && p.firstDetected > ctx.since && p.firstDetected <= ctx.asOf)
          m("alerts.match.new_product", { name: p.name, category: p.category }, `/app/products/${p.id}`);
      break;
    }
    case "competitor_new_products": {
      if (!rule.target.storeId) break;
      const store = ctx.stores.find((s) => s.id === rule.target.storeId);
      const added = ctx.storeProducts.filter((sp) => sp.storeId === rule.target.storeId && sp.firstSeen > ctx.since && sp.firstSeen <= ctx.asOf);
      if (added.length) m("alerts.match.competitor_products", { store: store?.name ?? rule.target.storeId, n: added.length }, `/app/stores/${rule.target.storeId}`);
      break;
    }
    case "daily_summary": {
      const fresh = ctx.products
        .filter((p) => p.score.overall != null && p.lastDetected > ctx.since)
        .sort((a, b) => (b.score.overall as number) - (a.score.overall as number))
        .slice(0, 3);
      if (fresh.length) m("alerts.match.daily_summary", { n: fresh.length, top: fresh.map((p) => p.name).join(", ") }, "/app/products?sort=score");
      break;
    }
  }
  return out;
}

export function evaluateRules(rules: AlertRule[], ctx: AlertContext): AlertMatch[] {
  return rules.flatMap((r) => evaluateRule(r, ctx));
}
