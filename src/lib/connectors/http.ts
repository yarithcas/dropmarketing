import "server-only";

/**
 * Shared outbound HTTP for connectors: identified user agent, AbortSignal
 * timeouts, pacing derived from each connector's declared rate limit, and
 * bounded retries with exponential backoff that honour Retry-After. Nothing
 * here bypasses authentication or anti-bot protections: a refusal (401/403,
 * robots.txt disallow) ends the attempt.
 */

export const USER_AGENT = "TrendHunterBot/1.0 (+https://trendhunter.app/bot; respects robots.txt)";

export type RateLimit = { requests: number; per: "second" | "minute" | "hour" | "day" };
const WINDOW_MS: Record<RateLimit["per"], number> = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/**
 * Sliding-window pacer: at most `requests` request starts within any `per`
 * window, spaced by at least min(window / requests, 1 s). Slots are reserved
 * before waiting, so concurrent callers queue instead of bursting.
 */
export class Pacer {
  private starts: number[] = [];
  readonly windowMs: number;
  gapMs: number;
  constructor(
    readonly limit: RateLimit,
    private clock: Clock = realClock,
  ) {
    this.windowMs = WINDOW_MS[limit.per];
    this.gapMs = Math.min(this.windowMs / Math.max(1, limit.requests), 1_000);
  }

  /** Milliseconds until the next request may start. */
  delay(): number {
    const now = this.clock.now();
    this.starts = this.starts.filter((t) => t > now - this.windowMs);
    const last = this.starts.at(-1);
    const spacing = last == null ? 0 : last + this.gapMs - now;
    const n = Math.max(1, this.limit.requests);
    const windowFull = this.starts.length >= n ? this.starts[this.starts.length - n] + this.windowMs - now : 0;
    return Math.max(0, spacing, windowFull);
  }

  /** Waits for a slot. Returns false, without waiting, when the slot would open after `deadline`. */
  async take(deadline = Infinity): Promise<boolean> {
    const wait = this.delay();
    const at = this.clock.now() + wait;
    if (at > deadline) return false;
    this.starts.push(at);
    if (wait > 0) await this.clock.sleep(wait);
    return true;
  }

  /** Raises the minimum spacing, e.g. to honour a robots.txt Crawl-delay. */
  slowTo(ms: number) {
    this.gapMs = Math.max(this.gapMs, ms);
  }
}

const pacers = new Map<string, Pacer>();
/** One pacer per connector (or host) and process, so limits hold across calls within an instance. */
export function pacerFor(key: string, limit: RateLimit): Pacer {
  let p = pacers.get(key);
  if (!p) pacers.set(key, (p = new Pacer(limit)));
  return p;
}

/** Retry-After as milliseconds (delta-seconds or HTTP date); null when absent or invalid. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const v = header.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** Exponential backoff with ±25 % jitter: base · 2^attempt. */
export function backoffMs(attempt: number, baseMs = 1_000, rand: () => number = Math.random): number {
  return Math.round(baseMs * 2 ** attempt * (0.75 + 0.5 * rand()));
}

export interface FetchPolicy {
  pacer?: Pacer;
  /** Per-attempt timeout (default 15 s), shortened to fit the deadline. */
  timeoutMs?: number;
  /** Retries after the first attempt for network errors, timeouts, 429 and 5xx (default 2). */
  retries?: number;
  /** Absolute epoch-ms deadline: no attempt or wait starts past it. */
  deadline?: number;
  /** Longest Retry-After or backoff wait accepted before giving up (default 30 s). */
  maxWaitMs?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  clock?: Clock;
}

export type FetchErrorCode = "timeout" | "network" | "deadline" | "rate_limited" | "redirected" | `http_${number}`;
export type FetchFailure = { ok: false; code: FetchErrorCode; status?: number; res?: Response; attempts: number };
export type FetchResult = { ok: true; res: Response; attempts: number } | FetchFailure;

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
const retryable = (status: number) => status === 429 || status >= 500;

/**
 * fetch() with pacing, timeout and bounded retries. Client errors (4xx other
 * than 429) are returned at once; the final failed Response is kept on the
 * result so callers can read a provider error body.
 */
export async function connectorFetch(url: string | URL, init: RequestInit = {}, policy: FetchPolicy = {}): Promise<FetchResult> {
  const clock = policy.clock ?? realClock;
  const doFetch = policy.fetchImpl ?? fetch;
  const retries = policy.retries ?? 2;
  const deadline = policy.deadline ?? Infinity;
  const timeoutMs = policy.timeoutMs ?? 15_000;
  let failure: FetchFailure | null = null;
  for (let attempt = 0; ; attempt++) {
    if (clock.now() >= deadline || (policy.pacer && !(await policy.pacer.take(deadline)))) return failure ?? { ok: false, code: "deadline", attempts: attempt };
    let res: Response | undefined;
    try {
      res = await doFetch(url, { ...init, signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, deadline - clock.now()))) });
    } catch (e) {
      failure = { ok: false, code: isTimeout(e) ? "timeout" : "network", attempts: attempt + 1 };
    }
    if (res) {
      if (res.ok) return { ok: true, res, attempts: attempt + 1 };
      failure = { ok: false, code: res.status === 429 ? "rate_limited" : `http_${res.status}`, status: res.status, res, attempts: attempt + 1 };
      if (!retryable(res.status)) return failure;
    }
    if (attempt >= retries) return failure!;
    const wait = (res && retryAfterMs(res.headers.get("retry-after"), clock.now())) ?? backoffMs(attempt, policy.baseDelayMs);
    if (wait > (policy.maxWaitMs ?? 30_000) || clock.now() + wait > deadline) return failure!;
    await res?.body?.cancel().catch(() => {}); // release the connection before retrying
    await clock.sleep(wait);
  }
}

