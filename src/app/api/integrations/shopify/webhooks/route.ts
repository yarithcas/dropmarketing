import type { NextRequest } from "next/server";
import { apiError, json } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { supabaseAdmin } from "@/lib/server/supabase";
import { normalizeShop, redactShop, revokeShop, verifyWebhookHmac, webhookAction } from "@/lib/server/shopify";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;

/**
 * Shopify webhooks: app/uninstalled and the mandatory privacy topics
 * (customers/data_request, customers/redact, shop/redact). Every request must
 * carry a valid X-Shopify-Hmac-Sha256 signature of its raw body.
 */
export async function POST(req: NextRequest) {
  if (!features().shopify) return apiError(503, "not_configured");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return apiError(413, "payload_too_large");
  // The signature covers the exact bytes received: read the raw body before any parsing.
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return apiError(413, "payload_too_large");
  if (!verifyWebhookHmac(raw, req.headers.get("x-shopify-hmac-sha256"))) return apiError(401, "invalid_hmac");
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const shop = normalizeShop(req.headers.get("x-shopify-shop-domain") ?? "");
  if (!shop) return apiError(400, "invalid_shop");
  const action = webhookAction(topic);
  // customers/data_request and customers/redact: no customer personal data is stored
  // (orders are aggregated per product and day), so there is nothing to export or erase.
  if (action === "acknowledge") return json({ ok: true });
  const db = supabaseAdmin();
  if (!db) return apiError(503, "database_unavailable");
  try {
    if (action === "revoke") await revokeShop(db, shop);
    else await redactShop(db, shop);
  } catch (e) {
    console.error(`[shopify] webhook ${topic} for ${shop} failed: ${e instanceof Error ? e.message : "unknown error"}`);
    return apiError(500, "webhook_failed"); // non-2xx: Shopify retries the delivery
  }
  return json({ ok: true });
}
