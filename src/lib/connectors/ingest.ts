import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashString, slugify } from "../demo/generate";
import type { AdRecord } from "./mappers";
import type { MatchableProduct } from "./matching";
import type { StorefrontObservation } from "./storefronts";
import type { SyncResult } from "./types";

/**
 * Database writes for connectors. Every upsert result is checked: a record
 * counts as stored only when its write returned no error, and failures are
 * counted so a run can report partial / failed instead of success.
 */

export interface WriteTally {
  /** Rows stored (writes that returned no error). */
  records: number;
  /** Rows fetched but not stored (database error or failed validation). */
  failed: number;
  /** Provider requests that ended in an error after retries. */
  requestFailures: number;
  errors: string[];
}
export const tally = (): WriteTally => ({ records: 0, failed: 0, requestFailures: 0, errors: [] });

type DbError = { code?: string; message?: string };
const errText = (e: DbError) => [e.code, e.message].filter(Boolean).join(" ").slice(0, 160) || "database_error";
export const note = (t: WriteTally, msg: string) => {
  if (t.errors.length < 10 && !t.errors.includes(msg)) t.errors.push(msg);
};
/** Records a provider request that failed (an error code, never a URL or a provider message). */
export const requestFailed = (t: WriteTally, code: string) => {
  t.requestFailures++;
  note(t, code);
};
/** Records fetched items that failed validation and were not stored. */
export const rejected = (t: WriteTally, n: number) => {
  if (n <= 0) return;
  t.failed += n;
  note(t, "invalid_records");
};

/**
 * success: nothing failed and the run was not cut short. partial: something
 * failed or the run was cut short (time/request budget, throttling) but records
 * were stored, or nothing failed. failed: errors and nothing stored.
 */
export function summarize(t: WriteTally, incomplete: string | null = null): SyncResult {
  const errors = t.failed > 0 || t.requestFailures > 0;
  const status: SyncResult["status"] = !errors && !incomplete ? "success" : t.records > 0 || !errors ? "partial" : "failed";
  const parts = [incomplete, t.failed ? `${t.failed} failed` : null, t.requestFailures ? `${t.requestFailures} request(s) failed` : null, ...t.errors.slice(0, 3)].filter(Boolean);
  return { status, records: t.records, failed: t.failed, ...(parts.length ? { message: parts.join("; ").slice(0, 500) } : {}) };
}

/** Real (non-demo) tracked products ads may be linked to. Demo products are never linked to real ads. */
export async function loadMatchableProducts(db: SupabaseClient, t: WriteTally): Promise<MatchableProduct[]> {
  const { data, error } = await db.from("products").select("id, name, tags, category").eq("is_demo", false).limit(5000);
  if (error) {
    note(t, `product_matching_unavailable: ${errText(error)}`);
    return [];
  }
  return (data ?? []).map((p) => ({ id: p.id as string, name: p.name as string, tags: (p.tags as string[]) ?? [], category: p.category as MatchableProduct["category"] }));
}

async function writeAds(db: SupabaseClient, recs: AdRecord[], today: string): Promise<DbError | null> {
  const { error } = await db.from("advertisements").upsert(
    recs.map((r) => r.row),
    { onConflict: "connector,external_id" },
  );
  if (error) return error;
  const { error: obsError } = await db.from("ad_observations").upsert(
    recs.map((r) => ({ ad_id: r.row.id, date: today, active: r.active, connector: r.row.connector, observed_at: r.row.observed_at })),
    { onConflict: "ad_id,date,connector" },
  );
  return obsError;
}

/** Upserts ads and today's observation (active derived from the delivery dates), in batches of 100. */
export async function storeAds(db: SupabaseClient, records: AdRecord[], today: string, t: WriteTally): Promise<void> {
  const seen = new Set<string>();
  // One row per (connector, external_id): a batch may not touch the same row twice.
  const unique = records.filter((r) => !seen.has(`${r.row.connector}:${r.row.external_id}`) && seen.add(`${r.row.connector}:${r.row.external_id}`));
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const error = await writeAds(db, chunk, today);
    if (!error) {
      t.records += chunk.length;
      continue;
    }
    // Retry row by row so one invalid row does not discard the rest of the batch.
    for (const rec of chunk.length > 1 ? chunk : []) {
      const e = await writeAds(db, [rec], today);
      if (e) {
        t.failed++;
        note(t, errText(e));
      } else t.records++;
    }
    if (chunk.length === 1) {
      t.failed++;
      note(t, errText(error));
    }
  }
}

