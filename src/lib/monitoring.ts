import type { AlertContext } from "./alerts";
import type { ConnectorSpec } from "./connectors/types";
import type { DemoDataset } from "./demo/generate";
import { isPlan, PLANS, type PlanId } from "./plans";
import { computeMetrics, scoreProduct } from "./scoring";
import { addDays } from "./dates";
import type { SourceRef } from "./types";
import type { AlertRule } from "./workspace";

/**
 * Pure rules for background monitoring: when a connector is due, which alert
 * rules a user's plan allows, which research rows count as live, how errors
 * are reported and how long data is kept. Server jobs (lib/server/scan.ts)
 * apply them; everything here is unit-tested.
 */

// ---------------------------------------------------------------------------
// Scheduling (due-ness)
// ---------------------------------------------------------------------------
//
// The scan endpoint is idempotent with respect to time: whichever scheduler calls it (the daily Vercel cron of
// the free Hobby plan, an hourly cron on a paid plan, an external scheduler), each run syncs only the connectors
// that are due and evaluates only the rules that are due. A daily scheduler therefore checks hourly rules once a
// day; adding an hourly scheduler makes them hourly without changing anything else.
//
// Periods are UTC calendar periods (hour, 6-hour block from 00:00, day, ISO week from Monday): a task is due once
// per period, at the first scan of the period. Unlike fixed intervals this neither drifts with an hourly
// scheduler nor skips a day when a Hobby cron fires late one day (anywhere within the hour) and early the next.

export type SyncFrequency = ConnectorSpec["syncFrequency"];
export type RuleFrequency = AlertRule["frequency"];

/** Start (ms) of the UTC period containing `t`; null for `on_demand`, which is never scheduled. */
export function periodStart(frequency: SyncFrequency, t: Date): number | null {
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const d = t.getUTCDate();
  const h = t.getUTCHours();
  switch (frequency) {
    case "hourly":
      return Date.UTC(y, m, d, h);
    case "every6h":
      return Date.UTC(y, m, d, h - (h % 6));
    case "daily":
      return Date.UTC(y, m, d);
    case "weekly":
      return Date.UTC(y, m, d - ((t.getUTCDay() + 6) % 7));
    case "on_demand":
      return null;
  }
}

/** Due when it never ran (or the date is unreadable) or its last run started before the current period. */
export function isDue(frequency: SyncFrequency, lastAt: string | null | undefined, now: Date): boolean {
  const start = periodStart(frequency, now);
  if (start == null) return false;
  const last = lastAt ? Date.parse(lastAt) : Number.NaN;
  if (Number.isNaN(last)) return true;
  return last < start;
}

/** Connectors the scheduled scan never syncs: the static demo set, and Shopify (synced per merchant by its own job). */
export const UNSCHEDULED_CONNECTORS: readonly string[] = ["demo", "shopify_admin"];

export const isScheduledConnector = (id: string) => !UNSCHEDULED_CONNECTORS.includes(id);

export type ConnectorDecision = "run" | "not_configured" | "not_scheduled" | "not_due";

/**
 * Decides, for one scan, which connectors sync: configured ones without a successful sync (connector_runs) in the
 * current `syncFrequency` period. Unconfigured connectors are not called; a failed or skipped sync is retried at
 * the next scan.
 */
export function planConnectorRuns(
  connectors: { id: string; syncFrequency: SyncFrequency; configured: boolean }[],
  lastSuccess: Record<string, string | null>,
  now: Date,
): Record<string, ConnectorDecision> {
  const out: Record<string, ConnectorDecision> = {};
  for (const c of connectors) {
    if (!isScheduledConnector(c.id)) continue;
    out[c.id] = !c.configured
      ? "not_configured"
      : c.syncFrequency === "on_demand"
        ? "not_scheduled"
        : isDue(c.syncFrequency, lastSuccess[c.id] ?? null, now)
          ? "run"
          : "not_due";
  }
  return out;
}

/** A rule is due when its last scheduled turn (alerts.last_scheduled_at) is before the current rule period. */
export function isRuleDue(rule: { frequency: string; last_scheduled_at?: string | null }, now: Date): boolean {
  const frequency = (["hourly", "daily", "weekly"] as const).find((f) => f === rule.frequency) ?? "daily";
  return isDue(frequency, rule.last_scheduled_at ?? null, now);
}

/** The retention purge runs once a day: at the first scan of the UTC day without a successful purge yet. */
export const isRetentionDue = (lastPurgeAt: string | null | undefined, now: Date) => isDue("daily", lastPurgeAt, now);

// ---------------------------------------------------------------------------
// Plan entitlements for scheduled rule evaluation
// ---------------------------------------------------------------------------

export interface MembershipRow {
  user_id: string;
  created_at?: string | null;
  organizations: { subscriptions: { plan: string; status: string }[] | null } | null;
}

