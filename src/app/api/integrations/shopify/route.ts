import type { NextRequest } from "next/server";
import { json, limitOr429 } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { supabaseForRequest } from "@/lib/server/supabase";
import { MOCK_MATCH_COOKIE, loadOwnStoreData, marketProducts, mockStore, ownPerformance, parseMockMatches, publicErrorCode, shopifyMode, storeLimit, withinStoreLimit, type OwnPerformanceRow } from "@/lib/server/shopify";

export const dynamic = "force-dynamic";

const SCOPES = ["read_products", "read_orders", "read_inventory"];

/**
 * Connections + own-store performance of the selected store (`?id=`).
 * Performance data is returned only for stores included in the caller's plan.
 * Mock mode when Shopify credentials are not configured.
 */
export async function GET(req: NextRequest) {
  const limited = limitOr429(req, "shopify", 60);
  if (limited) return limited;
  const session = await getSession();
  const limit = storeLimit(session.plan);
  const allowed = limit > 0;
  const mode = shopifyMode();
  const autoSync = features().cron;
  if (mode === "mock") {
    const market = await marketProducts("mock");
    const m = mockStore(market);
    return json({
      mode,
      configured: false,
      allowed,
      storeLimit: limit,
      autoSync: false,
      connections: [{ id: "mock", shop: "demo-store.myshopify.com", status: "connected", lastSyncAt: `${m.asOf}T06:00:00Z`, lastError: null, scopes: SCOPES, overLimit: !allowed }],
      selectedId: "mock",
      asOf: m.asOf,
      marketAvailable: allowed && market.length > 0,
      performance: allowed ? ownPerformance(m.products, m.sales, m.asOf, { market, inventory: m.inventory, overrides: parseMockMatches(req.cookies.get(MOCK_MATCH_COOKIE)?.value) }) : [],
      missing: ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "ENCRYPTION_KEY", "NEXT_PUBLIC_SUPABASE_URL"].filter((k) => !process.env[k]),
    });
  }
  const sb = await supabaseForRequest();
  const empty = { mode, configured: true, allowed, storeLimit: limit, autoSync, connections: [], selectedId: null, performance: [], marketAvailable: false, asOf: null, missing: [] };
  if (!sb || !session.authenticated) return json(empty);
  // RLS: only the caller's own connections are visible (never the token).
  const { data: rows } = await sb.from("connected_integrations").select("id, external_account, status, last_sync_at, last_error, scopes, created_at").eq("provider", "shopify");
  const connections = withinStoreLimit(
    (rows ?? []).map((c) => ({
      id: c.id as string,
      shop: c.external_account as string,
      status: c.status as "connected" | "error" | "revoked",
      lastSyncAt: c.last_sync_at as string | null,
      lastError: publicErrorCode(c.last_error),
      scopes: c.scopes as string[],
      createdAt: c.created_at as string,
    })),
    limit,
  );
  const requested = req.nextUrl.searchParams.get("id");
  const selected = connections.find((c) => c.id === requested) ?? connections.find((c) => !c.overLimit) ?? connections[0] ?? null;
  const asOf = new Date().toISOString().slice(0, 10);
  let performance: OwnPerformanceRow[] = [];
  let marketAvailable = false;
  // Plan entitlement: no data for a store beyond the plan's limit (every store when the plan has no integration).
  if (selected && !selected.overLimit) {
    const [own, market] = await Promise.all([loadOwnStoreData(sb, selected.id, asOf), marketProducts("live")]);
    marketAvailable = market.length > 0;
    performance = ownPerformance(own.products, own.sales, asOf, { market, inventory: own.inventory, overrides: own.overrides });
  }
  return json({ ...empty, connections, selectedId: selected?.id ?? null, asOf, performance, marketAvailable });
}
