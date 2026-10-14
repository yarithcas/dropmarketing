import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { apiError, json } from "@/lib/server/api";
import { env } from "@/lib/server/env";
import { planForPrice, stripe } from "@/lib/server/stripe";
import { supabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/** Stripe webhook: the only place a paid plan is granted. Signature is verified on the raw body. */
export async function POST(req: NextRequest) {
  const s = stripe();
  const db = supabaseAdmin();
  if (!s || !db) return apiError(400, "billing_not_configured");
  const sig = req.headers.get("stripe-signature");
  if (!sig) return apiError(400, "missing_signature");
  let event: Stripe.Event;
  try {
    event = s.webhooks.constructEvent(await req.text(), sig, env.stripeWebhookSecret!);
  } catch {
    return apiError(400, "invalid_signature");
  }

  const upsertFromSubscription = async (sub: Stripe.Subscription) => {
    const orgId = sub.metadata?.organization_id;
    if (!orgId) return;
    const item = sub.items.data[0];
    const plan = planForPrice(item?.price.id) ?? "free";
    const active = sub.status === "active" || sub.status === "trialing";
    const periodEnd = (item as unknown as { current_period_end?: number })?.current_period_end;
    await db.from("subscriptions").update({
      plan: active ? plan : "free",
      status: sub.status,
      stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripe_subscription_id: sub.id,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("organization_id", orgId);
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const cs = event.data.object as Stripe.Checkout.Session;
      if (cs.subscription) await upsertFromSubscription(await s.subscriptions.retrieve(typeof cs.subscription === "string" ? cs.subscription : cs.subscription.id));
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await upsertFromSubscription(event.data.object as Stripe.Subscription);
      break;
  }
  return json({ received: true });
}
