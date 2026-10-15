import "server-only";
import type { Connector, SyncContext, SyncResult } from "./types";
import { env } from "../server/env";
import { supabaseAdmin } from "../server/supabase";
import { normalizeDomain } from "../queries";
import { connectorFetch, pacerFor, type FetchFailure } from "./http";
import {
  META_FIELDS,
  META_THROTTLE_CODES,
  TIKTOK_FIELDS,
  licensedAdRecord,
  licensedProductRow,
  metaAdRecord,
  metaUsagePct,
  parseJsonKeepingIds,
  queryCountries,
  rotateDaily,
  searchTermsFor,
  tiktokAdRecord,
  type AdRecord,
} from "./mappers";
import { ingestStorefront, loadMatchableProducts, note, rejected, requestFailed, storeAds, summarize, tally } from "./ingest";
import { crawlStorefront } from "./storefronts";

/**
 * Connector registry. Each connector uses an official API, a licensed feed or
 * public pages fetched in line with robots.txt. None bypasses authentication,
 * paywalls or anti-bot protections. Unconfigured connectors return "skipped".
 *
 * Every provider request goes through lib/connectors/http.ts: timeouts, pacing
 * from the declared rate limit, bounded retries with backoff (Retry-After
 * honoured). Each run also has a time and request budget, because the
 * scheduled scan runs all connectors in one function invocation.
 */

const skipped = (message: string): SyncResult => ({ status: "skipped", records: 0, message });

const BUDGET_MS = { meta: 75_000, tiktok: 60_000, storefronts: 75_000, licensed: 30_000 };
const deadlineFor = (ctx: SyncContext, ms: number) => Math.min(ctx.deadline ?? Infinity, Date.now() + ms);
const MAX_TERMS = 25;
const MAX_PAGES_PER_QUERY = 3;

/** Reads a JSON error body from a failed provider response (null when there is none). */
async function errorBody(r: FetchFailure): Promise<Record<string, unknown> | null> {
  try {
    const b = (await r.res?.json()) as { error?: Record<string, unknown> } | null;
    return b?.error && typeof b.error === "object" ? b.error : null;
  } catch {
    return null;
  }
}

