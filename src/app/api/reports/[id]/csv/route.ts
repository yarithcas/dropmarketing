import type { NextRequest } from "next/server";
import { apiError } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { buildReport, isReportId, reportCatalog, reportCsv } from "@/lib/server/reports";
import { PLANS } from "@/lib/plans";

/** Data depends on the request and on the current (demo or live) snapshot day: never prerendered or cached. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, { bucket: "report-csv", limit: 30 });
  if (g.res) return g.res;
  const { id } = await params;
  if (!isReportId(id)) return apiError(404, "not_found");
  const ent = PLANS[g.session.plan].entitlements;
  if (!ent.exports) return apiError(403, "plan_required");
  if (reportCatalog().find((r) => r.id === id)?.advanced && !ent.advancedReports) return apiError(403, "plan_required");
  return new Response(reportCsv(buildReport(id)), {
    headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="trendhunter-${id}.csv"` },
  });
}
