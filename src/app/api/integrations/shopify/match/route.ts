import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, limitOr429, parseBody, parseQuery, sameOrigin } from "@/lib/server/api";
import { getSession } from "@/lib/server/session";
import { supabaseAdmin } from "@/lib/server/supabase";
import { MOCK_MATCH_COOKIE, marketProducts, mockStore, parseMockMatches, searchMarket, serializeMockMatches, shopifyMode, storeLimit, withinStoreLimit } from "@/lib/server/shopify";

export const dynamic = "force-dynamic";

/** Tracked products for the manual match picker (names only). */
export async function GET(req: NextRequest) {
  const limited = limitOr429(req, "shopify-match", 30);
  if (limited) return limited;
  const session = await getSession();
  const mode = shopifyMode();
  if (mode === "live" && !session.authenticated) return apiError(401, "unauthenticated");
  if (!storeLimit(session.plan)) return apiError(403, "plan_required");
  const q = parseQuery(req, z.object({ q: z.string().trim().min(1).max(120) }));
  if (!q.ok) return q.res;
  const items = searchMarket(q.data.q, await marketProducts(mode)).map((p) => ({ id: p.id, name: p.name, category: p.category }));
  return json({ items });
}

const bodySchema = z.object({
  id: z.string().min(1).max(64),
  externalId: z.string().min(1).max(200),
  /** "auto": back to the name-similarity estimate; "none": no comparable product; otherwise a tracked product id. */
  match: z.union([z.literal("auto"), z.literal("none"), z.object({ productId: z.string().min(1).max(200) })]),
});

/** Sets or clears the manual market match of one own product. */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "shopify-match-set", 30);
  if (blocked) return blocked;
  const session = await getSession();
  const mode = shopifyMode();
  if (mode === "live" && !session.authenticated) return apiError(401, "unauthenticated");
  const limit = storeLimit(session.plan);
  if (!limit) return apiError(403, "plan_required");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.res;
  const { id, externalId, match } = body.data;
  const market = await marketProducts(mode);
  if (typeof match === "object" && !market.some((p) => p.id === match.productId)) return apiError(404, "not_found");

  if (mode === "mock") {
    if (id !== "mock" || !mockStore(market).products.some((p) => p.externalId === externalId)) return apiError(404, "not_found");
    const matches = parseMockMatches(req.cookies.get(MOCK_MATCH_COOKIE)?.value);
    if (match === "auto") matches.delete(externalId);
    else matches.set(externalId, match === "none" ? null : match.productId);
    const res = json({ ok: true });
    res.cookies.set(MOCK_MATCH_COOKIE, serializeMockMatches(matches), { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/api/integrations/shopify", maxAge: 60 * 60 * 24 * 90 });
    return res;
  }

  if (!z.uuid().safeParse(id).success) return apiError(400, "invalid_body");
  const db = supabaseAdmin();
  if (!db) return apiError(503, "database_unavailable");
  // Ownership and plan: the integration must be the caller's and within the plan's store limit.
  const { data: rows } = await db.from("connected_integrations").select("id, created_at").eq("user_id", session.id).eq("provider", "shopify");
  const target = withinStoreLimit((rows ?? []).map((r) => ({ id: r.id as string, createdAt: r.created_at as string })), limit).find((r) => r.id === id);
  if (!target) return apiError(404, "not_connected");
  if (target.overLimit) return apiError(403, "store_limit");
  const { data: product } = await db.from("own_store_products").select("external_id").eq("integration_id", id).eq("external_id", externalId).maybeSingle();
  if (!product) return apiError(404, "not_found");
  const { error } =
    match === "auto"
      ? await db.from("own_store_market_matches").delete().eq("integration_id", id).eq("product_external_id", externalId)
      : await db
          .from("own_store_market_matches")
          .upsert({ integration_id: id, product_external_id: externalId, market_product_id: match === "none" ? null : match.productId, updated_at: new Date().toISOString() });
  if (error) return apiError(500, "database_unavailable");
  return json({ ok: true });
}