// ---------------------------------------------------------------------------
// Public storefront pages: per-host pacing and robots.txt (RFC 9309)
// ---------------------------------------------------------------------------

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** One request per second per host (slower when robots.txt sets a Crawl-delay), identified UA, 10 s timeout. */
export async function politeFetch(url: string, opts: { deadline?: number; accept?: string; fetchImpl?: typeof fetch } = {}): Promise<FetchResult> {
  const u = new URL(url);
  const r = await connectorFetch(
    u,
    { headers: { "user-agent": USER_AGENT, accept: opts.accept ?? "application/json" }, redirect: "follow" },
    { pacer: pacerFor(`host:${bare(u.host)}`, { requests: 1, per: "second" }), timeoutMs: 10_000, retries: 1, maxWaitMs: 10_000, deadline: opts.deadline, fetchImpl: opts.fetchImpl },
  );
  // A redirect to another site is not the store we were asked to read, and its robots.txt was not checked.
  if (r.ok && r.res.url && bare(new URL(r.res.url).hostname) !== bare(u.hostname)) {
    await r.res.body?.cancel().catch(() => {});
    return { ok: false, code: "redirected", attempts: r.attempts };
  }
  return r;
}

export interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelayMs: number | null;
}
export const ALLOW_ALL: RobotsRules = { allow: [], disallow: [], crawlDelayMs: null };

/** Rules that apply to our crawler: groups naming "trendhunter" if any, otherwise the "*" groups. */
export function parseRobots(txt: string): RobotsRules {
  type Group = { agents: string[]; allow: string[]; disallow: string[]; delay: number | null };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let inRules = false;
  for (const raw of txt.slice(0, 512_000).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === "user-agent") {
      // Consecutive user-agent lines share one group; a user-agent after rules starts a new group.
      if (!cur || inRules) groups.push((cur = { agents: [], allow: [], disallow: [], delay: null }));
      inRules = false;
      cur.agents.push(value.toLowerCase());
    } else if (cur && (key === "allow" || key === "disallow" || key === "crawl-delay")) {
      inRules = true;
      if (key === "crawl-delay") {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) cur.delay = Math.max(cur.delay ?? 0, n);
      } else if (value) (key === "allow" ? cur.allow : cur.disallow).push(value);
    }
  }
  const own = groups.filter((g) => g.agents.some((a) => a.includes("trendhunter")));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  const delays = chosen.map((g) => g.delay).filter((d): d is number => d != null);
  return { allow: chosen.flatMap((g) => g.allow), disallow: chosen.flatMap((g) => g.disallow), crawlDelayMs: delays.length ? Math.max(...delays) * 1000 : null };
}

/** Length of the longest rule matching `path` ("*" wildcard, "$" end anchor), or -1. */
function longestMatch(rules: string[], path: string): number {
  let best = -1;
  for (const rule of rules) {
    const anchored = rule.endsWith("$");
    const body = (anchored ? rule.slice(0, -1) : rule).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    if (new RegExp(`^${body}${anchored ? "$" : ""}`).test(path)) best = Math.max(best, rule.length);
  }
  return best;
}

/** RFC 9309: the most specific (longest) matching rule wins; on a tie, allow wins. */
export function robotsAllowsPath(rules: RobotsRules, path: string): boolean {
  const disallow = longestMatch(rules.disallow, path);
  return disallow < 0 || longestMatch(rules.allow, path) >= disallow;
}

export type RobotsLookup = { rules: RobotsRules } | { blocked: true } | { failed: FetchErrorCode };
const robotsCache = new Map<string, { at: number; value: RobotsLookup }>();

/**
 * robots.txt for a domain, cached for an hour. 404/410 means no restrictions;
 * any other refusal or server error is treated as "do not crawl" (RFC 9309
 * requires a full disallow when robots.txt is unreachable). Network failures
 * are reported, not cached.
 */
export async function robotsFor(domain: string, deadline?: number): Promise<RobotsLookup> {
  const hit = robotsCache.get(domain);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.value;
  const r = await politeFetch(`https://${domain}/robots.txt`, { deadline, accept: "text/plain" });
  let value: RobotsLookup;
  if (r.ok) value = { rules: parseRobots(await r.res.text()) };
  else if (r.status === 404 || r.status === 410) value = { rules: ALLOW_ALL };
  else if (r.status != null) value = { blocked: true };
  else return { failed: r.code };
  if ("rules" in value && value.rules.crawlDelayMs) pacerFor(`host:${bare(domain)}`, { requests: 1, per: "second" }).slowTo(value.rules.crawlDelayMs);
  robotsCache.set(domain, { at: Date.now(), value });
  return value;
}

/** Whether our crawler may fetch `path` on `domain`. */
export async function robotsAllows(domain: string, path: string, deadline?: number): Promise<boolean> {
  const r = await robotsFor(domain, deadline);
  return "rules" in r && robotsAllowsPath(r.rules, path);
}
