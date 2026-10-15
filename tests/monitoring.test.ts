import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  currentFailures,
  ERROR_CATEGORIES,
  errorCategory,
  evaluationStatus,
  isDue,
  isRetentionDue,
  isRuleDue,
  liveEvaluationData,
  periodStart,
  planConnectorRuns,
  planFromMembership,
  plansByUser,
  redactSecrets,
  monthsBefore,
  retentionCutoffs,
  RUN_REASONS,
  selectRulesForEvaluation,
  type MembershipRow,
} from "@/lib/monitoring";
import { CONNECTORS } from "@/lib/connectors/registry";
import { evaluateRules } from "@/lib/alerts";
import { generateDemoDataset } from "@/lib/demo/generate";
import { addDays } from "@/lib/dates";
import type { PlanId } from "@/lib/plans";
import type { AlertRule } from "@/lib/workspace";

const now = new Date("2026-10-14T05:15:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("due-ness", () => {
  // `now` is Wednesday 2026-10-14 05:15 UTC.
  it("is due once per UTC calendar period: hour, 6-hour block, day, ISO week", () => {
    expect(periodStart("hourly", now)).toBe(Date.UTC(2026, 9, 14, 5));
    expect(periodStart("every6h", now)).toBe(Date.UTC(2026, 9, 14, 0));
    expect(periodStart("daily", now)).toBe(Date.UTC(2026, 9, 14));
    expect(periodStart("weekly", now)).toBe(Date.UTC(2026, 9, 12)); // Monday
    expect(periodStart("weekly", new Date("2026-10-18T23:00:00Z"))).toBe(Date.UTC(2026, 9, 12)); // Sunday
    expect(periodStart("on_demand", now)).toBeNull();

    expect(isDue("daily", null, now)).toBe(true);
    expect(isDue("daily", "2026-10-13T05:59:00Z", now)).toBe(true); // yesterday's Hobby cron fired late in the hour
    expect(isDue("daily", "2026-10-14T00:30:00Z", now)).toBe(false);
    expect(isDue("weekly", "2026-10-12T05:59:00Z", now)).toBe(false);
    expect(isDue("weekly", "2026-10-11T05:15:00Z", now)).toBe(true);
    expect(isDue("every6h", "2026-10-14T01:00:00Z", now)).toBe(false);
    expect(isDue("every6h", "2026-10-13T23:00:00Z", now)).toBe(true);
    expect(isDue("hourly", "2026-10-14T05:01:00Z", now)).toBe(false);
    expect(isDue("hourly", "2026-10-14T04:59:00Z", now)).toBe(true);
  });

  it("never schedules on-demand connectors and treats an unreadable date as never run", () => {
    expect(isDue("on_demand", null, now)).toBe(false);
    expect(isDue("daily", "not-a-date", now)).toBe(true);
  });

  it("runs only configured connectors that are due according to their sync frequency", () => {
    const connectors = [
      { id: "meta_ad_library", syncFrequency: "daily" as const, configured: true },
      { id: "tiktok_commercial_content", syncFrequency: "daily" as const, configured: true },
      { id: "search_trends", syncFrequency: "daily" as const, configured: false },
      { id: "public_storefronts", syncFrequency: "weekly" as const, configured: true },
      { id: "licensed_dataset", syncFrequency: "weekly" as const, configured: true },
      { id: "custom_on_demand", syncFrequency: "on_demand" as const, configured: true },
      { id: "shopify_admin", syncFrequency: "every6h" as const, configured: true },
      { id: "demo", syncFrequency: "on_demand" as const, configured: true },
    ];
    const last = { meta_ad_library: ago(24 * HOUR), tiktok_commercial_content: ago(3 * HOUR), public_storefronts: ago(2 * 24 * HOUR), licensed_dataset: null }; // storefronts: this Monday
    expect(planConnectorRuns(connectors, last, now)).toEqual({
      meta_ad_library: "run",
      tiktok_commercial_content: "not_due",
      search_trends: "not_configured",
      public_storefronts: "not_due",
      licensed_dataset: "run",
      custom_on_demand: "not_scheduled",
    });
    // Next Monday the weekly connector is due again; Shopify and demo are never part of the scan.
    const later = planConnectorRuns(connectors, last, new Date("2026-10-19T05:15:00Z"));
    expect(later.public_storefronts).toBe("run");
    expect(Object.keys(later)).not.toContain("shopify_admin");
    expect(Object.keys(later)).not.toContain("demo");
  });

  it("a once-a-day scheduler syncs every registered connector at its frequency or daily, whichever is slower", () => {
    for (const c of CONNECTORS.filter((x) => x.id !== "demo" && x.id !== "shopify_admin")) {
      let last: string | null = null;
      let runs = 0;
      for (let day = 0; day < 28; day++) {
        // Daily cron at 05:15 UTC with up to 59 minutes of jitter.
        const at = new Date(Date.UTC(2026, 9, 5 + day, 5, (day * 37) % 60)); // from Monday 2026-10-05
        if (planConnectorRuns([{ ...c, configured: true }], { [c.id]: last }, at)[c.id] === "run") {
          runs++;
          last = at.toISOString();
        }
      }
      expect(runs, c.id).toBe(c.syncFrequency === "weekly" ? 4 : 28);
    }
  });

  it("rules are due once per period, whatever the scheduler cadence", () => {
    expect(isRuleDue({ frequency: "hourly", last_scheduled_at: null }, now)).toBe(true);
    expect(isRuleDue({ frequency: "hourly", last_scheduled_at: ago(HOUR) }, now)).toBe(true);
    expect(isRuleDue({ frequency: "daily", last_scheduled_at: ago(HOUR) }, now)).toBe(false);
    expect(isRuleDue({ frequency: "daily", last_scheduled_at: ago(24 * HOUR) }, now)).toBe(true);
    expect(isRuleDue({ frequency: "weekly", last_scheduled_at: ago(24 * HOUR) }, now)).toBe(false);
    expect(isRuleDue({ frequency: "weekly", last_scheduled_at: ago(7 * 24 * HOUR) }, now)).toBe(true);
    expect(isRuleDue({ frequency: "unexpected", last_scheduled_at: ago(HOUR) }, now)).toBe(false); // treated as daily
    const evaluations = (frequency: string, hours: number[]) => {
      let last: string | null = null;
      let n = 0;
      for (const h of hours) {
        const at = new Date(Date.UTC(2026, 9, 5, h, (h * 17) % 60)); // from Monday 2026-10-05, with jitter
        if (isRuleDue({ frequency, last_scheduled_at: last }, at)) {
          n++;
          last = at.toISOString();
        }
      }
      return n;
    };
    const hourlyScheduler = Array.from({ length: 14 * 24 }, (_, h) => h);
    const dailyScheduler = Array.from({ length: 14 }, (_, d) => d * 24 + 5);
    // An hourly scheduler: hourly rules every hour, daily rules once a day, weekly rules once a week.
    expect(evaluations("hourly", hourlyScheduler)).toBe(14 * 24);
    expect(evaluations("daily", hourlyScheduler)).toBe(14);
    expect(evaluations("weekly", hourlyScheduler)).toBe(2);
    // The daily Hobby cron: hourly and daily rules once a day, weekly rules once a week.
    expect(evaluations("hourly", dailyScheduler)).toBe(14);
    expect(evaluations("daily", dailyScheduler)).toBe(14);
    expect(evaluations("weekly", dailyScheduler)).toBe(2);
  });

  it("purges once a day", () => {
    expect(isRetentionDue(null, now)).toBe(true);
    expect(isRetentionDue(ago(3 * HOUR), now)).toBe(false);
    expect(isRetentionDue(ago(6 * HOUR), now)).toBe(true); // yesterday 23:15
  });
});

