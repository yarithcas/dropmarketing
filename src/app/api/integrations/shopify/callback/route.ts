import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/server/api";
import { env, features } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { exchangeCode, normalizeShop, storeIntegration, syncIntegration, verifyShopifyHmac } from "@/lib/server/shopify";
import { safeEqual } from "@/lib/server/crypto";
import { supabaseAdmin } from "@/lib/server/supabase";

export async function GET(req: NextRequest) {
  if (!features().shopify) return apiError(400, "not_configured");
  const p = req.nextUrl.searchParams;
  const session = await getSession();
  if (!session.authenticated) return apiError(401, "unauthenticated");
  const [state, cookieShop] = (req.cookies.get("th_shopify_state")?.value ?? "").split(".");
  const shop = normalizeShop(p.get("shop") ?? "");
  if (!shop || !state || !safeEqual(state, p.get("state") ?? "") || shop !== cookieShop) return apiError(400, "invalid_state");
  if (!verifyShopifyHmac(p)) return apiError(400, "invalid_hmac");
  const code = p.get("code");
  if (!code) return apiError(400, "missing_code");
  const back = new URL("/app/stores?tab=mine", env.appUrl);
  try {
    const token = await exchangeCode(shop, code);
    await storeIntegration(session.id, session.organizationId, shop, token.access_token, token.scope);
    const { data } = await supabaseAdmin()!.from("connected_integrations").select("id").eq("user_id", session.id).eq("external_account", shop).single();
    if (data) await syncIntegration(data.id).catch(() => {}); // errors are recorded on the row
    back.searchParams.set("connected", "1");
  } catch {
    back.searchParams.set("error", "connect_failed");
  }
  const res = NextResponse.redirect(back);
  res.cookies.delete("th_shopify_state");
  return res;
}
