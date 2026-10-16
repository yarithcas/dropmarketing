import type { TFunction } from "i18next";
import { addDays } from "./dates";
import type { Advertisement } from "./types";

/**
 * "Active advertisers": the default quality bar of every list where TrendHunter finds ads
 * (Ad Spy, creatives, global search, dashboard, reports, product and store pages).
 *
 * - **Active ad** = an ad currently running on `asOf` (also the Ad Spy "active ads only" filter and the
 *   overview's active-ad count): first seen on or before `asOf`, and
 *   - if the source reported it as ended (`ended`: Meta stop date before the sync day, a library that
 *     stopped showing it, a demo ad that stopped before the snapshot), last seen on or after `asOf`
 *     (an ended ad runs through its last delivery day, never after it);
 *   - otherwise last seen at most `ACTIVE_GRACE_DAYS` (1) day before `asOf`: libraries refresh with
 *     about a day of delay and the connectors sync once a day, so a running ad observed yesterday
 *     still runs (the `ad_observations.active` rule of the connectors).
 *   An ad that stopped yesterday is therefore not active today.
 * - **Advertiser identity**: `advertiserKey(name)` — Unicode NFKD, combining accents removed, lower
 *   case, Greek final sigma folded (ς → σ), runs of whitespace collapsed to one space, trimmed.
 *   "Maison Éclat", " maison  eclat " and "MAISON ECLAT" are one advertiser; so are "ΟΔΟΣ" and "Οδος".
 *   Platforms are not part of the identity.
 * - **Qualifying advertiser**: at least `MIN_ACTIVE_ADS` (5) of its ads are active on `asOf` AND were
 *   first seen at least `MIN_ACTIVE_DAYS` (7) days before it (`firstSeen <= asOf - 7 days`).
 *   Every ad of a qualifying advertiser is shown; ads of other advertisers are hidden by default.
 *
 * The Postgres side (migration 0008: `advertiser_key()`, `advertisements.ended`, `advertiser_activity()`,
 * `ads_of_active_advertisers()`) implements exactly the same rule; keep both in sync
 * (tests/active-advertisers.test.ts and supabase/tests/0008_active_advertisers.test.sql share fixtures).
 */

export const MIN_ACTIVE_ADS = 5;
export const MIN_ACTIVE_DAYS = 7;
/** A running ad (not reported ended) last seen up to this many days before `asOf` is still active. */
export const ACTIVE_GRACE_DAYS = 1;
/** Bounds of the adjustable thresholds (Pro advanced filters). */
export const THRESHOLD_LIMITS = { minAds: { min: 1, max: 50 }, minDays: { min: 0, max: 90 } } as const;

export interface AdvertiserThresholds {
  minAds: number;
  minDays: number;
}

export const DEFAULT_THRESHOLDS: AdvertiserThresholds = { minAds: MIN_ACTIVE_ADS, minDays: MIN_ACTIVE_DAYS };

/** The rule a list was evaluated with, echoed by the API so the UI can explain it. */
export interface AdvertiserRule extends AdvertiserThresholds {
  /** Whether ads of non-qualifying advertisers were hidden. */
  enabled: boolean;
  /** Day the rule was evaluated on (the dataset's snapshot). */
  asOf: string;
}

/** Per-advertiser activity on `asOf`, with the thresholds it was evaluated against. */
export interface AdvertiserActivity extends AdvertiserThresholds {
  /** Ads active on asOf. */
  activeAds: number;
  /** Active ads first seen at least `minDays` days before asOf (the count the rule compares to `minAds`). */
  activeSinceMinDays: number;
  /** First-seen day of the oldest active ad; null without active ads. */
  oldestActiveFirstSeen: string | null;
  qualifies: boolean;
}

/** Ad as returned by ad lists: with its advertiser's activity. */
export type AdWithActivity<T extends Advertisement = Advertisement> = T & { advertiserActivity: AdvertiserActivity };

/**
 * Normalized advertiser identity (case-, accent- and spacing-insensitive). Mirrors SQL `public.advertiser_key()`.
 * `toLowerCase()` maps a word-final Σ to ς (context-sensitive) while Postgres `lower()` always gives σ:
 * folding ς to σ afterwards makes both sides agree ("ΟΔΟΣ", "Οδος" → "οδοσ").
 */
export function advertiserKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\u03c2/g, "\u03c3")
    .replace(/[\t\n\v\f\r ]+/g, " ")
    .replace(/^ | $/g, "");
}

/** Earliest last-seen day for an ad that the source still reports as running to count as active on `asOf`. */
export function activeSince(asOf: string): string {
  return addDays(asOf, -ACTIVE_GRACE_DAYS);
}

