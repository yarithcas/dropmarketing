import type { NextRequest } from "next/server";
import { json, parseQuery } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { productQuerySchema } from "@/lib/queries";
import { isLiveDb, listProducts, meta } from "@/lib/server/repository";
import { listProductsDb } from "@/lib/server/supabase-repository";
import { supabaseAdmin } from "@/lib/server/supabase";
import { ADVANCED_PRODUCT_FILTERS, PLANS } from "@/lib/plans";

export async function GET(req: NextRequest) {
  const q = parseQuery(req, productQuerySchema);
  if (!q.ok) return q.res;
  const isPageTurn = q.data.page > 1;
  const g = await guard(req, { bucket: "products", meter: isPageTurn ? undefined : "product_search" });
  if (g.res) return g.res;
  const query = { ...q.data };
  const ignored: string[] = [];
  // Free plan: advanced filters are not applied server-side (and reported back).
  if (!PLANS[g.session.plan].entitlements.advancedFilters) {
    for (const k of ADVANCED_PRODUCT_FILTERS) {
      const v = query[k as keyof typeof query];
      if (v != null && !(Array.isArray(v) && v.length === 0)) {
        ignored.push(k);
        (query as Record<string, unknown>)[k] = Array.isArray(v) ? [] : undefined;
      }
    }
  }
  // Live mode: filtering, sorting and pagination happen in Postgres.
  const page = isLiveDb() ? await listProductsDb(supabaseAdmin()!, query) : listProducts(query);
  return json({ ...page, meta: meta(), ignoredFilters: ignored });
}
