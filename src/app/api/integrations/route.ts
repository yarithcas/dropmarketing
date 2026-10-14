import { json } from "@/lib/server/api";
import { connectorStatus } from "@/lib/connectors/registry";
import { features } from "@/lib/server/env";
import { supabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/** Connector configuration + last run status (no secret values are returned). */
export async function GET() {
  const list = connectorStatus();
  const db = supabaseAdmin();
  const runs: Record<string, { status: string; at: string; records: number; error: string | null }> = {};
  if (db) {
    const { data } = await db.from("connector_runs").select("connector, status, started_at, records, error").order("started_at", { ascending: false }).limit(100);
    for (const r of data ?? []) if (!runs[r.connector]) runs[r.connector] = { status: r.status, at: r.started_at, records: r.records, error: r.error };
  }
  const f = features();
  return json({
    connectors: list.map((c) => ({ ...c, lastRun: runs[c.id] ?? null })),
    services: [
      { id: "supabase", configured: f.supabase, envVars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] },
      { id: "anthropic", configured: f.ai, envVars: ["ANTHROPIC_API_KEY"] },
      { id: "stripe", configured: f.stripe, envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO", "STRIPE_PRICE_BUSINESS"] },
      { id: "email", configured: f.email, envVars: ["RESEND_API_KEY", "EMAIL_FROM"] },
      { id: "cron", configured: f.cron, envVars: ["CRON_SECRET"] },
    ],
  });
}
