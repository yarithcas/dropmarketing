import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// The server env is read at import time: configure it before the modules load.
vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.SHOPIFY_API_SECRET = "test-secret";
});

import {
  ShopifyApiError,
  canAddStore,
  codeForGraphqlErrors,
  codeForStatus,
  comparableMarket,
  failurePatch,
  fetchOwnStore,
  isSyncDue,
  ownPerformance,
  parseMockMatches,
  publicErrorCode,
  selectDueIntegrations,
  serializeMockMatches,
  storeLimit,
  syncIntegration,
  verifyWebhookHmac,
  webhookAction,
  withinStoreLimit,
  type DueCandidate,
} from "@/lib/server/shopify";
import { encrypt } from "@/lib/server/crypto";
import type { ProductWithMetrics } from "@/lib/types";

const sign = (body: string | Buffer, secret = "test-secret") => createHmac("sha256", secret).update(body).digest("base64");

function stubFetch(...responses: (() => Response)[]) {
  const fn = vi.fn(async () => (responses.shift() ?? (() => new Response("{}", { status: 500 })))());
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Minimal chainable stand-in for the Supabase client that records every call. */
function fakeDb(row: Record<string, unknown>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const db = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "update", "upsert", "delete", "insert", "eq", "neq", "not", "lt", "gte", "in", "order", "range"])
        chain[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return chain;
        };
      chain.single = () => Promise.resolve({ data: row, error: null });
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve, reject);
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("webhook HMAC", () => {
  const body = JSON.stringify({ shop_domain: "my-store.myshopify.com", note: "café ✓" });

  it("accepts the base64 HMAC-SHA256 of the raw body", () => {
    expect(verifyWebhookHmac(Buffer.from(body), sign(body))).toBe(true);
    expect(verifyWebhookHmac(body, ` ${sign(body)} `)).toBe(true);
  });

  it("rejects tampered bodies, other secrets and missing or malformed headers", () => {
    expect(verifyWebhookHmac(body.replace("café", "cafe"), sign(body))).toBe(false);
    expect(verifyWebhookHmac(body, sign(body, "other-secret"))).toBe(false);
    expect(verifyWebhookHmac(body, null)).toBe(false);
    expect(verifyWebhookHmac(body, "")).toBe(false);
    expect(verifyWebhookHmac(body, "short")).toBe(false);
    expect(verifyWebhookHmac(body, createHmac("sha256", "test-secret").update(body).digest("hex"))).toBe(false);
    expect(verifyWebhookHmac(body, sign(body), undefined)).toBe(true); // default: SHOPIFY_API_SECRET
    expect(verifyWebhookHmac(body, sign(body), "")).toBe(false);
  });

  it("maps topics to actions", () => {
    expect(webhookAction("app/uninstalled")).toBe("revoke");
    expect(webhookAction("shop/redact")).toBe("redact_shop");
    expect(webhookAction("customers/data_request")).toBe("acknowledge");
    expect(webhookAction("customers/redact")).toBe("acknowledge");
    expect(webhookAction("products/update")).toBe("acknowledge");
  });
});

