import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Chainable stand-in for the service-role Supabase client: every awaited query is recorded and answered. */
interface Call {
  table: string;
  op: "select" | "insert" | "update" | "rpc";
  payload?: unknown;
  filters: unknown[][];
}
function fakeDb(respond: (c: Call) => { data?: unknown; error?: unknown }) {
  const calls: Call[] = [];
  const query = (c: Call) => {
    const q: Record<string, unknown> = {
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        calls.push(c);
        return Promise.resolve({ data: null, error: null, ...respond(c) }).then(ok, ko);
      },
    };
    for (const m of ["select", "single", "maybeSingle", "order", "limit", "range", "eq", "in", "gt", "gte", "lt", "not", "is"])
      q[m] = (...args: unknown[]) => {
        if (!["select", "single", "maybeSingle"].includes(m)) c.filters.push([m, ...args]);
        return q;
      };
    q.insert = (p: unknown) => ((c.op = "insert"), (c.payload = p), q);
    q.update = (p: unknown) => ((c.op = "update"), (c.payload = p), q);
    return q;
  };
  const db = {
    from: (table: string) => query({ table, op: "select", filters: [] }),
    rpc: (fn: string, args: unknown) => query({ table: fn, op: "rpc", payload: args, filters: [] }),
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const rule = (id: string, user_id: string, over: Record<string, unknown> = {}) => ({
  id,
  user_id,
  name: id,
  type: "new_product_in_category",
  target: {},
  frequency: "daily",
  channels: { inApp: true, email: false },
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  last_evaluated_at: null,
  last_scheduled_at: null,
  ...over,
});
const member = (user_id: string, plan: string) => ({ user_id, created_at: "2026-01-01T00:00:00Z", organizations: { subscriptions: [{ plan, status: "active" }] } });

function scenario(opts: { products?: Record<string, unknown>[]; lastPurge?: string | null } = {}) {
  return fakeDb((c) => {
    if (c.op === "insert") return { data: c.table === "notifications" ? (c.payload as unknown[]).map((_, i) => ({ id: `n${i}` })) : { id: 1 } };
    if (c.op === "rpc") return { data: { usage_events: 3 } };
    if (c.op !== "select") return {};
    switch (c.table) {
      case "alerts":
        return { data: [rule("pro-rule", "pro-user"), rule("free-rule", "free-user"), rule("done-rule", "pro-user", { last_scheduled_at: "2026-10-14T01:00:00Z" })] };
      case "organization_members":
        return { data: [member("pro-user", "pro"), member("free-user", "free")] };
      case "scan_runs":
        return { data: opts.lastPurge ? [{ started_at: opts.lastPurge }] : [] };
      case "products":
        return { data: opts.products ?? [] };
      default:
        return { data: [] };
    }
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("runScan", () => {
  const now = new Date("2026-10-14T05:15:00Z");

  it("never evaluates rules on demo data: an empty or demo-only database records a skipped run per entitled user", async () => {
    const { runScan } = await import("@/lib/server/scan");
    const demoProduct = { id: "p1", name: "Demo", category: "pets", first_detected: "2026-10-13", last_detected: "2026-10-13", source_connector: "demo", source_kind: "demo", is_demo: true, observed_at: "2026-10-13T00:00:00Z" };
    for (const products of [[], [demoProduct]]) {
      const { db, calls } = scenario({ products });
      const result = await runScan(db, { now });
      // No connector is configured in tests: nothing is called, nothing is ingested or scored.
      expect(Object.values(result.connectors).every((d) => d === "not_configured")).toBe(true);
      expect(result.records).toBe(0);
      expect(calls.some((c) => c.table === "product_metrics" || (c.table === "product_observations" && c.op !== "select"))).toBe(false);
      // Only the Pro user's due rule; the free plan has no alerts, the other rule already had its turn today.
      expect(result.evaluation).toMatchObject({ users: 1, notEntitled: 1, rules: 1, matches: 0, skipped: "no_live_data" });
      const runs = calls.filter((c) => c.table === "alert_runs");
      expect(runs.map((c) => c.op)).toEqual(["insert", "update"]);
      expect(runs[0].payload).toMatchObject({ user_id: "pro-user", origin: "scheduled", rules: 1 });
      expect(runs[1].payload).toMatchObject({ status: "skipped", message: "no_live_data" });
      expect(calls.some((c) => c.table === "notifications")).toBe(false);
      const turn = calls.find((c) => c.table === "alerts" && c.op === "update")!;
      expect(turn.payload).toEqual({ last_scheduled_at: now.toISOString() });
      expect(turn.filters).toContainEqual(["in", "id", ["pro-rule"]]);
    }
  });

  it("evaluates entitled rules on real rows and runs the purge once a day", async () => {
    vi.useFakeTimers({ now, toFake: ["Date"] }); // the database snapshot is dated "today"
    const { runScan } = await import("@/lib/server/scan");
    const real = { id: "p2", name: "Real", category: "pets", first_detected: "2026-10-14", last_detected: "2026-10-14", source_connector: "licensed_dataset", source_kind: "estimate", is_demo: false, observed_at: "2026-10-14T00:00:00Z" };
    const { db, calls } = scenario({ products: [real] });
    const result = await runScan(db, { now });
    expect(result.evaluation).toMatchObject({ users: 1, rules: 1, matches: 1, skipped: null });
    const note = calls.find((c) => c.table === "notifications" && c.op === "insert")!;
    expect(note.payload).toEqual([expect.objectContaining({ user_id: "pro-user", alert_id: "pro-rule", key: "alerts.match.new_product", origin: "scheduled" })]);
    expect(calls.filter((c) => c.table === "alert_runs").at(-1)!.payload).toMatchObject({ status: "success", matches: 1, data_as_of: "2026-10-14" });
    const purge = calls.find((c) => c.op === "rpc")!;
    expect(purge.table).toBe("purge_expired_data");
    expect(purge.payload).toMatchObject({ cutoffs: { usage_events_before: "2025-09-14T05:15:00.000Z" } });
    expect(result.retention).toMatchObject({ status: "success", deleted: { usage_events: 3 } });

    const again = scenario({ products: [real], lastPurge: "2026-10-14T00:10:00Z" });
    expect((await runScan(again.db, { now })).retention).toBeNull();
    expect(again.calls.some((c) => c.op === "rpc")).toBe(false);
  });
});
