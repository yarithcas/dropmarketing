import type { NextRequest } from "next/server";
import { apiError, json } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { getStore, meta } from "@/lib/server/repository";

/** Data depends on the request and on the current (demo or live) snapshot day: never prerendered or cached. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, { bucket: "store" });
  if (g.res) return g.res;
  const detail = getStore((await params).id);
  if (!detail) return apiError(404, "not_found");
  return json({ ...detail, meta: meta() });
}
