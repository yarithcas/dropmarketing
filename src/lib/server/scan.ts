import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONNECTORS } from "../connectors/registry";
import type { SyncContext, SyncResult } from "../connectors/types";
import type { DemoDataset } from "../demo/generate";
import { computeMetrics, scoreProduct } from "../scoring";
import { addDays } from "../dates";
import {
  errorCategory,
  errorText,
  isRetentionDue,
  isRuleDue,
  isScheduledConnector,
  planConnectorRuns,
  plansByUser,
  redactSecrets,
  retentionCutoffs,
  selectRulesForEvaluation,
  type MembershipRow,
  type RuleRowLike,
} from "../monitoring";
import type { PlanId } from "../plans";
import { loadLiveDataset } from "./supabase-repository";
import { loadEvaluationSource, runAlertsForUser } from "./alert-runner";
import { ensureDataset } from "./repository";

/**
 * Scheduled scan, run by /api/cron/scan whenever a scheduler calls it (daily on Vercel Hobby, more often with a
 * paid plan or an external scheduler): due connectors → daily aggregates + scores (only when records were
 * ingested) → due rules of entitled users, on live data only → retention purge (once a day). Every step is
 * logged: connector_runs per sync, alert_runs per user, scan_runs per scan. Nothing is reported as successful
 * unless it ran, and rules are never evaluated on the demo dataset.
 */
export async function runScan(db: SupabaseClient, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const { data: scan } = await db.from("scan_runs").insert({ started_at: now.toISOString(), status: "running" }).select("id").single();
  const log = async (patch: Record<string, unknown>) => {
    if (scan) await db.from("scan_runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", scan.id);
  };
  try {
    const ingestion = await ingestDueConnectors(db, now);
    // Merchants' own Shopify stores (shopify_admin) are not research data and are synced per merchant by the
    // Shopify job, not here. Integration point: call syncDueShopifyIntegrations() at this step.
    // Aggregates and scores are rewritten only when records arrived: stale data is never re-dated as today's.
    const scored = ingestion.records > 0 ? await aggregateAndScore(db, today) : null;
    const evaluation = await evaluateDueRules(db, now, scored?.dataset ?? null);
    const retention = await purgeExpiredDataIfDue(db, now);
    await log({ status: "success", connectors: ingestion.connectors, records: ingestion.records, evaluation, retention });
    return { connectors: ingestion.connectors, records: ingestion.records, products: scored?.count ?? 0, evaluation, retention };
  } catch (e) {
    await log({ status: "failed", error: redactSecrets(errorText(e)) });
    throw e;
  }
}

/**
 * Syncs the connectors that are due (lib/monitoring.ts → planConnectorRuns): configured, and whose last
 * successful run is at least one `syncFrequency` period old. Unconfigured connectors are not called.
 */
async function ingestDueConnectors(db: SupabaseClient, now: Date) {
  const candidates = CONNECTORS.filter((c) => isScheduledConnector(c.id));
  const lastSuccess: Record<string, string | null> = {};
  await Promise.all(
    candidates.map(async (c) => {
      const { data, error } = await db.from("connector_runs").select("started_at").eq("connector", c.id).eq("status", "success").order("started_at", { ascending: false }).limit(1);
      if (error) throw error;
      lastSuccess[c.id] = (data?.[0]?.started_at as string | undefined) ?? null;
    }),
  );
  const decisions = planConnectorRuns(
    candidates.map((c) => ({ id: c.id, syncFrequency: c.syncFrequency, configured: c.configured() })),
    lastSuccess,
    now,
  );
  const connectors: Record<string, string> = { ...decisions };
  const due = candidates.filter((c) => decisions[c.id] === "run");
  let records = 0;
  if (!due.length) return { connectors, records };

  const ctx = await syncContext(db);
  for (const c of due) {
    const { data: run } = await db.from("connector_runs").insert({ connector: c.id, status: "running" }).select("id").single();
    let r: SyncResult;
    try {
      r = await c.sync(ctx);
    } catch (e) {
      r = { status: "failed", records: 0, message: errorText(e) };
    }
    connectors[c.id] = r.status;
    records += r.records; // a sync that failed midway may still have stored records
    if (run)
      await db
        .from("connector_runs")
        .update({ status: r.status, records: r.records, error: r.message ? redactSecrets(r.message, 500) : null, finished_at: new Date().toISOString() })
        .eq("id", run.id);
  }
  return { connectors, records };
}

