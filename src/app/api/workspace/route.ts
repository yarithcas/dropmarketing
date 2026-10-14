import type { NextRequest } from "next/server";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { getSession } from "@/lib/server/session";
import { supabaseForRequest } from "@/lib/server/supabase";
import { applyOpDb, loadWorkspace } from "@/lib/server/workspace-db";
import { WorkspaceError, workspaceOpSchema } from "@/lib/workspace";

export const dynamic = "force-dynamic";

async function ctx() {
  const session = await getSession();
  if (session.mode !== "live") return { err: apiError(400, "demo_mode", "Demo workspaces are stored in the browser") };
  if (!session.authenticated) return { err: apiError(401, "unauthenticated") };
  const sb = await supabaseForRequest();
  if (!sb) return { err: apiError(503, "database_unavailable") };
  return { session, sb };
}

export async function GET(req: NextRequest) {
  const limited = limitOr429(req, "workspace", 120);
  if (limited) return limited;
  const c = await ctx();
  if (c.err) return c.err;
  return json(await loadWorkspace(c.sb, c.session.id));
}

export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "workspace-write", 120);
  if (blocked) return blocked;
  const c = await ctx();
  if (c.err) return c.err;
  const body = await parseBody(req, workspaceOpSchema);
  if (!body.ok) return body.res;
  try {
    await applyOpDb(c.sb, c.session, body.data);
  } catch (e) {
    if (e instanceof WorkspaceError) return apiError(e.code === "not_found" ? 404 : 409, e.code);
    return apiError(500, "database_error");
  }
  return json(await loadWorkspace(c.sb, c.session.id));
}
