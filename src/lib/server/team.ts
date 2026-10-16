import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlan, PLAN_IDS, type PlanId } from "../plans";
import { INVITE_TTL_DAYS, isOrgRole, seatUsage, type InviteRole, type OrgRole, type TeamInvitation } from "../team";
import { DEFAULT_LOCALE, type Locale } from "../i18n/config";
import { hashInviteToken, isInviteExpired } from "./invite-token";
import { sendEmail } from "./email";
import { env } from "./env";
import { serverT } from "./messages";
import { stripe } from "./stripe";

/** Team management on the service-role client. Every caller checks roles first (see roles.ts). */

export interface DirectoryEntry {
  organizationId: string;
  userId: string;
  role: OrgRole;
  name: string | null;
  email: string | null;
  joinedAt: string;
}

/** Members of the given workspaces with their profile name and sign-in email. */
export async function memberDirectory(db: SupabaseClient, organizationIds: string[]): Promise<DirectoryEntry[]> {
  if (!organizationIds.length) return [];
  const { data, error } = await db.rpc("org_member_directory", { orgs: organizationIds });
  if (error) throw error;
  type Row = { organization_id: string; user_id: string; role: string; name: string | null; email: string | null; joined_at: string };
  return ((data ?? []) as Row[]).map((r) => ({
    organizationId: r.organization_id,
    userId: r.user_id,
    role: isOrgRole(r.role) ? r.role : "member",
    name: r.name,
    email: r.email,
    joinedAt: r.joined_at,
  }));
}

/** Workspaces paid for by a billing organization, itself included. */
export async function billedWorkspaceIds(db: SupabaseClient, billingOrganizationId: string): Promise<string[]> {
  const { data, error } = await db.from("organizations").select("id").or(`id.eq.${billingOrganizationId},billing_organization_id.eq.${billingOrganizationId}`);
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

export async function billingOrganizationOf(db: SupabaseClient, organizationId: string): Promise<string> {
  const { data } = await db.from("organizations").select("billing_organization_id").eq("id", organizationId).maybeSingle();
  return (data?.billing_organization_id as string | null) ?? organizationId;
}

/** Active plan of a billing organization (best active or trialing subscription). */
export async function planOf(db: SupabaseClient, billingOrganizationId: string): Promise<PlanId> {
  const { data } = await db.from("subscriptions").select("plan, status").eq("organization_id", billingOrganizationId);
  const active = (data ?? []).filter((s) => (s.status === "active" || s.status === "trialing") && isPlan(s.plan)).map((s) => s.plan as PlanId);
  return active.sort((a, b) => PLAN_IDS.indexOf(b) - PLAN_IDS.indexOf(a))[0] ?? "free";
}

export interface SeatState {
  used: number;
  directory: DirectoryEntry[];
  /** Emails of open (unexpired) invitations across the billed workspaces. */
  pending: string[];
}

/** Seats of a billing organization: distinct members of its workspaces + open invitations for non-members. */
export async function seatState(db: SupabaseClient, billingOrganizationId: string): Promise<SeatState> {
  const ids = await billedWorkspaceIds(db, billingOrganizationId);
  const [directory, invites] = await Promise.all([
    memberDirectory(db, ids),
    db.from("organization_invitations").select("email").in("organization_id", ids).is("accepted_at", null).gt("expires_at", new Date().toISOString()),
  ]);
  if (invites.error) throw invites.error;
  const pending = (invites.data ?? []).map((i) => i.email as string);
  return { used: seatUsage(directory, pending), directory, pending };
}

// ---------------------------------------------------------------------------
// Invitations: the raw token only exists in the link handed to the inviter.
// ---------------------------------------------------------------------------
export { hashInviteToken, isInviteExpired, newInviteToken } from "./invite-token";

export const inviteLink = (token: string) => `${env.appUrl}/app/invite?token=${encodeURIComponent(token)}`;

export const INVITATION_FIELDS = "id, email, role, created_at, expires_at";

export interface StoredInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: InviteRole;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
}

/** Looks an invitation up by the hash of the token from the link. */
export async function findInvitation(db: SupabaseClient, token: string): Promise<StoredInvitation | null> {
  const { data } = await db
    .from("organization_invitations")
    .select("id, organization_id, email, role, invited_by, expires_at, accepted_at, accepted_by")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();
  return (data as StoredInvitation | null) ?? null;
}

export function toInvitation(r: Record<string, unknown>, now = Date.now()): TeamInvitation {
  return {
    id: r.id as string,
    email: r.email as string,
    role: r.role as InviteRole,
    createdAt: r.created_at as string,
    expiresAt: r.expires_at as string,
    expired: isInviteExpired(r.expires_at as string, now),
  };
}

/** Sends the invitation in the inviter's interface language. Returns false when email is not configured or fails. */
export async function sendInviteEmail(p: { to: string; link: string; inviter: string; workspace: string; role: InviteRole; locale?: Locale }): Promise<boolean> {
  const t = serverT(p.locale ?? DEFAULT_LOCALE);
  const body = [
    t("email.inviteIntro", { inviter: p.inviter, workspace: p.workspace, role: t(`team.roles.${p.role}`) }),
    "",
    t("email.inviteSteps", { email: p.to }),
    p.link,
    "",
    t("email.inviteExpiry", { days: INVITE_TTL_DAYS }),
  ].join("\n");
  try {
    return await sendEmail(p.to, t("email.inviteSubject", { inviter: p.inviter, workspace: p.workspace }), body);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------
/**
 * Before an account is deleted: workspaces where the user is the only member are
 * deleted; where the user is the last owner, the longest-standing admin (else
 * member) becomes owner. Subscriptions of both are cancelled so the departing
 * user is never billed again; remaining members can subscribe themselves.
 */
export async function releaseMemberships(db: SupabaseClient, userId: string) {
  const { data: mine } = await db.from("organization_members").select("organization_id, role").eq("user_id", userId);
  for (const m of mine ?? []) {
    const org = m.organization_id as string;
    const { data: members } = await db.from("organization_members").select("user_id, role, created_at").eq("organization_id", org).order("created_at");
    const others = (members ?? []).filter((x) => x.user_id !== userId);
    const lastOwner = m.role === "owner" && !others.some((x) => x.role === "owner");
    if (others.length === 0 || lastOwner) {
      const { data: subs } = await db.from("subscriptions").select("stripe_subscription_id").eq("organization_id", org);
      for (const s of subs ?? []) if (s.stripe_subscription_id) await stripe()?.subscriptions.cancel(s.stripe_subscription_id as string).catch(() => {});
    }
    if (others.length === 0) await db.from("organizations").delete().eq("id", org);
    else if (lastOwner) {
      const heir = others.find((x) => x.role === "admin") ?? others[0];
      await db.from("organization_members").update({ role: "owner" }).eq("organization_id", org).eq("user_id", heir.user_id);
    }
  }
}
