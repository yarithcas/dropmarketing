import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateRules, type AlertMatch } from "../alerts";
import { addDays } from "../dates";
import { allProducts, datasetForEngines, meta } from "./repository";
import { rowToRule } from "./workspace-db";
import { sendAlertEmail } from "./email";
import type { AlertRule } from "../workspace";

export function alertContext(since: string) {
  const d = datasetForEngines();
  return { products: allProducts(), observations: d.observations, ads: d.ads, stores: d.stores, storeProducts: d.storeProducts, asOf: meta().asOf, since };
}

/** Evaluates rules and writes notifications. Used by the scheduled scan and the manual "run now" action. */
export async function runAlertsForRows(db: SupabaseClient, rows: Record<string, unknown>[], origin: "scheduled" | "manual") {
  const asOf = meta().asOf;
  const { data: run } = await db.from("alert_runs").insert({ origin, status: "running", rules: rows.length }).select("id").single();
  let matches: AlertMatch[] = [];
  try {
    for (const row of rows) {
      const rule: AlertRule = rowToRule(row);
      const since = rule.lastEvaluatedAt ? rule.lastEvaluatedAt.slice(0, 10) : addDays(asOf, -1);
      const found = evaluateRules([rule], alertContext(since));
      matches = matches.concat(found);
      if (found.length && rule.channels.inApp !== false) {
        await db.from("notifications").insert(
          found.map((m) => ({ user_id: row.user_id, alert_id: rule.id, key: m.key, params: m.params, link: m.link, origin })),
        );
      }
      if (found.length && rule.channels.email) await sendAlertEmail(db, row.user_id as string, rule, found);
      await db.from("alerts").update({ last_evaluated_at: new Date().toISOString() }).eq("id", rule.id);
    }
    if (run) await db.from("alert_runs").update({ status: "success", matches: matches.length, finished_at: new Date().toISOString() }).eq("id", run.id);
  } catch (e) {
    if (run) await db.from("alert_runs").update({ status: "failed", message: e instanceof Error ? e.message.slice(0, 500) : "failed", finished_at: new Date().toISOString() }).eq("id", run.id);
    throw e;
  }
  return matches;
}
