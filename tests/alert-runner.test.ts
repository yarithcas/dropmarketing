import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateDemoDataset } from "@/lib/demo/generate";
import { addDays } from "@/lib/dates";
import { liveEvaluationData } from "@/lib/monitoring";

/** Minimal chainable stand-in for the Supabase client: records every awaited query. */
interface Call {
  table: string;
  op: "select" | "insert" | "update";
  payload?: unknown;
  filters: [string, string, unknown][];
}
function fakeDb(respond: (c: Call) => { data?: unknown; error?: unknown } = () => ({})) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const c: Call = { table, op: "select", filters: [] };
    const q = {
      insert: (p: unknown) => ((c.op = "insert"), (c.payload = p), q),
      update: (p: unknown) => ((c.op = "update"), (c.payload = p), q),
      select: () => q,
      single: () => q,
      maybeSingle: () => q,
      eq: (col: string, v: unknown) => (c.filters.push(["eq", col, v]), q),
      in: (col: string, v: unknown) => (c.filters.push(["in", col, v]), q),
      // Paging and ordering (loadLiveDataset) are not asserted.
      gte: () => q,
      order: () => q,
      range: () => q,
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        calls.push(c);
        return Promise.resolve({ data: null, error: null, ...respond(c) }).then(ok, ko);
      },
    };
    return q;
  };
  const db = { from, auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: "owner@example.test" } }, error: null })) } } };
  return { db: db as unknown as SupabaseClient, calls };
}

const respond = (c: Call) => {
  if (c.table === "alert_runs" && c.op === "insert") return { data: { id: 7 } };
  if (c.table === "notifications" && c.op === "insert") return { data: (c.payload as unknown[]).map((_, i) => ({ id: `n${i}` })) };
  return {};
};

/** Demo rows relabelled as real (licensed feed) so the live path has data to evaluate. */
function realData() {
  const d = generateDemoDataset();
  const real = <S extends { connector: string; kind: string }>(s: S) => ({ ...s, connector: "licensed_dataset", kind: "estimate" as const });
  return liveEvaluationData({ ...d, products: d.products.map((p) => ({ ...p, source: real(p.source) })) })!;
}

const ruleRow = (over: Record<string, unknown> = {}) => ({
  id: "rule-1",
  user_id: "user-1",
  name: "New products",
  type: "new_product_in_category",
  target: {},
  frequency: "daily",
  channels: { inApp: true, email: true },
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  last_evaluated_at: null,
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock("@/lib/server/email");
  vi.doUnmock("@/lib/server/supabase");
});

describe("loadEvaluationSource", () => {
  it("never falls back to the demo dataset when no database snapshot is available", async () => {
    const { loadEvaluationSource } = await import("@/lib/server/alert-runner");
    expect(await loadEvaluationSource()).toEqual({ skipped: "data_unavailable" });
    const broken = fakeDb(() => ({ error: { message: "connection refused" } })).db;
    expect(await loadEvaluationSource({ db: broken })).toEqual({ skipped: "data_unavailable" });
    expect(await loadEvaluationSource({ db: fakeDb(() => ({ data: [] })).db })).toEqual({ skipped: "no_live_data" });
    expect(await loadEvaluationSource({ dataset: generateDemoDataset() })).toEqual({ skipped: "no_live_data" });
  });
});

