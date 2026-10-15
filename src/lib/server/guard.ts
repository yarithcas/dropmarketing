import "server-only";
import type { NextRequest } from "next/server";
import type { MeteredFeature } from "../plans";
import { apiError, limitOr429 } from "./api";
import { getSession, type Session } from "./session";
import { meter } from "./usage";
import { ensureDataset } from "./repository";

/** Common guard for research endpoints: rate limit, auth in live mode, plan metering. */
export async function guard(req: NextRequest, opts: { bucket: string; meter?: MeteredFeature; meterKey?: string; limit?: number }): Promise<{ session: Session; res?: undefined } | { res: Response; session?: undefined }> {
  const limited = limitOr429(req, opts.bucket, opts.limit ?? 240);
  if (limited) return { res: limited };
  const session = await getSession();
  if (session.mode === "live" && !session.authenticated) return { res: apiError(401, "unauthenticated") };
  if (opts.meter) {
    const u = await meter(session, opts.meter, true, opts.meterKey);
    if (!u.allowed) return { res: apiError(429, "limit_reached", "Daily plan limit reached", { used: u.used, limit: u.limit }) };
  }
  await ensureDataset();
  return { session };
}
