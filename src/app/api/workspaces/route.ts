import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { accountContext, activeWorkspace, roleIn, setActiveWorkspace } from "@/lib/server/roles";
import type { Session } from "@/lib/server/session";
import { billedWorkspaceIds } from "@/lib/server/team";
import { PLANS } from "@/lib/plans";
import { canManageTeam, workspaceCreateBlock, workspaceNameSchema, type WorkspacesResponse } from "@/lib/team";

export const dynamic = "force-dynamic";

/**
 * New workspaces are billed under the organization that pays for the active one
 * (a Business owner's), within its plan's workspace limit, and only by that
 * organization's owners and admins.
 */
async function createEligibility(db: SupabaseClient, session: Session): Promise<{ create: WorkspacesResponse["create"]; billingOrganizationId: string | null }> {
  const active = activeWorkspace(session);
  if (!active) return { create: { allowed: false, reason: "role_required", used: 0, limit: 0 }, billingOrganizationId: null };
  const billing = active.billingOrganizationId;
  const limit = PLANS[active.plan].entitlements.workspaces;
  const used = (await billedWorkspaceIds(db, billing)).length;
  const reason = workspaceCreateBlock({ limit, used, canManageBilling: canManageTeam(roleIn(session, billing)) });
  return { create: { allowed: reason == null, reason, used, limit }, billingOrganizationId: billing };
}

export async function GET(req: NextRequest) {
  const limited = limitOr429(req, "workspaces", 120);
  if (limited) return limited;
  const c = await accountContext();
  if (c.res) return c.res;
  try {
    const { create } = await createEligibility(c.db, c.session);
    const body: WorkspacesResponse = {
      workspaces: c.session.workspaces.map((w) => ({ ...w, active: w.id === c.session.organizationId, canRename: canManageTeam(w.role) })),
      create,
    };
    return json(body);
  } catch {
    return apiError(500, "database_error");
  }
}

export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "workspace-create", 10);
  if (blocked) return blocked;
  const c = await accountContext();
  if (c.res) return c.res;
  const body = await parseBody(req, workspaceNameSchema);
  if (!body.ok) return body.res;
  const { db, session } = c;
  try {
    const { create: can, billingOrganizationId } = await createEligibility(db, session);
    if (!can.allowed || !billingOrganizationId) return apiError(can.reason === "limit_workspaces" ? 409 : 403, can.reason ?? "role_required");
    const { data: org, error } = await db.from("organizations").insert({ name: body.data.name, billing_organization_id: billingOrganizationId }).select("id").single();
    if (error || !org) return apiError(500, "database_error");
    const { error: memberError } = await db.from("organization_members").insert({ organization_id: org.id, user_id: session.id, role: "owner" });
    if (memberError) {
      await db.from("organizations").delete().eq("id", org.id);
      return apiError(500, "database_error");
    }
    // Its own (free) subscription row is unused while billed under the owner, and keeps billing working if that changes.
    await db.from("subscriptions").insert({ organization_id: org.id, plan: "free", status: "active" });
    const res = json({ id: org.id as string });
    setActiveWorkspace(res, req, org.id as string);
    return res;
  } catch {
    return apiError(500, "database_error");
  }
}
