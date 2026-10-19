import { describe, expect, it } from "vitest";
import { captionDomain, connectorKeywords, licensedAdRecord, MAX_AD_MEDIA, metaAdRecord, parseJsonKeepingIds, rotateDaily, safeHttpsUrl, searchTermsFor, tiktokAdRecord } from "@/lib/connectors/mappers";
import { classifyCategory, matchProduct, type MatchableProduct } from "@/lib/connectors/matching";
import { parseShopifyProducts, parseShopMeta, parseWooProducts, shopifyCurrency } from "@/lib/connectors/storefronts";
import { summarize, tally } from "@/lib/connectors/ingest";
import { rowToMedia } from "@/lib/server/supabase-repository";

const products: MatchableProduct[] = [
  { id: "posture", name: "Posture Corrector Brace", tags: ["back", "posture"], category: "wellness" },
  { id: "rope", name: "Smart Jump Rope", tags: ["fitness", "cardio"], category: "fitness" },
];
const TODAY = "2026-10-15";
const NOW = "2026-10-15T06:00:00.000Z";

const metaRaw = {
  id: "123",
  page_name: "Acme",
  ad_creative_bodies: ["Fix your back with our posture corrector brace."],
  ad_creative_link_titles: ["Posture Corrector Brace"],
  ad_creative_link_captions: ["WWW.ACME-SHOP.COM"],
  ad_delivery_start_time: "2026-09-01",
  ad_delivery_stop_time: "2026-10-01",
  languages: ["fr"],
  publisher_platforms: ["FACEBOOK", "instagram"],
  ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=123&access_token=SECRET",
};

describe("Meta Ad Library mapping", () => {
  it("maps only provider fields and leaves undisclosed ones unknown", () => {
    const r = metaAdRecord(metaRaw, "DE", TODAY, NOW, products, { term: "Posture Corrector Brace", productId: "posture" })!;
    expect(r.active).toBe(false); // delivery stopped before today
    expect(r.row).toMatchObject({
      country: "DE",
      language: "fr",
      format: "unknown",
      cta: "unknown",
      landing_domain: "acme-shop.com",
      landing_url: null,
      product_id: "posture",
      product_match_basis: "search_term",
      category: "wellness",
      category_basis: "product",
      last_seen: "2026-10-01",
      placements: ["facebook", "instagram"],
      source_kind: "measured",
    });
    expect(r.row.snapshot_url).toBe("https://www.facebook.com/ads/library/?id=123");
    expect(JSON.stringify(r.row)).not.toContain("SECRET");
    // The Ad Library API returns no media URL; ad_snapshot_url is never used as one.
    expect(r.row.media).toEqual([]);
  });

  it("marks still-delivering ads active and links others by token overlap or not at all", () => {
    const running = metaAdRecord({ ...metaRaw, ad_delivery_stop_time: null }, "FR", TODAY, NOW, products, { term: "back pain", productId: null })!;
    expect(running.active).toBe(true);
    expect(running.row.last_seen).toBe(TODAY);
    expect(running.row).toMatchObject({ product_id: "posture", product_match_basis: "token_overlap" });
    const other = metaAdRecord({ ...metaRaw, ad_creative_bodies: ["A new blender for your kitchen"], ad_creative_link_titles: [], ad_creative_link_captions: ["Free delivery"] }, "FR", TODAY, NOW, products, null)!;
    expect(other.row).toMatchObject({ product_id: null, product_match_basis: null, landing_domain: null, category: "kitchen", category_basis: "keyword_classifier" });
    const plain = metaAdRecord({ ...metaRaw, ad_creative_bodies: ["Hello there"], ad_creative_link_titles: [] }, "FR", TODAY, NOW, products, null)!;
    expect(plain.row).toMatchObject({ category: null, category_basis: null });
  });

  it("rejects malformed records", () => {
    expect(metaAdRecord({ id: "1" }, "FR", TODAY, NOW, products)).toBeNull();
  });
});

describe("TikTok mapping", () => {
  it("keeps int64 ids, stores no invented text and takes the product from the search term", () => {
    const body = parseJsonKeepingIds('{"ads":[{"ad":{"id":7412345678901234567,"first_shown_date":20261001,"last_shown_date":20261014,"videos":[{"url":"x"}]},"advertiser":{"business_name":"Shop"}}]}') as { ads: unknown[] };
    const r = tiktokAdRecord(body.ads[0], "FR", TODAY, NOW, products, { term: "Smart Jump Rope", productId: "rope" })!;
    expect(r.row.external_id).toBe("7412345678901234567");
    expect(r.row).toMatchObject({ headline: "", copy: "", language: null, cta: "unknown", format: "video", landing_domain: null, product_id: "rope", product_match_basis: "search_term", category: "fitness" });
    expect(r.active).toBe(true);
    const old = tiktokAdRecord({ ad: { id: "9", first_shown_date: 20260901, last_shown_date: 20261001 }, advertiser: { business_name: "S" } }, "FR", TODAY, NOW, products, { term: "yoga mat", productId: null })!;
    expect(old.active).toBe(false);
    expect(old.row).toMatchObject({ format: "unknown", product_id: null, category: "fitness", category_basis: "keyword_classifier" });
  });
});

