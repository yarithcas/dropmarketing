import type { NextRequest } from "next/server";
import { apiError, json, sameOrigin } from "@/lib/server/api";
import { env } from "@/lib/server/env";
import { billingOrganization } from "@/lib/server/roles";
import { getSession } from "@/lib/server/session";
import { stripe } from "@/lib/server/stripe";
import { supabaseAdmin } from "@/lib/server/supabase";

export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req);
  if (blocked) return blocked;
  const s = stripe();
  if (!s) return apiError(400, "billing_not_configured");
  const session = await getSession();
  if (!session.authenticated || !session.organizationId) return apiError(401, "unauthenticated");
  const billing = billingOrganization(session);
  if (!billing.ok) return billing.res;
  const { data: sub } = await supabaseAdmin()!.from("subscriptions").select("stripe_customer_id").eq("organization_id", billing.organizationId).maybeSingle();
  if (!sub?.stripe_customer_id) return apiError(404, "no_customer");
  const portal = await s.billingPortal.sessions.create({ customer: sub.stripe_customer_id, return_url: `${env.appUrl}/app/settings?tab=billing` });
  return json({ url: portal.url });
}
