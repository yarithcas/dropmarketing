import "server-only";
import { cookies } from "next/headers";
import { isPlan, PLANS, type PlanId } from "../plans";
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
  plan: PlanId;
  organizationId: string | null;
}

export async function getSession(): Promise<Session> {
  const store = await cookies();
  if (features().supabase) {
    const sb = await supabaseForRequest();
    const { data } = (await sb?.auth.getUser()) ?? { data: { user: null } };
    const user = data.user;
    if (!user) return { mode: "live", id: "anonymous", user: null, authenticated: false, plan: "free", organizationId: null };
    const { data: member } = await sb!
      .from("organization_members")
      .select("organization_id, organizations(subscriptions(plan, status))")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    type Row = { organization_id: string; organizations: { subscriptions: { plan: string; status: string }[] } | null };
    const row = member as Row | null;
    const sub = row?.organizations?.subscriptions?.find((s) => s.status === "active" || s.status === "trialing");
    return {
      mode: "live",
      id: user.id,
      user: { name: (user.user_metadata?.name as string) ?? user.email ?? "", email: user.email ?? "" },
      authenticated: true,
      plan: isPlan(sub?.plan) ? sub!.plan : "free",
      organizationId: row?.organization_id ?? null,
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
    organizationId: null,
  };
}

export function entitlementsFor(plan: PlanId) {
  return PLANS[plan].entitlements;
}
