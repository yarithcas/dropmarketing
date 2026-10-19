import type { NextRequest } from "next/server";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { accountContext, roleIn, roleRequired } from "@/lib/server/roles";
import { canManageTeam, idParam, workspaceNameSchema } from "@/lib/team";

/** Renames a workspace (its owners and admins). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "team-write", 60);
  if (blocked) return blocked;
  const id = idParam.safeParse((await params).id);
  if (!id.success) return apiError(404, "not_found");
  const c = await accountContext();
  if (c.res) return c.res;
  const role = roleIn(c.session, id.data);
  if (!role) return apiError(404, "not_found");
  if (!canManageTeam(role)) return roleRequired();
  const body = await parseBody(req, workspaceNameSchema);
  if (!body.ok) return body.res;
  const { error } = await c.db.from("organizations").update({ name: body.data.name }).eq("id", id.data);
  if (error) return apiError(500, "database_error");
  return json({ ok: true });
}
