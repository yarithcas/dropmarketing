import type { NextRequest } from "next/server";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { accountContext } from "@/lib/server/roles";
import { findInvitation, isInviteExpired } from "@/lib/server/team";
import { inviteTokenSchema, maskEmail, normalizeEmail, type InviteLookup } from "@/lib/team";

/** What an invitation link is for, shown to the signed-in recipient before accepting. Token in the body, not the URL. */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "invite-lookup", 30);
  if (blocked) return blocked;
  const c = await accountContext();
  if (c.res) return c.res;
  const { session, db } = c;
  const body = await parseBody(req, inviteTokenSchema);
  if (!body.ok) return apiError(404, "invite_invalid");
  const inv = await findInvitation(db, body.data.token);
  if (!inv) return apiError(404, "invite_invalid");
  const [{ data: org }, { data: inviter }] = await Promise.all([
    db.from("organizations").select("name").eq("id", inv.organization_id).maybeSingle(),
    inv.invited_by ? db.from("profiles").select("name").eq("user_id", inv.invited_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!org) return apiError(404, "invite_invalid");
  const matches = normalizeEmail(session.user?.email ?? "") === inv.email;
  const member = session.workspaces.some((w) => w.id === inv.organization_id);
  const status: InviteLookup["status"] = member
    ? "already_member"
    : inv.accepted_at
      ? "accepted"
      : isInviteExpired(inv.expires_at)
        ? "expired"
        : matches
          ? "valid"
          : "email_mismatch";
  const out: InviteLookup = {
    workspace: org.name as string,
    invitedBy: (inviter?.name as string | null | undefined) ?? null,
    role: inv.role,
    expiresAt: inv.expires_at,
    status,
    email: matches ? inv.email : maskEmail(inv.email),
    ...(member ? { organizationId: inv.organization_id } : {}),
  };
  return json(out);
}
