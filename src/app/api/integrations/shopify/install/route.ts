import { NextResponse, type NextRequest } from "next/server";
import { apiError, limitOr429 } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { installUrl, normalizeShop } from "@/lib/server/shopify";
import { randomToken } from "@/lib/server/crypto";
import { PLANS } from "@/lib/plans";

/** Starts OAuth for the user's OWN store. */
export async function GET(req: NextRequest) {
  const limited = limitOr429(req, "shopify-install", 10);
  if (limited) return limited;
  if (!features().shopify) return apiError(400, "not_configured", "Shopify credentials are not configured");
  const session = await getSession();
  if (!session.authenticated) return apiError(401, "unauthenticated");
  if (!PLANS[session.plan].entitlements.shopifyIntegration) return apiError(403, "plan_required");
  const shop = normalizeShop(req.nextUrl.searchParams.get("shop") ?? "");
  if (!shop) return apiError(400, "invalid_shop");
  const state = randomToken();
  const res = NextResponse.redirect(installUrl(shop, state));
  res.cookies.set("th_shopify_state", `${state}.${shop}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/integrations/shopify", maxAge: 600 });
  return res;
}
