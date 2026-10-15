import type { NextRequest } from "next/server";
import { apiError, json, limitOr429 } from "@/lib/server/api";
import { CONNECTORS } from "@/lib/connectors/registry";
import { features } from "@/lib/server/env";
import { currentFailures, evaluationStatus, isScheduledConnector, type AlertRunRow, type ConnectorRunRow, type MonitoringStatus } from "@/lib/monitoring";
import { getSession } from "@/lib/server/session";
import { supabaseAdmin, supabaseForRequest } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/**
 * Real monitoring status, never inferred: data ingestion (connector syncs that
 * stored records, platform-wide) is reported separately from rule evaluation
 * (this user's own scheduled runs). Connector errors are reduced to categories.
 */
export async function GET(req: NextRequest) {
  const limited = limitOr429(req, "alerts-status", 60);
  if (limited) return limited;
  const session = await getSession();
  if (session.mode === "live" && !session.authenticated) return apiError(401, "unauthenticated");
  const f = features();
  const status: MonitoringStatus = {
    mode: session.mode,
    scheduler: f.cron,
    email: f.email,
    connectors: CONNECTORS.filter((c) => isScheduledConnector(c.id) && c.configured()).map((c) => c.id),
    lastIngestion: null,
    lastEvaluation: null,
    lastSuccessfulEvaluation: null,
    failures: [],
  };
  const db = session.mode === "live" ? supabaseAdmin() : null;
  const sb = db ? await supabaseForRequest() : null;
  if (db && sb) {
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const runCols = "started_at, finished_at, status, message, rules, matches, data_as_of";
    // Platform research connectors only: merchants' own Shopify syncs are private to each merchant.
    const research = CONNECTORS.filter((c) => isScheduledConnector(c.id)).map((c) => c.id);
    const [ingested, recent, latest, succeeded] = await Promise.all([
      db.from("connector_runs").select("connector, started_at, finished_at, records").in("connector", research).eq("status", "success").gt("records", 0).order("started_at", { ascending: false }).limit(1),
      db.from("connector_runs").select("connector, status, started_at, error").in("connector", research).gte("started_at", since).order("started_at", { ascending: false }).limit(200),
      // The user's own rows (RLS: alert_runs are readable by their owner only).
      sb.from("alert_runs").select(runCols).eq("user_id", session.id).eq("origin", "scheduled").order("started_at", { ascending: false }).limit(1),
      sb.from("alert_runs").select(runCols).eq("user_id", session.id).eq("origin", "scheduled").eq("status", "success").order("started_at", { ascending: false }).limit(1),
    ]);
    const ing = ingested.data?.[0];
    if (ing) status.lastIngestion = { at: ing.finished_at ?? ing.started_at, connector: ing.connector, records: ing.records };
    status.failures = currentFailures((recent.data ?? []) as ConnectorRunRow[]).slice(0, 5);
    const last = latest.data?.[0] as AlertRunRow | undefined;
    if (last) status.lastEvaluation = evaluationStatus(last, new Date());
    const ok = succeeded.data?.[0];
    if (ok) status.lastSuccessfulEvaluation = { at: ok.finished_at ?? ok.started_at, dataAsOf: ok.data_as_of ?? null };
  }
  return json(status);
}
