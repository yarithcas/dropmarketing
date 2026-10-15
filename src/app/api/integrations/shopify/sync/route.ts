import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { supabaseForRequest } from "@/lib/server/supabase";
import { storeLimit, syncErrorCode, syncIntegration, withinStoreLimit } from "@/lib/server/shopify";

const STATUS = { shopify_revoked: 409, rate_limited: 429, shopify_access_denied: 502, shopify_unavailable: 502, sync_failed: 502 } as const;

/** Syncs one of the caller's stores now. Requires a plan that includes the store. */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "shopify-sync", 6);
  if (blocked) return blocked;
  if (!features().shopify) return apiError(400, "not_configured", "Mock mode: nothing to synchronise");
  const session = await getSession();
  if (!session.authenticated) return apiError(401, "unauthenticated");
  const limit = storeLimit(session.plan);
  if (!limit) return apiError(403, "plan_required");
  const body = await parseBody(req, z.object({ id: z.uuid() }));
  if (!body.ok) return body.res;
  const sb = await supabaseForRequest();
  if (!sb) return apiError(503, "database_unavailable");
  // RLS ensures only the caller's own integrations are visible here.
  const { data } = await sb.from("connected_integrations").select("id, status, created_at").eq("provider", "shopify");
  const target = withinStoreLimit((data ?? []).map((r) => ({ id: r.id as string, status: r.status as string, createdAt: r.created_at as string })), limit).find((r) => r.id === body.data.id);
  if (!target) return apiError(404, "not_connected");
  if (target.overLimit) return apiError(403, "store_limit");
  if (target.status === "revoked") return apiError(409, "shopify_revoked");
  try {
    return json({ ok: true, result: await syncIntegration(target.id) });
  } catch (e) {
    // Only a code is returned: provider error text is never shown to the user.
    const code = syncErrorCode(e);
    return apiError(STATUS[code], code);
  }
}
