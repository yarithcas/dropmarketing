import "server-only";
import { METER_LIMIT, PLANS, type MeteredFeature } from "../plans";
import type { Session } from "./session";
import { supabaseForRequest } from "./supabase";

/**
 * Usage metering for plan limits. Live mode stores usage_events in Postgres;
 * demo mode keeps per-visitor counters in process memory (reset on restart,
 * sufficient for demonstrating limits — not for billing).
 */
const memory = new Map<string, number>();

const today = () => new Date().toISOString().slice(0, 10);

export interface UsageCheck {
  allowed: boolean;
  used: number;
  limit: number;
}

export async function meter(session: Session, feature: MeteredFeature, record = true): Promise<UsageCheck> {
  const limit = PLANS[session.plan].entitlements[METER_LIMIT[feature]] as number;
  if (session.mode === "live" && session.authenticated) {
    const sb = await supabaseForRequest();
    if (sb) {
      const since = `${today()}T00:00:00Z`;
      const { count } = await sb.from("usage_events").select("id", { count: "exact", head: true }).eq("user_id", session.id).eq("feature", feature).gte("created_at", since);
      const used = count ?? 0;
      if (used >= limit) return { allowed: false, used, limit };
      if (record) await sb.from("usage_events").insert({ user_id: session.id, organization_id: session.organizationId, feature });
      return { allowed: true, used: used + (record ? 1 : 0), limit };
    }
  }
  const key = `${session.id}:${feature}:${today()}`;
  const used = memory.get(key) ?? 0;
  if (used >= limit) return { allowed: false, used, limit };
  if (record) memory.set(key, used + 1);
  return { allowed: true, used: used + (record ? 1 : 0), limit };
}

export async function usageSummary(session: Session) {
  const features: MeteredFeature[] = ["product_search", "ad_search", "ai_query"];
  const out: Record<string, UsageCheck> = {};
  for (const f of features) out[f] = await meter(session, f, false);
  return out;
}