describe("licensed feed mapping", () => {
  it("validates enums and URLs instead of coercing", () => {
    const r = licensedAdRecord(
      { id: "l1", advertiser: "A", platform: "meta", country: "FR", format: "reel", cta: "buy", category: "nope", snapshot_url: "javascript:alert(1)", landing_url: "http://x.com", headline: "Smart jump rope", copy: "count every jump", first_seen: "2026-10-01", last_seen: "2026-10-15" },
      TODAY,
      NOW,
      products,
    )!;
    expect(r.row).toMatchObject({ format: "unknown", cta: "unknown", snapshot_url: null, landing_url: null, product_id: "rope", product_match_basis: "token_overlap", category: "fitness", category_basis: "product", source_kind: "estimate" });
    const src = licensedAdRecord({ id: "l2", advertiser: "A", platform: "meta", country: "FR", product_id: "posture", category: "beauty", first_seen: "2026-10-01", last_seen: "2026-10-01" }, TODAY, NOW, products)!;
    expect(src.row).toMatchObject({ product_match_basis: "source", category: "beauty", category_basis: "source" });
    expect(src.active).toBe(false);
  });
});

describe("authorized ad media", () => {
  it("keeps the HTTPS video/cover URLs TikTok returns, drops anything else", () => {
    const r = tiktokAdRecord(
      {
        ad: {
          id: "77",
          first_shown_date: 20261001,
          last_shown_date: 20261014,
          videos: [{ url: "https://v16.tiktokcdn.example/v.mp4?x-expires=1&x-signature=s", cover_image_url: "https://p16.tiktokcdn.example/c.jpg" }, { url: "http://insecure.example/v.mp4" }, "https://v16.tiktokcdn.example/v.mp4?x-expires=1&x-signature=s", { url: "javascript:alert(1)" }, 42],
          image_urls: ["https://p16.tiktokcdn.example/i.jpg", "ftp://x/i.jpg"],
        },
        advertiser: { business_name: "Shop" },
      },
      "FR",
      TODAY,
      NOW,
      products,
    )!;
    expect(r.row.format).toBe("video");
    expect(r.row.media).toEqual([
      { type: "video", url: "https://v16.tiktokcdn.example/v.mp4?x-expires=1&x-signature=s", posterUrl: "https://p16.tiktokcdn.example/c.jpg", source: "tiktok_commercial_content", authorized: true },
      { type: "image", url: "https://p16.tiktokcdn.example/i.jpg", source: "tiktok_commercial_content", authorized: true },
    ]);
  });

  it("maps licensed feed media (HTTPS only, tokens stripped, capped)", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ type: "image", url: `https://cdn.example/${i}.jpg` }));
    const r = licensedAdRecord(
      {
        id: "lm",
        advertiser: "A",
        platform: "meta",
        country: "FR",
        first_seen: "2026-10-01",
        last_seen: "2026-10-15",
        media: [{ type: "video", url: "https://cdn.example/v.mp4?access_token=SECRET", poster_url: "http://cdn.example/p.jpg" }, ...many],
      },
      TODAY,
      NOW,
      products,
    )!;
    expect(r.row.media).toHaveLength(MAX_AD_MEDIA);
    expect(r.row.media[0]).toEqual({ type: "video", url: "https://cdn.example/v.mp4", source: "licensed_dataset", authorized: true });
    expect(JSON.stringify(r.row)).not.toContain("SECRET");
    expect(licensedAdRecord({ id: "ln", advertiser: "A", platform: "meta", country: "FR", first_seen: "2026-10-01", last_seen: "2026-10-15" }, TODAY, NOW, products)!.row.media).toEqual([]);
  });

  it("reads only valid authorized media back from the database", () => {
    expect(
      rowToMedia([
        { type: "video", url: "https://cdn.example/v.mp4", posterUrl: "https://cdn.example/p.jpg", source: "tiktok_commercial_content", authorized: true },
        { type: "video", url: "http://cdn.example/v.mp4", source: "x", authorized: true },
        { type: "video", url: "https://cdn.example/v.mp4?access_token=X", source: "x", authorized: true },
        { type: "audio", url: "https://cdn.example/a.mp3", source: "x", authorized: true },
        { type: "image", url: "https://cdn.example/i.jpg", posterUrl: "javascript:x", source: "x" },
        "https://cdn.example/raw.mp4",
      ]),
    ).toEqual([{ type: "video", url: "https://cdn.example/v.mp4", posterUrl: "https://cdn.example/p.jpg", source: "tiktok_commercial_content", authorized: true }]);
    expect(rowToMedia(null)).toEqual([]);
  });
});

