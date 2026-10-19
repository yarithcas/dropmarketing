import type { NextRequest } from "next/server";
import { z } from "zod";
import { json, parseQuery } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { allProducts, meta } from "@/lib/server/repository";

/** Data depends on the request and on the current (demo or live) snapshot day: never prerendered or cached. */
export const dynamic = "force-dynamic";

const schema = z.object({ ids: z.string().transform((s) => s.split(",").filter(Boolean).slice(0, 100)) });

/** Fetches specific products by id (collections, comparisons). Not metered: no search is performed. */
export async function GET(req: NextRequest) {
  const q = parseQuery(req, schema);
  if (!q.ok) return q.res;
  const g = await guard(req, { bucket: "batch" });
  if (g.res) return g.res;
  const ids = new Set(q.data.ids);
  return json({ items: allProducts().filter((p) => ids.has(p.id)), meta: meta() });
}
