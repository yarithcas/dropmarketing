import type { NextRequest } from "next/server";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { setActiveWorkspace } from "@/lib/server/roles";
import { getSession } from "@/lib/server/session";
import { switchWorkspaceSchema } from "@/lib/team";

/** Sets the active workspace after checking the membership (the cookie is re-validated on every request anyway). */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "workspace-switch", 60);
  if (blocked) return blocked;
  const session = await getSession();
  if (session.mode !== "live") return apiError(400, "demo_mode");
  if (!session.authenticated) return apiError(401, "unauthenticated");
  const body = await parseBody(req, switchWorkspaceSchema);
  if (!body.ok) return body.res;
  if (!session.workspaces.some((w) => w.id === body.data.organizationId)) return apiError(404, "not_found");
  const res = json({ ok: true });
  setActiveWorkspace(res, req, body.data.organizationId);
  return res;
}
