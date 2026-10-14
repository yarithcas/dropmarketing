import { json } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { supabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/** Real monitoring status: never reports a scan that did not happen. */
export async function GET() {
  const f = features();
  const db = supabaseAdmin();
  let lastSuccess: string | null = null;
  let failures: { connector: string; at: string; error: string | null }[] = [];
  if (f.cron && db) {
    const [{ data: ok }, { data: bad }] = await Promise.all([
      db.from("alert_runs").select("finished_at").eq("origin", "scheduled").eq("status", "success").order("finished_at", { ascending: false }).limit(1),
      db.from("connector_runs").select("connector, started_at, error").eq("status", "failed").order("started_at", { ascending: false }).limit(5),
    ]);
    lastSuccess = ok?.[0]?.finished_at ?? null;
    failures = (bad ?? []).map((r) => ({ connector: r.connector, at: r.started_at, error: r.error }));
  }
  return json({ scheduler: f.cron, email: f.email, lastSuccess, failures });
}
