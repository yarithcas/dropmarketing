import "server-only";
import { z } from "zod";
import { COUNTRIES, type Country } from "../types";
import { politeFetch, robotsAllowsPath, robotsFor, type RobotsRules } from "./http";

/**
 * Public storefront reading. Only endpoints a platform exposes to every
 * visitor are used, each checked against robots.txt first:
 *
 * - Shopify: /products.json (listings; a valid response verifies the platform),
 *   /meta.json (shop name, country, shop currency, published product count)
 *   and /cart.js (the currency the storefront presents to this visitor).
 *   /products.json prices are in the shop currency; when /cart.js presents a
 *   different currency (Shopify Markets), the listing currency is ambiguous
 *   and stays null.
 * - WooCommerce: the Store API /wp-json/wc/store/products (listings, currency
 *   and X-WP-Total count; a valid response verifies the platform).
 *
 * Nothing is inferred: a value the store does not expose stays null.
 */

export interface ListingObservation {
  externalId: string;
  title: string;
  price: number;
  /** Publication date when the platform reports one, otherwise the observation day. */
  firstSeen: string;
}

export interface StorefrontObservation {
  platform: "shopify" | "woocommerce";
  listings: ListingObservation[];
  /** Total public listings when reliably known (complete crawl or a platform count), else null. */
  productCount: number | null;
  /** True when every public listing was read. */
  complete: boolean;
  currency: string | null;
  name: string | null;
  country: Country | null;
}

export type CrawlOutcome = { kind: "ok"; obs: StorefrontObservation } | { kind: "skipped"; reason: string } | { kind: "failed"; reason: string };

const SHOPIFY_PAGE = 250;
const WOO_PAGE = 100;
const MAX_PAGES = 4;
export const WOO_PATH = "/wp-json/wc/store/products";
/** Longest robots.txt Crawl-delay we can honour within a run; slower sites are skipped. */
const MAX_CRAWL_DELAY_MS = 10_000;

const CURRENCY = /^[A-Z]{3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}/;

const shopifyProductsSchema = z.object({
  products: z.array(
    z.object({
      id: z.union([z.number(), z.string().min(1)]),
      title: z.string(),
      handle: z.string(),
      published_at: z.string().nullish(),
      variants: z.array(z.object({ price: z.union([z.string(), z.number()]) })),
    }),
  ),
});

/** Listings from a Shopify /products.json body; null when the body is not that endpoint's shape. */
export function parseShopifyProducts(body: unknown, today: string): ListingObservation[] | null {
  const p = shopifyProductsSchema.safeParse(body);
  if (!p.success) return null;
  return p.data.products.flatMap((x) => {
    const prices = x.variants.map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
    if (!prices.length) return [];
    return [{ externalId: String(x.id), title: x.title.slice(0, 300), price: Math.min(...prices), firstSeen: x.published_at && DAY.test(x.published_at) ? x.published_at.slice(0, 10) : today }];
  });
}

const wooProductsSchema = z.array(
  z.object({
    id: z.number(),
    name: z.string(),
    prices: z.object({ price: z.string().regex(/^\d+$/), currency_code: z.string(), currency_minor_unit: z.number().int().min(0).max(4) }),
  }),
);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Store API names are HTML-escaped; decode entities so titles display as text. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Listings + currency from a WooCommerce Store API products page; null when not that shape. */
export function parseWooProducts(body: unknown, today: string): { listings: ListingObservation[]; currency: string | null } | null {
  const p = wooProductsSchema.safeParse(body);
  if (!p.success) return null;
  const listings = p.data.flatMap((x) => {
    const price = Number(x.prices.price) / 10 ** x.prices.currency_minor_unit;
    return price > 0 ? [{ externalId: String(x.id), title: decodeEntities(x.name).slice(0, 300), price, firstSeen: today }] : [];
  });
  const currency = p.data.map((x) => x.prices.currency_code).find((c) => CURRENCY.test(c)) ?? null;
  return { listings, currency };
}

/** Currency of a Shopify /cart.js response (the currency storefront prices are shown in). */
export function parseCartCurrency(body: unknown): string | null {
  const c = (body as { currency?: unknown } | null)?.currency;
  return typeof c === "string" && CURRENCY.test(c) ? c : null;
}

export interface ShopMeta {
  name: string | null;
  country: Country | null;
  currency: string | null;
  productCount: number | null;
}
const NO_META: ShopMeta = { name: null, country: null, currency: null, productCount: null };

/** Shop name, country, currency and published product count from Shopify /meta.json, each null when absent. */
export function parseShopMeta(body: unknown): ShopMeta {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 200) : null;
  const cc = typeof b.country === "string" ? b.country.toUpperCase() : "";
  const count = b.published_products_count;
  return {
    name,
    country: (COUNTRIES as readonly string[]).includes(cc) ? (cc as Country) : null,
    currency: typeof b.currency === "string" && CURRENCY.test(b.currency) ? b.currency : null,
    productCount: typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null,
  };
}

/**
 * Currency of /products.json prices: the shop currency from /meta.json, unless
 * /cart.js presents another one (then it is ambiguous → null); /cart.js alone
 * is used only when /meta.json does not state a currency.
 */
export function shopifyCurrency(metaCurrency: string | null, cartCurrency: string | null): string | null {
  if (metaCurrency && cartCurrency) return metaCurrency === cartCurrency ? metaCurrency : null;
  return metaCurrency ?? cartCurrency;
}

