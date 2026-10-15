import { describe, expect, it } from "vitest";
import { Pacer, backoffMs, connectorFetch, parseRobots, retryAfterMs, robotsAllowsPath, type Clock } from "@/lib/connectors/http";

function fakeClock(): Clock & { t: number; slept: number[] } {
  const c = {
    t: 1_000_000,
    slept: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.slept.push(ms);
      c.t += ms;
    },
  };
  return c;
}

const res = (status: number, headers: Record<string, string> = {}) => new Response(status === 204 ? null : "{}", { status, headers });

describe("connector HTTP helper", () => {
  it("paces requests from the declared rate limit", async () => {
    const clock = fakeClock();
    const p = new Pacer({ requests: 3, per: "minute" }, clock);
    for (let i = 0; i < 4; i++) await p.take();
    // 1 s spacing, then the 4th request waits for the 60 s window to free.
    expect(clock.slept).toEqual([1000, 1000, 58_000]);
    expect(await new Pacer({ requests: 1, per: "hour" }, clock).take()).toBe(true);
  });

  it("refuses a slot past the deadline", async () => {
    const clock = fakeClock();
    const p = new Pacer({ requests: 1, per: "minute" }, clock);
    await p.take();
    expect(await p.take(clock.now() + 1000)).toBe(false);
  });

  it("parses Retry-After and backs off exponentially", () => {
    expect(retryAfterMs("7")).toBe(7000);
    expect(retryAfterMs(new Date(2_000_000 + 5000).toUTCString(), 2_000_000)).toBe(5000);
    expect(retryAfterMs("soon")).toBeNull();
    expect(backoffMs(0, 1000, () => 0.5)).toBe(1000);
    expect(backoffMs(2, 1000, () => 0.5)).toBe(4000);
  });

  it("retries 429/5xx honouring Retry-After, then succeeds", async () => {
    const clock = fakeClock();
    const seq = [res(429, { "retry-after": "3" }), res(503), res(200)];
    let calls = 0;
    const r = await connectorFetch("https://api.test/x", {}, { clock, fetchImpl: (async () => seq[calls++]) as typeof fetch, retries: 2, baseDelayMs: 100 });
    expect(r.ok).toBe(true);
    expect(calls).toBe(3);
    expect(clock.slept[0]).toBe(3000);
  });

  it("does not retry client errors and stops after the retry budget", async () => {
    const clock = fakeClock();
    let calls = 0;
    const r400 = await connectorFetch("https://api.test/x", {}, { clock, fetchImpl: (async () => (calls++, res(400))) as typeof fetch });
    expect(r400).toMatchObject({ ok: false, code: "http_400", status: 400 });
    expect(calls).toBe(1);
    calls = 0;
    const r500 = await connectorFetch("https://api.test/x", {}, { clock, fetchImpl: (async () => (calls++, res(500))) as typeof fetch, retries: 2, baseDelayMs: 10 });
    expect(r500).toMatchObject({ ok: false, code: "http_500" });
    expect(calls).toBe(3);
  });

  it("gives up when Retry-After exceeds the accepted wait", async () => {
    const clock = fakeClock();
    let calls = 0;
    const r = await connectorFetch("https://api.test/x", {}, { clock, fetchImpl: (async () => (calls++, res(429, { "retry-after": "3600" }))) as typeof fetch });
    expect(r).toMatchObject({ ok: false, code: "rate_limited" });
    expect(calls).toBe(1);
  });

  it("reports timeouts via AbortSignal", async () => {
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as typeof fetch;
    const r = await connectorFetch("https://api.test/x", {}, { fetchImpl: hang, timeoutMs: 20, retries: 0 });
    expect(r).toMatchObject({ ok: false, code: "timeout" });
  });

  it("applies robots.txt groups, longest match and crawl-delay", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /cart\nAllow: /cart/public\nCrawl-delay: 2\n\nUser-agent: OtherBot\nDisallow: /\n");
    expect(robotsAllowsPath(rules, "/products.json")).toBe(true);
    expect(robotsAllowsPath(rules, "/cart.js")).toBe(false);
    expect(robotsAllowsPath(rules, "/cart/public/x")).toBe(true);
    expect(rules.crawlDelayMs).toBe(2000);
    const own = parseRobots("User-agent: *\nAllow: /\n\nUser-agent: TrendHunterBot\nDisallow: /products\n");
    expect(robotsAllowsPath(own, "/products.json")).toBe(false);
    expect(robotsAllowsPath(parseRobots("User-agent: *\nDisallow: /*.json$\n"), "/products.json")).toBe(false);
  });
});