/** Plan granted by one membership: its organization's active or trialing subscription (same rule as getSession). */
export function planFromMembership(row: MembershipRow | null | undefined): PlanId {
  const plan = row?.organizations?.subscriptions?.find((s) => s.status === "active" || s.status === "trialing")?.plan;
  return isPlan(plan) ? plan : "free";
}

/** Plan per user. Like getSession(), one membership decides: the oldest (the personal workspace created at sign-up). */
export function plansByUser(rows: MembershipRow[]): Map<string, PlanId> {
  const first = new Map<string, MembershipRow>();
  for (const r of rows) {
    const cur = first.get(r.user_id);
    if (!cur || (r.created_at ?? "") < (cur.created_at ?? "")) first.set(r.user_id, r);
  }
  return new Map([...first].map(([user, row]) => [user, planFromMembership(row)]));
}

export interface RuleRowLike {
  id: string;
  user_id: string;
  created_at: string;
  frequency: string;
  active?: boolean;
  last_scheduled_at?: string | null;
}

export interface UserRules<T> {
  userId: string;
  plan: PlanId;
  /** Rules to evaluate now, oldest first. */
  rules: T[];
  /** Rules (due now, when filtered) over the plan's rule limit: not evaluated, reported as `rule_limit`. */
  overLimit: T[];
}

/**
 * Applies plan entitlements before any evaluation: only users whose plan includes alerts, and at most
 * `alertRules` active rules per user (oldest first, counted across all frequencies). With `due`, only the
 * rules due now are returned (scheduled runs); without it, every allowed rule (manual checks).
 */
export function selectRulesForEvaluation<T extends RuleRowLike>(
  rows: T[],
  planOf: (userId: string) => PlanId,
  due?: (rule: T) => boolean,
): { users: UserRules<T>[]; notEntitled: string[] } {
  const byUser = new Map<string, T[]>();
  for (const r of rows) {
    if (r.active === false) continue;
    const list = byUser.get(r.user_id);
    if (list) list.push(r);
    else byUser.set(r.user_id, [r]);
  }
  const users: UserRules<T>[] = [];
  const notEntitled: string[] = [];
  for (const [userId, list] of byUser) {
    const plan = planOf(userId);
    const ent = PLANS[plan].entitlements;
    if (!ent.alerts || ent.alertRules < 1) {
      notEntitled.push(userId);
      continue;
    }
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const pick = (xs: T[]) => (due ? xs.filter(due) : xs);
    const rules = pick(sorted.slice(0, ent.alertRules));
    const overLimit = pick(sorted.slice(ent.alertRules));
    if (rules.length || overLimit.length) users.push({ userId, plan, rules, overLimit });
  }
  return { users, notEntitled };
}

// ---------------------------------------------------------------------------
// Live research data for rule evaluation
// ---------------------------------------------------------------------------

export type EvaluationData = Omit<AlertContext, "since"> & {
  /** Latest day actually covered by the real rows (stored in alert_runs.data_as_of), never later than `asOf`. */
  dataAsOf: string;
};

const isReal = (s: SourceRef) => s.kind !== "demo" && s.connector !== "demo";

/**
 * Removes demo-seeded rows from a database snapshot so rules are only ever evaluated on real research data.
 * Returns null when nothing real remains: the run is then recorded as skipped instead of evaluated.
 */
export function liveEvaluationData(d: DemoDataset): EvaluationData | null {
  const stores = d.stores.filter((s) => isReal(s.source));
  const storeIds = new Set(stores.map((s) => s.id));
  const storeProducts = d.storeProducts.filter((sp) => storeIds.has(sp.storeId));
  const ads = d.ads.filter((a) => isReal(a.source));
  const base = d.products.filter((p) => isReal(p.source));
  if (!base.length && !ads.length && !storeProducts.length) return null;
  const observations: EvaluationData["observations"] = {};
  for (const p of base) observations[p.id] = (d.observations[p.id] ?? []).filter((o) => isReal(o.source));
  const products = base.map((p) => {
    const metrics = computeMetrics(p, observations[p.id], ads, storeProducts, d.snapshot);
    return { ...p, metrics, score: scoreProduct(p, metrics, observations[p.id], d.snapshot) };
  });
  const dates = [
    ...base.map((p) => p.lastDetected),
    ...ads.map((a) => a.lastSeen),
    ...storeProducts.map((sp) => sp.firstSeen),
    ...Object.values(observations).flatMap((xs) => xs.map((o) => o.date)),
  ].filter((x) => x && x <= d.snapshot);
  const dataAsOf = dates.reduce((a, b) => (b > a ? b : a), dates[0] ?? d.snapshot);
  return { products, observations, ads, stores, storeProducts, asOf: d.snapshot, dataAsOf };
}

