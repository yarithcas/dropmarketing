import type { NextRequest } from "next/server";
import { apiError, json, parseQuery } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { adQuerySchema } from "@/lib/queries";
import { isLiveDb, listAds, meta } from "@/lib/server/repository";
import { listAdsDb } from "@/lib/server/supabase-repository";
import { supabaseAdmin } from "@/lib/server/supabase";
import { searchKey } from "@/lib/server/usage";
import { stripFilters } from "@/lib/server/plan-filters";
import { ADVANCED_AD_FILTERS, PLANS } from "@/lib/plans";

/** Data depends on the request and on the current (demo or live) snapshot day: never prerendered or cached. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = parseQuery(req, adQuerySchema);
  if (!q.ok) return q.res;
  // One metered search per distinct query and day: page turns are free, new searches always count.
  const g = await guard(req, { bucket: "ads", meter: "ad_search", meterKey: searchKey(q.data) });
  if (g.res) return g.res;
  // Free plan: advanced filters are not applied server-side (and reported back).
  const { query, ignored } = PLANS[g.session.plan].entitlements.advancedFilters ? { query: q.data, ignored: [] as string[] } : stripFilters(q.data, ADVANCED_AD_FILTERS);
  let page;
  try {
    page = isLiveDb() ? await listAdsDb(supabaseAdmin()!, query, meta().asOf) : listAds(query);
  } catch (e) {
    console.error("listAds failed", (e as { code?: string })?.code ?? e);
    return apiError(500, "database_error");
  }
  return json({ ...page, meta: meta(), ignoredFilters: ignored });
}
