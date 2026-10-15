import "server-only";
import type { Connector, SyncResult } from "./types";
import { env } from "../server/env";
import { supabaseAdmin } from "../server/supabase";
import { robotsAllows, politeFetch } from "./http";
import { hashString, slugify } from "../demo/generate";

/**
 * Connector registry. Each connector uses an official API, a licensed feed or
 * public pages fetched in line with robots.txt. None bypasses authentication,
 * paywalls or anti-bot protections. Unconfigured connectors return "skipped".
 */

const skipped = (message: string): SyncResult => ({ status: "skipped", records: 0, message });

async function upsertAds(rows: Record<string, unknown>[]) {
  const db = supabaseAdmin();
  if (!db || !rows.length) return 0;
  const { error } = await db.from("advertisements").upsert(rows, { onConflict: "connector,external_id" });
  if (error) throw error;
  const today = new Date().toISOString().slice(0, 10);
  await db.from("ad_observations").upsert(
    rows.map((r) => ({ ad_id: r.id, date: today, active: true, connector: r.connector, observed_at: new Date().toISOString() })),
    { onConflict: "ad_id,date,connector" },
  );
  return rows.length;
}

const metaAdLibrary: Connector = {
  id: "meta_ad_library",
  category: "ads",
  auth: "access_token",
  envVars: ["META_AD_LIBRARY_ACCESS_TOKEN"],
  permittedKey: "connectors.permitted.meta",
  rateLimit: { requests: 200, per: "hour" },
  fields: ["id", "page_name", "ad_creative_bodies", "ad_creative_link_titles", "ad_delivery_start_time", "ad_delivery_stop_time", "publisher_platforms", "languages", "ad_snapshot_url"],
  syncFrequency: "daily",
  retentionDays: 365,
  docsUrl: "https://www.facebook.com/ads/library/api",
  configured: () => Boolean(env.metaAccessToken),
  async sync(ctx) {
    if (!this.configured()) return skipped("not_configured");
    let records = 0;
    for (const keyword of ctx.keywords.slice(0, 25)) {
      const u = new URL(`https://graph.facebook.com/${env.metaGraphVersion}/ads_archive`);
      u.searchParams.set("search_terms", keyword);
      u.searchParams.set("ad_reached_countries", JSON.stringify(ctx.countries.length ? ctx.countries : ["FR"]));
      u.searchParams.set("ad_active_status", "ALL");
      u.searchParams.set("ad_delivery_date_min", ctx.since);
      u.searchParams.set("fields", this.fields.join(","));
      u.searchParams.set("limit", "100");
      u.searchParams.set("access_token", env.metaAccessToken!);
      const res = await fetch(u);
      if (res.status === 429) return { status: "failed", records, message: "rate_limited" };
      if (!res.ok) return { status: "failed", records, message: `http_${res.status}` };
      const body = (await res.json()) as { data?: Record<string, unknown>[] };
      records += await upsertAds(
        (body.data ?? []).map((a) => {
          const start = String(a.ad_delivery_start_time ?? "").slice(0, 10);
          const stop = String(a.ad_delivery_stop_time ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
          return {
            id: `meta-${a.id}`,
            connector: "meta_ad_library",
            external_id: String(a.id),
            advertiser: String(a.page_name ?? ""),
            platform: "meta",
            country: (ctx.countries[0] ?? "FR").toUpperCase(),
            language: (Array.isArray(a.languages) && (a.languages[0] as string)) || "en",
            format: "image", // the Ad Library API does not expose the creative format; refined when a snapshot is reviewed
            headline: Array.isArray(a.ad_creative_link_titles) ? String(a.ad_creative_link_titles[0] ?? "") : "",
            copy: Array.isArray(a.ad_creative_bodies) ? String(a.ad_creative_bodies[0] ?? "") : "",
            cta: "learn_more",
            snapshot_url: a.ad_snapshot_url ?? null,
            category: "home",
            first_seen: start,
            last_seen: stop,
            source_kind: "measured",
            observed_at: new Date().toISOString(),
            hue: hashString(String(a.id)) % 360,
          };
        }),
      );
    }
    return { status: "success", records };
  },
};

const tiktokCommercialContent: Connector = {
  id: "tiktok_commercial_content",
  category: "ads",
  auth: "oauth_client",
  envVars: ["TIKTOK_RESEARCH_CLIENT_KEY", "TIKTOK_RESEARCH_CLIENT_SECRET"],
  permittedKey: "connectors.permitted.tiktok",
  rateLimit: { requests: 1000, per: "day" },
  fields: ["ad.id", "ad.first_shown_date", "ad.last_shown_date", "advertiser.business_name", "ad.status"],
  syncFrequency: "daily",
  retentionDays: 365,
  docsUrl: "https://developers.tiktok.com/products/commercial-content-api",
  configured: () => Boolean(env.tiktokClientKey && env.tiktokClientSecret),
  async sync(ctx) {
    if (!this.configured()) return skipped("not_configured");
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: env.tiktokClientKey!, client_secret: env.tiktokClientSecret!, grant_type: "client_credentials" }),
    });
    if (!tokenRes.ok) return { status: "failed", records: 0, message: `token_http_${tokenRes.status}` };
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    let records = 0;
    for (const keyword of ctx.keywords.slice(0, 20)) {
      const res = await fetch(`https://open.tiktokapis.com/v2/research/adlib/ad/query/?fields=${encodeURIComponent(this.fields.join(","))}`, {
        method: "POST",
        headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" },
        body: JSON.stringify({
          filters: { ad_published_date_range: { min: ctx.since.replaceAll("-", ""), max: new Date().toISOString().slice(0, 10).replaceAll("-", "") }, country_code: ctx.countries[0] ?? "FR" },
          search_term: keyword,
          max_count: 50,
        }),
      });
      if (!res.ok) return { status: "failed", records, message: `http_${res.status}` };
      const body = (await res.json()) as { data?: { ads?: { ad: { id: string; first_shown_date: number; last_shown_date: number }; advertiser: { business_name: string } }[] } };
      const toDay = (n: number) => `${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6, 8)}`;
      records += await upsertAds(
        (body.data?.ads ?? []).map((a) => ({
          id: `tiktok-${a.ad.id}`,
          connector: "tiktok_commercial_content",
          external_id: a.ad.id,
          advertiser: a.advertiser.business_name,
          platform: "tiktok",
          country: ctx.countries[0] ?? "FR",
          language: "en",
          format: "video",
          headline: "",
          copy: "",
          cta: "learn_more",
          category: "home",
          first_seen: toDay(a.ad.first_shown_date),
          last_seen: toDay(a.ad.last_shown_date),
          source_kind: "measured",
          observed_at: new Date().toISOString(),
        })),
      );
    }
    return { status: "success", records };
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
  configured: () => Boolean(env.pinterestToken),
  async sync() {
    // Interface reserved for an authorized Pinterest ad-transparency feed. Not implemented until access terms are confirmed.
    return this.configured() ? skipped("provider_mapping_pending") : skipped("not_configured");
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
  configured: () => Boolean(env.trendsApiKey),
  async sync() {
    return this.configured() ? skipped("provider_mapping_pending") : skipped("not_configured");
  },
};

