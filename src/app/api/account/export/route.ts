import type { NextRequest } from "next/server";
import { apiError, limitOr429 } from "@/lib/server/api";
import { getSession } from "@/lib/server/session";
import { supabaseForRequest } from "@/lib/server/supabase";
import { loadWorkspace } from "@/lib/server/workspace-db";

/** Data depends on the request and on the current (demo or live) snapshot day: never prerendered or cached. */
export const dynamic = "force-dynamic";

/** GDPR data export (live mode). Demo visitors export their browser-stored workspace client-side. */
export async function GET(req: NextRequest) {
  const limited = limitOr429(req, "export", 5);
  if (limited) return limited;
  const session = await getSession();
  if (session.mode !== "live" || !session.authenticated) return apiError(400, "demo_mode");
  const sb = (await supabaseForRequest())!;
  const [{ data: profile }, workspace, { data: usage }, { data: integrations }, { data: reports }] = await Promise.all([
    sb.from("profiles").select("*").eq("user_id", session.id).maybeSingle(),
    loadWorkspace(sb, session, { allWorkspaces: true }),
    sb.from("usage_events").select("feature, created_at").eq("user_id", session.id).order("created_at", { ascending: false }).limit(5000),
    sb.from("connected_integrations").select("provider, external_account, scopes, status, last_sync_at, created_at"),
    sb.from("reports").select("*").eq("user_id", session.id),
  ]);
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), user: session.user, plan: session.plan, profile, workspace, usage, integrations, reports }, null, 2);
  return new Response(body, { headers: { "content-type": "application/json", "cache-control": "no-store", "content-disposition": 'attachment; filename="trendhunter-export.json"' } });
}