const CONNECTOR = "public_storefronts";

/**
 * Stores one storefront observation: the stores row first (so listings never
 * point at a missing store), then listings and, when the public listing count
 * is reliably known, a snapshot. Demo profiles are never touched.
 */
export async function ingestStorefront(db: SupabaseClient, domain: string, obs: StorefrontObservation, today: string, now: string, t: WriteTally): Promise<void> {
  const fail = (e: DbError, n: number) => {
    t.failed += Math.max(1, n);
    note(t, `${domain}: ${errText(e)}`);
  };
  const { data: existing, error: findError } = await db.from("stores").select("id, name, is_demo").eq("domain", domain).maybeSingle();
  if (findError) return fail(findError, obs.listings.length);
  if (existing?.is_demo) return;

  const technology = { platform: obs.platform, verified: true }; // a valid platform endpoint response was observed
  const provenance = { source_connector: CONNECTOR, source_kind: "measured", observed_at: now };
  let storeId: string;
  if (existing) {
    storeId = existing.id as string;
    const { error } = await db
      .from("stores")
      .update({
        technology,
        ...provenance,
        // Detected values only: an unknown value never overwrites a previously observed one.
        ...(obs.currency ? { currency: obs.currency } : {}),
        ...(obs.country ? { country: obs.country } : {}),
        ...(obs.productCount != null ? { product_count: obs.productCount } : {}),
        ...(obs.name && existing.name === domain ? { name: obs.name } : {}),
      })
      .eq("id", storeId);
    if (error) return fail(error, obs.listings.length);
  } else {
    storeId = slugify(domain);
    const row = {
      id: storeId,
      name: obs.name ?? domain,
      domain,
      currency: obs.currency,
      country: obs.country,
      product_count: obs.productCount,
      technology,
      first_seen: today,
      ...provenance,
      is_demo: false,
      hue: hashString(domain) % 360,
    };
    let { error } = await db.from("stores").insert(row);
    if (error?.code === "23505") {
      // Slug taken by another store: derive a distinct, stable id from the domain.
      storeId = `${storeId}-${hashString(domain).toString(36)}`;
      ({ error } = await db.from("stores").insert({ ...row, id: storeId }));
    }
    if (error) return fail(error, obs.listings.length);
  }

  // Keep the earliest first_seen already recorded for each listing.
  const { data: prev, error: prevError } = await db.from("store_products").select("external_id, first_seen").eq("store_id", storeId).limit(5000);
  if (prevError) return fail(prevError, obs.listings.length);
  const firstSeen = new Map((prev ?? []).map((r) => [r.external_id as string, r.first_seen as string]));
  const rows = obs.listings.map((l) => {
    const before = firstSeen.get(l.externalId);
    return {
      store_id: storeId,
      external_id: l.externalId,
      title: l.title,
      price: l.price,
      currency: obs.currency,
      first_seen: before && before < l.firstSeen ? before : l.firstSeen,
      last_seen: today,
      ...provenance,
    };
  });
  for (let i = 0; i < rows.length; i += 250) {
    const chunk = rows.slice(i, i + 250);
    const { error } = await db.from("store_products").upsert(chunk, { onConflict: "store_id,external_id" });
    if (error) fail(error, chunk.length);
    else t.records += chunk.length;
  }

  if (obs.productCount == null) return; // a partial crawl is not the store's listing count
  const prices = obs.listings.map((l) => l.price);
  const { error: snapError } = await db.from("store_snapshots").upsert(
    {
      store_id: storeId,
      date: today,
      product_count: obs.productCount,
      min_price: obs.complete && prices.length ? Math.min(...prices) : null,
      max_price: obs.complete && prices.length ? Math.max(...prices) : null,
      connector: CONNECTOR,
      observed_at: now,
    },
    { onConflict: "store_id,date" },
  );
  if (snapError) fail(snapError, 1);
}
