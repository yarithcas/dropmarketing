import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONNECTORS } from "../connectors/registry";
import type { SyncContext } from "../connectors/types";
import { computeMetrics, scoreProduct } from "../scoring";
import { addDays } from "../dates";
import { loadLiveDataset } from "./supabase-repository";
import { runAlertsForRows } from "./alert-runner";
import { ensureDataset } from "./repository";

/**
 * Scheduled scan: connectors → daily aggregates → metrics/scores → alerts.
 * Every step is logged in connector_runs / alert_runs so the UI can show the
 * latest successful scan and any failures. Nothing is reported as successful
 * unless it actually ran.
 */
export async function runScan(db: SupabaseClient, opts: { frequency?: "hourly" | "daily" | "weekly" } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: prods } = await db.from("products").select("id, name, tags, countries").limit(500);
  const { data: storeRows } = await db.from("stores").select("domain").limit(500);
  const ctx: SyncContext = {
    keywords: Array.from(new Set((prods ?? []).map((p) => p.name as string))).slice(0, 50),
    domains: (storeRows ?? []).map((s) => s.domain as string).filter((d) => !d.endsWith(".example")),
    countries: Array.from(new Set((prods ?? []).flatMap((p) => (p.countries as string[]) ?? []))).slice(0, 10),
    since: addDays(today, -7),
  };

  const connectorResults: Record<string, string> = {};
  // Hourly runs only evaluate hourly alerts; ingestion + scoring run on the daily/weekly schedule.
  const ingest = opts.frequency !== "hourly";
  for (const c of ingest ? CONNECTORS : []) {
    if (c.id === "demo" || c.id === "shopify_admin") continue;
    const { data: run } = await db.from("connector_runs").insert({ connector: c.id, status: "running" }).select("id").single();
    try {
      const r = await c.sync(ctx);
      connectorResults[c.id] = r.status;
      if (run) await db.from("connector_runs").update({ status: r.status, records: r.records, error: r.message ?? null, finished_at: new Date().toISOString() }).eq("id", run.id);
    } catch (e) {
      connectorResults[c.id] = "failed";
      if (run) await db.from("connector_runs").update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "failed", finished_at: new Date().toISOString() }).eq("id", run.id);
    }
  }

  let productsScored = 0;
  if (ingest) productsScored = await aggregateAndScore(db, today);

  // Alerts due at this frequency.
  let q = db.from("alerts").select("*").eq("active", true);
  if (opts.frequency) q = q.eq("frequency", opts.frequency);
  const { data: rules } = await q;
  const matches = await runAlertsForRows(db, rules ?? [], "scheduled");
  return { connectors: connectorResults, products: productsScored, alerts: rules?.length ?? 0, matches: matches.length };
}

async function aggregateAndScore(db: SupabaseClient, today: string): Promise<number> {
  // Daily aggregate observations derived from ad + listing records.
  const d = await loadLiveDataset(db);
  const obsRows = d.products.map((p) => {
    const pAds = d.ads.filter((a) => a.productId === p.id);
    const before = new Set(pAds.filter((a) => a.firstSeen < today).map((a) => a.advertiser));
    return {
      product_id: p.id,
      date: today,
      ads_active: pAds.filter((a) => a.firstSeen <= today && a.lastSeen >= addDays(today, -1)).length,
      new_advertisers: new Set(pAds.filter((a) => a.firstSeen === today && !before.has(a.advertiser)).map((a) => a.advertiser)).size,
      stores_observed: new Set(d.storeProducts.filter((s) => s.productId === p.id).map((s) => s.storeId)).size,
      search_interest: null,
      source_connector: "aggregate",
      source_kind: "measured",
      observed_at: new Date().toISOString(),
    };
  });
  const realObs = obsRows.filter((_, i) => d.products[i].source.kind !== "demo");
  if (realObs.length) await db.from("product_observations").upsert(realObs, { onConflict: "product_id,date,source_connector" });

  // Recompute metrics + transparent scores.
  const fresh = await loadLiveDataset(db);
  const metricRows = fresh.products.map((p) => {
    const obs = fresh.observations[p.id] ?? [];
    const metrics = computeMetrics(p, obs, fresh.ads, fresh.storeProducts, fresh.snapshot);
    const score = scoreProduct(p, metrics, obs, fresh.snapshot);
    return {
      product_id: p.id,
      as_of: fresh.snapshot,
      ads_observed: metrics.adsObserved,
      ads_active: metrics.adsActive,
      advertisers_observed: metrics.advertisersObserved,
      stores_observed: metrics.storesObserved,
      trend_growth_30d: metrics.trendGrowth,
      competition: metrics.competition,
      saturation: metrics.saturation,
      gross_margin: metrics.grossMargin,
      observation_count: metrics.observationCount,
      score: score.overall,
      confidence: score.confidence,
      score_detail: score,
      computed_at: new Date().toISOString(),
    };
  });
  for (let i = 0; i < metricRows.length; i += 500) await db.from("product_metrics").upsert(metricRows.slice(i, i + 500));
  await ensureDataset();
  return metricRows.length;
}
