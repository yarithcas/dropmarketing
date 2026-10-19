import type { NextRequest, NextResponse } from "next/server";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { teamContext, type TeamContext } from "@/lib/server/roles";
import { memberDirectory, type DirectoryEntry } from "@/lib/server/team";
import { ACTIVE_ORG_COOKIE, idParam, removalError, roleChangeError, roleSchema, type TeamRuleError } from "@/lib/team";

/** Role changes and removals in the active workspace; rules in lib/team.ts (the last owner always stays). */

type Target = { res: NextResponse } | { res?: undefined; c: TeamContext; member: DirectoryEntry; owners: number };

async function target(req: NextRequest, params: Promise<{ userId: string }>): Promise<Target> {
  const blocked = sameOrigin(req) ?? limitOr429(req, "team-write", 60);
  if (blocked) return { res: blocked };
  const userId = idParam.safeParse((await params).userId);
  if (!userId.success) return { res: apiError(404, "not_found") };
  const c = await teamContext();
  if (c.res) return { res: c.res };
  try {
    const directory = await memberDirectory(c.db, [c.workspace.id]);
    const member = directory.find((m) => m.userId === userId.data);
    if (!member) return { res: apiError(404, "not_found") };
    return { c, member, owners: directory.filter((m) => m.role === "owner").length };
  } catch {
    return { res: apiError(500, "database_error") };
  }
}

const ruleError = (code: TeamRuleError) => apiError(code === "last_owner" ? 409 : 403, code);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const t = await target(req, params);
  if (t.res) return t.res;
  const { c, member, owners } = t;
  const body = await parseBody(req, roleSchema);
  if (!body.ok) return body.res;
  if (body.data.role === member.role) return json({ ok: true });
  const denied = roleChangeError({ actor: c.workspace.role, target: member.role, next: body.data.role, owners });
  if (denied) return ruleError(denied);
  const { error } = await c.db.from("organization_members").update({ role: body.data.role }).eq("organization_id", c.workspace.id).eq("user_id", member.userId);
  if (error) return apiError(500, "database_error");
  return json({ ok: true });
}

/** Removes a member, or leaves the workspace when the target is the caller. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const t = await target(req, params);
  if (t.res) return t.res;
  const { c, member, owners } = t;
  const self = member.userId === c.session.id;
  const denied = removalError({ actor: c.workspace.role, target: member.role, owners, self });
  if (denied) return ruleError(denied);
  if (self && c.session.workspaces.length <= 1) return apiError(409, "last_workspace");
  const { error } = await c.db.from("organization_members").delete().eq("organization_id", c.workspace.id).eq("user_id", member.userId);
  if (error) return apiError(500, "database_error");
  // Their rules in this workspace stop running; their collections stay (shared ones remain readable by the team).
  await c.db.from("alerts").update({ active: false }).eq("organization_id", c.workspace.id).eq("user_id", member.userId);
  const res = json({ ok: true });
  if (self) res.cookies.delete(ACTIVE_ORG_COOKIE);
  return res;
}
