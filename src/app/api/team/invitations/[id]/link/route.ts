import type { NextRequest } from "next/server";
import { apiError, json, limitOr429, sameOrigin } from "@/lib/server/api";
import { requireRole, teamContext } from "@/lib/server/roles";
import { INVITATION_FIELDS, inviteLink, isInviteExpired, newInviteToken, seatState, toInvitation } from "@/lib/server/team";
import { PLANS } from "@/lib/plans";
import { idParam, seatUsage, teamPlanSeats } from "@/lib/team";

/**
 * Issues a new link for an open invitation (owners and admins). Only token hashes
 * are stored, so a lost link cannot be shown again: it is replaced, the previous
 * link stops working and the invitation is valid for another 7 days.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "team-write", 60);
  if (blocked) return blocked;
  const id = idParam.safeParse((await params).id);
  if (!id.success) return apiError(404, "not_found");
  const c = await teamContext();
  if (c.res) return c.res;
  const { db, workspace } = c;
  const denied = requireRole(c.session);
  if (denied) return denied;
  const limit = PLANS[workspace.plan].entitlements.seats;
  if (!teamPlanSeats(limit)) return apiError(403, "plan_required");
  try {
    const { data: current } = await db.from("organization_invitations").select("email, expires_at").eq("id", id.data).eq("organization_id", workspace.id).is("accepted_at", null).maybeSingle();
    if (!current) return apiError(404, "not_found");
    // An expired invitation no longer holds a seat: reviving it needs a free one.
    if (isInviteExpired(current.expires_at as string)) {
      const seats = await seatState(db, workspace.billingOrganizationId);
      if (seatUsage(seats.directory, [...seats.pending, current.email as string]) > limit) return apiError(409, "seats_exhausted", "No seat left on this plan", { used: seats.used, limit });
    }
    const { token, hash, expiresAt } = newInviteToken();
    const { data, error } = await db
      .from("organization_invitations")
      .update({ token_hash: hash, expires_at: expiresAt })
      .eq("id", id.data)
      .eq("organization_id", workspace.id)
      .is("accepted_at", null)
      .select(INVITATION_FIELDS);
    if (error) return apiError(500, "database_error");
    if (!data?.length) return apiError(404, "not_found");
    return json({ invitation: toInvitation(data[0]), link: inviteLink(token) });
  } catch {
    return apiError(500, "database_error");
  }
}