async function syncContext(db: SupabaseClient): Promise<SyncContext> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: prods } = await db.from("products").select("id, name, tags, countries").limit(500);
  const { data: storeRows } = await db.from("stores").select("domain").limit(500);
  return {
    keywords: Array.from(new Set((prods ?? []).map((p) => p.name as string))).slice(0, 50),
    domains: (storeRows ?? []).map((s) => s.domain as string).filter((d) => !d.endsWith(".example")),
    countries: Array.from(new Set((prods ?? []).flatMap((p) => (p.countries as string[]) ?? []))).slice(0, 10),
    since: addDays(today, -7),
  };
}

type RuleRow = Record<string, unknown> & RuleRowLike;

async function activeRules(db: SupabaseClient): Promise<RuleRow[]> {
  const out: RuleRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("alerts").select("*").eq("active", true).order("created_at").order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as RuleRow[]));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * Current plan of each rule owner, resolved like getSession(): organization_members → organizations →
 * subscriptions (active or trialing). The one place to adapt if billing moves to another organization
 * (e.g. organizations.billing_organization_id, or the SQL function public.org_plan(org)). Users without a
 * membership are on the free plan.
 */
export async function resolveUserPlans(db: SupabaseClient, userIds: string[]): Promise<Map<string, PlanId>> {
  const rows: MembershipRow[] = [];
  for (let i = 0; i < userIds.length; i += 200) {
    const { data, error } = await db
      .from("organization_members")
      .select("user_id, created_at, organizations(subscriptions(plan, status))")
      .in("user_id", userIds.slice(i, i + 200));
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as MembershipRow[]));
  }
  return plansByUser(rows);
}

/**
 * Evaluates the rules that are due (lib/monitoring.ts → isRuleDue), one alert_runs row per user. Users whose
 * current plan excludes alerts are skipped; rules over the plan's limit are not evaluated.
 */
async function evaluateDueRules(db: SupabaseClient, now: Date, dataset: DemoDataset | null) {
  const rows = await activeRules(db);
  const plans = await resolveUserPlans(db, Array.from(new Set(rows.map((r) => r.user_id))));
  const { users, notEntitled } = selectRulesForEvaluation(rows, (u) => plans.get(u) ?? "free", (r) => isRuleDue(r, now));
  const summary = { users: users.length, notEntitled: notEntitled.length, rules: 0, overLimit: 0, matches: 0, emailsSent: 0, failedUsers: 0, skipped: null as string | null };
  if (!users.length) return summary;
  // One live snapshot per scan: the one just scored, or a fresh read. Never the demo dataset.
  const source = await loadEvaluationSource(dataset ? { dataset } : { db });
  if ("skipped" in source) summary.skipped = source.skipped;
  for (const u of users) {
    const o = await runAlertsForUser(db, u.userId, u.rules, "scheduled", source, { overLimit: u.overLimit, scheduledAt: now.toISOString() });
    summary.rules += o.rules;
    summary.overLimit += u.overLimit.length;
    summary.matches += o.matches;
    summary.emailsSent += o.emailsSent;
    if (o.status === "failed") summary.failedUsers++;
  }
  return summary;
}

/**
 * Retention purge (purge_expired_data() in supabase/migrations/0002_monitoring.sql), once a day: at the first
 * scan at least a day after the last successful purge. A failure is logged and does not fail the scan.
 */
async function purgeExpiredDataIfDue(db: SupabaseClient, now: Date) {
  const { data: last, error: readError } = await db
    .from("scan_runs")
    .select("started_at")
    .eq("retention->>status", "success")
    .order("started_at", { ascending: false })
    .limit(1);
  if (readError) return { status: "failed" as const, error: errorCategory(readError.message) };
  if (!isRetentionDue((last?.[0]?.started_at as string | undefined) ?? null, now)) return null;
  const cutoffs = retentionCutoffs(CONNECTORS, now);
  const { data, error } = await db.rpc("purge_expired_data", { cutoffs });
  if (error) return { status: "failed" as const, cutoffs, error: errorCategory(error.message) };
  return { status: "success" as const, cutoffs, deleted: data as Record<string, number> };
}

async function aggregateAndScore(db: SupabaseClient, today: string): Promise<{ count: number; dataset: DemoDataset }> {
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
  return { count: metricRows.length, dataset: fresh };
}
