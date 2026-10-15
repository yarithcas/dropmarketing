import type { NextRequest } from "next/server";
import { apiError, json, limitOr429 } from "@/lib/server/api";
import { connectorStatus } from "@/lib/connectors/registry";
import { errorCategory, isScheduledConnector, type ErrorCategory } from "@/lib/monitoring";
import { features } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { supabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/**
 * Connector configuration + last run status. No secret values and no raw
 * provider/database messages are returned: errors are reduced to a category.
 */
export async function GET(req: NextRequest) {
  const limited = limitOr429(req, "integrations", 60);
  if (limited) return limited;
  const session = await getSession();
  if (session.mode === "live" && !session.authenticated) return apiError(401, "unauthenticated");
  const list = connectorStatus();
  const db = session.mode === "live" ? supabaseAdmin() : null;
  const runs: Record<string, { status: string; at: string; records: number; errorCategory: ErrorCategory | null }> = {};
  if (db) {
    // Platform research connectors only: merchants' own Shopify syncs are private to each merchant.
    const research = list.filter((c) => isScheduledConnector(c.id)).map((c) => c.id);
    const { data } = await db.from("connector_runs").select("connector, status, started_at, records, error").in("connector", research).order("started_at", { ascending: false }).limit(100);
    for (const r of data ?? [])
      if (!runs[r.connector]) runs[r.connector] = { status: r.status, at: r.started_at, records: r.records, errorCategory: r.status === "failed" ? (errorCategory(r.error) ?? "unknown") : null };
  }
  const f = features();
  return json({
    connectors: list.map((c) => ({ ...c, lastRun: runs[c.id] ?? null })),
    services: [
      { id: "supabase", configured: f.supabase, envVars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] },
      { id: "anthropic", configured: f.ai, envVars: ["ANTHROPIC_API_KEY"] },
      { id: "stripe", configured: f.stripe, envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO", "STRIPE_PRICE_BUSINESS"] },
      { id: "email", configured: f.email, envVars: ["RESEND_API_KEY", "EMAIL_FROM"] },
      // Scheduled jobs write with the service role: CRON_SECRET alone is not enough (features().cron requires both).
      { id: "cron", configured: f.cron, envVars: ["CRON_SECRET", "SUPABASE_SERVICE_ROLE_KEY"] },
    ],
  });
}
