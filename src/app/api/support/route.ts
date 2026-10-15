import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { env, features } from "@/lib/server/env";
import { sendEmail } from "@/lib/server/email";
import { getSession } from "@/lib/server/session";
import { supabaseAdmin } from "@/lib/server/supabase";
import { PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";

const schema = z.object({
  category: z.enum(["question", "bug", "billing", "data", "other"]),
  subject: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(5000),
});

/**
 * Support requests: stored, then emailed to the support inbox. Priority comes from
 * the plan on the server (Business), never from the client.
 */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "support", 5);
  if (blocked) return blocked;
  if (!features().support) return apiError(400, "support_not_configured", "Support inbox is not configured");
  const session = await getSession();
  if (session.mode !== "live" || !session.authenticated || !session.user) return apiError(401, "unauthenticated");
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const priority = PLANS[session.plan].entitlements.prioritySupport;
  const db = supabaseAdmin()!;
  const { data: row, error } = await db
    .from("support_requests")
    .insert({ user_id: session.id, organization_id: session.organizationId, plan: session.plan, priority, ...body.data })
    .select("id")
    .single();
  if (error || !row) return apiError(500, "database_error");
  const sent = await sendEmail(
    env.supportEmail!,
    `${priority ? "[PRIORITY] " : ""}[${body.data.category}] ${body.data.subject}`,
    `From: ${session.user.name} <${session.user.email}>\nPlan: ${session.plan}\nRequest: ${row.id}\n\n${body.data.message}`,
  );
  if (sent) await db.from("support_requests").update({ emailed_at: new Date().toISOString() }).eq("id", row.id);
  return json({ id: row.id, priority, emailed: sent });
}