describe("Shopify errors", () => {
  it("maps 401/403 to revoked and other statuses to codes", () => {
    expect(codeForStatus(401)).toBe("shopify_revoked");
    expect(codeForStatus(403)).toBe("shopify_revoked");
    expect(codeForStatus(429)).toBe("rate_limited");
    expect(codeForStatus(402)).toBe("shopify_unavailable");
    expect(codeForStatus(404)).toBe("shopify_unavailable");
    expect(codeForStatus(500)).toBe("sync_failed");
    expect(codeForGraphqlErrors([{ message: "x", extensions: { code: "THROTTLED" } }])).toBe("rate_limited");
    expect(codeForGraphqlErrors([{ message: "x", extensions: { code: "ACCESS_DENIED" } }])).toBe("shopify_access_denied");
    expect(codeForGraphqlErrors("weird")).toBe("sync_failed");
  });

  it("never exposes raw provider text", () => {
    expect(publicErrorCode("Shopify API error 401")).toBe("sync_failed");
    expect(publicErrorCode("shopify_revoked")).toBe("shopify_revoked");
    expect(publicErrorCode(null)).toBeNull();
  });

  it("revocation deletes the stored token", () => {
    expect(failurePatch("shopify_revoked", "t")).toMatchObject({ status: "revoked", access_token_encrypted: null, last_error: "shopify_revoked" });
    const other = failurePatch("rate_limited", "t");
    expect(other).toMatchObject({ status: "error", last_error: "rate_limited" });
    expect(other).not.toHaveProperty("access_token_encrypted");
  });

  it.each([401, 403])("fetchOwnStore throws a revoked error on HTTP %i", async (status) => {
    stubFetch(() => new Response("Unauthorized", { status }));
    const err = await fetchOwnStore("my-store.myshopify.com", "tok").catch((e) => e);
    expect(err).toBeInstanceOf(ShopifyApiError);
    expect(err.code).toBe("shopify_revoked");
  });

  it("maps GraphQL throttling to rate_limited", async () => {
    stubFetch(() => Response.json({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }));
    await expect(fetchOwnStore("my-store.myshopify.com", "tok")).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("syncIntegration", () => {
  const productsPage = () =>
    Response.json({
      data: {
        products: {
          pageInfo: { hasNextPage: false, endCursor: "c" },
          nodes: [
            { id: "gid://shopify/Product/1", title: "Lampe lune", status: "ACTIVE", tracksInventory: true, totalInventory: 12, priceRangeV2: { minVariantPrice: { amount: "19.90", currencyCode: "USD" } } },
            { id: "gid://shopify/Product/2", title: "E-book", status: "ACTIVE", tracksInventory: false, totalInventory: 0, priceRangeV2: { minVariantPrice: { amount: "5.00", currencyCode: "USD" } } },
          ],
        },
      },
    });
  const ordersPage = () =>
    Response.json({
      data: {
        orders: {
          pageInfo: { hasNextPage: false, endCursor: "c" },
          nodes: [{ createdAt: "2026-10-14T10:00:00Z", lineItems: { nodes: [{ quantity: 2, product: { id: "gid://shopify/Product/1" }, originalTotalSet: { shopMoney: { amount: "39.80" } } }] } }],
        },
      },
    });

  it("marks the integration revoked and deletes its token on 401", async () => {
    stubFetch(() => new Response("", { status: 401 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = fakeDb({ id: "i1", external_account: "my-store.myshopify.com", access_token_encrypted: encrypt("tok") });
    await expect(syncIntegration("i1", db)).rejects.toMatchObject({ code: "shopify_revoked" });
    const update = calls.find((c) => c.table === "connected_integrations" && c.method === "update");
    expect(update?.args[0]).toMatchObject({ status: "revoked", access_token_encrypted: null, last_error: "shopify_revoked" });
    expect(calls.some((c) => c.table.startsWith("own_store"))).toBe(false);
  });

  it("does not call Shopify without a stored token", async () => {
    const fetchFn = stubFetch();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({ id: "i1", external_account: "my-store.myshopify.com", access_token_encrypted: null });
    await expect(syncIntegration("i1", db)).rejects.toMatchObject({ code: "shopify_revoked" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("stores products with their currency, a daily inventory snapshot and sales", async () => {
    stubFetch(productsPage, ordersPage);
    const { db, calls } = fakeDb({ id: "i1", external_account: "my-store.myshopify.com", access_token_encrypted: encrypt("tok") });
    expect(await syncIntegration("i1", db)).toEqual({ products: 2, salesRows: 1 });
    const upsert = (table: string) => calls.find((c) => c.table === table && c.method === "upsert")?.args[0] as Record<string, unknown>[];
    expect(upsert("own_store_products")).toEqual([
      expect.objectContaining({ external_id: "gid://shopify/Product/1", currency: "USD", inventory: 12 }),
      expect.objectContaining({ external_id: "gid://shopify/Product/2", inventory: null }),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    expect(upsert("own_store_inventory_snapshots")).toEqual([{ integration_id: "i1", product_external_id: "gid://shopify/Product/1", date: today, inventory: 12 }]);
    expect(upsert("own_store_daily_sales")).toEqual([{ integration_id: "i1", product_external_id: "gid://shopify/Product/1", date: "2026-10-14", units: 2, revenue: 39.8 }]);
    const success = calls.find((c) => c.table === "connected_integrations" && c.method === "update");
    expect(success?.args[0]).toMatchObject({ status: "connected", last_error: null });
    // A revocation that lands during the sync is not overwritten.
    expect(calls).toContainEqual({ table: "connected_integrations", method: "not", args: ["access_token_encrypted", "is", null] });
  });
});

describe("scheduled sync selection", () => {
  const now = new Date("2026-10-15T05:15:00Z");
  const row = (over: Partial<DueCandidate>): DueCandidate => ({
    id: "a",
    userId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    status: "connected",
    lastSyncAt: null,
    lastAttemptAt: null,
    intervalHours: 24,
    ...over,
  });

  it("is due when never synced or older than the interval (with a grace for the daily cron)", () => {
    expect(isSyncDue(row({}), now)).toBe(true);
    expect(isSyncDue(row({ lastSyncAt: "2026-10-14T05:16:30Z" }), now)).toBe(true); // 23h58 ago
    expect(isSyncDue(row({ lastSyncAt: "2026-10-15T01:00:00Z" }), now)).toBe(false);
    expect(isSyncDue(row({ lastSyncAt: "2026-10-13T05:00:00Z", lastAttemptAt: "2026-10-15T04:00:00Z" }), now)).toBe(false); // failed attempt 1 h ago
    expect(isSyncDue(row({ lastSyncAt: "2026-10-15T01:00:00Z", intervalHours: 2 }), now)).toBe(true);
  });

  it("skips revoked stores and stores beyond the plan limit, oldest first", () => {
    const rows = [
      row({ id: "u1-first", createdAt: "2026-01-01T00:00:00Z", lastSyncAt: "2026-10-13T00:00:00Z" }),
      row({ id: "u1-second", createdAt: "2026-02-01T00:00:00Z" }),
      row({ id: "u2-revoked", userId: "u2", status: "revoked" }),
      row({ id: "u2-error", userId: "u2", createdAt: "2026-03-01T00:00:00Z", status: "error", lastSyncAt: "2026-10-10T00:00:00Z" }),
      row({ id: "u3-free", userId: "u3" }),
      row({ id: "u4-fresh", userId: "u4", lastSyncAt: "2026-10-15T04:00:00Z" }),
    ];
    const limits: Record<string, number> = { u1: 1, u2: 5, u3: 0, u4: 1 };
    const { due, skipped } = selectDueIntegrations(rows, (u) => limits[u], now);
    expect(due.map((r) => r.id)).toEqual(["u2-error", "u1-first"]);
    expect(skipped).toBe(2); // u1-second (over the Pro limit) and u3-free (no integration on Free)
  });
});

describe("plan store limits", () => {
  it("follows the plan entitlements", () => {
    expect([storeLimit("free"), storeLimit("pro"), storeLimit("business")]).toEqual([0, 1, 5]);
  });

  it("allows reconnecting a known shop but not a new one beyond the limit", () => {
    expect(canAddStore([], "a.myshopify.com", 1)).toBe(true);
    expect(canAddStore(["a.myshopify.com"], "a.myshopify.com", 1)).toBe(true);
    expect(canAddStore(["a.myshopify.com"], "b.myshopify.com", 1)).toBe(false);
    expect(canAddStore(["a.myshopify.com"], "b.myshopify.com", 5)).toBe(true);
    expect(canAddStore([], "a.myshopify.com", 0)).toBe(false);
  });

  it("marks connections beyond the limit in creation order", () => {
    const rows = [
      { id: "b", createdAt: "2026-02-01" },
      { id: "a", createdAt: "2026-01-01" },
    ];
    expect(withinStoreLimit(rows, 1).map((r) => [r.id, r.overLimit])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });
});

describe("own performance vs market", () => {
  const product = (id: string, name: string, kind: "demo" | "measured"): ProductWithMetrics =>
    ({ id, name, source: { connector: kind === "demo" ? "demo" : "meta_ad_library", kind, observedAt: "2026-10-01" }, score: { overall: 70 }, metrics: { trendGrowth: 12 } }) as unknown as ProductWithMetrics;
  const own = [{ externalId: "g1", title: "Lampe lune 3D", status: "ACTIVE", price: 20, currency: "EUR", inventory: 10 }];
  const asOf = "2026-10-15";

  it("never compares real sales with demo products", () => {
    const market = [product("demo-1", "Lampe lune 3D", "demo"), product("live-1", "Lampe lune LED", "measured")];
    expect(comparableMarket(market, true).map((p) => p.id)).toEqual(["live-1"]);
    expect(comparableMarket(market, false)).toEqual([]);
    const [row] = ownPerformance(own, [], asOf, { market: [] });
    expect(row.market).toBeNull();
  });

  it("labels the automatic match as an estimate and applies manual overrides", () => {
    const market = [product("live-1", "Lampe lune LED", "measured"), product("live-2", "Tapis de yoga", "measured")];
    expect(ownPerformance(own, [], asOf, { market })[0]).toMatchObject({ matchSource: "auto", market: { productId: "live-1", score: 70, trendGrowth: 12 } });
    expect(ownPerformance(own, [], asOf, { market, overrides: new Map([["g1", "live-2"]]) })[0]).toMatchObject({ matchSource: "manual", market: { productId: "live-2" } });
    expect(ownPerformance(own, [], asOf, { market, overrides: new Map([["g1", null]]) })[0]).toMatchObject({ matchSource: "manual", market: null });
    // A manual match to a product that is not in the comparable market shows no market data.
    expect(ownPerformance(own, [], asOf, { market, overrides: new Map([["g1", "demo-1"]]) })[0].market).toBeNull();
  });

  it("returns the last 30 days of inventory snapshots", () => {
    const inventory = new Map([
      [
        "g1",
        [
          { date: "2026-10-15", inventory: 10 },
          { date: "2026-09-01", inventory: 99 },
          { date: "2026-10-01", inventory: 40 },
        ],
      ],
    ]);
    expect(ownPerformance(own, [], asOf, { market: [], inventory })[0].stock).toEqual([
      { date: "2026-10-01", inventory: 40 },
      { date: "2026-10-15", inventory: 10 },
    ]);
  });

  it("round-trips mock-mode matches through the cookie and ignores junk", () => {
    const m = new Map<string, string | null>([
      ["gid://shopify/Product/mock-1", "p1"],
      ["gid://shopify/Product/mock-2", null],
    ]);
    expect(parseMockMatches(serializeMockMatches(m))).toEqual(m);
    expect(parseMockMatches("not-base64-json").size).toBe(0);
    expect(parseMockMatches(Buffer.from(JSON.stringify({ evil: "x" })).toString("base64url")).size).toBe(0);
  });
});