/** Whether the ad is currently running on `asOf` (see "Active ad" above). */
export function isActiveAd(ad: Pick<Advertisement, "firstSeen" | "lastSeen" | "ended">, asOf: string): boolean {
  return ad.firstSeen <= asOf && ad.lastSeen >= (ad.ended ? asOf : activeSince(asOf));
}

/** Clamps user-supplied thresholds to the allowed range; missing values take the defaults. */
export function resolveThresholds(t: { minAds?: number | null; minDays?: number | null } = {}): AdvertiserThresholds {
  const clamp = (v: number | null | undefined, d: number, lim: { min: number; max: number }) => (v == null || !Number.isFinite(v) ? d : Math.min(lim.max, Math.max(lim.min, Math.trunc(v))));
  return { minAds: clamp(t.minAds, MIN_ACTIVE_ADS, THRESHOLD_LIMITS.minAds), minDays: clamp(t.minDays, MIN_ACTIVE_DAYS, THRESHOLD_LIMITS.minDays) };
}

export function emptyActivity(t: AdvertiserThresholds = DEFAULT_THRESHOLDS): AdvertiserActivity {
  return { activeAds: 0, activeSinceMinDays: 0, oldestActiveFirstSeen: null, qualifies: false, ...t };
}

/** Builds an advertiser's activity from aggregated counts (also used for rows read from Postgres). */
export function activityFromCounts(c: { activeAds: number; activeSinceMinDays: number; oldestActiveFirstSeen: string | null }, t: AdvertiserThresholds = DEFAULT_THRESHOLDS): AdvertiserActivity {
  return { ...c, qualifies: c.activeSinceMinDays >= t.minAds, ...t };
}

export interface AdvertiserSummary extends AdvertiserActivity {
  key: string;
  /** Most frequent spelling among the advertiser's ads (ties: alphabetical). */
  name: string;
  totalAds: number;
}

/** Activity of every advertiser present in `ads`, keyed by `advertiserKey`. Pure and deterministic. */
export function advertiserActivity(
  ads: readonly Pick<Advertisement, "advertiser" | "firstSeen" | "lastSeen" | "ended">[],
  asOf: string,
  thresholds: AdvertiserThresholds = DEFAULT_THRESHOLDS,
): Map<string, AdvertiserSummary> {
  const longRunning = addDays(asOf, -thresholds.minDays);
  const acc = new Map<string, { names: Map<string, number>; total: number; active: number; old: number; oldest: string | null }>();
  for (const ad of ads) {
    const key = advertiserKey(ad.advertiser);
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { names: new Map(), total: 0, active: 0, old: 0, oldest: null }));
    a.names.set(ad.advertiser, (a.names.get(ad.advertiser) ?? 0) + 1);
    a.total++;
    if (isActiveAd(ad, asOf)) {
      a.active++;
      if (ad.firstSeen <= longRunning) a.old++;
      if (a.oldest == null || ad.firstSeen < a.oldest) a.oldest = ad.firstSeen;
    }
  }
  const out = new Map<string, AdvertiserSummary>();
  for (const [key, a] of acc) {
    const name = [...a.names.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))[0][0];
    out.set(key, { key, name, totalAds: a.total, ...activityFromCounts({ activeAds: a.active, activeSinceMinDays: a.old, oldestActiveFirstSeen: a.oldest }, thresholds) });
  }
  return out;
}

/** Activity of one ad's advertiser from a precomputed map (an advertiser absent from the map has no activity). */
export function activityOf(map: ReadonlyMap<string, AdvertiserSummary>, advertiser: string, t: AdvertiserThresholds = DEFAULT_THRESHOLDS): AdvertiserActivity {
  const s = map.get(advertiserKey(advertiser));
  if (!s) return emptyActivity(t);
  return { activeAds: s.activeAds, activeSinceMinDays: s.activeSinceMinDays, oldestActiveFirstSeen: s.oldestActiveFirstSeen, qualifies: s.qualifies, minAds: s.minAds, minDays: s.minDays };
}

/** Ranks advertiser summaries: qualifying first, then by long-running active ads, active ads, total ads, name. */
export function rankAdvertisers<T extends AdvertiserSummary>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => Number(b.qualifies) - Number(a.qualifies) || b.activeSinceMinDays - a.activeSinceMinDays || b.activeAds - a.activeAds || b.totalAds - a.totalAds || a.name.localeCompare(b.name),
  );
}

/**
 * Interpolation values of every rule text ("≥ {{ads}} for ≥ {{days}}"): "5 active ads" / "1 active ad" and
 * "7 days" / "1 day", pluralized per language (activeAdvertisers.nAds / nDays plural keys).
 */
export function ruleValues(t: TFunction, ads: number, days: number): { ads: string; days: string } {
  return { ads: t("activeAdvertisers.nAds", { count: ads }), days: t("activeAdvertisers.nDays", { count: days }) };
}
