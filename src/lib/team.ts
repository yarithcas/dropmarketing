import { z } from "zod";
import type { PlanId } from "./plans";

/**
 * Workspaces (organizations), member roles and invitations. Pure rules shared
 * by the API routes and the UI; the server is the only place they are enforced.
 */

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const INVITE_ROLES = ["admin", "member"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

/** httpOnly cookie holding the active workspace id (always re-checked against memberships). */
export const ACTIVE_ORG_COOKIE = "th_org";
export const INVITE_TTL_DAYS = 7;

export function isOrgRole(v: unknown): v is OrgRole {
  return typeof v === "string" && (ORG_ROLES as readonly string[]).includes(v);
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: OrgRole;
  plan: PlanId;
  /** Organization whose subscription applies: the workspace itself, or the Business owner's organization. */
  billingOrganizationId: string;
  members: number;
  joinedAt: string;
}

/** The cookie choice when it is still one of the user's memberships, else the oldest owned workspace, else the oldest one. */
export function pickActiveWorkspace<T extends { id: string; role: OrgRole; joinedAt: string }>(list: T[], preferred?: string | null): T | null {
  if (preferred) {
    const chosen = list.find((w) => w.id === preferred);
    if (chosen) return chosen;
  }
  const byAge = [...list].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  return byAge.find((w) => w.role === "owner") ?? byAge[0] ?? null;
}

export const canManageTeam = (role: OrgRole | null | undefined) => role === "owner" || role === "admin";

export type TeamRuleError = "role_required" | "owner_required" | "last_owner";

/** Owners and admins manage roles; only owners grant or withdraw the owner role; the last owner always stays. */
export function roleChangeError(p: { actor: OrgRole; target: OrgRole; next: OrgRole; owners: number }): TeamRuleError | null {
  if (!canManageTeam(p.actor)) return "role_required";
  if ((p.target === "owner" || p.next === "owner") && p.actor !== "owner") return "owner_required";
  if (p.target === "owner" && p.next !== "owner" && p.owners <= 1) return "last_owner";
  return null;
}

/** Anyone may leave (except the last owner); owners and admins remove members; only owners remove owners. */
export function removalError(p: { actor: OrgRole; target: OrgRole; owners: number; self: boolean }): TeamRuleError | null {
  if (!p.self && !canManageTeam(p.actor)) return "role_required";
  if (!p.self && p.target === "owner" && p.actor !== "owner") return "owner_required";
  if (p.target === "owner" && p.owners <= 1) return "last_owner";
  return null;
}

export type WorkspaceCreateBlock = "plan_required" | "role_required" | "limit_workspaces";

/**
 * Why no workspace can be added under a billing organization (null: allowed).
 * `limit` is the plan's workspaces entitlement, `used` counts every workspace it pays for (itself included).
 */
export function workspaceCreateBlock(p: { limit: number; used: number; canManageBilling: boolean }): WorkspaceCreateBlock | null {
  if (p.limit <= 1) return "plan_required";
  if (!p.canManageBilling) return "role_required";
  return p.used >= p.limit ? "limit_workspaces" : null;
}

/** Plans with more than one seat (Business) can invite teammates. */
export const teamPlanSeats = (seats: number) => seats > 1;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Seats used by a billing organization: distinct members across every workspace
 * it pays for, plus open invitations for addresses that are not members yet.
 */
export function seatUsage(members: { userId: string; email: string | null }[], pendingEmails: string[]): number {
  const users = new Set(members.map((m) => m.userId));
  const memberEmails = new Set(members.flatMap((m) => (m.email ? [normalizeEmail(m.email)] : [])));
  const pending = new Set(pendingEmails.map(normalizeEmail).filter((e) => !memberEmails.has(e)));
  return users.size + pending.size;
}

/** "d***@example.com": shown to a signed-in user whose address does not match the invitation. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  role: z.enum(INVITE_ROLES).default("member"),
});
export const roleSchema = z.object({ role: z.enum(ORG_ROLES) });
export const workspaceNameSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const switchWorkspaceSchema = z.object({ organizationId: z.guid() });
/** Invitation tokens are 32 random bytes in base64url. */
export const inviteTokenSchema = z.object({ token: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/) });
export const idParam = z.guid();

// ---------------------------------------------------------------------------
// API payloads
// ---------------------------------------------------------------------------
export interface TeamMember {
  userId: string;
  /** Display name from the member's profile; null when they never set one. */
  name: string | null;
  email: string | null;
  role: OrgRole;
  joinedAt: string;
  self: boolean;
  /** Roles the viewer may assign to this member (empty when they cannot change it). */
  assignableRoles: OrgRole[];
  canRemove: boolean;
}

export interface TeamInvitation {
  id: string;
  email: string;
  role: InviteRole;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

export interface TeamResponse {
  workspace: { id: string; name: string; plan: PlanId };
  role: OrgRole;
  canManage: boolean;
  /** The plan allows more than one seat (Business). */
  teamPlan: boolean;
  seats: { used: number; limit: number };
  members: TeamMember[];
  /** Open invitations (owners and admins only). */
  invitations: TeamInvitation[];
  emailConfigured: boolean;
}

export interface WorkspacesResponse {
  workspaces: (WorkspaceSummary & { active: boolean; canRename: boolean })[];
  create: { allowed: boolean; reason: "plan_required" | "role_required" | "limit_workspaces" | null; used: number; limit: number };
}

export interface InviteLookup {
  workspace: string;
  invitedBy: string | null;
  role: InviteRole;
  expiresAt: string;
  status: "valid" | "expired" | "accepted" | "email_mismatch" | "already_member";
  /** Masked unless it matches the signed-in user. */
  email: string;
  /** Only when the viewer already belongs to the workspace (to switch to it). */
  organizationId?: string;
}