describe("plan entitlements for scheduled runs", () => {
  const member = (user_id: string, created_at: string, subs: { plan: string; status: string }[]): MembershipRow => ({ user_id, created_at, organizations: { subscriptions: subs } });

  it("resolves the plan from an active or trialing subscription, like getSession", () => {
    expect(planFromMembership(member("u", "2026-01-01", [{ plan: "pro", status: "active" }]))).toBe("pro");
    expect(planFromMembership(member("u", "2026-01-01", [{ plan: "business", status: "trialing" }]))).toBe("business");
    expect(planFromMembership(member("u", "2026-01-01", [{ plan: "business", status: "canceled" }]))).toBe("free");
    expect(planFromMembership(member("u", "2026-01-01", [{ plan: "enterprise", status: "active" }]))).toBe("free");
    expect(planFromMembership({ user_id: "u", organizations: null })).toBe("free");
    expect(planFromMembership(null)).toBe("free");
  });

  it("uses the user's oldest membership", () => {
    const plans = plansByUser([
      member("a", "2026-05-01", [{ plan: "business", status: "active" }]),
      member("a", "2026-01-01", [{ plan: "pro", status: "active" }]),
      member("b", "2026-02-01", [{ plan: "free", status: "active" }]),
    ]);
    expect(plans.get("a")).toBe("pro");
    expect(plans.get("b")).toBe("free");
  });

  const rule = (id: string, user_id: string, created_at: string, frequency = "daily", active = true) => ({ id, user_id, created_at, frequency, active });

  it("skips users whose plan has no alerts and ignores paused rules", () => {
    const plans: Record<string, PlanId> = { free: "free", pro: "pro" };
    const { users, notEntitled } = selectRulesForEvaluation(
      [rule("r1", "free", "2026-01-01"), rule("r2", "pro", "2026-01-01"), rule("r3", "pro", "2026-01-02", "daily", false)],
      (u) => plans[u] ?? "free",
    );
    expect(notEntitled).toEqual(["free"]);
    expect(users).toEqual([{ userId: "pro", plan: "pro", rules: [expect.objectContaining({ id: "r2" })], overLimit: [] }]);
  });

  it("evaluates at most entitlements.alertRules rules per user, oldest first, across frequencies", () => {
    // Pro allows 25 rules: 20 hourly rules created first, then 10 daily ones (a downgrade from Business).
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => rule(`d${i}`, "u", `2026-02-${String(i + 10).padStart(2, "0")}`, "daily")),
      ...Array.from({ length: 20 }, (_, i) => rule(`h${i}`, "u", `2026-01-${String(i + 10).padStart(2, "0")}`, "hourly")),
    ];
    const isDaily = (r: { frequency: string }) => r.frequency === "daily";
    const daily = selectRulesForEvaluation(rows, () => "pro", isDaily).users[0];
    expect(daily.rules.map((r) => r.id)).toEqual(["d0", "d1", "d2", "d3", "d4"]);
    expect(daily.overLimit.map((r) => r.id)).toEqual(["d5", "d6", "d7", "d8", "d9"]);
    const hourly = selectRulesForEvaluation(rows, () => "pro", (r) => r.frequency === "hourly").users[0];
    expect(hourly.rules).toHaveLength(20);
    expect(hourly.overLimit).toEqual([]);
    expect(selectRulesForEvaluation(rows, () => "business", isDaily).users[0].overLimit).toEqual([]);
    expect(selectRulesForEvaluation(rows, () => "pro", (r) => r.frequency === "weekly").users).toEqual([]);
    // Manual checks (no due filter) evaluate every allowed rule.
    const all = selectRulesForEvaluation(rows, () => "pro").users[0];
    expect(all.rules).toHaveLength(25);
    expect(all.overLimit).toHaveLength(5);
  });

  it("selects only the rules that are due now", () => {
    const rows = [
      { ...rule("r1", "u", "2026-01-01", "daily"), last_scheduled_at: ago(2 * HOUR) },
      { ...rule("r2", "u", "2026-01-02", "daily"), last_scheduled_at: ago(24 * HOUR) },
      { ...rule("r3", "u", "2026-01-03", "hourly"), last_scheduled_at: ago(2 * HOUR) },
      { ...rule("r4", "v", "2026-01-03", "weekly"), last_scheduled_at: ago(2 * 24 * HOUR) },
    ];
    const { users } = selectRulesForEvaluation(rows, () => "pro", (r) => isRuleDue(r, now));
    expect(users.map((u) => [u.userId, u.rules.map((r) => r.id)])).toEqual([["u", ["r2", "r3"]]]);
  });
});