describe("runAlertsForUser", () => {
  const scheduledAt = "2026-10-14T05:15:00.000Z";

  it("records a skipped run and writes no notification when there is no live data", async () => {
    const { runAlertsForUser } = await import("@/lib/server/alert-runner");
    const { db, calls } = fakeDb(respond);
    const o = await runAlertsForUser(db, "user-1", [ruleRow()], "scheduled", { skipped: "no_live_data" }, { scheduledAt, overLimit: [ruleRow({ id: "rule-2" })] });
    expect(o).toMatchObject({ status: "skipped", reason: "no_live_data", matches: 0 });
    expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(["alert_runs:insert", "alerts:update", "alert_runs:update"]);
    expect(calls[0].payload).toMatchObject({ user_id: "user-1", origin: "scheduled", status: "running" });
    // The rules' scheduled turn is over (they are due again next period), but they were not evaluated.
    expect(calls[1].payload).toEqual({ last_scheduled_at: scheduledAt });
    expect(calls[1].filters).toEqual([
      ["in", "id", ["rule-1", "rule-2"]],
      ["eq", "user_id", "user-1"],
    ]);
    expect(calls[2].payload).toMatchObject({ status: "skipped", message: "no_live_data", data_as_of: null });
  });

  it("keeps the rules due when the research data could not be loaded (transient)", async () => {
    const { runAlertsForUser } = await import("@/lib/server/alert-runner");
    const { db, calls } = fakeDb(respond);
    const o = await runAlertsForUser(db, "user-1", [ruleRow()], "scheduled", { skipped: "data_unavailable" }, { scheduledAt });
    expect(o).toMatchObject({ status: "skipped", reason: "data_unavailable" });
    expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(["alert_runs:insert", "alert_runs:update"]);
  });

  it("evaluates live data, notifies the owner and stamps the run with the data date", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.resetModules();
    const sendAlertEmail = vi.fn(async () => true);
    vi.doMock("@/lib/server/email", () => ({ sendAlertEmail }));
    const { runAlertsForUser } = await import("@/lib/server/alert-runner");
    const data = realData();
    const { db, calls } = fakeDb(respond);
    const o = await runAlertsForUser(db, "user-1", [ruleRow({ last_evaluated_at: `${addDays(data.asOf, -90)}T00:00:00Z` })], "manual", { data });
    expect(o.status).toBe("success");
    expect(o.matches).toBeGreaterThan(0);
    expect(o.emailsSent).toBe(1);
    const inserted = calls.find((c) => c.table === "notifications" && c.op === "insert")!.payload as Record<string, unknown>[];
    expect(inserted.every((n) => n.user_id === "user-1" && n.origin === "manual" && n.alert_id === "rule-1")).toBe(true);
    // The email covers exactly the notifications inserted by this run.
    expect(sendAlertEmail).toHaveBeenCalledWith("user-1", expect.objectContaining({ id: "rule-1" }), expect.any(Array), inserted.map((_, i) => `n${i}`));
    const ruleUpdate = calls.find((c) => c.table === "alerts" && c.op === "update")!;
    expect(ruleUpdate.filters).toEqual([
      ["eq", "id", "rule-1"],
      ["eq", "user_id", "user-1"],
    ]);
    // A manual check does not move the rule's schedule.
    expect(ruleUpdate.payload).not.toHaveProperty("last_scheduled_at");
    expect(calls.at(-1)!.payload).toMatchObject({ status: "success", matches: o.matches, emails_sent: 1, message: null, data_as_of: data.dataAsOf });
    expect(data.dataAsOf <= data.asOf).toBe(true);
  });

  it("stamps the scheduled turn of evaluated rules with the scan start", async () => {
    const { runAlertsForUser } = await import("@/lib/server/alert-runner");
    const data = realData();
    const { db, calls } = fakeDb(respond);
    const o = await runAlertsForUser(db, "user-1", [ruleRow({ channels: { inApp: true, email: false } })], "scheduled", { data }, { scheduledAt });
    expect(o.status).toBe("success");
    const ruleUpdate = calls.find((c) => c.table === "alerts" && c.op === "update")!;
    expect(ruleUpdate.payload).toMatchObject({ last_scheduled_at: scheduledAt, last_evaluated_at: expect.any(String) });
  });

  it("reports failed emails and plan limits in the run instead of claiming a clean success", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.resetModules();
    vi.doMock("@/lib/server/email", () => ({ sendAlertEmail: vi.fn(async () => false) }));
    const { runAlertsForUser } = await import("@/lib/server/alert-runner");
    const data = realData();
    const since = `${addDays(data.asOf, -90)}T00:00:00Z`;
    const over = [ruleRow({ id: "rule-9" })];
    const failed = await runAlertsForUser(fakeDb(respond).db, "user-1", [ruleRow({ last_evaluated_at: since })], "scheduled", { data }, { overLimit: over });
    expect(failed).toMatchObject({ status: "success", reason: "email_failed", emailsSent: 0 });
    const capped = await runAlertsForUser(fakeDb(respond).db, "user-1", [ruleRow({ last_evaluated_at: since, channels: { inApp: true, email: false } })], "scheduled", { data }, { overLimit: over });
    expect(capped.reason).toBe("rule_limit");
    const fake = fakeDb(respond);
    const none = await runAlertsForUser(fake.db, "user-1", [], "scheduled", { data }, { overLimit: over, scheduledAt: "2026-10-14T05:15:00.000Z" });
    expect(none).toMatchObject({ status: "skipped", reason: "rule_limit" });
    expect(fake.calls.some((c) => c.table === "notifications")).toBe(false);
    expect(fake.calls.find((c) => c.table === "alerts")!.filters[0]).toEqual(["in", "id", ["rule-9"]]);
  });

  it("records a failure code, never the raw database error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { runAlertsForUser } = await import("@/lib/server/alert-runner");
    const data = realData();
    const { db, calls } = fakeDb((c) => (c.table === "notifications" ? { error: { message: 'relation "notifications" does not exist' } } : respond(c)));
    const o = await runAlertsForUser(db, "user-1", [ruleRow({ last_evaluated_at: `${addDays(data.asOf, -90)}T00:00:00Z` })], "scheduled", { data });
    expect(o).toMatchObject({ status: "failed", reason: "evaluation_failed" });
    expect(JSON.stringify(calls.at(-1)!.payload)).not.toContain("relation");
  });
});

describe("sendAlertEmail", () => {
  async function setup(resendOk: boolean) {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.resetModules();
    const fake = fakeDb((c) => (c.table === "profiles" ? { data: { locale: "de" } } : {}));
    vi.doMock("@/lib/server/supabase", () => ({ supabaseAdmin: () => fake.db, supabaseForRequest: async () => null }));
    const fetchMock = vi.fn(async () => new Response("{}", { status: resendOk ? 200 : 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendAlertEmail } = await import("@/lib/server/email");
    const rule = { id: "rule-1", name: "Haustiere", type: "daily_summary" as const, target: {}, frequency: "daily" as const, channels: { inApp: true, email: true }, active: true, createdAt: "2026-01-01" };
    const matches = [{ ruleId: "rule-1", key: "alerts.match.new_product", params: { name: "Napf", category: "pets" }, link: "/app/products/p1" }];
    return { fake, fetchMock, send: () => sendAlertEmail("user-1", rule, matches, ["n1", "n2"]) };
  }

  it("looks the address up with the service role and stamps only this run's notifications", async () => {
    const { fake, fetchMock, send } = await setup(true);
    expect(await send()).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain("owner@example.test");
    const stamp = fake.calls.find((c) => c.table === "notifications" && c.op === "update")!;
    expect(stamp.filters).toEqual([
      ["in", "id", ["n1", "n2"]],
      ["eq", "user_id", "user-1"],
    ]);
  });

  it("does not stamp emailed_at when the provider rejects the message", async () => {
    const { fake, send } = await setup(false);
    expect(await send()).toBe(false);
    expect(fake.calls.some((c) => c.table === "notifications")).toBe(false);
  });
});
