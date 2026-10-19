import type { NextRequest } from "next/server";
import { json } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { meta, overview } from "@/lib/server/repository";

/** Data depends on the request and on the current (demo or live) snapshot day: never prerendered or cached. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guard(req, { bucket: "overview" });
  if (g.res) return g.res;
  return json({ ...overview(), meta: meta() });
}