describe("matching heuristics", () => {
  it("requires enough name tokens and treats ties as ambiguous", () => {
    expect(matchProduct("Good posture every day", products)).toBeNull(); // 1 of 3 name tokens
    expect(matchProduct("Le correcteur posture brace", products)?.productId).toBe("posture"); // 2 of 3 ≥ 60 %
    expect(matchProduct("posture corrector for your back", products)?.productId).toBe("posture");
    expect(matchProduct("jump", products)).toBeNull();
    const twins: MatchableProduct[] = [
      { id: "a", name: "Wireless Charger Pad", tags: [], category: "tech" },
      { id: "b", name: "Wireless Charger Pad", tags: [], category: "tech" },
    ];
    expect(matchProduct("wireless charger pad", twins)).toBeNull();
    expect(classifyCategory("Nouvelle lampe pour votre maison")).toBe("home");
    expect(classifyCategory("lorem ipsum")).toBeNull();
  });

  it("pairs keywords with real products and rotates daily", () => {
    expect(searchTermsFor({ keywords: ["smart jump rope", "yoga", "Yoga"] }, products)).toEqual([
      { term: "smart jump rope", productId: "rope" },
      { term: "yoga", productId: null },
    ]);
    expect(searchTermsFor({ keywords: [], searchTerms: [{ term: "x", productId: "demo-product" }] }, products)).toEqual([{ term: "x", productId: null }]);
    expect(rotateDaily([1, 2, 3], "2026-10-15")).toHaveLength(3);
    expect(new Set([rotateDaily([1, 2, 3], "2026-10-15")[0], rotateDaily([1, 2, 3], "2026-10-16")[0]]).size).toBe(2);
  });

  it("cleans URLs and captions", () => {
    expect(safeHttpsUrl("https://a.com/x?access_token=s&id=1")).toBe("https://a.com/x?id=1");
    expect(safeHttpsUrl("http://a.com")).toBeNull();
    expect(captionDomain(["Shop now", "shop.example.co.uk/sale"])).toBe("shop.example.co.uk");
  });
});

describe("storefront parsing", () => {
  it("parses Shopify and WooCommerce public endpoints", () => {
    expect(parseShopifyProducts({ products: [{ id: 1, title: "T", handle: "t", published_at: "2026-01-02T00:00:00Z", variants: [{ price: "19.90" }, { price: "9.90" }] }] }, TODAY)).toEqual([
      { externalId: "1", title: "T", price: 9.9, firstSeen: "2026-01-02" },
    ]);
    expect(parseShopifyProducts("<html>", TODAY)).toBeNull();
    const woo = parseWooProducts([{ id: 5, name: "Caf&eacute; &amp; th&#233;", prices: { price: "1250", currency_code: "GBP", currency_minor_unit: 2 } }], TODAY)!;
    expect(woo.currency).toBe("GBP");
    expect(woo.listings[0]).toMatchObject({ price: 12.5, title: "Caf&eacute; & thé" });
    expect(parseShopMeta({ name: "Shop", country: "fr", currency: "EUR", published_products_count: 12 })).toEqual({ name: "Shop", country: "FR", currency: "EUR", productCount: 12 });
  });

  it("keeps the listing currency only when unambiguous", () => {
    expect(shopifyCurrency("EUR", "EUR")).toBe("EUR");
    expect(shopifyCurrency("EUR", "USD")).toBeNull();
    expect(shopifyCurrency(null, "USD")).toBe("USD");
    expect(shopifyCurrency(null, null)).toBeNull();
  });
});

describe("run summary", () => {
  it("reports success, partial and failed", () => {
    expect(summarize({ ...tally(), records: 3 }).status).toBe("success");
    expect(summarize({ ...tally(), records: 3, failed: 1 }).status).toBe("partial");
    expect(summarize({ ...tally(), records: 3 }, "time_budget_exhausted").status).toBe("partial");
    expect(summarize({ ...tally(), failed: 2, errors: ["23503 fk"] })).toMatchObject({ status: "failed", records: 0, failed: 2 });
    expect(summarize({ ...tally(), requestFailures: 1, errors: ["http_500"] }).status).toBe("failed");
  });
});

describe("connectorKeywords", () => {
  it("puts TRACKED_KEYWORDS first, then product names, without duplicates", () => {
    expect(connectorKeywords(" corde à sauter, brosse lissante;\nCorde à sauter ", ["Brosse lissante", "Smart jump rope"])).toEqual(["corde à sauter", "brosse lissante", "Smart jump rope"]);
  });
  it("works without TRACKED_KEYWORDS and caps the list", () => {
    expect(connectorKeywords(undefined, ["a", "b", "c"], 2)).toEqual(["a", "b"]);
    expect(connectorKeywords("", [])).toEqual([]);
  });
});
