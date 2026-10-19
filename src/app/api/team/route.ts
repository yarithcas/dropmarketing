import type { NextRequest } from "next/server";
import { apiError, json, limitOr429 } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { teamContext } from "@/lib/server/roles";
import { INVITATION_FIELDS, memberDirectory, seatState, toInvitation } from "@/lib/server/team";
import { PLANS } from "@/lib/plans";
import { canManageTeam, ORG_ROLES, removalError, roleChangeError, teamPlanSeats, type TeamResponse } from "@/lib/team";

export const dynamic = "force-dynamic";

/** Members, open invitations and seats of the active workspace, with what the viewer may change. */
export async function GET(req: NextRequest) {
  const limited = limitOr429(req, "team", 120);
  if (limited) return limited;
  const c = await teamContext();
  if (c.res) return c.res;
  const { session, db, workspace } = c;
  const canManage = canManageTeam(workspace.role);
  try {
    const [directory, seats, invites] = await Promise.all([
      memberDirectory(db, [workspace.id]),
      seatState(db, workspace.billingOrganizationId),
      canManage
        ? db.from("organization_invitations").select(INVITATION_FIELDS).eq("organization_id", workspace.id).is("accepted_at", null).order("created_at", { ascending: false })
        : null,
    ]);
    if (invites?.error) throw invites.error;
    const owners = directory.filter((m) => m.role === "owner").length;
    const body: TeamResponse = {
      workspace: { id: workspace.id, name: workspace.name, plan: workspace.plan },
      role: workspace.role,
      canManage,
      teamPlan: teamPlanSeats(PLANS[workspace.plan].entitlements.seats),
      seats: { used: seats.used, limit: PLANS[workspace.plan].entitlements.seats },
      members: directory.map((m) => {
        const self = m.userId === session.id;
        return {
          userId: m.userId,
          name: m.name,
          email: m.email,
          role: m.role,
          joinedAt: m.joinedAt,
          self,
          assignableRoles: ORG_ROLES.filter((next) => next !== m.role && !roleChangeError({ actor: workspace.role, target: m.role, next, owners })),
          // Leaving is not possible from one's only workspace.
          canRemove: !removalError({ actor: workspace.role, target: m.role, owners, self }) && (!self || session.workspaces.length > 1),
        };
      }),
      invitations: (invites?.data ?? []).map((r) => toInvitation(r)),
      emailConfigured: features().email,
    };
    return json(body);
  } catch {
    return apiError(500, "database_error");
  }
}
