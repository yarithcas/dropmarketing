import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, parseBody, sameOrigin } from "@/lib/server/api";
import { getSession } from "@/lib/server/session";
import { supabaseAdmin } from "@/lib/server/supabase";

export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req);
  if (blocked) return blocked;
  const session = await getSession();
  if (!session.authenticated || session.mode !== "live") return apiError(401, "unauthenticated");
  const body = await parseBody(req, z.object({ id: z.uuid() }));
  if (!body.ok) return body.res;
  const db = supabaseAdmin();
  if (!db) return apiError(503, "database_unavailable");
  // Scoped to the caller: a user can only delete their own connection (cascades to synced data).
  await db.from("connected_integrations").delete().eq("id", body.data.id).eq("user_id", session.id);
  return json({ ok: true });
}