describe("live evaluation data", () => {
  it("never evaluates the demo dataset", () => {
    expect(liveEvaluationData(generateDemoDataset())).toBeNull();
  });

  it("keeps only real research rows from a mixed database snapshot", () => {
    const d = generateDemoDataset();
    const real = <S extends { connector: string; kind: string }>(s: S) => ({ ...s, connector: "licensed_dataset", kind: "estimate" as const });
    const realStore = d.stores[0];
    const mixed = {
      ...d,
      products: d.products.map((p, i) => (i % 2 ? p : { ...p, source: real(p.source) })),
      ads: d.ads.map((a, i) => (i % 3 ? a : { ...a, source: real(a.source) })),
      stores: d.stores.map((s) => (s.id === realStore.id ? { ...s, source: real(s.source) } : s)),
    };
    const data = liveEvaluationData(mixed)!;
    expect(data.products.length).toBe(Math.ceil(d.products.length / 2));
    expect(data.products.every((p) => p.source.kind !== "demo")).toBe(true);
    expect(data.ads.every((a) => a.source.kind !== "demo")).toBe(true);
    expect(data.stores.map((s) => s.id)).toEqual([realStore.id]);
    expect(data.storeProducts.every((sp) => sp.storeId === realStore.id)).toBe(true);
    expect(Object.values(data.observations).flat().every((o) => o.source.kind !== "demo")).toBe(true);
    // Rule matches can only reference real products.
    const ids = new Set(data.products.map((p) => p.id));
    const rule: AlertRule = { id: "r", name: "n", type: "new_product_in_category", target: {}, frequency: "daily", channels: { inApp: true, email: false }, active: true, createdAt: "2026-01-01" };
    const matches = evaluateRules([rule], { ...data, since: addDays(data.asOf, -90) });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => ids.has(m.link!.split("/").at(-1)!))).toBe(true);
  });
});

