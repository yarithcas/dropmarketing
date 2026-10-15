import "server-only";
import { createHash } from "node:crypto";
import { METER_LIMIT, PLANS, type MeteredFeature } from "../plans";
import type { Session } from "./session";
import { supabaseForRequest } from "./supabase";

/**
 * Usage metering for plan limits. Live mode stores usage_events in Postgres;
 * demo mode keeps per-visitor counters in process memory (reset on restart,
 * sufficient for demonstrating limits — not for billing).
 */
const memory = new Map<string, number>();
const memoryKeys = new Map<string, Set<string>>();

const today = () => new Date().toISOString().slice(0, 10);

export interface UsageCheck {
  allowed: boolean;
  used: number;
  limit: number;
}

/**
 * Stable key of a search: the filters without pagination and sort order. Turning
 * pages or re-sorting the same search is not a new search; any other change is.
 */
export function searchKey(query: Record<string, unknown>): string {
  const relevant = Object.entries(query)
    .filter(([k, v]) => !["page", "pageSize", "sort"].includes(k) && v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => [k, Array.isArray(v) ? [...v].map(String).sort() : v] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(relevant)).digest("base64url").slice(0, 22);
}

/**
 * Counts one usage of `feature` against the daily plan limit. With `key`, a search
 * already counted today (same key) is allowed again without counting, even at the limit.
 */
export async function meter(session: Session, feature: MeteredFeature, record = true, key?: string): Promise<UsageCheck> {
  const limit = PLANS[session.plan].entitlements[METER_LIMIT[feature]] as number;
  if (session.mode === "live" && session.authenticated) {
    const sb = await supabaseForRequest();
    if (sb) {
      const since = `${today()}T00:00:00Z`;
      const base = () => sb.from("usage_events").select("id", { count: "exact", head: true }).eq("user_id", session.id).eq("feature", feature).gte("created_at", since);
      const { count } = await base();
      const used = count ?? 0;
      if (key) {
        const { count: seen } = await base().eq("query_key", key);
        if (seen) return { allowed: true, used, limit };
      }
      if (used >= limit) return { allowed: false, used, limit };
      if (record) await sb.from("usage_events").insert({ user_id: session.id, organization_id: session.organizationId, feature, query_key: key ?? null });
      return { allowed: true, used: used + (record ? 1 : 0), limit };
    }
  }
  const day = `${session.id}:${feature}:${today()}`;
  const used = memory.get(day) ?? 0;
  if (key && memoryKeys.get(day)?.has(key)) return { allowed: true, used, limit };
  if (used >= limit) return { allowed: false, used, limit };
  if (record) {
    memory.set(day, used + 1);
    if (key) memoryKeys.set(day, (memoryKeys.get(day) ?? new Set()).add(key));
  }
  return { allowed: true, used: used + (record ? 1 : 0), limit };
}

export async function usageSummary(session: Session) {
  const features: MeteredFeature[] = ["product_search", "ad_search", "ai_query"];
  const out: Record<string, UsageCheck> = {};
  for (const f of features) out[f] = await meter(session, f, false);
  return out;
}
