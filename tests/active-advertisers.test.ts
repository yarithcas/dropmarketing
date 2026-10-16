import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  ACTIVE_GRACE_DAYS,
  DEFAULT_THRESHOLDS,
  MIN_ACTIVE_ADS,
  MIN_ACTIVE_DAYS,
  activityOf,
  advertiserActivity,
  advertiserKey,
  isActiveAd,
  rankAdvertisers,
  resolveThresholds,
  ruleValues,
  type AdvertiserThresholds,
} from "@/lib/advertisers";
import { createI18n } from "@/lib/i18n/i18n";
import { addDays } from "@/lib/dates";
import { adQuerySchema, adThresholds, paramsToObject } from "@/lib/queries";
import { ADVANCED_AD_FILTERS } from "@/lib/plans";
import { stripFilters } from "@/lib/server/plan-filters";
import { searchKey } from "@/lib/server/usage";
import { advertisersOf, datasetForEngines, getAd, getProduct, getStore, globalSearch, listAds, overview, searchAdvertisers } from "@/lib/server/repository";
import { buildReport, reportCatalog } from "@/lib/server/reports";
import { listAdsDb } from "@/lib/server/supabase-repository";
import { DEMO_BASE_SNAPSHOT, demoSnapshot, generateDemoDataset } from "@/lib/demo/generate";

type FixtureAd = { id: string; advertiser: string; firstSeen: string; lastSeen: string; ended?: boolean };
type Expected = { activeAds: number; activeSinceMinDays: number; oldestActiveFirstSeen: string | null; qualifies: boolean };
const fixture = JSON.parse(fs.readFileSync("tests/fixtures/active-advertisers.json", "utf8")) as {
  asOf: string;
  keyCases: [string, string][];
  ads: FixtureAd[];
  withoutActiveAds: string[];
  cases: { name: string; minAds: number; minDays: number; activity: Record<string, Expected>; qualifyingAdIds: string[] }[];
};

const ad = (advertiser: string, firstSeen: string, lastSeen: string, ended?: boolean) => ({ advertiser, firstSeen, lastSeen, ...(ended ? { ended } : {}) });
const AS_OF = "2026-10-12";
const days = (n: number) => addDays(AS_OF, -n);

