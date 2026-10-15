import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, parseQuery } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { getStore, meta } from "@/lib/server/repository";

/** Data depends on the request and on the current (demo or live) snapshot day: never prerendered or cached. */
export const dynamic = "force-dynamic";

const schema = z.object({
  ids: z
    .string()
    .transform((s) => Array.from(new Set(s.split(",").filter(Boolean))))
    .pipe(z.array(z.string().max(120)).min(1).max(5)),
});

/** Compares up to five stores using only publicly observed data. */
export async function GET(req: NextRequest) {
  const q = parseQuery(req, schema);
  if (!q.ok) return q.res;
  const g = await guard(req, { bucket: "compare" });
  if (g.res) return g.res;
  const stores = q.data.ids.map((id) => getStore(id)).filter((s) => s != null);
  if (!stores.length) return apiError(404, "not_found");
  return json({
    meta: meta(),
    stores: stores.map((d) => {
      const prices = d.listings.map((l) => l.price);
      const last = d.snapshots.at(-1);
      const first = d.snapshots[0];
      return {
        store: d.store,
        listingCount: d.listings.length,
        trackedProducts: d.products.length,
        priceMin: prices.length ? Math.min(...prices) : null,
        priceMax: prices.length ? Math.max(...prices) : null,
        priceMedian: prices.length ? [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)] : null,
        adsObserved: d.ads.length,
        activeAds: d.ads.filter((a) => a.lastSeen >= meta().asOf.slice(0, 10)).length,
        platforms: Array.from(new Set(d.ads.map((a) => a.platform))),
        listingGrowth: first && last && first.productCount > 0 ? Math.round(((last.productCount - first.productCount) / first.productCount) * 100) : null,
        snapshots: d.snapshots,
        topProducts: d.products.slice(0, 5).map((p) => ({ id: p.id, name: p.name, score: p.score.overall })),
      };
    }),
  });
}
