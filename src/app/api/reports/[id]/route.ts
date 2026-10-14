import type { NextRequest } from "next/server";
import { apiError, json } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { buildReport, isReportId, reportCatalog } from "@/lib/server/reports";
import { PLANS } from "@/lib/plans";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, { bucket: "report" });
  if (g.res) return g.res;
  const { id } = await params;
  if (!isReportId(id)) return apiError(404, "not_found");
  if (reportCatalog().find((r) => r.id === id)?.advanced && !PLANS[g.session.plan].entitlements.advancedReports) return apiError(403, "plan_required");
  return json(buildReport(id));
}
