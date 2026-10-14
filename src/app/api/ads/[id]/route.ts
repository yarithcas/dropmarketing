import type { NextRequest } from "next/server";
import { apiError, json } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { getAd, meta } from "@/lib/server/repository";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, { bucket: "ad" });
  if (g.res) return g.res;
  const detail = getAd((await params).id);
  if (!detail) return apiError(404, "not_found");
  return json({ ...detail, meta: meta() });
}
