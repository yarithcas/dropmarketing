import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { evaluateRules } from "@/lib/alerts";
import { addDays } from "@/lib/dates";
import { alertContext, runAlertsForRows } from "@/lib/server/alert-runner";
import { ensureDataset, meta } from "@/lib/server/repository";
import { getSession } from "@/lib/server/session";
import { supabaseForRequest } from "@/lib/server/supabase";
import { loadWorkspace } from "@/lib/server/workspace-db";
import { ALERT_TYPES } from "@/lib/workspace";
import { PLANS } from "@/lib/plans";

const ruleSchema = z.object({
  id: z.string().max(120),
  name: z.string().max(160),
  type: z.enum(ALERT_TYPES),
  target: z.object({ productId: z.string().max(120).optional(), category: z.string().max(40).optional(), storeId: z.string().max(120).optional() }),
  thresholdPct: z.number().optional(),
  frequency: z.enum(["hourly", "daily", "weekly"]),
  channels: z.object({ inApp: z.boolean(), email: z.boolean() }),
  active: z.boolean(),
  createdAt: z.string(),
  lastEvaluatedAt: z.string().optional(),
});

/**
 * Manual alert check.
 * - Demo: evaluates the visitor's rules against the demo snapshot (last 7 days). Clearly labelled; no monitoring is simulated.
 * - Live: evaluates the user's stored rules now and writes notifications.
 */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "alerts-eval", 10);
  if (blocked) return blocked;
  const session = await getSession();
  await ensureDataset();
  if (!PLANS[session.plan].entitlements.alerts) return apiError(403, "plan_required");
  if (session.mode === "demo") {
    const body = await parseBody(req, z.object({ rules: z.array(ruleSchema).max(200) }));
    if (!body.ok) return body.res;
    const asOf = meta().asOf;
    const since = addDays(asOf, -7);
    return json({ asOf, since, matches: evaluateRules(body.data.rules as never, alertContext(since)) });
  }
  if (!session.authenticated) return apiError(401, "unauthenticated");
  const sb = await supabaseForRequest();
  if (!sb) return apiError(503, "database_unavailable");
  if (!session.organizationId) return apiError(409, "no_workspace");
  // Manual check of the active workspace's rules.
  const { data: rows } = await sb.from("alerts").select("*").eq("user_id", session.id).eq("organization_id", session.organizationId).eq("active", true);
  const matches = await runAlertsForRows(sb, rows ?? [], "manual");
  return json({ matches: matches.length, workspace: await loadWorkspace(sb, session) });
}
