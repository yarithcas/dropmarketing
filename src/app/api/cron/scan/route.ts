import type { NextRequest } from "next/server";
import { apiError, json } from "@/lib/server/api";
import { env, features } from "@/lib/server/env";
import { safeEqual } from "@/lib/server/crypto";
import { errorCategory, errorText } from "@/lib/monitoring";
import { runScan } from "@/lib/server/scan";
import { supabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Background job entry point (Vercel Cron, GitHub Actions, or any scheduler).
 * Requires `Authorization: Bearer $CRON_SECRET`. Each call syncs the connectors
 * that are due, evaluates the alert rules that are due and runs the daily
 * retention purge when due, so any schedule works (daily on Vercel Hobby, see
 * vercel.json and docs/DEPLOYMENT.md). Query parameters are ignored (older
 * schedules passing `?frequency=` keep working).
 */
export async function GET(req: NextRequest) {
  if (!features().cron) return apiError(503, "not_configured", "CRON_SECRET and Supabase service role are required");
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${env.cronSecret}`)) return apiError(401, "unauthorized");
  try {
    const result = await runScan(supabaseAdmin()!);
    return json({ ok: true, ...result });
  } catch (e) {
    // Details stay in scan_runs (service role); the response only carries a category.
    return apiError(500, "scan_failed", errorCategory(errorText(e)) ?? "unknown");
  }
}
