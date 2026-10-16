import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { PLAN_IDS, PLANS } from "@/lib/plans";

// The database enforces the same limits as the app (supabase/migrations/0003_plan_limits.sql).
describe("plan limits in SQL", () => {
  it("match src/lib/plans.ts", () => {
    const sql = fs.readFileSync("supabase/migrations/0003_plan_limits.sql", "utf8");
    for (const id of PLAN_IDS) {
      const m = sql.match(new RegExp(`\\('${id}', (\\d+), (\\d+), (\\d+), (true|false), (true|false)\\)`));
      expect(m, id).not.toBeNull();
      const e = PLANS[id].entitlements;
      expect([Number(m![1]), Number(m![2]), Number(m![3]), m![4] === "true", m![5] === "true"]).toEqual([e.collections, e.savedItems, e.alertRules, e.watchlists, e.alerts]);
    }
  });
});
