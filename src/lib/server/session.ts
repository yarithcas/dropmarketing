import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlan, PLANS, type PlanId } from "../plans";
import { ACTIVE_ORG_COOKIE, isOrgRole, pickActiveWorkspace, type OrgRole, type WorkspaceSummary } from "../team";
import { features } from "./env";
import { supabaseForRequest } from "./supabase";

export const DEMO_PLAN_COOKIE = "th_demo_plan";
export const DEMO_USER_COOKIE = "th_demo_user";
export const VISITOR_COOKIE = "th_vid";

export interface Session {
  mode: "demo" | "live";
  /** Stable id: Supabase user id, or an anonymous visitor id in demo mode. */
  id: string;
  user: { name: string; email: string } | null;
  authenticated: boolean;
  /** Plan of the active workspace (its billing organization's subscription). */
  plan: PlanId;
  /** Active workspace (organization), validated against the user's memberships. */
  organizationId: string | null;
  /** The user's role in the active workspace. */
  role: OrgRole | null;
  /** Organization whose subscription pays for the active workspace. */
  billingOrganizationId: string | null;
  /** Every workspace the user belongs to (live mode). */
  workspaces: WorkspaceSummary[];
}

const NO_WORKSPACE = { organizationId: null, role: null, billingOrganizationId: null, workspaces: [] };

type WorkspaceRow = { organization_id: string; name: string; role: string; plan: string; billing_organization_id: string; member_count: number; joined_at: string };

/** Memberships with role and effective plan (RLS-safe RPC from migration 0004). */
async function listWorkspaces(sb: SupabaseClient, userId: string): Promise<WorkspaceSummary[]> {
  const { data, error } = await sb.rpc("my_workspaces");
  if (!error)
    return ((data ?? []) as WorkspaceRow[]).map((r) => ({
      id: r.organization_id,
      name: r.name,
      // Unknown roles get the least privilege.
      role: isOrgRole(r.role) ? r.role : "member",
      plan: isPlan(r.plan) ? r.plan : "free",
      billingOrganizationId: r.billing_organization_id,
      members: r.member_count,
      joinedAt: r.joined_at,
    }));
  // Database without migration 0004 yet: the personal workspace only, as before.
  const { data: member } = await sb
    .from("organization_members")
    .select("organization_id, role, created_at, organizations(name, subscriptions(plan, status))")
    .eq("user_id", userId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  type Row = { organization_id: string; role: string; created_at: string; organizations: { name: string; subscriptions: { plan: string; status: string }[] } | null };
  const row = member as Row | null;
  if (!row) return [];
  const sub = row.organizations?.subscriptions?.find((s) => s.status === "active" || s.status === "trialing");
  return [
    {
      id: row.organization_id,
      name: row.organizations?.name ?? "",
      role: isOrgRole(row.role) ? row.role : "member",
      plan: isPlan(sub?.plan) ? sub.plan : "free",
      billingOrganizationId: row.organization_id,
      members: 1,
      joinedAt: row.created_at,
    },
  ];
}

export async function getSession(): Promise<Session> {
  const store = await cookies();
  if (features().supabase) {
    const sb = await supabaseForRequest();
    const { data } = (await sb?.auth.getUser()) ?? { data: { user: null } };
    const user = data.user;
    if (!user) return { mode: "live", id: "anonymous", user: null, authenticated: false, plan: "free", ...NO_WORKSPACE };
    const workspaces = await listWorkspaces(sb!, user.id);
    const active = pickActiveWorkspace(workspaces, store.get(ACTIVE_ORG_COOKIE)?.value);
    return {
      mode: "live",
      id: user.id,
      user: { name: (user.user_metadata?.name as string) ?? user.email ?? "", email: user.email ?? "" },
      authenticated: true,
      plan: active?.plan ?? "free",
      organizationId: active?.id ?? null,
      role: active?.role ?? null,
      billingOrganizationId: active?.billingOrganizationId ?? null,
      workspaces,
    };
  }
  // Demo mode: no real accounts. The visitor id and the demo plan live in cookies.
  const plan = store.get(DEMO_PLAN_COOKIE)?.value;
  let user: Session["user"] = null;
  try {
    const raw = store.get(DEMO_USER_COOKIE)?.value;
    if (raw) {
      const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
      if (typeof parsed?.email === "string") user = { name: String(parsed.name ?? "").slice(0, 80), email: parsed.email.slice(0, 120) };
    }
  } catch {
    user = null;
  }
  return {
    mode: "demo",
    id: store.get(VISITOR_COOKIE)?.value ?? "visitor",
    user,
    authenticated: Boolean(user),
    plan: isPlan(plan) ? plan : "pro",
    ...NO_WORKSPACE,
  };
}

export function entitlementsFor(plan: PlanId) {
  return PLANS[plan].entitlements;
}
