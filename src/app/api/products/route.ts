import type { NextRequest } from "next/server";
import { apiError, json, parseQuery } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { productQuerySchema } from "@/lib/queries";
import { isLiveDb, listProducts, meta } from "@/lib/server/repository";
import { listProductsDb } from "@/lib/server/supabase-repository";
import { supabaseAdmin } from "@/lib/server/supabase";
import { searchKey } from "@/lib/server/usage";
import { stripFilters } from "@/lib/server/plan-filters";
import { ADVANCED_PRODUCT_FILTERS, PLANS } from "@/lib/plans";

export async function GET(req: NextRequest) {
  const q = parseQuery(req, productQuerySchema);
  if (!q.ok) return q.res;
  // One metered search per distinct query and day: page turns are free, new searches always count.
  const g = await guard(req, { bucket: "products", meter: "product_search", meterKey: searchKey(q.data) });
  if (g.res) return g.res;
  // Free plan: advanced filters are not applied server-side (and reported back).
  const { query, ignored } = PLANS[g.session.plan].entitlements.advancedFilters ? { query: q.data, ignored: [] as string[] } : stripFilters(q.data, ADVANCED_PRODUCT_FILTERS);
  // Live mode: filtering, sorting and pagination happen in Postgres.
  let page;
  try {
    page = isLiveDb() ? await listProductsDb(supabaseAdmin()!, query) : listProducts(query);
  } catch (e) {
    console.error("listProducts failed", (e as { code?: string })?.code ?? e);
    return apiError(500, "database_error");
  }
  return json({ ...page, meta: meta(), ignoredFilters: ignored });
}
