import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_ORG_COOKIE, canManageTeam, type OrgRole, type WorkspaceSummary } from "../team";
import { apiError } from "./api";
import { getSession, type Session } from "./session";
import { supabaseAdmin } from "./supabase";

/**
 * Role-based access. Roles come from the session's memberships, which are read
 * with the user's JWT on every request, so a role is never taken from the client.
 */

export const MANAGER_ROLES: readonly OrgRole[] = ["owner", "admin"];

/** The user's role in one of their workspaces, or null when they are not a member. */
export function roleIn(session: Session, organizationId: string): OrgRole | null {
  return session.workspaces.find((w) => w.id === organizationId)?.role ?? null;
}

export function activeWorkspace(session: Session): WorkspaceSummary | null {
  return session.workspaces.find((w) => w.id === session.organizationId) ?? null;
}

export const roleRequired = () => apiError(403, "role_required", "Your role in this workspace does not allow this action");

/** 403 unless the user holds one of `roles` in the active workspace. */
export function requireRole(session: Session, roles: readonly OrgRole[] = MANAGER_ROLES): NextResponse | null {
  return session.role && roles.includes(session.role) ? null : roleRequired();
}

/**
 * Billing acts on the organization that pays for the active workspace. Only its
 * owners and admins may open checkout or the customer portal.
 */
export function billingOrganization(session: Session): { ok: true; organizationId: string } | { ok: false; res: NextResponse } {
  const organizationId = session.billingOrganizationId ?? session.organizationId;
  if (!organizationId) return { ok: false, res: apiError(401, "unauthenticated") };
  if (!canManageTeam(roleIn(session, organizationId))) return { ok: false, res: roleRequired() };
  return { ok: true, organizationId };
}

export interface AccountContext {
  session: Session;
  /** Service-role client: used only after the role checks of each route. */
  db: SupabaseClient;
}
export interface TeamContext extends AccountContext {
  workspace: WorkspaceSummary;
}

/** Signed-in live user plus the service-role client for membership writes. */
export async function accountContext(): Promise<({ res?: undefined } & AccountContext) | { res: NextResponse }> {
  const session = await getSession();
  if (session.mode !== "live") return { res: apiError(400, "demo_mode", "Teams and workspaces require a configured database") };
  if (!session.authenticated) return { res: apiError(401, "unauthenticated") };
  const db = supabaseAdmin();
  if (!db) return { res: apiError(503, "not_configured", "SUPABASE_SERVICE_ROLE_KEY is required for team management") };
  return { session, db };
}

/** Same, for routes that act on the active workspace. */
export async function teamContext(): Promise<({ res?: undefined } & TeamContext) | { res: NextResponse }> {
  const c = await accountContext();
  if (c.res) return c;
  const workspace = activeWorkspace(c.session);
  if (!workspace) return { res: apiError(409, "no_workspace") };
  return { ...c, workspace };
}

/** Stores the active workspace. Callers must have checked the membership first. */
export function setActiveWorkspace(res: NextResponse, req: NextRequest, organizationId: string) {
  res.cookies.set(ACTIVE_ORG_COOKIE, organizationId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: req.nextUrl.protocol === "https:" });
}