const publicStorefronts: Connector = {
  id: "public_storefronts",
  category: "stores",
  auth: "none",
  envVars: ["STOREFRONT_CRAWLER_ENABLED"],
  permittedKey: "connectors.permitted.storefronts",
  rateLimit: { requests: 1, per: "second" },
  fields: ["title", "variants.price", "published_at", "product_type", "vendor"],
  syncFrequency: "weekly",
  retentionDays: 180,
  docsUrl: "https://shopify.dev/docs/storefronts",
  configured: () => env.storefrontCrawlerEnabled,
  async sync(ctx) {
    if (!this.configured()) return skipped("not_configured");
    const db = supabaseAdmin();
    if (!db) return skipped("database_not_configured");
    let records = 0;
    for (const domain of ctx.domains.slice(0, 50)) {
      // Respect robots.txt; skip stores that disallow the path. Only public listing data is collected.
      if (!(await robotsAllows(domain, "/products.json"))) continue;
      const res = await politeFetch(`https://${domain}/products.json?limit=250`);
      if (!res || !res.ok) continue;
      const body = (await res.json().catch(() => null)) as { products?: { id: number; title: string; published_at: string; variants: { price: string }[] }[] } | null;
      if (!body?.products) continue;
      const storeId = slugify(domain);
      const today = new Date().toISOString().slice(0, 10);
      const rows = body.products.map((p) => ({
        store_id: storeId,
        external_id: String(p.id),
        title: p.title.slice(0, 300),
        price: Number(p.variants?.[0]?.price ?? 0),
        currency: "EUR", // products.json omits currency; refined from the storefront's shop metadata when available
        first_seen: (p.published_at ?? today).slice(0, 10),
        last_seen: today,
      }));
      await db.from("store_products").upsert(rows, { onConflict: "store_id,external_id" });
      const prices = rows.map((r) => r.price).filter((n) => n > 0);
      await db.from("store_snapshots").upsert({
        store_id: storeId,
        date: today,
        product_count: rows.length,
        min_price: prices.length ? Math.min(...prices) : null,
        max_price: prices.length ? Math.max(...prices) : null,
        connector: "public_storefronts",
        observed_at: new Date().toISOString(),
      });
      records += rows.length;
    }
    return { status: "success", records };
  },
};

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
  async sync() {
    if (!this.configured()) return skipped("not_configured");
    const res = await fetch(env.licensedProviderUrl!, { headers: { authorization: `Bearer ${env.licensedProviderKey}` } });
    if (!res.ok) return { status: "failed", records: 0, message: `http_${res.status}` };
    const body = (await res.json()) as { products?: Record<string, unknown>[]; ads?: Record<string, unknown>[] };
    const now = new Date().toISOString();
    const pick = (row: Record<string, unknown>, cols: string[]) => Object.fromEntries(cols.filter((c) => row[c] !== undefined).map((c) => [c, row[c]]));
    // Whitelisted columns only: provider payloads never write arbitrary fields.
    const products = (body.products ?? [])
      .filter((p) => typeof p.id === "string" && typeof p.name === "string" && typeof p.category === "string")
      .map((p) => ({
        ...pick(p, ["id", "name", "category", "description", "product_type", "tags", "price_estimate", "supplier_cost_estimate", "currency", "channels", "countries", "shipping", "differentiation", "first_detected", "last_detected", "source_url"]),
        image_url: typeof p.image_url === "string" && p.image_url.startsWith("https://") ? p.image_url : null,
        source_connector: "licensed_dataset",
        source_kind: "estimate",
        observed_at: (p.observed_at as string) ?? now,
        is_demo: false,
      }));
    const db = supabaseAdmin();
    if (db && products.length) {
      const { error } = await db.from("products").upsert(products);
      if (error) return { status: "failed", records: 0, message: error.message };
    }
    const AD_COLS = ["id", "external_id", "product_id", "advertiser", "platform", "country", "language", "format", "headline", "copy", "cta", "landing_domain", "landing_url", "snapshot_url", "category", "first_seen", "last_seen", "observed_at"];
    const records =
      products.length +
      (await upsertAds((body.ads ?? []).map((a) => ({ ...pick(a, AD_COLS), connector: "licensed_dataset", source_kind: "estimate", observed_at: (a.observed_at as string) ?? now }))));
    return { status: "success", records };
  },
};

const shopifyAdmin: Connector = {
  id: "shopify_admin",
  category: "commerce",
  auth: "oauth_user",
  envVars: ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "ENCRYPTION_KEY"],
  permittedKey: "connectors.permitted.shopify",
  rateLimit: { requests: 2, per: "second" },
  fields: ["products", "orders (60 days)", "inventory (daily snapshots)"],
  syncFrequency: "daily",
  retentionDays: 400,
  docsUrl: "https://shopify.dev/docs/api/admin-graphql",
  configured: () => Boolean(env.shopifyApiKey && env.shopifyApiSecret && env.encryptionKey),
  async sync() {
    // Synced per connected merchant, daily by syncDueShopifyIntegrations() (lib/server/shopify.ts) and on demand.
    return skipped("per_user_sync");
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
  return CONNECTORS.map((c) => ({
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
    configured: c.configured(),
  }));
}