const metaAdLibrary: Connector = {
  id: "meta_ad_library",
  category: "ads",
  auth: "access_token",
  envVars: ["META_AD_LIBRARY_ACCESS_TOKEN"],
  permittedKey: "connectors.permitted.meta",
  rateLimit: { requests: 200, per: "hour" },
  fields: META_FIELDS,
  syncFrequency: "daily",
  retentionDays: 365,
  docsUrl: "https://www.facebook.com/ads/library/api",
  configured: () => Boolean(env.metaAccessToken),
  async sync(ctx) {
    if (!this.configured()) return skipped("not_configured");
    const db = supabaseAdmin();
    if (!db) return skipped("database_not_configured");
    const t = tally();
    const products = await loadMatchableProducts(db, t);
    const terms = searchTermsFor(ctx, products).slice(0, MAX_TERMS);
    if (!terms.length) return skipped("no_keywords");
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const deadline = deadlineFor(ctx, BUDGET_MS.meta);
    const pacer = pacerFor(this.id, this.rateLimit);
    // Stay under the declared hourly limit within one run.
    const maxRequests = Math.floor(this.rateLimit.requests * 0.75);
    const seen = new Set<string>();
    let requests = 0;
    let incomplete: string | null = null;

    queries: for (const search of rotateDaily(terms, today)) {
      // One country per query: every ad returned is known to have reached that country.
      for (const country of queryCountries(ctx.countries)) {
        let after: string | null = null;
        for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
          if (requests >= maxRequests) {
            incomplete = "request_budget_exhausted";
            break queries;
          }
          const u = new URL(`https://graph.facebook.com/${env.metaGraphVersion}/ads_archive`);
          u.searchParams.set("search_terms", search.term);
          u.searchParams.set("ad_type", "ALL"); // the API default is political and issue ads only
          u.searchParams.set("ad_reached_countries", JSON.stringify([country]));
          u.searchParams.set("ad_active_status", "ALL");
          u.searchParams.set("ad_delivery_date_min", ctx.since);
          u.searchParams.set("fields", META_FIELDS.join(","));
          u.searchParams.set("limit", "100");
          if (after) u.searchParams.set("after", after);
          u.searchParams.set("access_token", env.metaAccessToken!);
          requests++;
          const r = await connectorFetch(u, { headers: { accept: "application/json" } }, { pacer, deadline, timeoutMs: 20_000 });
          if (!r.ok) {
            if (r.code === "deadline") {
              incomplete = "time_budget_exhausted";
              break queries;
            }
            const err = await errorBody(r);
            const code = typeof err?.code === "number" ? err.code : null;
            if (r.code === "rate_limited" || (code != null && META_THROTTLE_CODES.has(code))) {
              requestFailed(t, "rate_limited");
              break queries;
            }
            if (r.status === 401 || r.status === 403 || code === 190) {
              requestFailed(t, "auth_failed");
              break queries;
            }
            requestFailed(t, code != null ? `graph_error_${code}` : r.code); // never the URL: it carries the token
            break; // next query
          }
          const body = (await r.res.json().catch(() => null)) as { data?: unknown[]; paging?: { next?: string; cursors?: { after?: string } } } | null;
          if (!body || !Array.isArray(body.data)) {
            requestFailed(t, "invalid_response");
            break;
          }
          const recs: AdRecord[] = [];
          let invalid = 0;
          for (const raw of body.data) {
            const rec = metaAdRecord(raw, country, today, now, products, search);
            if (!rec) invalid++;
            // An ad reaching several queried countries is stored once, with the first country it was found in.
            else if (!seen.has(rec.row.id)) {
              seen.add(rec.row.id);
              recs.push(rec);
            }
          }
          rejected(t, invalid);
          await storeAds(db, recs, today, t);
          const usage = metaUsagePct(r.res.headers);
          if (usage != null && usage >= 90) {
            incomplete = "rate_limit_near";
            break queries;
          }
          after = body.paging?.next && typeof body.paging.cursors?.after === "string" ? body.paging.cursors.after : null;
          if (!after) break;
        }
      }
    }
    return summarize(t, incomplete);
  },
};

type TikTokQueryBody = { data?: { ads?: unknown[]; has_more?: boolean; search_id?: string }; error?: { code?: string } };

