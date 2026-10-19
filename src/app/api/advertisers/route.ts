import type { NextRequest } from "next/server";
import { z } from "zod";
import { json, parseQuery } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { meta, searchAdvertisers } from "@/lib/server/repository";
import { DEFAULT_THRESHOLDS } from "@/lib/advertisers";

/** Data depends on the request and on the current (demo or live) snapshot day: never prerendered or cached. */
export const dynamic = "force-dynamic";

/** Advertiser suggestions (Ad Spy advertiser field): qualifying active advertisers first, each flagged. */
export async function GET(req: NextRequest) {
  const q = parseQuery(req, z.object({ q: z.string().trim().max(120).default("") }));
  if (!q.ok) return q.res;
  const g = await guard(req, { bucket: "search", limit: 300 });
  if (g.res) return g.res;
  return json({ items: searchAdvertisers(q.data.q, 8), advertiserRule: { enabled: true, ...DEFAULT_THRESHOLDS, asOf: meta().asOf } });
}
