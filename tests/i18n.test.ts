import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import es from "@/locales/es.json";
import de from "@/locales/de.json";
import it_ from "@/locales/it.json";
import { CATEGORIES, COUNTRIES, PLATFORMS } from "@/lib/types";
import { ERROR_CODES } from "@/lib/client/errors";

type Tree = { [k: string]: string | Tree | Tree[] };

function flatten(obj: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else if (Array.isArray(v)) out.set(key, JSON.stringify(v.map((x) => Object.keys(x))));
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

const vars = (s: string) => Array.from(s.matchAll(/\{\{(\w+)\}\}/g), (m) => m[1]).sort().join(",");
const EN = flatten(en as Tree);
const has = (k: string) => EN.has(k) || EN.has(`${k}_one`) || EN.has(`${k}_other`) || [...EN.keys()].some((x) => x.startsWith(`${k}.`));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? sourceFiles(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []));
}

describe("i18n", () => {
  for (const [name, locale] of Object.entries({ fr, es, de, it: it_ })) {
    it(`${name} has exactly the same keys and placeholders as en`, () => {
      const L = flatten(locale as Tree);
      const missing = [...EN.keys()].filter((k) => !L.has(k));
      const extra = [...L.keys()].filter((k) => !EN.has(k));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      const mismatched = [...EN.entries()].filter(([k, v]) => vars(v) !== vars(L.get(k) ?? ""));
      expect(mismatched.map(([k]) => k)).toEqual([]);
    });
  }

  it("every literal key used in the source exists", () => {
    const missing = new Set<string>();
    for (const f of sourceFiles("src")) {
      const s = fs.readFileSync(f, "utf8");
      for (const m of s.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) if (!has(m[1])) missing.add(`${m[1]} (${f})`);
      for (const m of s.matchAll(/key: "([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)"/g)) if (!has(m[1])) missing.add(`${m[1]} (${f})`);
      for (const m of s.matchAll(/"((?:analyst|creative|reports|steps|signals|insufficient|alerts\.match)\.[a-zA-Z0-9_.]+)"/g)) if (!has(m[1])) missing.add(`${m[1]} (${f})`);
    }
    expect([...missing]).toEqual([]);
  });

  it("enumerated dynamic keys exist", () => {
    const keys = [
      ...CATEGORIES.map((c) => `categories.${c}`),
      ...COUNTRIES.map((c) => `countries.${c}`),
      ...PLATFORMS.map((c) => `platforms.${c}`),
      ...["trend", "ads", "margin", "competition", "differentiation", "freshness"].map((k) => `score.components.${k}`),
      ...["insufficient_history", "new_activity", "no_activity"].flatMap((k) => [`trend.status.${k}`, `trend.status.${k}Tip`]),
      ...["measured", "estimate", "ai", "demo"].flatMap((k) => [`provenance.${k}`, `provenance.${k}Tip`]),
      ...ERROR_CODES.map((c) => `errors.codes.${c}`),
      ...["meta_ad_library", "tiktok_commercial_content", "pinterest_ads_repository", "search_trends", "public_storefronts", "licensed_dataset", "shopify_admin", "demo"].map((k) => `connectors.names.${k}`),
    ];
    expect(keys.filter((k) => !has(k))).toEqual([]);
  });
});
