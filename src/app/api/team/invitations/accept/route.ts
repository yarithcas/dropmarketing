import type { NextRequest } from "next/server";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { accountContext, setActiveWorkspace } from "@/lib/server/roles";
import { billingOrganizationOf, findInvitation, isInviteExpired, planOf, seatState } from "@/lib/server/team";
import { PLANS } from "@/lib/plans";
import { inviteTokenSchema, normalizeEmail, seatUsage, teamPlanSeats } from "@/lib/team";

/**
 * Accepts an invitation for the signed-in user whose (confirmed) email matches it,
 * creates the membership and switches to that workspace.
 */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "invite-accept", 20);
  if (blocked) return blocked;
  const c = await accountContext();
  if (c.res) return c.res;
  const { session, db } = c;
  const body = await parseBody(req, inviteTokenSchema);
  if (!body.ok) return apiError(404, "invite_invalid");
  const inv = await findInvitation(db, body.data.token);
  if (!inv || inv.accepted_at) return apiError(410, "invite_invalid");
  if (isInviteExpired(inv.expires_at)) return apiError(410, "invite_expired");
  const { data: account } = await db.auth.admin.getUserById(session.id);
  const email = account.user?.email ?? session.user?.email ?? "";
  if (normalizeEmail(email) !== inv.email) return apiError(403, "invite_email_mismatch");
  if (!account.user?.email_confirmed_at) return apiError(403, "email_unconfirmed");

  const org = inv.organization_id;
  const alreadyMember = session.workspaces.some((w) => w.id === org);
  try {
    if (!alreadyMember) {
      // The plan may have changed since the invitation was sent.
      const billing = await billingOrganizationOf(db, org);
      const limit = PLANS[await planOf(db, billing)].entitlements.seats;
      if (!teamPlanSeats(limit)) return apiError(403, "plan_required");
      const seats = await seatState(db, billing);
      if (seatUsage([...seats.directory, { userId: session.id, email }], []) > limit) return apiError(409, "seats_exhausted");
    }
    // Claim the invitation first so a link can only be used once.
    const { data: claimed } = await db
      .from("organization_invitations")
      .update({ accepted_at: new Date().toISOString(), accepted_by: session.id })
      .eq("id", inv.id)
      .is("accepted_at", null)
      .select("id");
    if (!claimed?.length) return apiError(410, "invite_invalid");
    if (!alreadyMember) {
      const { error } = await db.from("organization_members").insert({ organization_id: org, user_id: session.id, role: inv.role });
      if (error && error.code !== "23505") {
        await db.from("organization_invitations").update({ accepted_at: null, accepted_by: null }).eq("id", inv.id);
        return apiError(500, "database_error");
      }
    }
  } catch {
    return apiError(500, "database_error");
  }
  const res = json({ organizationId: org });
  setActiveWorkspace(res, req, org);
  return res;
}
