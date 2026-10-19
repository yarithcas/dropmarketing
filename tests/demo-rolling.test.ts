import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { DEMO_BASE_SNAPSHOT, DEMO_EPOCH, demoSnapshot, generateDemoDataset, getDemoDataset, type DemoDataset } from "@/lib/demo/generate";
import { addDays } from "@/lib/dates";
import { DAILY_SCAN_UTC, nextDailyUtc, refreshStatus } from "@/lib/monitoring";
import { meta, overview } from "@/lib/server/repository";

const D = "2026-10-20";
const D1 = addDays(D, 1);

/** Ad fields that do not depend on the snapshot (lastSeen/source move while an ad keeps running; ended once it stops). */
const stable = (ad: DemoDataset["ads"][number]) => {
  const rest: Partial<typeof ad> = { ...ad };
  delete rest.lastSeen;
  delete rest.source;
  delete rest.ended;
  return rest;
};

describe("demo snapshot day", () => {
  it("follows the UTC calendar: yesterday, rolling over at 00:00 UTC", () => {
    expect(demoSnapshot(new Date("2026-10-15T23:59:59Z"), "")).toBe("2026-10-14");
    expect(demoSnapshot(new Date("2026-10-16T00:00:00Z"), "")).toBe("2026-10-15");
    expect(demoSnapshot(new Date("2027-03-01T12:00:00Z"), "")).toBe("2027-02-28");
  });
  it("can be pinned with DEMO_SNAPSHOT, never earlier than the base snapshot", () => {
    expect(demoSnapshot(new Date("2027-01-01T12:00:00Z"), "2026-11-03")).toBe("2026-11-03");
    expect(demoSnapshot(new Date("2027-01-01T12:00:00Z"), "not-a-date")).toBe("2026-12-31");
    expect(demoSnapshot(new Date("2026-01-01T12:00:00Z"), "")).toBe(DEMO_BASE_SNAPSHOT);
    expect(demoSnapshot(new Date(), "2025-01-01")).toBe(DEMO_BASE_SNAPSHOT);
    expect(generateDemoDataset("2020-01-01").snapshot).toBe(DEMO_BASE_SNAPSHOT);
  });
});