// ---------------------------------------------------------------------------
// Run outcomes and status
// ---------------------------------------------------------------------------

/**
 * Reason codes stored in alert_runs.message (users read these rows, so never raw error text).
 * - no_live_data: the database holds no real research rows (empty, or demo-seeded only)
 * - data_unavailable: research data could not be loaded (service role missing, database error)
 * - rule_limit: some due rules are over the plan's rule limit and were not evaluated
 * - email_failed: matches were notified in-app but at least one alert email was not sent
 * - evaluation_failed: an error stopped the evaluation
 * - interrupted: not stored; reported for a run left "running" (cut off by a timeout or crash)
 */
export const RUN_REASONS = ["no_live_data", "data_unavailable", "rule_limit", "email_failed", "evaluation_failed", "interrupted"] as const;
export type RunReason = (typeof RUN_REASONS)[number];
export type EvaluationSkipReason = Extract<RunReason, "no_live_data" | "data_unavailable">;

/** Short error categories shown to users instead of raw provider or database messages. */
export const ERROR_CATEGORIES = ["rate_limited", "auth", "provider_error", "network", "database", "unknown"] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export function errorCategory(raw: string | null | undefined): ErrorCategory | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes("rate_limited") || /\b(http_)?429\b/.test(s) || s.includes("too many requests")) return "rate_limited";
  if (/token_http_\d+|http_40[13]\b|unauthori[sz]ed|forbidden|invalid.*(token|key)/.test(s)) return "auth";
  if (/\bhttp_\d{3}\b/.test(s)) return "provider_error";
  if (/fetch failed|network|econn|enotfound|etimedout|timeout|socket|abort/.test(s)) return "network";
  if (/duplicate key|violates|relation|column|permission denied|syntax error|pgrst|database/.test(s)) return "database";
  return "unknown";
}

/** Message of a thrown value (Error, or a Supabase/PostgREST error object). */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** Error text kept in operations logs (service role only): credentials redacted, length bounded. */
export function redactSecrets(raw: string, max = 300): string {
  return raw
    .replace(/((?:access_)?token|key|secret|password|signature)=[^&\s"']+/gi, "$1=[redacted]")
    .replace(/bearer\s+[\w.~+/=-]+/gi, "Bearer [redacted]")
    .slice(0, max);
}

export interface ConnectorRunRow {
  connector: string;
  status: string;
  started_at: string;
  error: string | null;
}

/** Connectors whose most recent finished run failed (older failures followed by a success are resolved). */
export function currentFailures(runsNewestFirst: ConnectorRunRow[]): { connector: string; at: string; category: ErrorCategory }[] {
  const seen = new Set<string>();
  const out: { connector: string; at: string; category: ErrorCategory }[] = [];
  for (const r of runsNewestFirst) {
    if (r.status === "running" || seen.has(r.connector)) continue;
    seen.add(r.connector);
    if (r.status === "failed") out.push({ connector: r.connector, at: r.started_at, category: errorCategory(r.error) ?? "unknown" });
  }
  return out;
}

/** /api/alerts/status payload. Ingestion and rule evaluation are reported separately and never inferred. */
export interface MonitoringStatus {
  mode: "demo" | "live";
  /** Background job configured (CRON_SECRET + Supabase service role). */
  scheduler: boolean;
  email: boolean;
  /** Configured ingestion connectors (scheduled by the scan; demo and Shopify excluded). */
  connectors: string[];
  /** Last connector sync that stored records. */
  lastIngestion: { at: string; connector: string; records: number } | null;
  /** Latest scheduled evaluation of this user's rules, whatever its outcome. */
  lastEvaluation: { at: string; status: "running" | "success" | "failed" | "skipped"; reason: string | null; dataAsOf: string | null; rules: number; matches: number } | null;
  lastSuccessfulEvaluation: { at: string; dataAsOf: string | null } | null;
  failures: { connector: string; at: string; category: ErrorCategory }[];
  /** How the research data shown in the app is refreshed. */
  refresh: RefreshStatus;
}

/**
 * Refresh mechanism of the data shown in the app:
 * - `demo_daily`: no database; the synthetic demo dataset regenerates for each UTC day.
 * - `cron_daily`: the daily background scan (vercel.json, 05:15 UTC) ingests, rescores, evaluates alerts and purges.
 * - `none`: live database without the background job: data only changes when something writes to it.
 */
export interface RefreshStatus {
  kind: "demo_daily" | "cron_daily" | "none";
  /** Next time the data is expected to change (ISO timestamp), when scheduled. */
  nextAt: string | null;
  /** Snapshot day of the data currently served. */
  dataAsOf: string | null;
}

/** Daily scan schedule, in UTC. Must match the first cron entry of vercel.json ("15 5 * * *"). */
export const DAILY_SCAN_UTC = { hour: 5, minute: 15 } as const;

/** Next occurrence of a daily UTC time strictly after `now`. */
export function nextDailyUtc(now: Date, at: { hour: number; minute: number } = DAILY_SCAN_UTC): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), at.hour, at.minute));
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export function refreshStatus(input: { mode: "demo" | "live"; scheduler: boolean; dataAsOf: string | null; now: Date }): RefreshStatus {
  const { mode, scheduler, dataAsOf, now } = input;
  // The demo snapshot rolls at 00:00 UTC (it is the last complete UTC day).
  if (mode === "demo") return { kind: "demo_daily", nextAt: nextDailyUtc(now, { hour: 0, minute: 0 }), dataAsOf };
  if (scheduler) return { kind: "cron_daily", nextAt: nextDailyUtc(now), dataAsOf };
  return { kind: "none", nextAt: null, dataAsOf };
}

