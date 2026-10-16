import { NextResponse, type NextRequest } from "next/server";
import { env, features } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { canAddStore, exchangeCode, normalizeShop, storeIntegration, storeLimit, syncIntegration, verifyShopifyHmac } from "@/lib/server/shopify";
import { safeEqual } from "@/lib/server/crypto";
import { supabaseAdmin } from "@/lib/server/supabase";

/** Shopify redirects the browser here: every outcome returns to the store page (`connected=1` or `error=<code>`). */
export async function GET(req: NextRequest) {
  const back = new URL("/app/stores?tab=mine", env.appUrl);
  const done = (error?: string) => {
    if (error) back.searchParams.set("error", error);
    const res = NextResponse.redirect(back);
    res.cookies.delete({ name: "th_shopify_state", path: "/api/integrations/shopify" });
    return res;
  };
  if (!features().shopify) return done("not_configured");
  const p = req.nextUrl.searchParams;
  const session = await getSession();
  if (!session.authenticated) return done("unauthenticated");
  // Cookie value is `<state>.<shop>`: the state has no dots, the shop domain does.
  const cookie = req.cookies.get("th_shopify_state")?.value ?? "";
  const dot = cookie.indexOf(".");
  const state = dot > 0 ? cookie.slice(0, dot) : "";
  const cookieShop = dot > 0 ? cookie.slice(dot + 1) : "";
  const shop = normalizeShop(p.get("shop") ?? "");
  if (!shop || !state || !safeEqual(state, p.get("state") ?? "") || shop !== cookieShop) return done("invalid_state");
  if (!verifyShopifyHmac(p)) return done("invalid_hmac");
  const code = p.get("code");
  if (!code) return done("missing_code");
  const db = supabaseAdmin();
  if (!db) return done("database_unavailable");
  // Plan and store limit are checked again: they may have changed since the install started.
  const limit = storeLimit(session.plan);
  if (!limit) return done("plan_required");
  const { data: existing, error } = await db.from("connected_integrations").select("external_account").eq("user_id", session.id).eq("provider", "shopify");
  if (error) return done("database_unavailable");
  if (!canAddStore((existing ?? []).map((r) => r.external_account as string), shop, limit)) return done("store_limit");
  try {
    const token = await exchangeCode(shop, code);
    await storeIntegration(session.id, session.organizationId, shop, token.access_token, token.scope);
    const { data } = await db.from("connected_integrations").select("id").eq("user_id", session.id).eq("provider", "shopify").eq("external_account", shop).single();
    if (data) await syncIntegration(data.id, db).catch(() => {}); // errors are recorded on the row
  } catch {
    return done("connect_failed");
  }
  back.searchParams.set("connected", "1");
  back.searchParams.set("shop", shop);
  return done();
}
