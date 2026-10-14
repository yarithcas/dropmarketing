import { json } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { ensureDataset, meta } from "@/lib/server/repository";
import { entitlementsFor, getSession } from "@/lib/server/session";
import { usageSummary } from "@/lib/server/usage";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  await ensureDataset().catch(() => {});
  const f = features();
  return json({
    mode: session.mode,
    authenticated: session.authenticated,
    user: session.user,
    plan: session.plan,
    entitlements: entitlementsFor(session.plan),
    usage: await usageSummary(session),
    // Booleans only — never configuration values or secrets.
    features: { supabase: f.supabase, ai: f.ai, stripe: f.stripe, shopify: f.shopify, email: f.email, cron: f.cron },
    data: meta(),
  });
}
