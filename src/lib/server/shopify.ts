import "server-only";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env, features } from "./env";
import { decrypt, encrypt, hmacHex, safeEqual } from "./crypto";
import { supabaseAdmin } from "./supabase";
import { allProducts, ensureDataset, fold, isLiveDb } from "./repository";
import { DEMO_SNAPSHOT, hashString, prng } from "../demo/generate";
import { addDays } from "../dates";
import { PLANS, isPlan, type PlanId } from "../plans";
import type { ProductWithMetrics } from "../types";

/**
 * Shopify integration for the merchant's OWN store only (OAuth, official Admin
 * GraphQL API). Scopes are limited to read_products, read_orders and
 * read_inventory. Tokens are encrypted at rest and never sent to the browser.
 */

export const SHOP_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;

export function normalizeShop(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const shop = s.endsWith(".myshopify.com") ? s : `${s}.myshopify.com`;
  return SHOP_RE.test(shop) ? shop : null;
}

export function installUrl(shop: string, state: string): string {
  const u = new URL(`https://${shop}/admin/oauth/authorize`);
  u.searchParams.set("client_id", env.shopifyApiKey!);
  u.searchParams.set("scope", env.shopifyScopes);
  u.searchParams.set("redirect_uri", `${env.appUrl}/api/integrations/shopify/callback`);
  u.searchParams.set("state", state);
  return u.toString();
}

/** Verifies the `hmac` query parameter Shopify appends to OAuth redirects. */
export function verifyShopifyHmac(params: URLSearchParams): boolean {
  const hmac = params.get("hmac");
  if (!hmac || !env.shopifyApiSecret) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return safeEqual(hmacHex(env.shopifyApiSecret, message), hmac);
}

/**
 * Verifies a webhook's `X-Shopify-Hmac-Sha256` header: the base64 HMAC-SHA256
 * of the RAW request body, keyed with the app secret, compared in constant time.
 */
export function verifyWebhookHmac(rawBody: Buffer | string, header: string | null | undefined, secret: string | undefined = env.shopifyApiSecret): boolean {
  if (!header || !secret) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
  return safeEqual(digest, header.trim());
}

