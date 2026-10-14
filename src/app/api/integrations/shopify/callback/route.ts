import { NextResponse, type NextRequest } from "next/server";
import { env, features } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { exchangeCode, normalizeShop, storeIntegration, syncIntegration, verifyShopifyHmac } from "@/lib/server/shopify";
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
  const [state, cookieShop] = (req.cookies.get("th_shopify_state")?.value ?? "").split(".");
  const shop = normalizeShop(p.get("shop") ?? "");
  if (!shop || !state || !safeEqual(state, p.get("state") ?? "") || shop !== cookieShop) return done("invalid_state");
  if (!verifyShopifyHmac(p)) return done("invalid_hmac");
  const code = p.get("code");
  if (!code) return done("missing_code");
  try {
    const token = await exchangeCode(shop, code);
    await storeIntegration(session.id, session.organizationId, shop, token.access_token, token.scope);
    const { data } = await supabaseAdmin()!.from("connected_integrations").select("id").eq("user_id", session.id).eq("external_account", shop).single();
    if (data) await syncIntegration(data.id).catch(() => {}); // errors are recorded on the row
  } catch {
    return done("connect_failed");
  }
  back.searchParams.set("connected", "1");
  return done();
}
