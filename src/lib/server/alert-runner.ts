import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateRules, type AlertContext } from "../alerts";
import { addDays } from "../dates";
import type { DemoDataset } from "../demo/generate";
import { errorText, liveEvaluationData, redactSecrets, type EvaluationData, type EvaluationSkipReason, type RunReason } from "../monitoring";
import { allProducts, datasetForEngines, ensureDataset, isLiveDb, meta } from "./repository";
import { features } from "./env";
import { loadLiveDataset } from "./supabase-repository";
import { rowToRule } from "./workspace-db";
import { sendAlertEmail } from "./email";

/** Demo snapshot context, used only by the labelled manual demo check (demo mode). Never used for live runs. */
export function alertContext(since: string): AlertContext {
  const d = datasetForEngines();
  return { products: allProducts(), observations: d.observations, ads: d.ads, stores: d.stores, storeProducts: d.storeProducts, asOf: meta().asOf, since };
}

export type EvaluationSource = { data: EvaluationData } | { skipped: EvaluationSkipReason };

/**
 * Research data for live rule evaluation: the database snapshot without demo-seeded rows.
 * - `dataset`: a snapshot the caller just loaded (the scan, right after ingestion and scoring)
 * - `db`: read the database now with this service-role client (scheduled runs)
 * - otherwise: the per-instance snapshot, (re)loaded by ensureDataset() (manual checks)
 * The synthetic demo dataset is never used: without live data the run is skipped with a reason.
 */
export async function loadEvaluationSource(opts: { db?: SupabaseClient; dataset?: DemoDataset | null } = {}): Promise<EvaluationSource> {
  try {
    let d = opts.dataset ?? (opts.db ? await loadLiveDataset(opts.db) : null);
    if (!d) {
      await ensureDataset();
      // Without a loaded database snapshot the repository would fall back to the demo dataset.
      if (!isLiveDb()) return { skipped: "data_unavailable" };
      d = datasetForEngines();
    }
    const data = liveEvaluationData(d);
    return data ? { data } : { skipped: "no_live_data" };
  } catch {
    return { skipped: "data_unavailable" };
  }
}

export interface RunOutcome {
  status: "success" | "skipped" | "failed";
  reason: RunReason | null;
  rules: number;
  matches: number;
  emailsSent: number;
}

type RuleRow = Record<string, unknown> & { id: unknown };

/**
 * Evaluates one user's rules, writes notifications (and emails), and records the run as one alert_runs row
 * owned by that user. `db` must be the service-role client: callers authorize first (session check for manual
 * checks, plan entitlements for scheduled runs). Never throws; failures are recorded and returned.
 *
 * Scheduled runs pass `scheduledAt` (the scan start): rules whose scheduled turn is over — evaluated, skipped
 * for lack of real data, or over the plan's rule limit — get `last_scheduled_at`, so they are not due again
 * before their next period. A failed run stamps nothing and is retried at the next scan.
 */
export async function runAlertsForUser(
  db: SupabaseClient,
  userId: string,
  rows: RuleRow[],
  origin: "scheduled" | "manual",
  source: EvaluationSource,
  opts: { overLimit?: RuleRow[]; scheduledAt?: string } = {},
): Promise<RunOutcome> {
  const overLimit = opts.overLimit ?? [];
  const { data: run } = await db
    .from("alert_runs")
    .insert({ user_id: userId, origin, status: "running", rules: rows.length })
    .select("id")
    .single();
  const finish = async (o: RunOutcome, dataAsOf: string | null) => {
    if (run)
      await db
        .from("alert_runs")
        .update({ status: o.status, matches: o.matches, emails_sent: o.emailsSent, message: o.reason, data_as_of: dataAsOf, finished_at: new Date().toISOString() })
        .eq("id", run.id);
    return o;
  };
  /** Ends the scheduled turn of rules that were not evaluated (no real data, plan limit). */
  const endTurn = async (list: RuleRow[]) => {
    if (!opts.scheduledAt || !list.length) return;
    await db
      .from("alerts")
      .update({ last_scheduled_at: opts.scheduledAt })
      .in("id", list.map((r) => r.id as string))
      .eq("user_id", userId);
  };

  if ("skipped" in source) {
    // A database error is transient: the rules stay due. Without real data, the turn is over until next period.
    if (source.skipped === "no_live_data") await endTurn([...rows, ...overLimit]);
    return finish({ status: "skipped", reason: source.skipped, rules: rows.length, matches: 0, emailsSent: 0 }, null);
  }
  await endTurn(overLimit);
  // Every due rule is over the plan's limit: nothing is evaluated, and the history says why.
  if (!rows.length) return finish({ status: "skipped", reason: "rule_limit", rules: 0, matches: 0, emailsSent: 0 }, null);

  const data = source.data;
  let matches = 0;
  let emailsSent = 0;
  let emailsFailed = 0;
  try {
    for (const row of rows) {
      const rule = rowToRule(row);
      const since = rule.lastEvaluatedAt ? rule.lastEvaluatedAt.slice(0, 10) : addDays(data.asOf, -1);
      const found = evaluateRules([rule], { ...data, since });
      matches += found.length;
      let ids: string[] = [];
      if (found.length && rule.channels.inApp !== false) {
        const { data: inserted, error } = await db
          .from("notifications")
          .insert(found.map((m) => ({ user_id: userId, alert_id: rule.id, key: m.key, params: m.params, link: m.link, origin })))
          .select("id");
        if (error) throw error;
        ids = (inserted ?? []).map((n) => n.id as string);
      }
      if (found.length && rule.channels.email && features().email) {
        if (await sendAlertEmail(userId, rule, found, ids)) emailsSent++;
        else emailsFailed++;
      }
      const stamp = { last_evaluated_at: new Date().toISOString(), ...(opts.scheduledAt ? { last_scheduled_at: opts.scheduledAt } : {}) };
      const { error } = await db.from("alerts").update(stamp).eq("id", rule.id).eq("user_id", userId);
      if (error) throw error;
    }
  } catch (e) {
    console.error("alert evaluation failed", redactSecrets(errorText(e)));
    return finish({ status: "failed", reason: "evaluation_failed", rules: rows.length, matches, emailsSent }, data.dataAsOf);
  }
  const reason: RunReason | null = emailsFailed ? "email_failed" : overLimit.length ? "rule_limit" : null;
  return finish({ status: "success", reason, rules: rows.length, matches, emailsSent }, data.dataAsOf);
}
