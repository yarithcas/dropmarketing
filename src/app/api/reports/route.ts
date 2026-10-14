import type { NextRequest } from "next/server";
import { json } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { reportCatalog } from "@/lib/server/reports";
import { meta } from "@/lib/server/repository";

export async function GET(req: NextRequest) {
  const g = await guard(req, { bucket: "reports" });
  if (g.res) return g.res;
  return json({ items: reportCatalog(), meta: meta() });
}
