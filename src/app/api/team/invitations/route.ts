import type { NextRequest } from "next/server";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { requireRole, teamContext } from "@/lib/server/roles";
import { INVITATION_FIELDS, inviteLink, newInviteToken, seatState, sendInviteEmail, toInvitation } from "@/lib/server/team";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { PLANS } from "@/lib/plans";
import { inviteSchema, normalizeEmail, seatUsage, teamPlanSeats } from "@/lib/team";

/**
 * Invites someone to the active workspace (owners and admins, Business plan).
 * The link is always returned so the inviter can share it; the email is sent
 * only when email delivery is configured.
 */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "team-invite", 20);
  if (blocked) return blocked;
  const c = await teamContext();
  if (c.res) return c.res;
  const { session, db, workspace } = c;
  const denied = requireRole(session);
  if (denied) return denied;
  const body = await parseBody(req, inviteSchema);
  if (!body.ok) return body.res;
  const limit = PLANS[workspace.plan].entitlements.seats;
  if (!teamPlanSeats(limit)) return apiError(403, "plan_required");
  const { email, role } = body.data;
  try {
    const seats = await seatState(db, workspace.billingOrganizationId);
    if (seats.directory.some((m) => m.organizationId === workspace.id && m.email && normalizeEmail(m.email) === email)) return apiError(409, "already_member");
    // Re-inviting an address (or inviting a member of another billed workspace) takes no extra seat.
    if (seatUsage(seats.directory, [...seats.pending, email]) > limit) return apiError(409, "seats_exhausted", "No seat left on this plan", { used: seats.used, limit });
    const { token, hash, expiresAt } = newInviteToken();
    // A new invitation replaces the open one for this address (the old link stops working).
    await db.from("organization_invitations").delete().eq("organization_id", workspace.id).eq("email", email).is("accepted_at", null);
    const { data, error } = await db
      .from("organization_invitations")
      .insert({ organization_id: workspace.id, email, role, token_hash: hash, invited_by: session.id, expires_at: expiresAt })
      .select(INVITATION_FIELDS)
      .single();
    if (error || !data) return apiError(500, "database_error");
    const link = inviteLink(token);
    const lang = req.cookies.get(LOCALE_COOKIE)?.value;
    const emailed = await sendInviteEmail({
      to: email,
      link,
      inviter: session.user?.name || session.user?.email || "",
      workspace: workspace.name,
      role,
      locale: isLocale(lang) ? lang : undefined,
    });
    return json({ invitation: toInvitation(data), link, emailed });
  } catch {
    return apiError(500, "database_error");
  }
}
