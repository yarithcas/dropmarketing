import type { NextRequest } from "next/server";
import { apiError, json, limitOr429 } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { supabaseForRequest } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/** Subscription state for the billing tab. Written only by the verified Stripe webhook. */
export async function GET(req: NextRequest) {
  const limited = limitOr429(req, "subscription", 60);
  if (limited) return limited;
  const session = await getSession();
  const f = features();
  const base = { plan: session.plan, billing: f.stripe ? "stripe" : "demo", yearlyAvailable: f.stripe && f.stripeYearly, supportAvailable: f.support && session.mode === "live" };
  if (session.mode !== "live") return json({ ...base, status: null, interval: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
  if (!session.authenticated) return apiError(401, "unauthenticated");
  const sb = await supabaseForRequest();
  if (!sb || !session.organizationId) return apiError(503, "database_unavailable");
  const { data } = await sb
    .from("subscriptions")
    .select("status, billing_interval, current_period_end, cancel_at_period_end")
    .eq("organization_id", session.organizationId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return json({
    ...base,
    status: data?.status ?? null,
    interval: data?.billing_interval ?? null,
    currentPeriodEnd: data?.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(data?.cancel_at_period_end),
  });
}
