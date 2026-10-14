import type { NextRequest } from "next/server";
import { apiError, json, limitOr429, sameOrigin } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { supabaseForRequest } from "@/lib/server/supabase";
import { syncIntegration } from "@/lib/server/shopify";

export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "shopify-sync", 6);
  if (blocked) return blocked;
  if (!features().shopify) return apiError(400, "not_configured", "Mock mode: nothing to synchronise");
  const session = await getSession();
  if (!session.authenticated) return apiError(401, "unauthenticated");
  const sb = await supabaseForRequest();
  // RLS ensures only the caller's own integrations are visible here.
  const { data } = await sb!.from("connected_integrations").select("id").eq("provider", "shopify");
  if (!data?.length) return apiError(404, "not_connected");
  try {
    const results = [];
    for (const row of data) results.push(await syncIntegration(row.id));
    return json({ ok: true, results });
  } catch (e) {
    return apiError(502, "sync_failed", e instanceof Error ? e.message : "sync failed");
  }
}
