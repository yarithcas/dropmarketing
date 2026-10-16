import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { evaluateRules } from "@/lib/alerts";
import { addDays } from "@/lib/dates";
import { selectRulesForEvaluation } from "@/lib/monitoring";
import { alertContext, loadEvaluationSource, runAlertsForUser } from "@/lib/server/alert-runner";
import { ensureDataset, meta } from "@/lib/server/repository";
import { getSession } from "@/lib/server/session";
import { supabaseAdmin, supabaseForRequest } from "@/lib/server/supabase";
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
 * - Live: evaluates the user's stored rules (within the plan's rule limit) on live research data only, writes
 *   notifications and records the run. Without live data the check is recorded as skipped, never run on demo data.
 */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "alerts-eval", 10);
  if (blocked) return blocked;
  const session = await getSession();
  if (session.mode === "live" && !session.authenticated) return apiError(401, "unauthenticated");
  if (!PLANS[session.plan].entitlements.alerts) return apiError(403, "plan_required");
  if (session.mode === "demo") {
    const body = await parseBody(req, z.object({ rules: z.array(ruleSchema).max(200) }));
    if (!body.ok) return body.res;
    await ensureDataset();
    const asOf = meta().asOf;
    const since = addDays(asOf, -7);
    return json({ asOf, since, matches: evaluateRules(body.data.rules as never, alertContext(since)) });
  }
  const sb = await supabaseForRequest();
  // Runs and notifications are written with the service role, after the session check above.
  const admin = supabaseAdmin();
  if (!sb || !admin) return apiError(503, "database_unavailable");
  if (!session.organizationId) return apiError(409, "no_workspace");
  // Manual check of the active workspace's rules.
  const { data: rows, error } = await sb.from("alerts").select("*").eq("user_id", session.id).eq("organization_id", session.organizationId).eq("active", true);
  if (error) return apiError(503, "database_unavailable");
  const [own] = selectRulesForEvaluation(rows ?? [], () => session.plan).users;
  if (!own) return json({ matches: 0, status: "success", reason: null, workspace: await loadWorkspace(sb, session) }); // no active rule
  const outcome = await runAlertsForUser(admin, session.id, own.rules, "manual", await loadEvaluationSource(), { overLimit: own.overLimit });
  return json({ matches: outcome.matches, status: outcome.status, reason: outcome.reason, workspace: await loadWorkspace(sb, session) });
}