describe("rolling demo dataset", () => {
  it("is identical for the same day (any instance, any request)", () => {
    const a = generateDemoDataset(D);
    const b = generateDemoDataset(D);
    expect(a.snapshot).toBe(D);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("keeps past history unchanged and appends exactly one day the next day", () => {
    const a = generateDemoDataset(D);
    const b = generateDemoDataset(D1);
    expect(b.products.map((p) => p.id)).toEqual(a.products.map((p) => p.id)); // stable product ids
    for (const p of a.products) {
      const before = a.observations[p.id];
      const after = b.observations[p.id];
      expect(after.slice(0, -1)).toEqual(before);
      expect(after).toHaveLength(before.length + 1);
      expect(after.at(-1)!.date).toBe(D1);
      expect(before[0].date >= DEMO_EPOCH).toBe(true);
      expect(b.products.find((x) => x.id === p.id)!.firstDetected).toBe(p.firstDetected);
    }
    // Ads: every ad of day D is still there with the same content; new ads all start on D+1.
    const byId = new Map(b.ads.map((x) => [x.id, x]));
    for (const ad of a.ads) {
      const next = byId.get(ad.id)!;
      expect(stable(next)).toEqual(stable(ad));
      expect(next.lastSeen === ad.lastSeen || (ad.lastSeen === D && next.lastSeen === D1)).toBe(true);
      // An ad that stopped stays stopped; one last seen on D has stopped on D1 exactly when it did not move.
      if (ad.ended) expect(next.ended).toBe(true);
      expect(Boolean(next.ended)).toBe(next.lastSeen < D1);
    }
    const added = b.ads.filter((x) => !a.ads.some((y) => y.id === x.id));
    expect(added.length).toBeGreaterThan(0); // new ads first seen "yesterday"
    expect(added.every((x) => x.firstSeen === D1 && x.source.kind === "demo")).toBe(true);
    // Store listings only grow, with the new day's listings.
    expect(b.storeProducts.slice(0, a.storeProducts.length)).toEqual(a.storeProducts);
    expect(b.storeProducts.slice(a.storeProducts.length).every((sp) => sp.firstSeen === D1)).toBe(true);
    for (const s of a.stores) expect(b.storeSnapshots[s.id].slice(0, a.storeSnapshots[s.id].length)).toEqual(a.storeSnapshots[s.id]);
  });

  it("stays continuous over longer gaps and moves day to day", () => {
    const a = generateDemoDataset(DEMO_BASE_SNAPSHOT);
    const b = generateDemoDataset("2026-11-20");
    for (const p of a.products) expect(b.observations[p.id].slice(0, a.observations[p.id].length)).toEqual(a.observations[p.id]);
    const last = (ds: DemoDataset) => ds.products.map((p) => ds.observations[p.id].at(-1)!.adsActive);
    expect(last(generateDemoDataset(D1))).not.toEqual(last(generateDemoDataset(D)));
  });

  it("keeps activity bounded a year later and every value demo-labelled", () => {
    const base = generateDemoDataset(DEMO_BASE_SNAPSHOT);
    const later = generateDemoDataset("2027-10-12");
    const active = (ds: DemoDataset) => ds.ads.filter((a) => a.lastSeen === ds.snapshot).length;
    expect(active(later)).toBeLessThan(active(base) * 3);
    expect(later.ads.every((a) => a.source.kind === "demo" && (a.landingDomain == null || a.landingDomain.endsWith(".example")))).toBe(true);
    expect(later.ads.every((a) => a.lastSeen <= later.snapshot && a.firstSeen <= a.lastSeen)).toBe(true);
  });

  it("caches one dataset per day", () => {
    const a = getDemoDataset(D);
    expect(getDemoDataset(D)).toBe(a);
    expect(getDemoDataset(D1)).not.toBe(a);
    expect(getDemoDataset(D1).snapshot).toBe(D1);
  });
});

describe("repository follows the snapshot day without a restart", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("serves the new day's data on the next request", () => {
    vi.stubEnv("DEMO_SNAPSHOT", D);
    expect(meta()).toMatchObject({ mode: "demo", asOf: D });
    const first = overview();
    vi.stubEnv("DEMO_SNAPSHOT", D1);
    expect(meta().asOf).toBe(D1);
    expect(overview()).not.toEqual(first);
  });
});

describe("refresh status", () => {
  it("matches the daily cron declared in vercel.json", () => {
    const cron = JSON.parse(fs.readFileSync("vercel.json", "utf8")).crons[0];
    expect(cron.path).toBe("/api/cron/scan");
    expect(cron.schedule).toBe(`${DAILY_SCAN_UTC.minute} ${DAILY_SCAN_UTC.hour} * * *`);
  });
  it("computes the next run and the mechanism per mode", () => {
    expect(nextDailyUtc(new Date("2026-10-14T05:14:00Z"))).toBe("2026-10-14T05:15:00.000Z");
    expect(nextDailyUtc(new Date("2026-10-14T05:15:00Z"))).toBe("2026-10-15T05:15:00.000Z");
    const now = new Date("2026-10-14T10:00:00Z");
    expect(refreshStatus({ mode: "demo", scheduler: false, dataAsOf: "2026-10-13", now })).toEqual({ kind: "demo_daily", nextAt: "2026-10-15T00:00:00.000Z", dataAsOf: "2026-10-13" });
    expect(refreshStatus({ mode: "live", scheduler: true, dataAsOf: "2026-10-14", now })).toEqual({ kind: "cron_daily", nextAt: "2026-10-15T05:15:00.000Z", dataAsOf: "2026-10-14" });
    expect(refreshStatus({ mode: "live", scheduler: false, dataAsOf: null, now }).kind).toBe("none");
  });
});
