import "server-only";
import { env, features } from "./env";
import { decrypt, encrypt, hmacHex, safeEqual } from "./crypto";
import { supabaseAdmin } from "./supabase";
import { allProducts } from "./repository";
import { DEMO_SNAPSHOT, hashString, prng } from "../demo/generate";
import { addDays } from "../dates";

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

export async function exchangeCode(shop: string, code: string): Promise<{ access_token: string; scope: string }> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: env.shopifyApiKey, client_secret: env.shopifyApiSecret, code }),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed (${res.status})`);
  return res.json();
}

async function adminGraphql<T>(shop: string, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/${env.shopifyApiVersion}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429) throw new Error("Shopify rate limit reached; retry later");
  if (!res.ok) throw new Error(`Shopify API error ${res.status}`);
  const body = await res.json();
  if (body.errors) throw new Error(`Shopify GraphQL error: ${JSON.stringify(body.errors).slice(0, 300)}`);
  return body.data as T;
}

export interface OwnProduct {
  externalId: string;
  title: string;
  status: string;
  price: number | null;
  currency: string;
  inventory: number | null;
}
export interface OwnSales {
  productExternalId: string;
  date: string;
  units: number;
  revenue: number;
}

const PRODUCTS_Q = `query($cursor: String) { products(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id title status totalInventory priceRangeV2 { minVariantPrice { amount currencyCode } } } } }`;
const ORDERS_Q = `query($cursor: String, $q: String) { orders(first: 100, after: $cursor, query: $q) { pageInfo { hasNextPage endCursor } nodes { createdAt lineItems(first: 50) { nodes { quantity product { id } originalTotalSet { shopMoney { amount } } } } } } }`;

export async function fetchOwnStore(shop: string, token: string, days = 60): Promise<{ products: OwnProduct[]; sales: OwnSales[] }> {
  const products: OwnProduct[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    type P = { products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { id: string; title: string; status: string; totalInventory: number | null; priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } } }[] } };
    const d: P = await adminGraphql<P>(shop, token, PRODUCTS_Q, { cursor });
    for (const n of d.products.nodes)
      products.push({ externalId: n.id, title: n.title, status: n.status, inventory: n.totalInventory, price: Number(n.priceRangeV2.minVariantPrice.amount), currency: n.priceRangeV2.minVariantPrice.currencyCode });
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

export interface OwnPerformanceRow extends OwnProduct {
  units30: number;
  unitsPrev30: number;
  revenue30: number;
  change: number | null;
  declining: boolean;
  lowStock: boolean;
  market: { productId: string; name: string; score: number | null; trendGrowth: number | null } | null;
}

function tokens(s: string) {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
}

/** Joins own sales with market observations (name-similarity match to tracked products). */
export function ownPerformance(products: OwnProduct[], sales: OwnSales[], asOf: string): OwnPerformanceRow[] {
  const market = allProducts();
  const start30 = addDays(asOf, -29);
  const startPrev = addDays(asOf, -59);
  return products.map((p) => {
    const mine = sales.filter((s) => s.productExternalId === p.externalId);
    const units30 = mine.filter((s) => s.date >= start30 && s.date <= asOf).reduce((a, s) => a + s.units, 0);
    const unitsPrev30 = mine.filter((s) => s.date >= startPrev && s.date < start30).reduce((a, s) => a + s.units, 0);
    const revenue30 = Math.round(mine.filter((s) => s.date >= start30).reduce((a, s) => a + s.revenue, 0) * 100) / 100;
    const change = unitsPrev30 > 0 ? Math.round(((units30 - unitsPrev30) / unitsPrev30) * 1000) / 10 : null;
    const tk = tokens(p.title);
    let best: (typeof market)[number] | null = null;
    let bestScore = 0;
    for (const m of market) {
      const mt = tokens(m.name);
      const overlap = [...tk].filter((w) => mt.has(w)).length / Math.max(1, Math.min(tk.size, mt.size));
      if (overlap > bestScore) {
        bestScore = overlap;
        best = m;
      }
    }
    return {
      ...p,
      units30,
      unitsPrev30,
      revenue30,
      change,
      declining: change != null && change <= -25,
      lowStock: p.inventory != null && p.inventory < 15,
      market: best && bestScore >= 0.5 ? { productId: best.id, name: best.name, score: best.score.overall, trendGrowth: best.metrics.trendGrowth } : null,
    };
  });
}

/** Deterministic mock store used when Shopify credentials are not configured. */
export function mockStore(): { products: OwnProduct[]; sales: OwnSales[]; asOf: string } {
  const picks = allProducts().filter((p) => p.priceEstimate != null).slice(0, 9);
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
  return { products, sales, asOf: DEMO_SNAPSHOT };
}

export function shopifyMode(): "live" | "mock" {
  return features().shopify ? "live" : "mock";
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

/** Syncs one integration: products + 60 days of orders → own_store_* tables. */
export async function syncIntegration(integrationId: string) {
  const db = supabaseAdmin();
  if (!db) throw new Error("Database not configured");
  const { data: row, error } = await db.from("connected_integrations").select("id, external_account, access_token_encrypted").eq("id", integrationId).single();
  if (error || !row) throw error ?? new Error("Integration not found");
  try {
    const { products, sales } = await fetchOwnStore(row.external_account, decrypt(row.access_token_encrypted));
    if (products.length)
      await db.from("own_store_products").upsert(
        products.map((p) => ({ integration_id: row.id, external_id: p.externalId, title: p.title, status: p.status, price: p.price, inventory: p.inventory, updated_at: new Date().toISOString() })),
      );
    if (sales.length)
      await db.from("own_store_daily_sales").upsert(sales.map((s) => ({ integration_id: row.id, product_external_id: s.productExternalId, date: s.date, units: s.units, revenue: s.revenue })));
    await db.from("connected_integrations").update({ last_sync_at: new Date().toISOString(), status: "connected", last_error: null }).eq("id", row.id);
    return { products: products.length, salesRows: sales.length };
  } catch (e) {
    await db.from("connected_integrations").update({ status: "error", last_error: e instanceof Error ? e.message.slice(0, 500) : "sync failed" }).eq("id", row.id);
    throw e;
  }
}
