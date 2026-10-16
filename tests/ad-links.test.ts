import { describe, expect, it } from "vitest";
import { adSite } from "@/lib/ad-links";

const src = (kind: "measured" | "estimate" | "demo") => ({ connector: kind === "demo" ? "demo" : "meta_ad_library", kind, observedAt: "2026-10-12T05:00:00Z" });

describe("adSite", () => {
  it("links a real ad to its reported landing page", () => {
    expect(adSite({ landingDomain: "shop.com", landingUrl: "https://shop.com/products/x", source: src("measured") })).toEqual({ domain: "shop.com", href: "https://shop.com/products/x", precision: "page" });
  });
  it("links a real ad with only the domain shown in the ad (Meta caption) to that domain", () => {
    expect(adSite({ landingDomain: "Shop.COM", landingUrl: null, source: src("estimate") })).toEqual({ domain: "shop.com", href: "https://shop.com/", precision: "domain" });
  });
  it("never follows a non-HTTPS landing URL and rejects a domain that is not a host name", () => {
    expect(adSite({ landingDomain: "shop.com", landingUrl: "http://shop.com/p", source: src("measured") })?.href).toBe("https://shop.com/");
    expect(adSite({ landingDomain: "javascript:alert(1)", landingUrl: null, source: src("measured") })).toBeNull();
  });
  it("shows a demo ad's fictional domain without linking it", () => {
    expect(adSite({ landingDomain: "glowhouse.example", landingUrl: "https://glowhouse.example/products/x", source: src("demo") })).toEqual({ domain: "glowhouse.example", href: null, precision: "page" });
  });
  it("returns nothing when the source gives no site", () => {
    expect(adSite({ landingDomain: null, landingUrl: null, source: src("measured") })).toBeNull();
  });
});
