import { NextResponse, type NextRequest } from "next/server";
import { limitOr429 } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { supabaseForRequest } from "@/lib/server/supabase";
import { canAddStore, installUrl, normalizeShop, storeLimit } from "@/lib/server/shopify";
import { randomToken } from "@/lib/server/crypto";

/** Browser navigation: failures return to the store page with an error code the UI translates. */
function back(req: NextRequest, code: string) {
  const url = new URL("/app/stores?tab=mine", req.nextUrl.origin);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}

/** Starts OAuth for the user's OWN store (a new one within the plan's store limit, or a reconnect). */
export async function GET(req: NextRequest) {
  if (limitOr429(req, "shopify-install", 10)) return back(req, "rate_limited");
  if (!features().shopify) return back(req, "not_configured");
  const session = await getSession();
  if (!session.authenticated) return back(req, "unauthenticated");
  const limit = storeLimit(session.plan);
  if (!limit) return back(req, "plan_required");
  const shop = normalizeShop(req.nextUrl.searchParams.get("shop") ?? "");
  if (!shop) return back(req, "invalid_shop");
  const sb = await supabaseForRequest();
  if (!sb) return back(req, "database_unavailable");
  // RLS: the caller's own connections.
  const { data: rows, error } = await sb.from("connected_integrations").select("external_account").eq("provider", "shopify");
  if (error) return back(req, "database_unavailable");
  if (!canAddStore((rows ?? []).map((r) => r.external_account as string), shop, limit)) return back(req, "store_limit");
  const state = randomToken();
  const res = NextResponse.redirect(installUrl(shop, state));
  res.cookies.set("th_shopify_state", `${state}.${shop}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/integrations/shopify", maxAge: 600 });
  return res;
}