const tiktokCommercialContent: Connector = {
  id: "tiktok_commercial_content",
  category: "ads",
  auth: "oauth_client",
  envVars: ["TIKTOK_RESEARCH_CLIENT_KEY", "TIKTOK_RESEARCH_CLIENT_SECRET"],
  permittedKey: "connectors.permitted.tiktok",
  rateLimit: { requests: 1000, per: "day" },
  fields: TIKTOK_FIELDS,
  syncFrequency: "daily",
  retentionDays: 365,
  docsUrl: "https://developers.tiktok.com/products/commercial-content-api",
  configured: () => Boolean(env.tiktokClientKey && env.tiktokClientSecret),
  async sync(ctx) {
    if (!this.configured()) return skipped("not_configured");
    const db = supabaseAdmin();
    if (!db) return skipped("database_not_configured");
    const t = tally();
    const products = await loadMatchableProducts(db, t);
    const terms = searchTermsFor(ctx, products).slice(0, MAX_TERMS);
    if (!terms.length) return skipped("no_keywords");
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const deadline = deadlineFor(ctx, BUDGET_MS.tiktok);
    const pacer = pacerFor(this.id, this.rateLimit);

    const tokenRes = await connectorFetch(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: env.tiktokClientKey!, client_secret: env.tiktokClientSecret!, grant_type: "client_credentials" }).toString(),
      },
      { pacer, deadline, timeoutMs: 15_000 },
    );
    if (!tokenRes.ok) return { status: "failed", records: 0, message: `token_${tokenRes.code}` };
    const token = ((await tokenRes.res.json().catch(() => null)) as { access_token?: unknown } | null)?.access_token;
    if (typeof token !== "string" || !token) return { status: "failed", records: 0, message: "token_invalid" };

    const maxRequests = 200; // of the declared 1000/day
    const seen = new Set<string>();
    let requests = 0;
    let incomplete: string | null = null;
    const max = today.replaceAll("-", "");
    queries: for (const search of rotateDaily(terms, today)) {
      for (const country of queryCountries(ctx.countries)) {
        let searchId: string | null = null;
        for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
          if (requests >= maxRequests) {
            incomplete = "request_budget_exhausted";
            break queries;
          }
          requests++;
          const r = await connectorFetch(
            `https://open.tiktokapis.com/v2/research/adlib/ad/query/?fields=${encodeURIComponent(TIKTOK_FIELDS.join(","))}`,
            {
              method: "POST",
              headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
              body: JSON.stringify({
                filters: { ad_published_date_range: { min: ctx.since.replaceAll("-", ""), max }, country_code: country },
                search_term: search.term,
                max_count: 50,
                ...(searchId ? { search_id: searchId } : {}),
              }),
            },
            { pacer, deadline, timeoutMs: 20_000 },
          );
          if (!r.ok) {
            if (r.code === "deadline") {
              incomplete = "time_budget_exhausted";
              break queries;
            }
            if (r.code === "rate_limited") {
              requestFailed(t, "rate_limited");
              break queries;
            }
            if (r.status === 401 || r.status === 403) {
              requestFailed(t, "auth_failed");
              break queries;
            }
            requestFailed(t, r.code);
            break;
          }
          let body: TikTokQueryBody | null = null;
          try {
            body = parseJsonKeepingIds(await r.res.text()) as TikTokQueryBody;
          } catch {
            body = null;
          }
          if (body?.error?.code && body.error.code !== "ok") {
            requestFailed(t, `api_${String(body.error.code).slice(0, 40)}`);
            if (/rate_limit/.test(body.error.code)) break queries;
            break;
          }
          if (!body?.data || !Array.isArray(body.data.ads ?? [])) {
            requestFailed(t, "invalid_response");
            break;
          }
          const recs: AdRecord[] = [];
          let invalid = 0;
          for (const raw of body.data.ads ?? []) {
            const rec = tiktokAdRecord(raw, country, today, now, products, search);
            if (!rec) invalid++;
            else if (!seen.has(rec.row.id)) {
              seen.add(rec.row.id);
              recs.push(rec);
            }
          }
          rejected(t, invalid);
          await storeAds(db, recs, today, t);
          searchId = body.data.has_more && typeof body.data.search_id === "string" ? body.data.search_id : null;
          if (!searchId) break;
        }
      }
    }
    return summarize(t, incomplete);
  },
};

const pinterestAds: Connector = {
  id: "pinterest_ads_repository",
  category: "ads",
  auth: "access_token",
  envVars: ["PINTEREST_API_TOKEN"],
  permittedKey: "connectors.permitted.pinterest",
  rateLimit: { requests: 100, per: "minute" },
  fields: ["advertiser", "first_seen", "last_seen", "targeting_countries"],
  syncFrequency: "daily",
  retentionDays: 365,
  docsUrl: "https://developers.pinterest.com/",
  // Interface reserved for an authorized Pinterest ad-transparency feed: no mapping is implemented,
  // so a token alone does not make it usable and it is never reported as configured.
  available: false,
  configured: () => false,
  async sync() {
    return skipped("not_available");
  },
};

