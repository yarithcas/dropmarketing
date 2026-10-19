import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("supabase/setup.sql", () => {
  it("contains every migration, in order (regenerate with node scripts/build-setup-sql.mjs)", () => {
    const setup = readFileSync("supabase/setup.sql", "utf8");
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    let at = 0;
    for (const f of files) {
      const body = readFileSync(`supabase/migrations/${f}`, "utf8").trimEnd();
      const i = setup.indexOf(`-- ═══ ${f} ═══\n${body}\n`, at);
      expect(i, f).toBeGreaterThanOrEqual(at);
      at = i + body.length;
    }
  });
});
