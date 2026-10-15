import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; op: string; rows: unknown; filters: Record<string, unknown> };
const state: { calls: Call[]; fail: (c: Call) => { code: string; message: string } | null; stores: Record<string, unknown>[]; products: Record<string, unknown>[] } = {
  calls: [],
  fail: () => null,
  stores: [],
  products: [],
};

/** Chainable stand-in for the Supabase query builder: records writes, answers reads from `state`. */
function fakeDb() {
  return {
    from(table: string) {
      const q: Call = { table, op: "select", rows: null, filters: {} };
      const result = () => {
        if (q.op === "select") return { data: table === "products" ? state.products : table === "stores" ? state.stores : [], error: null };
        return { error: state.fail(q) };
      };
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => ((q.filters[c] = v), b),
        limit: () => b,
        maybeSingle: async () => ({ data: state.stores.find((s) => s.domain === q.filters.domain) ?? null, error: null }),
        upsert: (rows: unknown) => ((q.op = "upsert"), (q.rows = rows), state.calls.push(q), b),
        insert: (rows: unknown) => ((q.op = "insert"), (q.rows = rows), state.calls.push(q), b),
        update: (rows: unknown) => ((q.op = "update"), (q.rows = rows), state.calls.push(q), b),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
      };
      return b;
    },
  };
}

vi.mock("@/lib/server/supabase", () => ({ supabaseAdmin: () => fakeDb() }));

const { env } = await import("@/lib/server/env");
const { CONNECTORS, connectorStatus } = await import("@/lib/connectors/registry");
const byId = (id: string) => CONNECTORS.find((c) => c.id === id)!;
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
const ctx = { keywords: ["Posture Corrector Brace"], domains: ["shop.example.com", "localhost", "acme-store.com"], countries: ["FR"], since: "2026-10-08" };

beforeEach(() => {
  state.calls = [];
  state.fail = () => null;
  state.stores = [];
  state.products = [{ id: "posture", name: "Posture Corrector Brace", tags: ["posture"], category: "wellness" }];
  Object.assign(env, { supabaseUrl: "http://db.test", supabaseAnonKey: "anon", supabaseServiceRoleKey: "service" });
});
afterEach(() => vi.unstubAllGlobals());

describe("Meta Ad Library sync", () => {
  it("queries per country, maps truthfully and derives activity", async () => {
    env.metaAccessToken = "tok";
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (u: URL | string) => {
      urls.push(new URL(String(u)));
      return json({
        data: [
          { id: "1", page_name: "Acme", ad_creative_bodies: ["Posture corrector brace"], ad_delivery_start_time: "2026-09-01", ad_delivery_stop_time: "2026-09-30", languages: ["fr"] },
          { id: "2", page_name: "Acme", ad_creative_bodies: ["Still running"], ad_delivery_start_time: "2026-10-01" },
          { bogus: true },
        ],
      });
    });
    const r = await byId("meta_ad_library").sync(ctx);
    expect(urls).toHaveLength(1);
    expect(urls[0].searchParams.get("ad_reached_countries")).toBe('["FR"]');
    expect(urls[0].searchParams.get("ad_type")).toBe("ALL");
    expect(urls[0].searchParams.get("fields")).toContain("ad_creative_link_captions");
    const ads = state.calls.find((c) => c.table === "advertisements")!.rows as Record<string, unknown>[];
    expect(ads.map((a) => [a.id, a.product_id, a.product_match_basis, a.format, a.cta])).toEqual([
      ["meta-1", "posture", "search_term", "unknown", "unknown"],
      ["meta-2", "posture", "search_term", "unknown", "unknown"],
    ]);
    const obs = state.calls.find((c) => c.table === "ad_observations")!.rows as { ad_id: string; active: boolean }[];
    expect(obs.map((o) => [o.ad_id, o.active])).toEqual([
      ["meta-1", false],
      ["meta-2", true],
    ]);
    expect(r).toMatchObject({ status: "partial", records: 2, failed: 1 }); // one invalid record
  });

  it("counts database errors instead of reporting success", async () => {
    env.metaAccessToken = "tok";
    vi.stubGlobal("fetch", async () => json({ data: [{ id: "1", page_name: "A", ad_delivery_start_time: "2026-10-01" }] }));
    state.fail = (c) => (c.table === "advertisements" ? { code: "23503", message: "fk" } : null);
    const r = await byId("meta_ad_library").sync(ctx);
    expect(r).toMatchObject({ status: "failed", records: 0, failed: 1 });
  });

  it("stops on Graph API throttling without leaking the token", async () => {
    env.metaAccessToken = "tok-secret";
    vi.stubGlobal("fetch", async () => json({ error: { code: 4, message: "Application request limit reached" } }, { status: 400 }));
    const r = await byId("meta_ad_library").sync({ ...ctx, keywords: ["a", "b"] });
    expect(r.status).toBe("failed");
    expect(r.message).toContain("rate_limited");
    expect(r.message).not.toContain("tok-secret");
  });
});