describe("errors and status", () => {
  it("reduces raw provider and database messages to categories", () => {
    expect(errorCategory(null)).toBeNull();
    expect(errorCategory("rate_limited")).toBe("rate_limited");
    expect(errorCategory("http_429")).toBe("rate_limited");
    expect(errorCategory("token_http_400")).toBe("auth");
    expect(errorCategory("http_403")).toBe("auth");
    expect(errorCategory("http_502")).toBe("provider_error");
    expect(errorCategory("fetch failed")).toBe("network");
    expect(errorCategory('duplicate key value violates unique constraint "products_pkey"')).toBe("database");
    expect(errorCategory("something odd")).toBe("unknown");
  });

  it("redacts credentials from logged errors", () => {
    const s = redactSecrets("GET https://graph.facebook.com/v23.0/ads_archive?search_terms=x&access_token=EAAB123secret failed; Authorization: Bearer sk_live_abc.def");
    expect(s).not.toContain("EAAB123secret");
    expect(s).not.toContain("sk_live_abc");
    expect(s).toContain("access_token=[redacted]");
    expect(redactSecrets("x".repeat(1000)).length).toBe(300);
  });

  it("reports a connector as failing only when its latest finished run failed", () => {
    const failures = currentFailures([
      { connector: "meta_ad_library", status: "running", started_at: "2026-10-14T05:15:00Z", error: null },
      { connector: "meta_ad_library", status: "failed", started_at: "2026-10-13T05:15:00Z", error: "http_500" },
      { connector: "tiktok_commercial_content", status: "success", started_at: "2026-10-13T05:15:00Z", error: null },
      { connector: "tiktok_commercial_content", status: "failed", started_at: "2026-10-12T05:15:00Z", error: "token_http_401" },
      { connector: "meta_ad_library", status: "success", started_at: "2026-10-12T05:15:00Z", error: null },
    ]);
    expect(failures).toEqual([{ connector: "meta_ad_library", at: "2026-10-13T05:15:00Z", category: "provider_error" }]);
  });
});

