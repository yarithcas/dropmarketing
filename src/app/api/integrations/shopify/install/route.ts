import { NextResponse, type NextRequest } from "next/server";
import { limitOr429 } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { installUrl, normalizeShop } from "@/lib/server/shopify";
import { randomToken } from "@/lib/server/crypto";
import { PLANS } from "@/lib/plans";

/** Browser navigation: failures return to the store page with an error code the UI translates. */
function back(req: NextRequest, code: string) {
  const url = new URL("/app/stores?tab=mine", req.nextUrl.origin);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}

/** Starts OAuth for the user's OWN store. */
export async function GET(req: NextRequest) {
  if (limitOr429(req, "shopify-install", 10)) return back(req, "rate_limited");
  if (!features().shopify) return back(req, "not_configured");
  const session = await getSession();
  if (!session.authenticated) return back(req, "unauthenticated");
  if (!PLANS[session.plan].entitlements.shopifyIntegration) return back(req, "plan_required");
  const shop = normalizeShop(req.nextUrl.searchParams.get("shop") ?? "");
  if (!shop) return back(req, "invalid_shop");
  const state = randomToken();
  const res = NextResponse.redirect(installUrl(shop, state));
  res.cookies.set("th_shopify_state", `${state}.${shop}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/integrations/shopify", maxAge: 600 });
  return res;
}
