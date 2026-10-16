import type { NextRequest } from "next/server";
import { json, parseQuery } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { storeQuerySchema } from "@/lib/queries";
import { listStores, meta } from "@/lib/server/repository";

/** Data depends on the request and on the current (demo or live) snapshot day: never prerendered or cached. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = parseQuery(req, storeQuerySchema);
  if (!q.ok) return q.res;
  const g = await guard(req, { bucket: "stores" });
  if (g.res) return g.res;
  return json({ ...listStores(q.data), meta: meta() });
}
