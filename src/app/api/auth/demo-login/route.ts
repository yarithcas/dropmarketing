import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, limitOr429, parseBody, sameOrigin } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { DEMO_USER_COOKIE } from "@/lib/server/session";

const schema = z.object({ name: z.string().trim().max(80).default(""), email: z.email().max(120) });

/** Demo-mode sign-in: personalises the demo only. No password, no account, no data leaves the browser. */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req) ?? limitOr429(req, "demo-login", 20);
  if (blocked) return blocked;
  if (features().supabase) return apiError(400, "use_supabase_auth");
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const res = json({ ok: true });
  res.cookies.set(DEMO_USER_COOKIE, Buffer.from(JSON.stringify(body.data)).toString("base64url"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
