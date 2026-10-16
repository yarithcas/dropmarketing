import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { env } from "@/lib/server/env";
import { billingOrganization } from "@/lib/server/roles";
import { getSession } from "@/lib/server/session";
import { priceFor, stripe } from "@/lib/server/stripe";
import { supabaseAdmin } from "@/lib/server/supabase";

/** Creates a Stripe Checkout session. Plan changes are applied only by the verified webhook. */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "checkout", 10);
  if (blocked) return blocked;
  const s = stripe();
  if (!s) return apiError(400, "billing_not_configured", "Stripe is not configured (demo billing mode)");
  const session = await getSession();
  if (!session.authenticated || !session.organizationId) return apiError(401, "unauthenticated");
  // Subscriptions belong to the organization that pays for the active workspace; only its owners/admins may change them.
  const billing = billingOrganization(session);
  if (!billing.ok) return billing.res;
  const body = await parseBody(req, z.object({ plan: z.enum(["pro", "business"]), interval: z.enum(["month", "year"]).default("month") }));
  if (!body.ok) return body.res;
  const price = priceFor(body.data.plan, body.data.interval);
  if (!price) return apiError(400, "interval_unavailable", "This billing interval is not configured");
  const db = supabaseAdmin();
  const { data: sub } = (await db?.from("subscriptions").select("stripe_customer_id").eq("organization_id", billing.organizationId).maybeSingle()) ?? { data: null };
  const checkout = await s.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    success_url: `${env.appUrl}/app/settings?tab=billing&checkout=success`,
    cancel_url: `${env.appUrl}/app/settings?tab=billing&checkout=cancelled`,
    client_reference_id: billing.organizationId,
    customer: sub?.stripe_customer_id ?? undefined,
    customer_email: sub?.stripe_customer_id ? undefined : session.user?.email,
    subscription_data: { metadata: { organization_id: billing.organizationId } },
    allow_promotion_codes: true,
  });
  return json({ url: checkout.url });
}