describe("public storefront sync", () => {
  it("creates the store first, detects platform and currency, records listing provenance", async () => {
    env.storefrontCrawlerEnabled = true;
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (u: URL | string) => {
      const url = new URL(String(u));
      paths.push(url.hostname + url.pathname);
      if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /cart\n", { status: 200 });
      if (url.pathname === "/products.json") return json({ products: [{ id: 10, title: "Brace", handle: "brace", published_at: "2026-05-01T00:00:00Z", variants: [{ price: "29.00" }] }] });
      if (url.pathname === "/meta.json") return json({ name: "Acme Store", country: "FR", currency: "EUR", published_products_count: 1 });
      return new Response("nope", { status: 404 });
    });
    const r = await byId("public_storefronts").sync({ ...ctx, domains: ["acme-store.com", "localhost", "demo.example"] });
    expect(paths.some((p) => p.startsWith("localhost") || p.includes(".example"))).toBe(false);
    expect(paths).not.toContain("acme-store.com/cart.js"); // disallowed by robots.txt
    const writes = state.calls.map((c) => `${c.op}:${c.table}`);
    expect(writes).toEqual(["insert:stores", "upsert:store_products", "upsert:store_snapshots"]);
    const store = state.calls[0].rows as Record<string, unknown>;
    expect(store).toMatchObject({ id: "acme-store-com", name: "Acme Store", currency: "EUR", technology: { platform: "shopify", verified: true }, source_connector: "public_storefronts" });
    const listing = (state.calls[1].rows as Record<string, unknown>[])[0];
    expect(listing).toMatchObject({ store_id: "acme-store-com", currency: "EUR", source_connector: "public_storefronts", source_kind: "measured" });
    expect(listing.observed_at).toBeTruthy();
    expect(r).toMatchObject({ status: "success", records: 1 });
  });

  it("reports listing upsert failures", async () => {
    env.storefrontCrawlerEnabled = true;
    vi.stubGlobal("fetch", async (u: URL | string) => {
      const p = new URL(String(u)).pathname;
      if (p === "/products.json") return json({ products: [{ id: 1, title: "A", handle: "a", variants: [{ price: "5" }] }] });
      return new Response("", { status: 404 });
    });
    state.fail = (c) => (c.table === "store_products" ? { code: "23514", message: "check" } : null);
    const r = await byId("public_storefronts").sync({ ...ctx, domains: ["other-store.com"] });
    expect(r).toMatchObject({ status: "failed", records: 0 });
    expect(r.failed).toBeGreaterThan(0);
  });
});

describe("unimplemented connectors", () => {
  it("are never reported as configured", async () => {
    env.pinterestToken = "set";
    env.trendsApiKey = "set";
    const s = connectorStatus();
    for (const id of ["pinterest_ads_repository", "search_trends"]) {
      expect(s.find((c) => c.id === id)).toMatchObject({ available: false, configured: false });
      expect(await byId(id).sync(ctx)).toMatchObject({ status: "skipped", message: "not_available" });
    }
  });
});
