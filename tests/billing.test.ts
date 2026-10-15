import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { searchKey } from "@/lib/server/usage";
import { stripFilters } from "@/lib/server/plan-filters";
import { clientIp } from "@/lib/server/api";
import { ADVANCED_AD_FILTERS } from "@/lib/plans";

describe("search metering key", () => {
  it("ignores pagination and sort but not filters", () => {
    const base = { q: "lamp", category: ["home", "kitchen"], page: 1, pageSize: 24, sort: "score" };
    expect(searchKey({ ...base, page: 3, pageSize: 100, sort: "newest" })).toBe(searchKey(base));
    expect(searchKey({ ...base, category: ["kitchen", "home"] })).toBe(searchKey(base));
    expect(searchKey({ ...base, q: "lamps" })).not.toBe(searchKey(base));
    expect(searchKey({ ...base, country: ["FR"] })).not.toBe(searchKey(base));
    expect(searchKey({ ...base, country: [] })).toBe(searchKey(base));
  });
});

describe("plan filters", () => {
  it("strips advanced ad filters and reports them", () => {
    const { query, ignored } = stripFilters({ q: "x", platform: ["meta"], country: ["FR"], activeOnly: true, format: [] as string[] }, ADVANCED_AD_FILTERS);
    expect(ignored.sort()).toEqual(["activeOnly", "country"]);
    expect(query).toMatchObject({ q: "x", platform: ["meta"], country: [], activeOnly: undefined });
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new NextRequest("http://localhost/api", { headers });
  it("does not trust the client-supplied first X-Forwarded-For hop", () => {
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 10.0.0.1, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(req({ "x-vercel-forwarded-for": "198.51.100.2", "x-forwarded-for": "6.6.6.6" }))).toBe("198.51.100.2");
    expect(clientIp(req({}))).toBe("local");
  });
});
