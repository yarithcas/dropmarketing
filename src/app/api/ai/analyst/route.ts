import type { NextRequest } from "next/server";
import { json, parseBody, sameOrigin } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { allProducts } from "@/lib/server/repository";
import { analystRequestSchema, type AnalystResponse } from "@/lib/analyst/types";
import { detectCategories, detectIntent, pickCandidates, rulesAnalyst } from "@/lib/analyst/rules";
import { claudeAnalyst } from "@/lib/server/ai";

export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req);
  if (blocked) return blocked;
  const body = await parseBody(req, analystRequestSchema);
  if (!body.ok) return body.res;
  const g = await guard(req, { bucket: "ai", meter: "ai_query", limit: 30 });
  if (g.res) return g.res;
  const { question, productIds, locale } = body.data;
  const all = allProducts();
  const intent = detectIntent(question, productIds);
  const selected = all.filter((p) => productIds.includes(p.id));
  const records = selected.length ? selected : pickCandidates(all, detectCategories(question), question).slice(0, 12);

  let result: AnalystResponse | null = null;
  let notice: AnalystResponse["notice"];
  try {
    result = await claudeAnalyst(question, locale, records, intent, selected.length > 0);
  } catch (e) {
    console.error("claude analyst failed", e instanceof Error ? e.message : e);
    notice = { key: "analyst.aiFailedNotice" };
  }
  if (!result) {
    result = rulesAnalyst(question, productIds, all);
    if (notice) result.notice = notice;
  }
  return json(result);
}
