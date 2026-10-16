import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** Demo-mode request cookies (plan and visitor), as set by the demo billing switch. */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));

const { GET: adsGET } = await import("@/app/api/ads/route");
const { GET: advertisersGET } = await import("@/app/api/advertisers/route");
const { GET: searchGET } = await import("@/app/api/search/route");
const { getSession } = await import("@/lib/server/session");
const { meter } = await import("@/lib/server/usage");

let visitor = 0;
function as(plan: "free" | "pro") {
  jar.clear();
  jar.set("th_demo_plan", plan);
  jar.set("th_vid", `api-test-${plan}-${++visitor}`); // fresh daily search quota per test
}

type AdsBody = {
  total: number;
  items: { advertiser: string; advertiserActivity: { qualifies: boolean; activeSinceMinDays: number; minAds: number; minDays: number } }[];
  advertiserRule: { enabled: boolean; minAds: number; minDays: number; asOf: string };
  ignoredFilters: string[];
};

async function ads(query: string): Promise<AdsBody> {
  const res = await adsGET(new NextRequest(`http://localhost/api/ads?${query}`));
  expect(res.status).toBe(200);
  return (await res.json()) as AdsBody;
}

describe("GET /api/ads — active advertisers", () => {
  beforeEach(() => as("pro"));

  it("is on by default for every plan", async () => {
    for (const plan of ["free", "pro"] as const) {
      as(plan);
      const body = await ads("pageSize=50");
      expect(body.advertiserRule).toEqual({ enabled: true, minAds: 5, minDays: 7, asOf: "2026-10-12" });
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.every((a) => a.advertiserActivity.qualifies)).toBe(true);
    }
  });

  it("can be switched off on every plan (more ads, same annotations)", async () => {
    for (const plan of ["free", "pro"] as const) {
      as(plan);
      const on = await ads("pageSize=50");
      const off = await ads("pageSize=50&activeAdvertisers=false");
      expect(off.advertiserRule.enabled).toBe(false);
      expect(off.ignoredFilters).toEqual([]);
      expect(off.total).toBeGreaterThan(on.total);
      expect(off.items.some((a) => !a.advertiserActivity.qualifies)).toBe(true);
    }
  });

  it("Pro can adjust the thresholds", async () => {
    const body = await ads("pageSize=50&minActiveAds=10&minActiveDays=14");
    expect(body.ignoredFilters).toEqual([]);
    expect(body.advertiserRule).toMatchObject({ enabled: true, minAds: 10, minDays: 14 });
    expect(body.items.every((a) => a.advertiserActivity.qualifies && a.advertiserActivity.activeSinceMinDays >= 10 && a.advertiserActivity.minDays === 14)).toBe(true);
    expect(body.total).toBeLessThan((await ads("pageSize=50")).total);
  });

  it("Free: threshold params are stripped (defaults apply) and reported", async () => {
    as("free");
    const body = await ads("pageSize=50&minActiveAds=1&minActiveDays=0");
    expect(body.ignoredFilters.sort()).toEqual(["minActiveAds", "minActiveDays"]);
    expect(body.advertiserRule).toMatchObject({ enabled: true, minAds: 5, minDays: 7 });
    expect(body.total).toBe((await ads("pageSize=50")).total);
  });

  it("rejects invalid values", async () => {
    for (const q of ["activeAdvertisers=no", "minActiveAds=0", "minActiveDays=-1", "minActiveAds=abc"]) {
      const res = await adsGET(new NextRequest(`http://localhost/api/ads?${q}`));
      expect(res.status, q).toBe(400);
    }
  });

  it("counts toggling as a new metered search, page turns as the same one", async () => {
    as("free");
    const used = async () => (await meter(await getSession(), "ad_search", false)).used;
    expect(await used()).toBe(0);
    await ads("q=lamp");
    expect(await used()).toBe(1);
    await ads("q=lamp&page=2");
    await ads("q=lamp&activeAdvertisers=true"); // explicit default = same search
    expect(await used()).toBe(1);
    await ads("q=lamp&activeAdvertisers=false");
    expect(await used()).toBe(2);
  });
});

describe("advertiser lists flag and rank active advertisers", () => {
  beforeEach(() => as("pro"));

  it("GET /api/advertisers", async () => {
    const res = await advertisersGET(new NextRequest("http://localhost/api/advertisers?q=or"));
    const body = (await res.json()) as { items: { name: string; active: boolean }[]; advertiserRule: { minAds: number; minDays: number } };
    expect(body.advertiserRule).toMatchObject({ minAds: 5, minDays: 7 });
    expect(body.items.length).toBeGreaterThan(0);
    const firstInactive = body.items.findIndex((a) => !a.active);
    if (firstInactive >= 0) expect(body.items.slice(firstInactive).every((a) => !a.active)).toBe(true);
  });

  it("GET /api/search: ads of active advertisers only, others counted", async () => {
    const res = await searchGET(new NextRequest("http://localhost/api/search?q=routine"));
    const body = (await res.json()) as { ads: unknown[]; hiddenAds: number; advertiserRule: { enabled: boolean } };
    expect(body.ads.length).toBeGreaterThan(0);
    expect(body.hiddenAds).toBeGreaterThan(0);
    expect(body.advertiserRule.enabled).toBe(true);
  });
});
