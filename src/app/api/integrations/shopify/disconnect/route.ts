import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { getSession } from "@/lib/server/session";
import { supabaseAdmin } from "@/lib/server/supabase";

/** Disconnects one store. Always allowed (also after a downgrade) so users can delete their data. */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "shopify-disconnect", 20);
  if (blocked) return blocked;
  const session = await getSession();
  if (!session.authenticated || session.mode !== "live") return apiError(401, "unauthenticated");
  const body = await parseBody(req, z.object({ id: z.uuid() }));
  if (!body.ok) return body.res;
  const db = supabaseAdmin();
  if (!db) return apiError(503, "database_unavailable");
  // Scoped to the caller: a user can only delete their own connection (cascades to synced data).
  const { error } = await db.from("connected_integrations").delete().eq("id", body.data.id).eq("user_id", session.id);
  if (error) return apiError(500, "database_unavailable");
  return json({ ok: true });
}
