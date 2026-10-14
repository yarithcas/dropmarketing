import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { getSession } from "@/lib/server/session";
import { supabaseForRequest } from "@/lib/server/supabase";
import { LOCALES } from "@/lib/i18n/config";

export const dynamic = "force-dynamic";

const schema = z.object({ locale: z.enum(LOCALES) });

/** Remembers the interface language on the profile so alert emails use it (live mode, signed-in users). */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "locale", 30);
  if (blocked) return blocked;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const session = await getSession();
  // Visitors and demo sessions only keep the cookie set by the browser.
  if (session.mode !== "live" || !session.authenticated) return json({ stored: false });
  const sb = await supabaseForRequest();
  if (!sb) return apiError(503, "database_unavailable");
  const { error } = await sb.from("profiles").update({ locale: body.data.locale, updated_at: new Date().toISOString() }).eq("user_id", session.id);
  if (error) return apiError(500, "database_error");
  return json({ stored: true });
}