describe("evaluation status", () => {
  const row = { started_at: "2026-10-14T05:00:00Z", finished_at: null, status: "running", message: null, rules: 2, matches: 0, data_as_of: null };

  it("reports the stored outcome and never upgrades it", () => {
    expect(evaluationStatus({ ...row, status: "skipped", message: "no_live_data", finished_at: "2026-10-14T05:01:00Z" }, now)).toEqual({
      at: "2026-10-14T05:01:00Z",
      status: "skipped",
      reason: "no_live_data",
      dataAsOf: null,
      rules: 2,
      matches: 0,
    });
    expect(evaluationStatus(row, now).status).toBe("running"); // started 15 minutes ago at most
    expect(evaluationStatus({ ...row, status: "weird" }, now).status).toBe("failed");
  });

  it("reports a run left running past the function time limit as interrupted", () => {
    expect(evaluationStatus({ ...row, started_at: "2026-10-14T04:00:00Z" }, now)).toMatchObject({ status: "failed", reason: "interrupted" });
  });

  it("every reason code and error category is translated in every language", () => {
    for (const loc of ["fr", "en", "es", "de", "it"]) {
      const messages = JSON.parse(fs.readFileSync(`src/locales/${loc}.json`, "utf8"));
      for (const r of RUN_REASONS) expect(messages.alerts.runReasons[r], `${loc} ${r}`).toBeTruthy();
      for (const c of ERROR_CATEGORIES) expect(messages.integrations.errorCategories[c], `${loc} ${c}`).toBeTruthy();
    }
  });
});

describe("retention", () => {
  const cutoffs = retentionCutoffs(CONNECTORS, now); // now = 2026-10-14T05:15Z

  it("follows each connector's documented retention and the privacy policy", () => {
    expect(cutoffs.connectors).toEqual({
      meta_ad_library: "2025-10-14", // 365 days
      tiktok_commercial_content: "2025-10-14",
      pinterest_ads_repository: "2025-10-14",
      search_trends: "2024-10-14", // 730 days
      public_storefronts: "2026-04-17", // 180 days
      licensed_dataset: "2024-10-14",
    });
    expect(cutoffs.store_listings_before).toBe("2026-04-17");
    expect(cutoffs.own_store_sales_before).toBe("2025-09-09"); // 400 days
    expect(cutoffs.usage_events_before).toBe("2025-09-14T05:15:00.000Z"); // 13 months (privacy policy)
    expect(cutoffs.run_logs_before).toBe("2026-07-16T05:15:00.000Z"); // 90 days
    expect(cutoffs.read_notifications_before).toBe("2026-04-17T05:15:00.000Z"); // 180 days
  });

  it("never purges the demo set or Shopify research rows, nor anything younger than 30 days", () => {
    expect(cutoffs.connectors).not.toHaveProperty("demo");
    expect(cutoffs.connectors).not.toHaveProperty("shopify_admin");
    const short = retentionCutoffs(
      [
        { id: "meta_ad_library", retentionDays: 7 },
        { id: "public_storefronts", retentionDays: 0 },
      ],
      now,
    );
    expect(short.connectors).toEqual({});
    expect(short.store_listings_before).toBeNull();
    expect(short.own_store_sales_before).toBeNull();
  });

  it("subtracts calendar months like Postgres intervals", () => {
    expect(monthsBefore(new Date("2026-10-14T05:15:00Z"), 13).toISOString()).toBe("2025-09-14T05:15:00.000Z");
    expect(monthsBefore(new Date("2027-03-31T00:00:00Z"), 13).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(monthsBefore(new Date("2025-01-15T00:00:00Z"), 13).toISOString()).toBe("2023-12-15T00:00:00.000Z");
  });

  it("matches the keys read by purge_expired_data()", () => {
    const sql = fs.readFileSync("supabase/migrations/0002_monitoring.sql", "utf8");
    for (const key of Object.keys(cutoffs)) expect(sql, key).toContain(`'${key}'`);
  });
});

describe("scheduler configuration", () => {
  it("deploys on Vercel Hobby: every cron runs at most once a day", () => {
    const { crons } = JSON.parse(fs.readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(crons.length).toBeGreaterThan(0);
    for (const c of crons) {
      const [minute, hour] = c.schedule.split(/\s+/);
      expect(minute, c.schedule).toMatch(/^\d+$/);
      expect(hour, c.schedule).toMatch(/^\d+$/);
      expect(c.path.startsWith("/api/cron/scan")).toBe(true);
    }
  });

  it("requires the service-role key, not only CRON_SECRET", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("CRON_SECRET", "secret");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.resetModules();
    expect((await import("@/lib/server/env")).features().cron).toBe(false);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.resetModules();
    expect((await import("@/lib/server/env")).features().cron).toBe(true);
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
