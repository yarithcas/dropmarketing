import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, parseBody, sameOrigin } from "@/lib/server/api";
import { features } from "@/lib/server/env";
import { PLAN_IDS } from "@/lib/plans";
import { DEMO_PLAN_COOKIE } from "@/lib/server/session";

/** Demo billing mode only: switches the simulated plan. No payment is taken. */
export async function POST(req: NextRequest) {
  const blocked = sameOrigin(req);
  if (blocked) return blocked;
  if (features().supabase) return apiError(400, "demo_only", "Plan changes go through Stripe in live mode");
  const body = await parseBody(req, z.object({ plan: z.enum(PLAN_IDS) }));
  if (!body.ok) return body.res;
  const res = json({ ok: true, plan: body.data.plan, demo: true });
  res.cookies.set(DEMO_PLAN_COOKIE, body.data.plan, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
