import "server-only";

/**
 * Fixed-window rate limiter (per instance). For multi-instance production
 * deployments back this with Redis/Upstash; the interface stays the same.
 */
const windows = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs = 60_000): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.reset <= now) {
    windows.set(key, { count: 1, reset: now + windowMs });
    if (windows.size > 10_000) for (const [k, v] of windows) if (v.reset <= now) windows.delete(k);
    return { ok: true, retryAfter: 0 };
  }
  w.count++;
  return { ok: w.count <= limit, retryAfter: Math.ceil((w.reset - now) / 1000) };
}
