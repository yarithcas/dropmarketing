import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { paramsToObject } from "../queries";
import { rateLimit } from "./rate-limit";

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function apiError(status: number, code: string, message?: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message: message ?? code, ...extra } }, { status });
}

/**
 * Client address for rate limiting. Prefers headers set by the hosting edge (Vercel),
 * then the hop appended by the nearest proxy: the first X-Forwarded-For entry is
 * supplied by the client and could be spoofed to dodge limits.
 */
export function clientIp(req: NextRequest): string {
  const h = req.headers;
  const edge = h.get("x-vercel-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip")?.trim();
  if (edge) return edge;
  const hops = h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return hops.at(-1) || "local";
}

/** Applies a per-IP rate limit; returns a 429 response when exceeded. */
export function limitOr429(req: NextRequest, bucket: string, limit = 120) {
  const r = rateLimit(`${bucket}:${clientIp(req)}`, limit);
  if (!r.ok) return apiError(429, "rate_limited", "Too many requests", { retryAfter: r.retryAfter });
  return null;
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): { ok: true; data: T } | { ok: false; res: NextResponse } {
  const parsed = schema.safeParse(paramsToObject(req.nextUrl.searchParams));
  if (!parsed.success) return { ok: false, res: apiError(400, "invalid_query", "Invalid query parameters", { issues: parsed.error.issues.slice(0, 5) }) };
  return { ok: true, data: parsed.data };
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, res: apiError(400, "invalid_json") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, res: apiError(400, "invalid_body", "Invalid request body", { issues: parsed.error.issues.slice(0, 5) }) };
  return { ok: true, data: parsed.data };
}

/** Rejects cross-site state-changing requests (defence in depth on top of SameSite cookies). */
export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (new URL(origin).host !== req.headers.get("host")) return apiError(403, "cross_origin");
  return null;
}