export interface AlertRunRow {
  started_at: string;
  finished_at: string | null;
  status: string;
  message: string | null;
  rules: number;
  matches: number;
  data_as_of: string | null;
}

/** A run still "running" after this long was cut off (function timeout, crash): reported as interrupted. */
export const STALE_RUN_MS = 15 * 60_000;

/** Status line of one alert run, as stored; a run left "running" past STALE_RUN_MS is reported as failed. */
export function evaluationStatus(row: AlertRunRow, now: Date): NonNullable<MonitoringStatus["lastEvaluation"]> {
  const stale = row.status === "running" && now.getTime() - Date.parse(row.started_at) > STALE_RUN_MS;
  const status = stale ? "failed" : (["running", "success", "failed", "skipped"] as const).find((x) => x === row.status) ?? "failed";
  return {
    at: row.finished_at ?? row.started_at,
    status,
    reason: stale ? "interrupted" : (row.message ?? null),
    dataAsOf: row.data_as_of ?? null,
    rules: row.rules,
    matches: row.matches,
  };
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Retention windows applied by the daily scan (documented in docs/DATA_SOURCES.md). Raw research rows follow
 * each connector's `retentionDays`; derived daily aggregates are kept as history.
 */
export const RETENTION = {
  usageEventsMonths: 13,
  /** connector_runs, alert_runs and scan_runs */
  runLogDays: 90,
  readNotificationDays: 180,
} as const;

/** Nothing younger than this is ever purged, whatever the cutoffs say (enforced again in SQL). */
export const MIN_RETENTION_DAYS = 30;

/**
 * Argument of the purge_expired_data() SQL function (supabase/migrations/0002_monitoring.sql): for each category,
 * rows dated strictly before the cutoff are deleted. Dates are UTC days, timestamps ISO strings. A null cutoff,
 * or a window shorter than MIN_RETENTION_DAYS, skips that category.
 */
export interface RetentionCutoffs {
  /** Raw research rows per connector (first day kept). */
  connectors: Record<string, string>;
  /** Public storefront listings not seen since (store_products has no connector column). */
  store_listings_before: string | null;
  /** Merchants' own Shopify daily sales. */
  own_store_sales_before: string | null;
  usage_events_before: string;
  /** connector_runs, alert_runs and scan_runs */
  run_logs_before: string;
  /** Notifications already read. */
  read_notifications_before: string;
}

/** `months` calendar months before `t` (UTC), clamped to the end of shorter months like Postgres intervals. */
export function monthsBefore(t: Date, months: number): Date {
  const total = t.getUTCFullYear() * 12 + t.getUTCMonth() - months;
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(t.getUTCDate(), lastDay), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds(), t.getUTCMilliseconds()));
}

export function retentionCutoffs(connectors: { id: string; retentionDays: number }[], now: Date): RetentionCutoffs {
  const today = now.toISOString().slice(0, 10);
  const valid = (days: number | null | undefined): days is number => days != null && days >= MIN_RETENTION_DAYS;
  const dayCutoff = (days: number | null | undefined) => (valid(days) ? addDays(today, -days) : null);
  const days = (id: string) => connectors.find((c) => c.id === id)?.retentionDays;
  const before = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  return {
    connectors: Object.fromEntries(
      connectors.filter((c) => isScheduledConnector(c.id) && valid(c.retentionDays)).map((c) => [c.id, addDays(today, -c.retentionDays)]),
    ),
    store_listings_before: dayCutoff(days("public_storefronts")),
    own_store_sales_before: dayCutoff(days("shopify_admin")),
    usage_events_before: monthsBefore(now, RETENTION.usageEventsMonths).toISOString(),
    run_logs_before: before(RETENTION.runLogDays),
    read_notifications_before: before(RETENTION.readNotificationDays),
  };
}
