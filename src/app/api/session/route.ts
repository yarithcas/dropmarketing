import { json } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { ensureDataset, meta } from "@/lib/server/repository";
import { activeWorkspace, billingOrganization } from "@/lib/server/roles";
import { entitlementsFor, getSession } from "@/lib/server/session";
import { usageSummary } from "@/lib/server/usage";
import type { WorkspaceSummary } from "@/lib/team";

export const dynamic = "force-dynamic";

const summary = (w: WorkspaceSummary) => ({ id: w.id, name: w.name, role: w.role, plan: w.plan, members: w.members });

export async function GET() {
  const session = await getSession();
  await ensureDataset().catch(() => {});
  const f = features();
  const active = activeWorkspace(session);
  return json({
    mode: session.mode,
    authenticated: session.authenticated,
    user: session.user,
    plan: session.plan,
    entitlements: entitlementsFor(session.plan),
    usage: await usageSummary(session),
    // Live mode: the active workspace and the user's memberships (no other member's details).
    workspace: active ? summary(active) : null,
    workspaces: session.workspaces.map(summary),
    canManageBilling: session.mode === "demo" || billingOrganization(session).ok,
    // Booleans only — never configuration values or secrets.
    features: { supabase: f.supabase, ai: f.ai, stripe: f.stripe, shopify: f.shopify, email: f.email, cron: f.cron },
    data: meta(),
  });
}
