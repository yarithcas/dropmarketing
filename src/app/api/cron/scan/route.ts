import type { NextRequest } from "next/server";
import { apiError, json } from "@/lib/server/api";
import { env, features } from "@/lib/server/env";
import { safeEqual } from "@/lib/server/crypto";
import { runScan } from "@/lib/server/scan";
import { supabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Background job entry point (Vercel Cron, GitHub Actions, or any scheduler).
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  if (!features().cron) return apiError(503, "not_configured", "CRON_SECRET and Supabase service role are required");
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${env.cronSecret}`)) return apiError(401, "unauthorized");
  const frequency = req.nextUrl.searchParams.get("frequency");
  try {
    const result = await runScan(supabaseAdmin()!, { frequency: frequency === "hourly" || frequency === "weekly" || frequency === "daily" ? frequency : undefined });
    return json({ ok: true, ...result });
  } catch (e) {
    return apiError(500, "scan_failed", e instanceof Error ? e.message : "scan failed");
  }
}
