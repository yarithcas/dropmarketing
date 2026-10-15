import "server-only";
import Stripe from "stripe";
import { env, features } from "./env";

let client: Stripe | null = null;
export function stripe(): Stripe | null {
  if (!features().stripe) return null;
  client ??= new Stripe(env.stripeSecretKey!);
  return client;
}

export type BillingInterval = "month" | "year";

/** Stripe price for a plan and interval, or null when that price is not configured. */
export function priceFor(plan: "pro" | "business", interval: BillingInterval = "month"): string | null {
  const id = interval === "year" ? (plan === "pro" ? env.stripePriceProYearly : env.stripePriceBusinessYearly) : plan === "pro" ? env.stripePricePro : env.stripePriceBusiness;
  return id ?? null;
}

export function planForPrice(priceId: string | undefined): "pro" | "business" | null {
  if (!priceId) return null;
  if (priceId === env.stripePricePro || priceId === env.stripePriceProYearly) return "pro";
  if (priceId === env.stripePriceBusiness || priceId === env.stripePriceBusinessYearly) return "business";
  return null;
}
