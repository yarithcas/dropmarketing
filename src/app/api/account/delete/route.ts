import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, parseBody, sameOrigin } from "@/lib/server/api";
import { DEMO_PLAN_COOKIE, DEMO_USER_COOKIE, VISITOR_COOKIE, getSession } from "@/lib/server/session";
import { supabaseAdmin, supabaseForRequest } from "@/lib/server/supabase";
import { releaseMemberships } from "@/lib/server/team";

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
  // Cancel the subscriptions the user pays for and hand over or delete their workspaces
  // (never a teammate's subscription: the user may only be a member of the active workspace).
  await releaseMemberships(db, session.id);
  await (await supabaseForRequest())?.auth.signOut();
  const { error } = await db.auth.admin.deleteUser(session.id);
  if (error) return apiError(500, "delete_failed");
  return res;
}
