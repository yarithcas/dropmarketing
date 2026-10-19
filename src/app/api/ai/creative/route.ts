import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, parseBody, sameOrigin } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { getAd } from "@/lib/server/repository";
import { rulesCreativeAnalysis, type CreativeAnalysis } from "@/lib/analyst/creative";
import { claudeCreative } from "@/lib/server/ai";
import { PLANS } from "@/lib/plans";

const schema = z.object({ adId: z.string().max(160), locale: z.enum(["fr", "en", "es", "de", "it"]).default("fr") });

export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req);
  if (blocked) return blocked;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const g = await guard(req, { bucket: "ai", limit: 30 });
  if (g.res) return g.res;
  if (!PLANS[g.session.plan].entitlements.creativeAnalysis) return apiError(403, "plan_required");
  const detail = getAd(body.data.adId);
  if (!detail) return apiError(404, "not_found");
  let result: CreativeAnalysis | null = null;
  let failed = false;
  try {
    result = await claudeCreative(detail.ad, detail.product, body.data.locale);
  } catch (e) {
    console.error("claude creative failed", e instanceof Error ? e.message : e);
    failed = true;
  }
  if (!result) {
    result = rulesCreativeAnalysis(detail.ad, detail.product);
    if (failed) result.notice = { key: "analyst.aiFailedNotice" };
  }
  return json(result);
}
