import type { NextRequest } from "next/server";
import { apiError, json, parseQuery } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { adQuerySchema } from "@/lib/queries";
import { isLiveDb, listAds, meta } from "@/lib/server/repository";
import { listAdsDb } from "@/lib/server/supabase-repository";
import { supabaseAdmin } from "@/lib/server/supabase";

export async function GET(req: NextRequest) {
  const q = parseQuery(req, adQuerySchema);
  if (!q.ok) return q.res;
  const g = await guard(req, { bucket: "ads", meter: q.data.page > 1 ? undefined : "ad_search" });
  if (g.res) return g.res;
  let page;
  try {
    page = isLiveDb() ? await listAdsDb(supabaseAdmin()!, q.data, meta().asOf) : listAds(q.data);
  } catch (e) {
    console.error("listAds failed", (e as { code?: string })?.code ?? e);
    return apiError(500, "database_error");
  }
  return json({ ...page, meta: meta() });
}
