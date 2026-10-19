import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { arrayContains, ilikeAny, likeLiteral, listAdsDb, listProductsDb } from "@/lib/server/supabase-repository";
import { adQuerySchema, productQuerySchema } from "@/lib/queries";

/**
 * Minimal re-implementation of PostgREST's logic-tree grammar for a flat
 * or=(...) list (pLogicSingleVal / pQuotedValue): a value is either a quoted
 * string where \x unescapes to x, a {…} array literal, or text up to "," / ")".
 */
function parseOrList(s: string): { field: string; op: string; value: string }[] {
  const out: { field: string; op: string; value: string }[] = [];
  let i = 0;
  const until = (stop: string) => {
    let v = "";
    while (i < s.length && !stop.includes(s[i])) v += s[i++];
    return v;
  };
  while (i < s.length) {
    const field = until(".");
    i++;
    const op = until(".");
    i++;
    let value = "";
    if (s[i] === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\") i++;
        value += s[i++];
      }
      if (s[i] !== '"') throw new Error("unterminated quote");
      i++;
    } else if (s[i] === "{") {
      value = until("}") + "}";
      i++;
    } else value = until(",)");
    if (i < s.length && s[i] !== ",") throw new Error(`unexpected ${s[i]} at ${i}`); // PostgREST answers 400
    i++;
    out.push({ field, op, value });
  }
  return out;
}

const PAYLOADS = ["x,id.neq.zz", "a)b", "a}b", 'quote"inside', "back\\slash", "100%_off", "(name.eq.x)", "x\",id.neq.\"y", "{a,b}", "x.y:z"];

describe("PostgREST filter construction", () => {
  it("the previous backslash escaping let a comma add an OR condition", () => {
    const legacy = (q: string) => q.replace(/[%_\\,()]/g, (c) => `\\${c}`);
    const conds = parseOrList(`copy.ilike.%${legacy("x,id.neq.zz")}%,headline.ilike.%${legacy("x,id.neq.zz")}%`);
    expect(conds.some((c) => c.field === "id" && c.op === "neq")).toBe(true);
  });

  it.each(PAYLOADS)("keeps %s inside a single ilike value per column", (q) => {
    const conds = parseOrList(ilikeAny(["copy", "headline", "advertiser"], q));
    expect(conds.map((c) => `${c.field}.${c.op}`)).toEqual(["copy.ilike", "headline.ilike", "advertiser.ilike"]);
    for (const c of conds) expect(c.value).toBe(`%${likeLiteral(q)}%`);
  });

  it.each(PAYLOADS)("keeps %s inside one array element for tags.cs", (q) => {
    const [c] = parseOrList(arrayContains("tags", q));
    expect(`${c.field}.${c.op}`).toBe("tags.cs");
    // Postgres array literal with one quoted element whose content is q.
    const m = /^\{"((?:[^"\\]|\\.)*)"\}$/.exec(c.value);
    expect(m).not.toBeNull();
    expect(m![1].replace(/\\(.)/g, "$1")).toBe(q);
  });

  it("escapes LIKE metacharacters so they match literally", () => {
    expect(likeLiteral("100%_\\")).toBe("100\\%\\_\\\\");
  });

  it("sends the quoted filter through supabase-js and surfaces PostgREST errors", async () => {
    const urls: string[] = [];
    let status = 200;
    const db = createClient("http://127.0.0.1:1", "service-key", {
      auth: { persistSession: false },
      global: {
        fetch: (async (input: RequestInfo | URL) => {
          urls.push(String(input));
          return status === 200
            ? new Response("[]", { status, headers: { "content-type": "application/json", "content-range": "0-0/0" } })
            : new Response(JSON.stringify({ code: "PGRST100", message: "failed to parse logic tree" }), { status, headers: { "content-type": "application/json" } });
        }) as typeof fetch,
      },
    });
    await listProductsDb(db, productQuerySchema.parse({ q: "x,id.neq.zz" }));
    await listAdsDb(db, adQuerySchema.parse({ q: "a)b}" }), "2026-10-15");
    for (const u of urls) {
      const or = new URL(u).searchParams.get("or")!;
      const conds = parseOrList(or.slice(1, -1));
      expect(conds.every((c) => ["name", "description", "tags", "copy", "headline", "advertiser"].includes(c.field))).toBe(true);
    }
    status = 400;
    await expect(listAdsDb(db, adQuerySchema.parse({ q: "x" }), "2026-10-15")).rejects.toMatchObject({ code: "PGRST100" });
  });
});
