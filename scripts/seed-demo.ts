/**
 * Loads the deterministic DEMO dataset into Supabase (every row flagged is_demo = true,
 * source_kind = "demo"). Useful to try the live (database) mode before real connectors run.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run seed:demo
 *
 * Remove later with:  delete from products where is_demo; delete from stores where is_demo;
 *                     delete from advertisements where is_demo;
 */
import { createClient } from "@supabase/supabase-js";
import { generateDemoDataset } from "../src/lib/demo/generate";
import { computeMetrics, scoreProduct } from "../src/lib/scoring";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

async function upsert(table: string, rows: Record<string, unknown>[], onConflict?: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), onConflict ? { onConflict } : undefined);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  console.log(`✓ ${table}: ${rows.length}`);
}

async function main() {
  const d = generateDemoDataset();
  await upsert(
    "products",
    d.products.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
      product_type: p.productType,
      tags: p.tags,
      price_estimate: p.priceEstimate,
      supplier_cost_estimate: p.supplierCostEstimate,
      currency: p.currency,
      channels: p.channels,
      countries: p.countries,
      shipping: p.shipping,
      differentiation: p.differentiation,
      first_detected: p.firstDetected,
      last_detected: p.lastDetected,
      source_connector: "demo",
      source_kind: "demo",
      observed_at: p.source.observedAt,
      is_demo: true,
      hue: p.hue,
    })),
  );
  await upsert(
    "stores",
    d.stores.map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain,
      description: s.description,
      categories: s.categories,
      currency: s.currency,
      product_count: s.productCount,
      socials: s.socials,
      technology: s.technology,
      country: s.country,
      first_seen: s.firstSeen,
      source_connector: "demo",
      source_kind: "demo",
      observed_at: s.source.observedAt,
      is_demo: true,
      hue: s.hue,
    })),
  );
  await upsert(
    "advertisements",
    d.ads.map((a) => ({
      id: a.id,
      connector: "demo",
      external_id: a.id,
      product_id: a.productId,
      advertiser: a.advertiser,
      platform: a.platform,
      country: a.country,
      language: a.language,
      format: a.format,
      headline: a.headline,
      copy: a.copy,
      cta: a.cta,
      landing_domain: a.landingDomain,
      landing_url: a.landingUrl,
      category: a.category,
      first_seen: a.firstSeen,
      last_seen: a.lastSeen,
      source_kind: "demo",
      observed_at: a.source.observedAt,
      is_demo: true,
      hue: a.hue,
    })),
    "connector,external_id",
  );
  await upsert(
    "store_products",
    d.storeProducts.map((sp, i) => ({
      store_id: sp.storeId,
      product_id: sp.productId,
      external_id: `demo-${i}`,
      title: sp.title,
      price: sp.price,
      currency: sp.currency,
      first_seen: sp.firstSeen,
      last_seen: d.snapshot,
    })),
    "store_id,external_id",
  );
  await upsert(
    "store_snapshots",
    Object.entries(d.storeSnapshots).flatMap(([storeId, snaps]) =>
      snaps.map((s) => ({ store_id: storeId, date: s.date, product_count: s.productCount, min_price: s.minPrice, max_price: s.maxPrice, connector: "demo", observed_at: s.source.observedAt })),
    ),
    "store_id,date",
  );
  await upsert(
    "product_observations",
    Object.values(d.observations)
      .flat()
      .map((o) => ({
        product_id: o.productId,
        date: o.date,
        ads_active: o.adsActive,
        new_advertisers: o.newAdvertisers,
        stores_observed: o.storesObserved,
        search_interest: o.searchInterest,
        source_connector: "demo",
        source_kind: "demo",
        observed_at: o.source.observedAt,
      })),
    "product_id,date,source_connector",
  );
  await upsert(
    "product_metrics",
    d.products.map((p) => {
      const obs = d.observations[p.id] ?? [];
      const m = computeMetrics(p, obs, d.ads, d.storeProducts, d.snapshot);
      const s = scoreProduct(p, m, obs, d.snapshot);
      return {
        product_id: p.id,
        as_of: d.snapshot,
        ads_observed: m.adsObserved,
        ads_active: m.adsActive,
        advertisers_observed: m.advertisersObserved,
        stores_observed: m.storesObserved,
        trend_growth_30d: m.trendGrowth,
        competition: m.competition,
        saturation: m.saturation,
        gross_margin: m.grossMargin,
        observation_count: m.observationCount,
        score: s.overall,
        confidence: s.confidence,
        score_detail: s,
      };
    }),
  );
  console.log("Demo dataset loaded (all rows flagged as demo).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