describe("active-advertiser definition", () => {
  it("uses the documented constants", () => {
    expect(MIN_ACTIVE_ADS).toBe(5);
    expect(MIN_ACTIVE_DAYS).toBe(7);
    expect(ACTIVE_GRACE_DAYS).toBe(1);
    expect(DEFAULT_THRESHOLDS).toEqual({ minAds: 5, minDays: 7 });
  });

  it.each(fixture.keyCases)("normalizes advertiser identity %j → %j", (input, key) => {
    expect(advertiserKey(input)).toBe(key);
  });

  it("a running ad is active when last seen up to 1 day before asOf and first seen by asOf", () => {
    expect(isActiveAd(ad("x", days(30), AS_OF), AS_OF)).toBe(true);
    expect(isActiveAd(ad("x", days(30), days(1)), AS_OF)).toBe(true); // grace boundary (synced yesterday)
    expect(isActiveAd(ad("x", days(30), days(2)), AS_OF)).toBe(false); // inactive
    expect(isActiveAd(ad("x", AS_OF, AS_OF), AS_OF)).toBe(true);
    expect(isActiveAd(ad("x", addDays(AS_OF, 1), addDays(AS_OF, 2)), AS_OF)).toBe(false); // not started on asOf
  });

  it("an ad the source reported as ended runs through its last day only (stopped yesterday = not active)", () => {
    expect(isActiveAd(ad("x", days(30), days(1), true), AS_OF)).toBe(false); // stopped yesterday
    expect(isActiveAd(ad("x", days(30), days(2), true), AS_OF)).toBe(false);
    expect(isActiveAd(ad("x", days(30), AS_OF, true), AS_OF)).toBe(true); // last delivery day = asOf
    expect(isActiveAd(ad("x", days(30), days(1), true), days(1))).toBe(true); // it was running yesterday
    expect(isActiveAd(ad("x", days(30), days(1), false), AS_OF)).toBe(true);
  });

  it("Meta: five ads stopped yesterday or the day before do not make an advertiser qualify", () => {
    // metaAdRecord: a past ad_delivery_stop_time gives last_seen = stop date and active = false (→ ended).
    const stopped = [days(1), days(1), days(1), days(2), days(2)].map((stop) => ad("Stopped Shop", "2026-09-01", stop, true));
    expect(advertiserActivity(stopped, AS_OF).get("stopped shop")).toMatchObject({ activeAds: 0, activeSinceMinDays: 0, qualifies: false });
    // Same ads still delivering when last synced yesterday: running.
    const running = stopped.map((a) => ({ ...a, lastSeen: days(1), ended: false }));
    expect(advertiserActivity(running, AS_OF).get("stopped shop")).toMatchObject({ activeAds: 5, qualifies: true });
  });

  it("qualifies with exactly 5 active ads running exactly 7 days, not with 4 ads or 6 days", () => {
    const five = Array.from({ length: 5 }, () => ad("Shop", days(7), AS_OF));
    expect(advertiserActivity(five, AS_OF).get("shop")).toMatchObject({ activeAds: 5, activeSinceMinDays: 5, qualifies: true, oldestActiveFirstSeen: days(7) });
    expect(advertiserActivity(five.slice(0, 4), AS_OF).get("shop")).toMatchObject({ activeAds: 4, qualifies: false });
    const sixDays = Array.from({ length: 5 }, () => ad("Shop", days(6), AS_OF));
    expect(advertiserActivity(sixDays, AS_OF).get("shop")).toMatchObject({ activeAds: 5, activeSinceMinDays: 0, qualifies: false });
    // 4 long-running + 1 six days old: still only 4 that count.
    expect(advertiserActivity([...five.slice(0, 4), ad("Shop", days(6), AS_OF)], AS_OF).get("shop")).toMatchObject({ activeSinceMinDays: 4, qualifies: false });
  });

  it("does not count an inactive or ended ad, even an old one", () => {
    const four = Array.from({ length: 4 }, () => ad("Shop", days(40), AS_OF));
    expect(advertiserActivity([...four, ad("Shop", days(40), days(2))], AS_OF).get("shop")).toMatchObject({ activeAds: 4, activeSinceMinDays: 4, qualifies: false });
    expect(advertiserActivity([...four, ad("Shop", days(40), days(1), true)], AS_OF).get("shop")).toMatchObject({ activeAds: 4, qualifies: false });
    expect(advertiserActivity([...four, ad("Shop", days(40), days(1))], AS_OF).get("shop")).toMatchObject({ activeAds: 5, qualifies: true });
  });

  it("groups case, accent and spacing variants of one advertiser", () => {
    const names = ["Maison Éclat", "maison eclat", "MAISON  ÉCLAT ", " Maison\tEclat", "maison éclat"];
    const map = advertiserActivity(names.map((n) => ad(n, days(20), AS_OF)), AS_OF);
    expect([...map.keys()]).toEqual(["maison eclat"]);
    expect(map.get("maison eclat")).toMatchObject({ activeAds: 5, qualifies: true, totalAds: 5 });
    // Each spelling resolves to the same activity.
    for (const n of names) expect(activityOf(map, n).qualifies).toBe(true);
    expect(activityOf(map, "Unknown Brand")).toMatchObject({ activeAds: 0, qualifies: false, minAds: 5, minDays: 7 });
  });

  it("evaluates on asOf: the same ads qualify or not depending on the day", () => {
    const ads = Array.from({ length: 5 }, () => ad("Shop", "2026-10-01", "2026-10-20"));
    expect(advertiserActivity(ads, "2026-10-07").get("shop")!.qualifies).toBe(false); // 6 days
    expect(advertiserActivity(ads, "2026-10-08").get("shop")!.qualifies).toBe(true); // 7 days
    expect(advertiserActivity(ads, "2026-10-21").get("shop")!.qualifies).toBe(true); // last seen the day before
    expect(advertiserActivity(ads, "2026-10-22").get("shop")!.qualifies).toBe(false); // stopped
    const ended = ads.map((a) => ({ ...a, ended: true }));
    expect(advertiserActivity(ended, "2026-10-20").get("shop")!.qualifies).toBe(true); // last delivery day
    expect(advertiserActivity(ended, "2026-10-21").get("shop")!.qualifies).toBe(false); // stopped yesterday
  });

  for (const c of fixture.cases) {
    it(`matches the shared fixture: ${c.name}`, () => {
      const t: AdvertiserThresholds = { minAds: c.minAds, minDays: c.minDays };
      const map = advertiserActivity(fixture.ads, fixture.asOf, t);
      const withActive = Object.fromEntries(
        [...map.entries()].filter(([, s]) => s.activeAds > 0).map(([k, s]) => [k, { activeAds: s.activeAds, activeSinceMinDays: s.activeSinceMinDays, oldestActiveFirstSeen: s.oldestActiveFirstSeen, qualifies: s.qualifies }]),
      );
      expect(withActive).toEqual(c.activity);
      for (const k of fixture.withoutActiveAds) expect(map.get(k)).toMatchObject({ activeAds: 0, qualifies: false, oldestActiveFirstSeen: null });
      const ids = fixture.ads.filter((a) => map.get(advertiserKey(a.advertiser))!.qualifies).map((a) => a.id);
      expect(ids.sort()).toEqual([...c.qualifyingAdIds].sort());
    });
  }

  it("ranks qualifying advertisers first", () => {
    const map = advertiserActivity(fixture.ads, fixture.asOf);
    const ranked = rankAdvertisers([...map.values()]);
    const qualifying = Object.values(fixture.cases[0].activity).filter((a) => a.qualifies).length;
    expect(qualifying).toBe(5);
    expect(ranked.findIndex((s) => !s.qualifies)).toBe(qualifying);
    expect(ranked.slice(0, qualifying).every((s) => s.qualifies)).toBe(true);
    expect(ranked.slice(qualifying).every((s) => !s.qualifies)).toBe(true);
  });

  it("clamps adjusted thresholds and defaults missing ones", () => {
    expect(resolveThresholds()).toEqual({ minAds: 5, minDays: 7 });
    expect(resolveThresholds({ minAds: 3, minDays: 14 })).toEqual({ minAds: 3, minDays: 14 });
    expect(resolveThresholds({ minAds: 0, minDays: 500 })).toEqual({ minAds: 1, minDays: 90 });
    expect(resolveThresholds({ minAds: null, minDays: undefined })).toEqual(DEFAULT_THRESHOLDS);
  });
});

