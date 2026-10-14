import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, parseBody, sameOrigin } from "@/lib/server/api";
import { DEMO_PLAN_COOKIE, DEMO_USER_COOKIE, VISITOR_COOKIE, getSession } from "@/lib/server/session";
import { supabaseAdmin, supabaseForRequest } from "@/lib/server/supabase";
import { stripe } from "@/lib/server/stripe";

/** Deletes the account and all user-owned rows (FK cascades). Requires typing the confirmation word. */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req);
  if (blocked) return blocked;
  const body = await parseBody(req, z.object({ confirm: z.literal("DELETE") }));
  if (!body.ok) return body.res;
  const session = await getSession();
  const res = json({ ok: true });
  if (session.mode === "demo") {
    for (const c of [DEMO_USER_COOKIE, DEMO_PLAN_COOKIE, VISITOR_COOKIE]) res.cookies.delete(c);
    return res;
  }
  if (!session.authenticated) return apiError(401, "unauthenticated");
  const db = supabaseAdmin();
  if (!db) return apiError(503, "database_unavailable");
  // Cancel any paid subscription first so the user is not billed after deletion.
  if (session.organizationId) {
    const { data: sub } = await db.from("subscriptions").select("stripe_subscription_id").eq("organization_id", session.organizationId).maybeSingle();
    if (sub?.stripe_subscription_id) await stripe()?.subscriptions.cancel(sub.stripe_subscription_id).catch(() => {});
    const { count } = await db.from("organization_members").select("user_id", { count: "exact", head: true }).eq("organization_id", session.organizationId);
    if ((count ?? 0) <= 1) await db.from("organizations").delete().eq("id", session.organizationId);
  }
  await (await supabaseForRequest())?.auth.signOut();
  const { error } = await db.auth.admin.deleteUser(session.id);
  if (error) return apiError(500, "delete_failed");
  return res;
}
