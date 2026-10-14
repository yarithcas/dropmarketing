import "server-only";
import Stripe from "stripe";
import { env, features } from "./env";

let client: Stripe | null = null;
export function stripe(): Stripe | null {
  if (!features().stripe) return null;
  client ??= new Stripe(env.stripeSecretKey!);
  return client;
}

export function priceFor(plan: "pro" | "business"): string {
  return plan === "pro" ? env.stripePricePro! : env.stripePriceBusiness!;
}

export function planForPrice(priceId: string | undefined): "pro" | "business" | null {
  if (priceId === env.stripePricePro) return "pro";
  if (priceId === env.stripePriceBusiness) return "business";
  return null;
}