describe("rule texts are pluralized in every language", () => {
  const text = (lng: "en" | "fr" | "es" | "de" | "it", key: string, ads: number, days: number, extra: Record<string, unknown> = {}) => {
    const { t } = createI18n(lng);
    return t(key, { ...extra, ...ruleValues(t, ads, days) });
  };
  it("singular and plural thresholds", () => {
    expect(text("en", "activeAdvertisers.toggle", 5, 7)).toBe("Active advertisers only — ≥ 5 active ads for ≥ 7 days");
    expect(text("en", "activeAdvertisers.toggle", 1, 1)).toBe("Active advertisers only — ≥ 1 active ad for ≥ 1 day");
    expect(text("fr", "activeAdvertisers.toggle", 1, 1)).toBe("Annonceurs actifs uniquement — ≥ 1 pub active depuis ≥ 1 jour");
    expect(text("fr", "activeAdvertisers.badgeTip", 5, 7)).toBe("5 pubs actives depuis ≥ 7 jours");
    expect(text("en", "activeAdvertisers.badgeTip", 3, 1)).toBe("3 active ads running for ≥ 1 day");
    expect(text("en", "activeAdvertisers.emptyText", 1, 1)).toContain("at least 1 active ad currently running for at least 1 day.");
    expect(text("de", "activeAdvertisers.toggle", 1, 1)).toBe("Nur aktive Werbetreibende — ≥ 1 aktive Anzeige seit ≥ 1 Tag");
    expect(text("de", "activeAdvertisers.toggle", 5, 7)).toBe("Nur aktive Werbetreibende — ≥ 5 aktive Anzeigen seit ≥ 7 Tagen");
    expect(text("es", "activeAdvertisers.suggestionActive", 1, 1)).toBe("Anunciante activo · 1 anuncio activo desde hace ≥ 1 día");
    expect(text("it", "activeAdvertisers.searchHidden", 1, 1, { count: 2 })).toContain("≥ 1 annuncio attivo da ≥ 1 giorno");
    for (const lng of ["en", "fr", "es", "de", "it"] as const) {
      for (const key of ["toggle", "badgeTip", "emptyText", "suggestionActive", "searchHidden"]) {
        const s = text(lng, `activeAdvertisers.${key}`, 1, 1, { count: 1 });
        expect(s, `${lng} ${key}`).not.toMatch(/\{\{|activeAdvertisers\./);
        expect(s, `${lng} ${key}`).not.toMatch(/\b1 (ads|days|pubs|jours|anuncios|días|Anzeigen|Tagen|annunci|giorni)\b/);
      }
    }
  });
});

describe("ad query: active advertisers parameter", () => {
  it("is on by default and only an explicit false turns it off", () => {
    expect(adQuerySchema.parse({}).activeAdvertisers).toBe(true);
    expect(adQuerySchema.parse({ activeAdvertisers: "true" }).activeAdvertisers).toBe(true);
    expect(adQuerySchema.parse({ activeAdvertisers: "false" }).activeAdvertisers).toBe(false);
    expect(adQuerySchema.safeParse({ activeAdvertisers: "maybe" }).success).toBe(false);
  });
  it("parses and bounds the thresholds", () => {
    expect(adThresholds(adQuerySchema.parse({}))).toEqual({ minAds: 5, minDays: 7 });
    expect(adThresholds(adQuerySchema.parse({ minActiveAds: "3", minActiveDays: "14" }))).toEqual({ minAds: 3, minDays: 14 });
    expect(adQuerySchema.safeParse({ minActiveAds: "0" }).success).toBe(false);
    expect(adQuerySchema.safeParse({ minActiveDays: "91" }).success).toBe(false);
    expect(adQuerySchema.safeParse({ minActiveAds: "2.5" }).success).toBe(false);
  });
  it("treats a blank threshold as not set (never as 0)", () => {
    for (const blank of ["", " ", "\t"]) {
      expect(adThresholds(adQuerySchema.parse(paramsToObject(new URLSearchParams({ minActiveDays: blank }))))).toEqual(DEFAULT_THRESHOLDS);
      expect(adThresholds(adQuerySchema.parse(paramsToObject(new URLSearchParams({ minActiveAds: blank }))))).toEqual(DEFAULT_THRESHOLDS);
    }
    expect(adQuerySchema.parse({ minActiveDays: "", minActiveAds: " " })).toMatchObject({ minActiveDays: undefined, minActiveAds: undefined });
    // An explicit 0 days is still a valid (Pro) threshold.
    expect(adThresholds(adQuerySchema.parse({ minActiveDays: "0" }))).toEqual({ minAds: 5, minDays: 0 });
    expect(listAds(adQuerySchema.parse({ minActiveDays: "" })).total).toBe(listAds(adQuerySchema.parse({})).total);
  });
  it("is part of the metered search key (a new search when toggled or adjusted)", () => {
    const on = searchKey(adQuerySchema.parse({ q: "lamp" }));
    expect(searchKey(adQuerySchema.parse({ q: "lamp", activeAdvertisers: "true" }))).toBe(on);
    expect(searchKey(adQuerySchema.parse({ q: "lamp", activeAdvertisers: "false" }))).not.toBe(on);
    expect(searchKey(adQuerySchema.parse({ q: "lamp", minActiveAds: "3" }))).not.toBe(on);
    expect(searchKey(adQuerySchema.parse({ q: "lamp", page: "2" }))).toBe(on);
  });
  it("thresholds are advanced filters (stripped on Free), the switch is not", () => {
    expect(ADVANCED_AD_FILTERS).toContain("minActiveAds");
    expect(ADVANCED_AD_FILTERS).toContain("minActiveDays");
    expect(ADVANCED_AD_FILTERS as readonly string[]).not.toContain("activeAdvertisers");
    const { query, ignored } = stripFilters(adQuerySchema.parse({ activeAdvertisers: "false", minActiveAds: "2", minActiveDays: "1" }), ADVANCED_AD_FILTERS);
    expect(ignored.sort()).toEqual(["minActiveAds", "minActiveDays"]);
    expect(query.activeAdvertisers).toBe(false);
    expect(adThresholds(query)).toEqual(DEFAULT_THRESHOLDS);
  });
});

describe("demo repository (pinned snapshot)", () => {
  const q = (o: Record<string, unknown> = {}) => adQuerySchema.parse({ pageSize: 100, ...o });

  it("Ad Spy shows only ads of qualifying advertisers by default; totals and pages follow", () => {
    const on = listAds(q());
    const off = listAds(q({ activeAdvertisers: "false" }));
    expect(on.advertiserRule).toEqual({ enabled: true, minAds: 5, minDays: 7, asOf: DEMO_BASE_SNAPSHOT });
    expect(off.advertiserRule.enabled).toBe(false);
    expect(on.total).toBeGreaterThan(0);
    expect(on.total).toBeLessThan(off.total);
    expect(on.items.every((a) => a.advertiserActivity.qualifies && a.advertiserActivity.activeSinceMinDays >= 5)).toBe(true);
    expect(off.items.some((a) => !a.advertiserActivity.qualifies)).toBe(true);
    // Pagination covers exactly the filtered set.
    const pages = Math.ceil(on.total / 100);
    const seen = new Set<string>();
    for (let page = 1; page <= pages; page++) for (const a of listAds(q({ page: String(page) })).items) seen.add(a.id);
    expect(seen.size).toBe(on.total);
    expect(listAds(q({ page: String(pages + 1) })).items).toEqual([]);
  });

  it("the badge data explains why an advertiser qualifies", () => {
    const [first] = listAds(q()).items;
    const stats = advertisersOf().get(advertiserKey(first.advertiser))!;
    expect(first.advertiserActivity).toEqual({
      activeAds: stats.activeAds,
      activeSinceMinDays: stats.activeSinceMinDays,
      oldestActiveFirstSeen: stats.oldestActiveFirstSeen,
      qualifies: true,
      minAds: 5,
      minDays: 7,
    });
    expect(first.advertiserActivity.oldestActiveFirstSeen! <= addDays(DEMO_BASE_SNAPSHOT, -7)).toBe(true);
  });

  it("adjusted thresholds change the set; with the switch off they only annotate", () => {
    const strict = listAds(q({ minActiveAds: "10", minActiveDays: "14" }));
    const loose = listAds(q({ minActiveAds: "2", minActiveDays: "3" }));
    const base = listAds(q());
    expect(strict.total).toBeLessThan(base.total);
    expect(loose.total).toBeGreaterThan(base.total);
    expect(strict.items.every((a) => a.advertiserActivity.activeSinceMinDays >= 10 && a.advertiserActivity.minDays === 14)).toBe(true);
    expect(listAds(q({ activeAdvertisers: "false", minActiveAds: "10" })).total).toBe(listAds(q({ activeAdvertisers: "false" })).total);
  });

  it("composes with the other filters (active ads only, advertiser search)", () => {
    const active = listAds(q({ activeOnly: "true" }));
    expect(active.total).toBeGreaterThan(0);
    // "Active ads only" uses the same definition as the rule: running on the snapshot day.
    expect(active.items.every((a) => a.advertiserActivity.qualifies && isActiveAd(a, DEMO_BASE_SNAPSHOT) && a.lastSeen === DEMO_BASE_SNAPSHOT)).toBe(true);
    const all = listAds(q({ activeAdvertisers: "false", activeOnly: "true", pageSize: "100" }));
    expect(all.total).toBe(generateDemoDataset(DEMO_BASE_SNAPSHOT).ads.filter((a) => a.lastSeen === DEMO_BASE_SNAPSHOT).length);
    const name = listAds(q()).items[0].advertiser;
    const shouting = listAds(q({ advertiser: ` ${name.toUpperCase()} ` }));
    expect(shouting.total).toBeGreaterThan(0);
    expect(shouting.items.every((a) => advertiserKey(a.advertiser).includes(advertiserKey(name)))).toBe(true);
  });

  it("global search lists ads of active advertisers only and ranks/flags active advertisers", () => {
    const r = globalSearch("routine");
    const map = advertisersOf();
    expect(r.ads.length).toBeGreaterThan(0);
    expect(r.ads.every((a) => map.get(advertiserKey(a.advertiser))!.qualifies)).toBe(true);
    expect(r.hiddenAds).toBeGreaterThan(0);
    // Words shared by store and brand names ("… Corner", "… Labs"): a mixed list.
    const adv = [...searchAdvertisers("or", 50), ...searchAdvertisers("la", 50)];
    for (const list of [searchAdvertisers("or", 50), searchAdvertisers("la", 50)]) {
      const firstInactive = list.findIndex((a) => !a.active);
      if (firstInactive >= 0) expect(list.slice(firstInactive).every((a) => !a.active)).toBe(true);
    }
    expect(adv.some((a) => a.active)).toBe(true);
    expect(adv.some((a) => !a.active)).toBe(true);
    expect(searchAdvertisers("o")).toEqual([]); // too short
    for (const a of adv) expect(a.active).toBe(map.get(advertiserKey(a.name))!.qualifies);
  });

  it("product, store and ad details keep every ad and annotate it", () => {
    const d = getProduct("smart-jump-rope-with-counter")!;
    expect(d.ads.length).toBe(d.product.metrics.adsObserved); // evidence is never dropped
    expect(d.advertiserRule).toMatchObject({ enabled: true, minAds: 5, minDays: 7 });
    expect(d.ads.every((a) => typeof a.advertiserActivity.qualifies === "boolean")).toBe(true);
    const qualifyingStore = [...advertisersOf().values()].find((s) => s.qualifies)!;
    const ad = listAds(q({ advertiser: qualifyingStore.name })).items[0];
    const detail = getAd(ad.id)!;
    expect(detail.ad.advertiserActivity.qualifies).toBe(true);
    if (ad.landingDomain) {
      const store = detail.store;
      if (store) expect(getStore(store.id)!.ads.some((a) => a.advertiserActivity.qualifies)).toBe(true);
    }
  });
});

describe("dashboard, creative viewer and reports follow the default (pinned and rolling days)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const days = [...new Set([DEMO_BASE_SNAPSHOT, "2026-10-14", demoSnapshot(new Date(), "")])];

  for (const day of days) {
    it(`on ${day}`, () => {
      vi.stubEnv("DEMO_SNAPSHOT", day);
      const map = advertisersOf();
      const qualifies = (a: { advertiser: string }) => map.get(advertiserKey(a.advertiser))?.qualifies === true;
      const d = datasetForEngines();
      expect(d.snapshot).toBe(day);

      // Dashboard "Recent ads": the first ads of its "View all" target (Ad Spy, newest first), badged.
      const o = overview();
      expect(o.asOf).toBe(day);
      expect(o.recentAds).toHaveLength(4);
      expect(o.recentAds.every((a) => qualifies(a) && a.advertiserActivity.qualifies && a.advertiserActivity.activeSinceMinDays >= 5)).toBe(true);
      expect(o.recentAds.map((a) => a.id)).toEqual(listAds(adQuerySchema.parse({ pageSize: 4 })).items.map((a) => a.id));
      expect(o.advertiserRule).toEqual({ enabled: true, minAds: 5, minDays: 7, asOf: day });

      // Creative viewer: related ads of active advertisers by default; every related ad one switch away.
      let mixed = 0;
      for (const { id } of listAds(adQuerySchema.parse({ pageSize: 60 })).items) {
        const detail = getAd(id)!;
        const sameProduct = d.ads.filter((a) => a.productId === detail.ad.productId && a.id !== id);
        expect(detail.relatedCounts).toEqual({ qualifying: sameProduct.filter(qualifies).length, total: sameProduct.length });
        expect(detail.related.length).toBe(Math.min(6, detail.relatedCounts.qualifying));
        expect(detail.related.every((a) => qualifies(a) && a.advertiserActivity.qualifies && a.productId === detail.ad.productId)).toBe(true);
        expect(detail.relatedAll.length).toBe(Math.min(6, sameProduct.length));
        expect(detail.relatedAll.every((a) => a.advertiserActivity.qualifies === qualifies(a))).toBe(true);
        if (detail.relatedAll.some((a) => !qualifies(a))) mixed++;
      }
      expect(mixed).toBeGreaterThan(0); // the switch matters

      // Reports: ad examples come from active advertisers whenever the report has any, labelled either way.
      for (const { id } of reportCatalog()) {
        const r = buildReport(id);
        const products = new Set(d.products.filter((p) => !r.category || p.category === r.category).map((p) => p.id));
        const reportAds = d.ads.filter((a) => a.productId && products.has(a.productId));
        const anyQualifying = reportAds.some(qualifies);
        expect(r.adExamplesRule).toMatchObject({ enabled: anyQualifying, minAds: 5, minDays: 7, asOf: day, totalAds: reportAds.length, qualifyingAds: reportAds.filter(qualifies).length });
        expect(r.adExamples.length).toBe(Math.min(4, anyQualifying ? reportAds.filter(qualifies).length : reportAds.length));
        for (const a of r.adExamples) {
          expect(a.advertiserActivity.qualifies).toBe(qualifies(a));
          if (anyQualifying) expect(qualifies(a), `${id}: ${a.advertiser}`).toBe(true);
        }
      }
    });
  }

  it("the reviewed cases: Glow House on the dashboard, ankle weights' related ads, the weekly report", () => {
    vi.stubEnv("DEMO_SNAPSHOT", DEMO_BASE_SNAPSHOT);
    expect(overview().recentAds.map((a) => a.id)).not.toContain("ad-self-cleaning-lint-roller-station-3");
    const ankle = getAd("ad-adjustable-ankle-weights-pair-0")!;
    expect(ankle.related.map((a) => a.advertiser)).not.toContain("Nimbo Wellness");
    expect(ankle.relatedAll.map((a) => a.advertiser)).toContain("Nimbo Wellness");
    const weekly = buildReport("weekly-opportunities");
    expect(weekly.adExamplesRule.enabled).toBe(true);
    expect(weekly.adExamples.map((a) => a.advertiser)).not.toContain("Lumi Shop");
  });
});

describe("demo dataset: a realistic subset qualifies on every rolling day", () => {
  /** Qualifying advertisers and their ads on `day`, from a dataset generated for any later day (history is stable). */
  const stats = (ads: { advertiser: string; firstSeen: string; lastSeen: string }[], day: string) => {
    const visible = ads.filter((a) => a.firstSeen <= day);
    const map = advertiserActivity(visible, day);
    const keys = new Set([...map.values()].filter((s) => s.qualifies).map((s) => s.key));
    return { advertisers: keys.size, ads: visible.filter((a) => keys.has(advertiserKey(a.advertiser))).length };
  };

  it("on the pinned test date and on today's rolling date", () => {
    for (const day of [DEMO_BASE_SNAPSHOT, demoSnapshot(new Date(), "")]) {
      const s = stats(generateDemoDataset(day).ads, day);
      expect(s.advertisers, day).toBeGreaterThanOrEqual(8);
      expect(s.ads, day).toBeGreaterThanOrEqual(40);
    }
  });

  it("every day for a year after the base snapshot", () => {
    const end = addDays(DEMO_BASE_SNAPSHOT, 365);
    const ads = generateDemoDataset(end).ads;
    // Evaluating day X on a later dataset equals evaluating X's own dataset (spot-checked here).
    for (const day of ["2026-10-20", "2027-01-15"]) expect(stats(ads, day)).toEqual(stats(generateDemoDataset(day).ads, day));
    let min = { advertisers: Infinity, ads: Infinity };
    for (let day = DEMO_BASE_SNAPSHOT; day <= end; day = addDays(day, 1)) {
      const s = stats(ads, day);
      min = { advertisers: Math.min(min.advertisers, s.advertisers), ads: Math.min(min.ads, s.ads) };
    }
    expect(min.advertisers).toBeGreaterThanOrEqual(8);
    expect(min.ads).toBeGreaterThanOrEqual(40);
  });
});

describe("live mode (PostgREST)", () => {
  afterEach(() => vi.restoreAllMocks());

  function fakeDb(responses: (url: string, body: unknown) => unknown) {
    const calls: { url: URL; method: string; body: unknown }[] = [];
    const db = createClient("http://127.0.0.1:1", "service-key", {
      auth: { persistSession: false },
      global: {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          const body = init?.body ? JSON.parse(String(init.body)) : null;
          calls.push({ url, method: init?.method ?? "GET", body });
          return new Response(JSON.stringify(responses(url.pathname, body)), { status: 200, headers: { "content-type": "application/json", "content-range": "0-1/2" } });
        }) as typeof fetch,
      },
    });
    return { db, calls };
  }

  const row = (id: string, advertiser: string, key: string) => ({
    id,
    advertiser,
    advertiser_key: key,
    platform: "meta",
    country: "FR",
    language: "fr",
    format: "video",
    headline: "h",
    copy: "c",
    cta: "shop_now",
    first_seen: "2026-09-01",
    last_seen: "2026-10-14",
    connector: "meta_ad_library",
    source_kind: "measured",
    observed_at: "2026-10-14T05:00:00Z",
    products: null,
  });

  it("default: the RPC is the base relation, thresholds go in the JSON body, filters stay quoted", async () => {
    const { db, calls } = fakeDb((path) =>
      path.endsWith("/rpc/advertiser_activity")
        ? [{ advertiser_key: "maison eclat", active_ads: 9, active_since_min_days: 6, oldest_active_first_seen: "2026-08-01" }]
        : [row("a1", "Maison Éclat", "maison eclat"), row("a2", "Other, Inc. (x)", "other, inc. (x)")],
    );
    const page = await listAdsDb(db, adQuerySchema.parse({ q: "x,id.neq.zz", advertiser: "MAISON éclat", minActiveAds: "6" }), "2026-10-15");
    const [list, activity] = calls;
    expect(list.method).toBe("POST");
    expect(list.url.pathname).toBe("/rest/v1/rpc/ads_of_active_advertisers");
    expect(list.body).toEqual({ as_of: "2026-10-15", min_ads: 6, min_days: 7 });
    expect(list.url.searchParams.get("select")).toBe("*,products(name)");
    expect(list.url.searchParams.get("or")).toBe('(copy.ilike."%x,id.neq.zz%",headline.ilike."%x,id.neq.zz%",advertiser.ilike."%x,id.neq.zz%")');
    expect(list.url.searchParams.get("advertiser_key")).toBe("ilike.%maison eclat%");
    // The needle is the same identity as the SQL column, Greek final sigma included (ΟΔΟΣ → οδοσ).
    await listAdsDb(db, adQuerySchema.parse({ advertiser: "ΟΔΟΣ" }), "2026-10-15");
    expect(calls.filter((c) => c.url.pathname.endsWith("/ads_of_active_advertisers")).at(-1)!.url.searchParams.get("advertiser_key")).toBe("ilike.%οδοσ%");
    // Stable pages: the sort column, then the id.
    expect(list.url.searchParams.get("order")).toBe("first_seen.desc,id.asc");
    expect(list.url.searchParams.get("offset")).toBe("0");
    expect(list.url.searchParams.get("limit")).toBe("24");
    // Advertiser keys of the page travel in the body, never in a filter string.
    expect(activity.url.pathname).toBe("/rest/v1/rpc/advertiser_activity");
    expect(activity.body).toEqual({ as_of: "2026-10-15", min_days: 7, keys: ["maison eclat", "other, inc. (x)"] });
    expect([...activity.url.searchParams.keys()]).toEqual([]);
    expect(page.total).toBe(2);
    expect(page.advertiserRule).toEqual({ enabled: true, minAds: 6, minDays: 7, asOf: "2026-10-15" });
    expect(page.items[0].advertiserActivity).toEqual({ activeAds: 9, activeSinceMinDays: 6, oldestActiveFirstSeen: "2026-08-01", qualifies: true, minAds: 6, minDays: 7 });
    expect(page.items[1].advertiserActivity).toMatchObject({ activeAds: 0, qualifies: false });
  });

  it("switched off: the plain table, still annotated", async () => {
    const { db, calls } = fakeDb((path) => (path.endsWith("/rpc/advertiser_activity") ? [] : [row("a1", "Shop", "shop")]));
    const page = await listAdsDb(db, adQuerySchema.parse({ activeAdvertisers: "false", activeOnly: "true" }), "2026-10-15");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url.pathname).toBe("/rest/v1/advertisements");
    // Active ads only = running on asOf: an ended ad through its last day, any other ad last seen at most a day before.
    expect(calls[0].url.searchParams.get("last_seen")).toBeNull();
    expect(calls[0].url.searchParams.get("first_seen")).toBe("lte.2026-10-15");
    expect(calls[0].url.searchParams.get("or")).toBe("(last_seen.gte.2026-10-15,and(last_seen.gte.2026-10-14,ended.is.false))");
    expect(calls[1].url.pathname).toBe("/rest/v1/rpc/advertiser_activity");
    expect(page.advertiserRule.enabled).toBe(false);
    expect(page.items[0].advertiserActivity.qualifies).toBe(false);
  });

  it("an empty page makes no activity call", async () => {
    const { db, calls } = fakeDb(() => []);
    const page = await listAdsDb(db, adQuerySchema.parse({}), "2026-10-15");
    expect(calls).toHaveLength(1);
    expect(page.items).toEqual([]);
  });
});
