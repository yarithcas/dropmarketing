import type { NextRequest } from "next/server";
import { json } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { reportCatalog } from "@/lib/server/reports";
import { meta } from "@/lib/server/repository";

/** Data depends on the request and on the current (demo or live) snapshot day: never prerendered or cached. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guard(req, { bucket: "reports" });
  if (g.res) return g.res;
  return json({ items: reportCatalog(), meta: meta() });
}