const searchTrends: Connector = {
  id: "search_trends",
  category: "trends",
  auth: "api_key",
  envVars: ["SEARCH_TRENDS_API_KEY"],
  permittedKey: "connectors.permitted.trends",
  rateLimit: { requests: 60, per: "minute" },
  fields: ["keyword", "date", "interest_index", "geo"],
  syncFrequency: "daily",
  retentionDays: 730,
  docsUrl: "https://developers.google.com/search/apis/trends",
  // No provider mapping is implemented yet (see Pinterest above).
  available: false,
  configured: () => false,
  async sync() {
    return skipped("not_available");
  },
};

/** Public host names only: no IP literals, localhost or reserved/internal suffixes. */
const PUBLIC_HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const RESERVED_SUFFIX = /\.(?:example|invalid|localhost|local|internal|test|lan|home|corp)$/;

const publicStorefronts: Connector = {
  id: "public_storefronts",
  category: "stores",
  auth: "none",
  envVars: ["STOREFRONT_CRAWLER_ENABLED"],
  permittedKey: "connectors.permitted.storefronts",
  rateLimit: { requests: 1, per: "second" },
  fields: ["products.json: title, variants.price, published_at", "meta.json: name, country, currency, published_products_count", "cart.js: currency", "wc/store/products: name, prices"],
  syncFrequency: "weekly",
  retentionDays: 180,
  docsUrl: "https://shopify.dev/docs/storefronts",
  configured: () => env.storefrontCrawlerEnabled,
  async sync(ctx) {
    if (!this.configured()) return skipped("not_configured");
    const db = supabaseAdmin();
    if (!db) return skipped("database_not_configured");
    const domains = Array.from(new Set(ctx.domains.map(normalizeDomain))).filter((d) => PUBLIC_HOST.test(d) && !RESERVED_SUFFIX.test(d));
    if (!domains.length) return skipped("no_domains");
    const t = tally();
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const deadline = deadlineFor(ctx, BUDGET_MS.storefronts);
    let incomplete: string | null = null;
    let notCrawled = 0;
    for (const domain of rotateDaily(domains, today).slice(0, 50)) {
      if (Date.now() >= deadline) {
        incomplete = "time_budget_exhausted";
        break;
      }
      // robots.txt is checked for every path; only public listing data is collected.
      const out = await crawlStorefront(domain, today, deadline);
      if (out.kind === "skipped") {
        notCrawled++;
        note(t, `${domain}: ${out.reason}`);
      } else if (out.kind === "failed") {
        if (out.reason === "deadline" || out.reason === "robots_deadline") {
          incomplete = "time_budget_exhausted";
          break;
        }
        requestFailed(t, `${domain}: ${out.reason}`);
      } else await ingestStorefront(db, domain, out.obs, today, now, t);
    }
    const r = summarize(t, incomplete);
    return notCrawled ? { ...r, message: [`${notCrawled} not crawled`, r.message].filter(Boolean).join("; ").slice(0, 500) } : r;
  },
};

const isLocal = (u: URL) => u.hostname === "localhost" || u.hostname === "127.0.0.1";

