import type { NextRequest } from "next/server";
import { json, sameOrigin } from "@/lib/server/api";
import { DEMO_USER_COOKIE } from "@/lib/server/session";
import { supabaseForRequest } from "@/lib/server/supabase";

export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req);
  if (blocked) return blocked;
  const sb = await supabaseForRequest();
  if (sb) await sb.auth.signOut();
  const res = json({ ok: true });
  res.cookies.delete(DEMO_USER_COOKIE);
  return res;
}
