import type { NextRequest } from "next/server";
import { json } from "@/lib/server/api";
import { guard } from "@/lib/server/guard";
import { meta, overview } from "@/lib/server/repository";

export async function GET(req: NextRequest) {
  const g = await guard(req, { bucket: "overview" });
  if (g.res) return g.res;
  return json({ ...overview(), meta: meta() });
}
