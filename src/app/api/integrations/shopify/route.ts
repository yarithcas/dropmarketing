import type { NextRequest } from "next/server";
import { json, limitOr429 } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { supabaseForRequest } from "@/lib/server/supabase";
import { mockStore, ownPerformance, shopifyMode, type OwnProduct, type OwnSales } from "@/lib/server/shopify";
import { PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";

/** Status + own-store performance. Mock mode when Shopify credentials are not configured. */
export async function GET(req: NextRequest) {
  const limited = limitOr429(req, "shopify", 60);
  if (limited) return limited;
  const session = await getSession();
  const allowed = PLANS[session.plan].entitlements.shopifyIntegration;
  const mode = shopifyMode();
  if (mode === "mock") {
    const m = mockStore();
    return json({
      mode,
      configured: false,
      allowed,
      connections: [{ id: "mock", shop: "demo-store.myshopify.com", status: "connected", lastSyncAt: `${m.asOf}T06:00:00Z`, lastError: null, scopes: ["read_products", "read_orders", "read_inventory"] }],
      asOf: m.asOf,
      performance: ownPerformance(m.products, m.sales, m.asOf),
      missing: ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "ENCRYPTION_KEY", "NEXT_PUBLIC_SUPABASE_URL"].filter((k) => !process.env[k]),
    });
  }
  const sb = await supabaseForRequest();
  if (!sb || !session.authenticated) return json({ mode, configured: true, allowed, connections: [], performance: [], asOf: null, missing: [] });
  const { data: conns } = await sb.from("connected_integrations").select("id, external_account, status, last_sync_at, last_error, scopes").eq("provider", "shopify");
  const first = conns?.[0];
  let performance: ReturnType<typeof ownPerformance> = [];
  const asOf = new Date().toISOString().slice(0, 10);
  if (first) {
    const [{ data: prods }, { data: sales }] = await Promise.all([
      sb.from("own_store_products").select("*").eq("integration_id", first.id),
      sb.from("own_store_daily_sales").select("*").eq("integration_id", first.id),
    ]);
    performance = ownPerformance(
      (prods ?? []).map((p): OwnProduct => ({ externalId: p.external_id, title: p.title, status: p.status, price: p.price == null ? null : Number(p.price), currency: "EUR", inventory: p.inventory })),
      (sales ?? []).map((s): OwnSales => ({ productExternalId: s.product_external_id, date: s.date, units: s.units, revenue: Number(s.revenue) })),
      asOf,
    );
  }
  return json({
    mode,
    configured: features().shopify,
    allowed,
    connections: (conns ?? []).map((c) => ({ id: c.id, shop: c.external_account, status: c.status, lastSyncAt: c.last_sync_at, lastError: c.last_error, scopes: c.scopes })),
    asOf,
    performance,
    missing: [],
  });
}