export async function exchangeCode(shop: string, code: string): Promise<{ access_token: string; scope: string }> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: env.shopifyApiKey, client_secret: env.shopifyApiSecret, code }),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed (${res.status})`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Errors: stored on the integration row and returned to the browser as codes
// only (translated under errors.codes.*), never as raw provider text.
// ---------------------------------------------------------------------------

export const SYNC_ERROR_CODES = ["shopify_revoked", "shopify_access_denied", "shopify_unavailable", "rate_limited", "sync_failed"] as const;
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

export class ShopifyApiError extends Error {
  constructor(
    public code: SyncErrorCode,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

/** Admin API HTTP status → error code. 401/403 mean the token is no longer valid: access was revoked. */
export function codeForStatus(status: number): SyncErrorCode {
  if (status === 401 || status === 403) return "shopify_revoked";
  if (status === 429) return "rate_limited";
  if (status === 402 || status === 404 || status === 423) return "shopify_unavailable"; // frozen, closed or locked store
  return "sync_failed";
}

/** GraphQL `errors` (HTTP 200) → error code. */
export function codeForGraphqlErrors(errors: unknown): SyncErrorCode {
  const codes = Array.isArray(errors) ? errors.map((e) => (e as { extensions?: { code?: string } })?.extensions?.code) : [];
  if (codes.includes("THROTTLED")) return "rate_limited";
  if (codes.includes("ACCESS_DENIED")) return "shopify_access_denied";
  return "sync_failed";
}

export function syncErrorCode(e: unknown): SyncErrorCode {
  return e instanceof ShopifyApiError ? e.code : "sync_failed";
}

/** Code shown for a stored `last_error` (older rows may hold raw provider text, which is never shown). */
export function publicErrorCode(lastError: string | null | undefined): SyncErrorCode | null {
  if (!lastError) return null;
  return (SYNC_ERROR_CODES as readonly string[]).includes(lastError) ? (lastError as SyncErrorCode) : "sync_failed";
}

/** Row update recorded after a failed sync. A revoked integration also loses its stored token. */
export function failurePatch(code: SyncErrorCode, now: string): Record<string, string | null> {
  if (code === "shopify_revoked") return { status: "revoked", access_token_encrypted: null, last_error: code, last_attempt_at: now, updated_at: now };
  return { status: "error", last_error: code, last_attempt_at: now, updated_at: now };
}

async function adminGraphql<T>(shop: string, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://${shop}/admin/api/${env.shopifyApiVersion}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new ShopifyApiError("sync_failed", `Shopify request failed: ${e instanceof Error ? e.message : "network"}`);
  }
  if (!res.ok) throw new ShopifyApiError(codeForStatus(res.status), `Shopify API error ${res.status}`, res.status);
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: unknown } | null;
  if (!body) throw new ShopifyApiError("sync_failed", "Shopify returned an invalid response");
  if (body.errors) throw new ShopifyApiError(codeForGraphqlErrors(body.errors), `Shopify GraphQL error: ${JSON.stringify(body.errors).slice(0, 300)}`);
  return body.data as T;
}

export interface OwnProduct {
  externalId: string;
  title: string;
  status: string;
  price: number | null;
  currency: string;
  /** Total inventory; null when the product does not track inventory. */
  inventory: number | null;
}
export interface OwnSales {
  productExternalId: string;
  date: string;
  units: number;
  revenue: number;
}
export interface InventoryPoint {
  date: string;
  inventory: number;
}

const PRODUCTS_Q = `query($cursor: String) { products(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id title status tracksInventory totalInventory priceRangeV2 { minVariantPrice { amount currencyCode } } } } }`;
const ORDERS_Q = `query($cursor: String, $q: String) { orders(first: 100, after: $cursor, query: $q) { pageInfo { hasNextPage endCursor } nodes { createdAt lineItems(first: 50) { nodes { quantity product { id } originalTotalSet { shopMoney { amount } } } } } } }`;

export async function fetchOwnStore(shop: string, token: string, days = 60): Promise<{ products: OwnProduct[]; sales: OwnSales[] }> {
  const products: OwnProduct[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    type P = { products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { id: string; title: string; status: string; tracksInventory: boolean; totalInventory: number | null; priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } } }[] } };
    const d: P = await adminGraphql<P>(shop, token, PRODUCTS_Q, { cursor });
    for (const n of d.products.nodes)
      products.push({
        externalId: n.id,
        title: n.title,
        status: n.status,
        inventory: n.tracksInventory === false ? null : n.totalInventory,
        price: Number(n.priceRangeV2.minVariantPrice.amount),
        currency: n.priceRangeV2.minVariantPrice.currencyCode,
      });
    if (!d.products.pageInfo.hasNextPage) break;
    cursor = d.products.pageInfo.endCursor;
  }
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const agg = new Map<string, OwnSales>();
  cursor = null;
  for (let page = 0; page < 50; page++) {
    type O = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { createdAt: string; lineItems: { nodes: { quantity: number; product: { id: string } | null; originalTotalSet: { shopMoney: { amount: string } } }[] } }[] } };
    const d: O = await adminGraphql<O>(shop, token, ORDERS_Q, { cursor, q: `created_at:>=${since}` });
    for (const o of d.orders.nodes) {
      const date = o.createdAt.slice(0, 10);
      for (const li of o.lineItems.nodes) {
        if (!li.product) continue;
        const k = `${li.product.id}|${date}`;
        const cur = agg.get(k) ?? { productExternalId: li.product.id, date, units: 0, revenue: 0 };
        cur.units += li.quantity;
        cur.revenue += Number(li.originalTotalSet.shopMoney.amount);
        agg.set(k, cur);
      }
    }
    if (!d.orders.pageInfo.hasNextPage) break;
    cursor = d.orders.pageInfo.endCursor;
  }
  return { products, sales: [...agg.values()] };
}

// ---------------------------------------------------------------------------
// Market comparison
// ---------------------------------------------------------------------------

export interface MarketRef {
  productId: string;
  name: string;
  score: number | null;
  trendGrowth: number | null;
}

export interface OwnPerformanceRow extends OwnProduct {
  units30: number;
  unitsPrev30: number;
  revenue30: number;
  change: number | null;
  declining: boolean;
  lowStock: boolean;
  /** Closest tracked product, or null (no match / no market data). */
  market: MarketRef | null;
  /** "auto": name-similarity estimate; "manual": chosen by the user (a product or "no match"). */
  matchSource: "auto" | "manual";
  /** Daily inventory snapshots over the last 30 days (oldest first). */
  stock: InventoryPoint[];
}

export interface PerformanceContext {
  /** Tracked products to compare with. Empty → "no market data yet". */
  market: ProductWithMetrics[];
  /** Manual matches per own product: a tracked product id, or null for "no match". */
  overrides?: Map<string, string | null>;
  inventory?: Map<string, InventoryPoint[]>;
}

function tokens(s: string) {
  return new Set(fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
}

/** Share of the smaller title's words found in the other title (0..1). */
function similarity(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

const MATCH_THRESHOLD = 0.5;

function marketRef(p: ProductWithMetrics): MarketRef {
  return { productId: p.id, name: p.name, score: p.score.overall, trendGrowth: p.metrics.trendGrowth };
}

/**
 * Automatic match: the tracked product sharing the most title words. This is a
 * heuristic estimate (labelled as such in the UI) that the user can override.
 */
export function estimateMatch(title: string, market: ProductWithMetrics[]): ProductWithMetrics | null {
  const tk = tokens(title);
  let best: ProductWithMetrics | null = null;
  let bestScore = 0;
  for (const m of market) {
    const s = similarity(tk, tokens(m.name));
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best && bestScore >= MATCH_THRESHOLD ? best : null;
}

/** Tracked products ranked for the manual match picker (word overlap, then substring). */
export function searchMarket(q: string, market: ProductWithMetrics[], limit = 8): ProductWithMetrics[] {
  const needle = fold(q.trim());
  if (!needle) return [];
  const tk = tokens(q);
  return market
    .map((p) => ({ p, s: similarity(tk, tokens(p.name)) + (fold(p.name).includes(needle) ? 1 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((x) => x.p);
}

/**
 * Products real sales may be compared with. Live mode never uses demo data:
 * without live research rows the market is empty ("no market data yet").
 */
export function comparableMarket(products: ProductWithMetrics[], liveDb: boolean): ProductWithMetrics[] {
  return liveDb ? products.filter((p) => p.source.kind !== "demo") : [];
}

/** Loads the working research dataset (as research routes do) and returns the comparable products. */
export async function marketProducts(mode: "live" | "mock"): Promise<ProductWithMetrics[]> {
  try {
    await ensureDataset();
  } catch {
    if (mode === "live") return [];
  }
  return mode === "mock" ? allProducts() : comparableMarket(allProducts(), isLiveDb());
}

/** Joins own sales and inventory history with the market match of each own product. */
export function ownPerformance(products: OwnProduct[], sales: OwnSales[], asOf: string, ctx: PerformanceContext): OwnPerformanceRow[] {
  const byId = new Map(ctx.market.map((m) => [m.id, m]));
  const start30 = addDays(asOf, -29);
  const startPrev = addDays(asOf, -59);
  return products.map((p) => {
    const mine = sales.filter((s) => s.productExternalId === p.externalId);
    const units30 = mine.filter((s) => s.date >= start30 && s.date <= asOf).reduce((a, s) => a + s.units, 0);
    const unitsPrev30 = mine.filter((s) => s.date >= startPrev && s.date < start30).reduce((a, s) => a + s.units, 0);
    const revenue30 = Math.round(mine.filter((s) => s.date >= start30 && s.date <= asOf).reduce((a, s) => a + s.revenue, 0) * 100) / 100;
    const change = unitsPrev30 > 0 ? Math.round(((units30 - unitsPrev30) / unitsPrev30) * 1000) / 10 : null;
    const manual = ctx.overrides?.has(p.externalId) ?? false;
    const chosen = manual ? ctx.overrides!.get(p.externalId) : undefined;
    const match = manual ? (chosen ? (byId.get(chosen) ?? null) : null) : estimateMatch(p.title, ctx.market);
    const stock = (ctx.inventory?.get(p.externalId) ?? []).filter((s) => s.date >= start30 && s.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
    return {
      ...p,
      units30,
      unitsPrev30,
      revenue30,
      change,
      declining: change != null && change <= -25,
      lowStock: p.inventory != null && p.inventory < 15,
      market: match ? marketRef(match) : null,
      matchSource: manual ? "manual" : "auto",
      stock,
    };
  });
}

/** Deterministic mock store used when Shopify credentials are not configured. */
export function mockStore(market: ProductWithMetrics[]): { products: OwnProduct[]; sales: OwnSales[]; inventory: Map<string, InventoryPoint[]>; asOf: string } {
  const picks = market.filter((p) => p.priceEstimate != null).slice(0, 9);
  const products: OwnProduct[] = picks.map((p, i) => ({
    externalId: `gid://shopify/Product/mock-${i + 1}`,
    title: p.name,
    status: i === 8 ? "DRAFT" : "ACTIVE",
    price: p.priceEstimate,
    currency: "EUR",
    inventory: Math.floor(prng(hashString(`inv-${p.id}`))() * 140),
  }));
  const sales: OwnSales[] = [];
  products.forEach((p, i) => {
    const rand = prng(hashString(`sales-${p.externalId}`));
    const drift = [1.6, 1.1, 0.5, 1.0, 1.3, 0.6, 0.9, 1.2, 0][i] ?? 1;
    for (let d = 59; d >= 0; d--) {
      const date = addDays(DEMO_SNAPSHOT, -d);
      const base = 3 + i * 0.7;
      const factor = d >= 30 ? 1 : drift;
      const units = Math.max(0, Math.round(base * factor + (rand() - 0.5) * 4));
      if (units) sales.push({ productExternalId: p.externalId, date, units, revenue: Math.round(units * (p.price ?? 0) * 100) / 100 });
    }
  });
  // Inventory history consistent with the mock sales: walking back in time adds the units sold, with periodic restocks.
  const inventory = new Map<string, InventoryPoint[]>();
  for (const p of products) {
    const sold = new Map(sales.filter((s) => s.productExternalId === p.externalId).map((s) => [s.date, s.units]));
    const points: InventoryPoint[] = [];
    let level = p.inventory ?? 0;
    for (let d = 0; d < 30; d++) {
      const date = addDays(DEMO_SNAPSHOT, -d);
      points.push({ date, inventory: level });
      level += sold.get(date) ?? 0;
      if (level > 160) level -= 120; // a restock of 120 units arrived that day
    }
    inventory.set(p.externalId, points.reverse());
  }
  return { products, sales, inventory, asOf: DEMO_SNAPSHOT };
}

