import { NextResponse, type NextRequest } from "next/server";
import { supabaseForRequest } from "@/lib/server/supabase";

/** Email confirmation / magic-link callback (Supabase PKCE code exchange). */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const sb = await supabaseForRequest();
  if (code && sb) await sb.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL("/app", req.url));
}
