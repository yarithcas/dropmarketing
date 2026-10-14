import type { NextRequest } from "next/server";
import { json, parseQuery } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { trendQuerySchema } from "@/lib/queries";
import { meta, trendReport } from "@/lib/server/repository";
import type { TimeRange } from "@/lib/types";

export async function GET(req: NextRequest) {
  const q = parseQuery(req, trendQuerySchema);
  if (!q.ok) return q.res;
  const g = await guard(req, { bucket: "trends" });
  if (g.res) return g.res;
  return json({ ...trendReport(q.data.range as TimeRange, q.data.category, q.data.country), meta: meta() });
}