const licensedDataset: Connector = {
  id: "licensed_dataset",
  category: "licensed",
  auth: "api_key",
  envVars: ["LICENSED_DATA_PROVIDER_URL", "LICENSED_DATA_PROVIDER_KEY"],
  permittedKey: "connectors.permitted.licensed",
  rateLimit: { requests: 10, per: "minute" },
  fields: ["products[]", "observations[]", "ads[]", "source", "observed_at"],
  syncFrequency: "daily",
  retentionDays: 730,
  docsUrl: "/docs/DATA_SOURCES.md",
  configured: () => Boolean(env.licensedProviderUrl && env.licensedProviderKey),
  async sync(ctx) {
    if (!this.configured()) return skipped("not_configured");
    let url: URL;
    try {
      url = new URL(env.licensedProviderUrl!);
    } catch {
      return { status: "failed", records: 0, message: "invalid_provider_url" };
    }
    // The key travels as a bearer token: never over plain HTTP (except a local test server).
    if (url.protocol !== "https:" && !isLocal(url)) return { status: "failed", records: 0, message: "provider_url_must_be_https" };
    const db = supabaseAdmin();
    if (!db) return skipped("database_not_configured");
    const r = await connectorFetch(
      url,
      { headers: { authorization: `Bearer ${env.licensedProviderKey}`, accept: "application/json" } },
      { pacer: pacerFor(this.id, this.rateLimit), deadline: deadlineFor(ctx, BUDGET_MS.licensed), timeoutMs: 25_000 },
    );
    if (!r.ok) return { status: "failed", records: 0, message: r.code };
    const body = (await r.res.json().catch(() => null)) as { products?: unknown; ads?: unknown } | null;
    if (!body || typeof body !== "object") return { status: "failed", records: 0, message: "invalid_response" };
    const t = tally();
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    // Whitelisted, validated columns only: provider payloads never write arbitrary fields.
    const rawProducts = Array.isArray(body.products) ? body.products : [];
    const products = rawProducts.map((p) => licensedProductRow(p, now)).filter((p): p is Record<string, unknown> => p != null);
    rejected(t, rawProducts.length - products.length);
    for (let i = 0; i < products.length; i += 500) {
      const chunk = products.slice(i, i + 500);
      const { error } = await db.from("products").upsert(chunk);
      if (error) {
        t.failed += chunk.length;
        note(t, [error.code, error.message].filter(Boolean).join(" ").slice(0, 160));
      } else t.records += chunk.length;
    }

    // Loaded after the product upsert so feed ads can reference feed products.
    const matchable = await loadMatchableProducts(db, t);
    const rawAds = Array.isArray(body.ads) ? body.ads : [];
    const ads = rawAds.map((a) => licensedAdRecord(a, today, now, matchable)).filter((a): a is AdRecord => a != null);
    rejected(t, rawAds.length - ads.length);
    await storeAds(db, ads, today, t);
    return summarize(t);
  },
};

const shopifyAdmin: Connector = {
  id: "shopify_admin",
  category: "commerce",
  auth: "oauth_user",
  envVars: ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "ENCRYPTION_KEY"],
  permittedKey: "connectors.permitted.shopify",
  rateLimit: { requests: 2, per: "second" },
  fields: ["products", "orders (60 days)", "inventory"],
  syncFrequency: "every6h",
  retentionDays: 400,
  docsUrl: "https://shopify.dev/docs/api/admin-graphql",
  configured: () => Boolean(env.shopifyApiKey && env.shopifyApiSecret && env.encryptionKey),
  async sync() {
    return skipped("per_user_sync"); // synced per connected merchant (see lib/server/shopify.ts)
  },
};

const demo: Connector = {
  id: "demo",
  category: "demo",
  auth: "none",
  envVars: [],
  permittedKey: "connectors.permitted.demo",
  rateLimit: { requests: 0, per: "day" },
  fields: ["products", "observations", "ads", "stores"],
  syncFrequency: "on_demand",
  retentionDays: 0,
  docsUrl: "/docs/DATA_SOURCES.md",
  configured: () => true,
  async sync() {
    return skipped("static_dataset");
  },
};

export const CONNECTORS: Connector[] = [metaAdLibrary, tiktokCommercialContent, pinterestAds, searchTrends, publicStorefronts, licensedDataset, shopifyAdmin, demo];

export function connectorStatus() {
  return CONNECTORS.map((c) => {
    const available = c.available !== false;
    return {
      id: c.id,
      category: c.category,
      auth: c.auth,
      envVars: c.envVars,
      permittedKey: c.permittedKey,
      rateLimit: c.rateLimit,
      fields: c.fields,
      syncFrequency: c.syncFrequency,
      retentionDays: c.retentionDays,
      docsUrl: c.docsUrl,
      /** False: not available yet (no provider mapping); shown as such, never as configured. */
      available,
      configured: available && c.configured(),
    };
  });
}
