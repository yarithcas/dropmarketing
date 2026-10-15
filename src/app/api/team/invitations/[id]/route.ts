import type { NextRequest } from "next/server";
import { apiError, json, limitOr429, sameOrigin } from "@/lib/server/api";
import { requireRole, teamContext } from "@/lib/server/roles";
import { idParam } from "@/lib/team";

/** Revokes an open invitation of the active workspace (owners and admins). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "team-write", 60);
  if (blocked) return blocked;
  const id = idParam.safeParse((await params).id);
  if (!id.success) return apiError(404, "not_found");
  const c = await teamContext();
  if (c.res) return c.res;
  const denied = requireRole(c.session);
  if (denied) return denied;
  const { data, error } = await c.db.from("organization_invitations").delete().eq("id", id.data).eq("organization_id", c.workspace.id).is("accepted_at", null).select("id");
  if (error) return apiError(500, "database_error");
  if (!data?.length) return apiError(404, "not_found");
  return json({ ok: true });
}