type Read<T> = { kind: "ok"; value: T } | { kind: "absent" } | { kind: "failed"; reason: string };

/** GET a JSON endpoint of the store; the full path (with query) is checked against robots.txt first. */
async function getJson(domain: string, path: string, rules: RobotsRules, deadline: number): Promise<{ ok: true; body: unknown; res: Response } | { ok: false; transient: boolean; reason: string }> {
  if (!robotsAllowsPath(rules, path)) return { ok: false, transient: false, reason: "robots_disallow" };
  const r = await politeFetch(`https://${domain}${path}`, { deadline });
  if (!r.ok) return { ok: false, transient: r.status == null || r.status === 429 || r.status >= 500, reason: r.code };
  try {
    return { ok: true, body: await r.res.json(), res: r.res };
  } catch {
    return { ok: false, transient: false, reason: "invalid_json" };
  }
}

async function readShopify(domain: string, rules: RobotsRules, today: string, deadline: number): Promise<Read<StorefrontObservation>> {
  const listings: ListingObservation[] = [];
  let read = 0;
  let complete = false;
  // Page 1 is always attempted (the fetch itself honours the deadline); later pages only within it.
  for (let page = 1; page <= MAX_PAGES && (page === 1 || Date.now() < deadline); page++) {
    const r = await getJson(domain, `/products.json?limit=${SHOPIFY_PAGE}&page=${page}`, rules, deadline);
    if (!r.ok) {
      if (page === 1) return r.transient ? { kind: "failed", reason: r.reason } : { kind: "absent" };
      break; // keep what was read; the count is then unknown
    }
    const items = parseShopifyProducts(r.body, today);
    // Verification needs a valid response with at least one listing on the first page.
    if (!items || (page === 1 && !(r.body as { products: unknown[] }).products.length)) {
      if (page === 1) return { kind: "absent" };
      break;
    }
    listings.push(...items);
    const n = (r.body as { products: unknown[] }).products.length;
    read += n;
    if (n < SHOPIFY_PAGE) {
      complete = true;
      break;
    }
  }
  const meta = await getJson(domain, "/meta.json", rules, deadline);
  const shop = meta.ok ? parseShopMeta(meta.body) : NO_META;
  // Shopify's default robots.txt disallows /cart*: the request is then not made.
  const cart = await getJson(domain, "/cart.js", rules, deadline);
  return {
    kind: "ok",
    value: {
      platform: "shopify",
      listings,
      complete,
      productCount: complete ? read : shop.productCount,
      currency: shopifyCurrency(shop.currency, cart.ok ? parseCartCurrency(cart.body) : null),
      name: shop.name,
      country: shop.country,
    },
  };
}

async function readWoo(domain: string, rules: RobotsRules, today: string, deadline: number): Promise<Read<StorefrontObservation>> {
  const listings: ListingObservation[] = [];
  let currency: string | null = null;
  let total: number | null = null;
  let read = 0;
  let exhausted = false;
  for (let page = 1; page <= MAX_PAGES && (page === 1 || Date.now() < deadline); page++) {
    const r = await getJson(domain, `${WOO_PATH}?per_page=${WOO_PAGE}&page=${page}`, rules, deadline);
    if (!r.ok) {
      if (page === 1) return r.transient ? { kind: "failed", reason: r.reason } : { kind: "absent" };
      break;
    }
    const parsed = parseWooProducts(r.body, today);
    if (!parsed || (page === 1 && !(r.body as unknown[]).length)) {
      if (page === 1) return { kind: "absent" };
      break;
    }
    listings.push(...parsed.listings);
    currency ??= parsed.currency;
    const header = r.res.headers.get("x-wp-total");
    if (page === 1 && header != null && /^\d+$/.test(header.trim())) total = Number(header);
    const n = (r.body as unknown[]).length;
    read += n;
    if (n < WOO_PAGE) {
      exhausted = true;
      break;
    }
  }
  const complete = exhausted || (total != null && read >= total);
  return { kind: "ok", value: { platform: "woocommerce", listings, complete, productCount: total ?? (complete ? read : null), currency, name: null, country: null } };
}

/** Reads one public storefront. Skips (never forces) anything robots.txt does not allow. */
export async function crawlStorefront(domain: string, today: string, deadline: number): Promise<CrawlOutcome> {
  const robots = await robotsFor(domain, deadline);
  if ("failed" in robots) return { kind: "failed", reason: `robots_${robots.failed}` };
  if ("blocked" in robots) return { kind: "skipped", reason: "robots_unavailable" };
  if ((robots.rules.crawlDelayMs ?? 0) > MAX_CRAWL_DELAY_MS) return { kind: "skipped", reason: "crawl_delay" };
  const allowShopify = robotsAllowsPath(robots.rules, "/products.json");
  const allowWoo = robotsAllowsPath(robots.rules, WOO_PATH);
  if (!allowShopify && !allowWoo) return { kind: "skipped", reason: "robots_disallow" };
  const shop = allowShopify ? await readShopify(domain, robots.rules, today, deadline) : null;
  if (shop?.kind === "ok") return { kind: "ok", obs: shop.value };
  const woo = allowWoo ? await readWoo(domain, robots.rules, today, deadline) : null;
  if (woo?.kind === "ok") return { kind: "ok", obs: woo.value };
  const failure = [shop, woo].find((r) => r?.kind === "failed");
  return failure?.kind === "failed" ? { kind: "failed", reason: failure.reason } : { kind: "skipped", reason: "platform_not_detected" };
}