/** Mock mode has no database: manual matches of the mock store live in this visitor's cookie. */
export const MOCK_MATCH_COOKIE = "th_shopify_mock_matches";

export function parseMockMatches(raw: string | undefined): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!raw) return out;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      for (const [k, v] of Object.entries(parsed).slice(0, 50)) if (k.startsWith("gid://shopify/Product/mock-") && (v === null || typeof v === "string")) out.set(k, v ? v.slice(0, 200) : null);
  } catch {
    // Ignore a malformed cookie.
  }
  return out;
}

export function serializeMockMatches(matches: Map<string, string | null>): string {
  return Buffer.from(JSON.stringify(Object.fromEntries(matches)), "utf8").toString("base64url");
}

export function shopifyMode(): "live" | "mock" {
  return features().shopify ? "live" : "mock";
}

// ---------------------------------------------------------------------------
// Plan limits: number of stores per plan (0 when the plan has no integration)
// ---------------------------------------------------------------------------

export function storeLimit(plan: PlanId): number {
  const e = PLANS[plan].entitlements;
  return e.shopifyIntegration ? e.shopifyStores : 0;
}

/**
 * Connections in creation order; those beyond the plan's store limit (e.g.
 * after a downgrade) are kept so they can be disconnected, but are neither
 * synchronized nor shown.
 */
export function withinStoreLimit<T extends { id: string; createdAt: string }>(rows: T[], limit: number): (T & { overLimit: boolean })[] {
  return [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((r, i) => ({ ...r, overLimit: i >= limit }));
}

/** A shop can be connected when it is already connected (reconnect) or the plan has a free slot. */
export function canAddStore(connectedShops: string[], shop: string, limit: number): boolean {
  return connectedShops.includes(shop) || connectedShops.length < limit;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Inventory snapshots are kept as long as the connector's documented retention. */
export const INVENTORY_RETENTION_DAYS = 400;
const PAGE = 1000;

async function selectAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function upsertChunks(db: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict?: string) {
  for (let i = 0; i < rows.length; i += PAGE) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + PAGE), onConflict ? { onConflict } : undefined);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/** Synced data of one integration (RLS client for the owner, or the service role). */
export async function loadOwnStoreData(sb: SupabaseClient, integrationId: string, asOf: string) {
  const [prods, sales, snaps, matches] = await Promise.all([
    selectAll<{ external_id: string; title: string; status: string | null; price: number | string | null; currency: string | null; inventory: number | null }>((a, b) =>
      sb.from("own_store_products").select("external_id, title, status, price, currency, inventory").eq("integration_id", integrationId).order("external_id").range(a, b),
    ),
    selectAll<{ product_external_id: string; date: string; units: number; revenue: number | string }>((a, b) =>
      sb
        .from("own_store_daily_sales")
        .select("product_external_id, date, units, revenue")
        .eq("integration_id", integrationId)
        .gte("date", addDays(asOf, -59))
        .order("date")
        .order("product_external_id")
        .range(a, b),
    ),
    selectAll<{ product_external_id: string; date: string; inventory: number }>((a, b) =>
      sb
        .from("own_store_inventory_snapshots")
        .select("product_external_id, date, inventory")
        .eq("integration_id", integrationId)
        .gte("date", addDays(asOf, -29))
        .order("date")
        .order("product_external_id")
        .range(a, b),
    ),
    selectAll<{ product_external_id: string; market_product_id: string | null }>((a, b) =>
      sb.from("own_store_market_matches").select("product_external_id, market_product_id").eq("integration_id", integrationId).order("product_external_id").range(a, b),
    ),
  ]);
  const inventory = new Map<string, InventoryPoint[]>();
  for (const s of snaps) {
    const list = inventory.get(s.product_external_id) ?? [];
    list.push({ date: s.date, inventory: s.inventory });
    inventory.set(s.product_external_id, list);
  }
  return {
    products: prods.map((p): OwnProduct => ({ externalId: p.external_id, title: p.title, status: p.status ?? "", price: p.price == null ? null : Number(p.price), currency: p.currency ?? "EUR", inventory: p.inventory })),
    sales: sales.map((s): OwnSales => ({ productExternalId: s.product_external_id, date: s.date, units: s.units, revenue: Number(s.revenue) })),
    inventory,
    overrides: new Map(matches.map((m) => [m.product_external_id, m.market_product_id])),
  };
}

export async function storeIntegration(userId: string, organizationId: string | null, shop: string, token: string, scope: string) {
  const db = supabaseAdmin();
  if (!db) throw new Error("Database not configured");
  const { error } = await db.from("connected_integrations").upsert(
    {
      user_id: userId,
      organization_id: organizationId,
      provider: "shopify",
      external_account: shop,
      scopes: scope.split(","),
      access_token_encrypted: encrypt(token),
      status: "connected",
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider,external_account" },
  );
  if (error) throw error;
}

/**
 * Syncs one integration: products, today's inventory snapshot and 60 days of
 * orders → own_store_* tables. Failures are recorded on the row as a code; a
 * 401/403 marks the integration revoked and deletes its token.
 */
export async function syncIntegration(integrationId: string, client?: SupabaseClient | null) {
  const db = client ?? supabaseAdmin();
  if (!db) throw new Error("Database not configured");
  const { data: row, error } = await db.from("connected_integrations").select("id, external_account, access_token_encrypted").eq("id", integrationId).single();
  if (error || !row) throw error ?? new Error("Integration not found");
  try {
    if (!row.access_token_encrypted) throw new ShopifyApiError("shopify_revoked", "No stored access token");
    const { products, sales } = await fetchOwnStore(row.external_account, decrypt(row.access_token_encrypted));
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    await upsertChunks(
      db,
      "own_store_products",
      products.map((p) => ({ integration_id: row.id, external_id: p.externalId, title: p.title, status: p.status, price: p.price, currency: p.currency, inventory: p.inventory, updated_at: now })),
    );
    // One inventory snapshot per product and day (a later sync the same day replaces it).
    await upsertChunks(
      db,
      "own_store_inventory_snapshots",
      products.filter((p) => p.inventory != null).map((p) => ({ integration_id: row.id, product_external_id: p.externalId, date: today, inventory: p.inventory })),
    );
    await db.from("own_store_inventory_snapshots").delete().eq("integration_id", row.id).lt("date", addDays(today, -INVENTORY_RETENTION_DAYS));
    await upsertChunks(
      db,
      "own_store_daily_sales",
      sales.map((s) => ({ integration_id: row.id, product_external_id: s.productExternalId, date: s.date, units: s.units, revenue: s.revenue })),
    );
    // Not if the access was revoked meanwhile (webhook): the token is gone and the row stays revoked.
    await db
      .from("connected_integrations")
      .update({ last_sync_at: now, last_attempt_at: now, status: "connected", last_error: null, updated_at: now })
      .eq("id", row.id)
      .not("access_token_encrypted", "is", null);
    return { products: products.length, salesRows: sales.length };
  } catch (e) {
    const code = syncErrorCode(e);
    console.error(`[shopify] sync of integration ${row.id} failed (${code}): ${e instanceof Error ? e.message : "unknown error"}`);
    await db.from("connected_integrations").update(failurePatch(code, new Date().toISOString())).eq("id", row.id);
    throw e instanceof ShopifyApiError ? e : new ShopifyApiError(code, e instanceof Error ? e.message : "sync failed");
  }
}

// ---------------------------------------------------------------------------
// Scheduled sync (service role): called by the daily cron
// ---------------------------------------------------------------------------

/** Default interval between automatic syncs (daily). */
export const SYNC_INTERVAL_HOURS = 24;
/** A daily cron fires at the same time each day: a sync finished slightly less than 24 h ago is still due. */
const SYNC_GRACE_MS = 60 * 60_000;

export interface DueCandidate {
  id: string;
  userId: string;
  createdAt: string;
  status: string;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  intervalHours: number;
}

export function isSyncDue(c: Pick<DueCandidate, "lastSyncAt" | "lastAttemptAt" | "intervalHours">, now: Date): boolean {
  const last = [c.lastSyncAt, c.lastAttemptAt].filter((x): x is string => Boolean(x)).map((x) => Date.parse(x));
  if (!last.length) return true;
  return now.getTime() - Math.max(...last) >= Math.max(1, c.intervalHours) * 3_600_000 - SYNC_GRACE_MS;
}

/**
 * Integrations to sync now: not revoked, within the owner's plan store limit,
 * and whose last sync (or attempt) is older than their interval. Oldest first.
 */
export function selectDueIntegrations(rows: DueCandidate[], limitFor: (userId: string) => number, now: Date): { due: DueCandidate[]; skipped: number } {
  const byUser = new Map<string, DueCandidate[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  const due: DueCandidate[] = [];
  let skipped = 0;
  for (const [userId, list] of byUser) {
    for (const r of withinStoreLimit(list, limitFor(userId))) {
      if (r.status === "revoked") continue;
      if (r.overLimit) skipped++;
      else if (isSyncDue(r, now)) due.push(r);
    }
  }
  const lastOf = (r: DueCandidate) => r.lastSyncAt ?? r.lastAttemptAt ?? "";
  due.sort((a, b) => lastOf(a).localeCompare(lastOf(b)) || a.id.localeCompare(b.id));
  return { due, skipped };
}

const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, business: 2 };

/** Plan per organization from active/trialing subscriptions (best plan wins), as the database's org_plan(). */
async function orgPlans(db: SupabaseClient, orgIds: string[]): Promise<Map<string, PlanId>> {
  const plans = new Map<string, PlanId>();
  for (let i = 0; i < orgIds.length; i += 100) {
    const { data, error } = await db.from("subscriptions").select("organization_id, plan, status").in("organization_id", orgIds.slice(i, i + 100)).in("status", ["active", "trialing"]);
    if (error) throw error;
    for (const s of data ?? []) {
      if (!isPlan(s.plan)) continue;
      const cur = plans.get(s.organization_id);
      if (!cur || PLAN_RANK[s.plan] > PLAN_RANK[cur]) plans.set(s.organization_id, s.plan);
    }
  }
  return plans;
}

export interface DueSyncResult {
  configured: boolean;
  /** Integrations examined (all statuses). */
  checked: number;
  due: number;
  synced: number;
  failed: number;
  /** Failed because access was revoked (now marked revoked, token deleted). */
  revoked: number;
  /** Not synced because the owner's plan no longer includes them. */
  skipped: number;
  /** Due but left for the next run (time budget or per-run cap reached). */
  deferred: number;
}

/**
 * Syncs every connected, non-revoked Shopify integration whose last sync is
 * older than its interval (daily by default). Uses the service role; errors
 * are recorded on each row. Intended for the daily cron.
 */
export async function syncDueShopifyIntegrations(opts: { now?: Date; max?: number; timeBudgetMs?: number } = {}): Promise<DueSyncResult> {
  const result: DueSyncResult = { configured: false, checked: 0, due: 0, synced: 0, failed: 0, revoked: 0, skipped: 0, deferred: 0 };
  const db = supabaseAdmin();
  if (!features().shopify || !db) return result;
  result.configured = true;
  const now = opts.now ?? new Date();
  const started = Date.now();
  const rows = await selectAll<{ id: string; user_id: string; organization_id: string | null; status: string; created_at: string; last_sync_at: string | null; last_attempt_at: string | null; sync_interval_hours: number | null }>((a, b) =>
    db.from("connected_integrations").select("id, user_id, organization_id, status, created_at, last_sync_at, last_attempt_at, sync_interval_hours").eq("provider", "shopify").order("id").range(a, b),
  );
  result.checked = rows.length;
  const plans = await orgPlans(db, [...new Set(rows.map((r) => r.organization_id).filter((o): o is string => Boolean(o)))]);
  const userPlan = new Map<string, PlanId>();
  for (const r of rows) {
    const plan = (r.organization_id && plans.get(r.organization_id)) || "free";
    const cur = userPlan.get(r.user_id);
    if (!cur || PLAN_RANK[plan] > PLAN_RANK[cur]) userPlan.set(r.user_id, plan);
  }
  const { due, skipped } = selectDueIntegrations(
    rows.map((r) => ({ id: r.id, userId: r.user_id, createdAt: r.created_at, status: r.status, lastSyncAt: r.last_sync_at, lastAttemptAt: r.last_attempt_at, intervalHours: r.sync_interval_hours ?? SYNC_INTERVAL_HOURS })),
    (userId) => storeLimit(userPlan.get(userId) ?? "free"),
    now,
  );
  result.due = due.length;
  result.skipped = skipped;
  const max = opts.max ?? 200;
  const budget = opts.timeBudgetMs ?? 120_000;
  for (const [i, r] of due.entries()) {
    if (i >= max || Date.now() - started > budget) {
      result.deferred = due.length - i;
      break;
    }
    try {
      await syncIntegration(r.id, db);
      result.synced++;
    } catch (e) {
      if (syncErrorCode(e) === "shopify_revoked") result.revoked++;
      else result.failed++;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Webhooks (app/uninstalled and the mandatory privacy topics)
// ---------------------------------------------------------------------------

export type WebhookAction = "revoke" | "redact_shop" | "acknowledge";

/** What a webhook topic requires. No customer personal data is stored (orders are aggregated per product and day). */
export function webhookAction(topic: string): WebhookAction {
  if (topic === "app/uninstalled") return "revoke";
  if (topic === "shop/redact") return "redact_shop";
  return "acknowledge"; // customers/data_request, customers/redact and any other topic
}

/** The app was uninstalled: every token for this shop is invalid. Rows stay (status shown), tokens are deleted. */
export async function revokeShop(db: SupabaseClient, shop: string) {
  const now = new Date().toISOString();
  const { error } = await db
    .from("connected_integrations")
    .update({ status: "revoked", access_token_encrypted: null, last_error: "shopify_revoked", updated_at: now })
    .eq("provider", "shopify")
    .eq("external_account", shop);
  if (error) throw error;
}

/**
 * shop/redact (sent 48 h after an uninstall): deletes everything synchronized
 * from this shop and makes sure no token remains, so nothing is synced again.
 * The revoked connection row stays visible to its owner until disconnected.
 */
export async function redactShop(db: SupabaseClient, shop: string) {
  const { data, error } = await db.from("connected_integrations").select("id").eq("provider", "shopify").eq("external_account", shop);
  if (error) throw error;
  const ids = (data ?? []).map((r) => r.id as string);
  if (!ids.length) return;
  const { error: revokeError } = await db
    .from("connected_integrations")
    .update({ status: "revoked", access_token_encrypted: null, last_error: "shopify_revoked", last_sync_at: null, updated_at: new Date().toISOString() })
    .in("id", ids);
  if (revokeError) throw revokeError;
  for (const table of ["own_store_market_matches", "own_store_inventory_snapshots", "own_store_daily_sales", "own_store_products"]) {
    const { error: e } = await db.from(table).delete().in("integration_id", ids);
    if (e) throw e;
  }
}
