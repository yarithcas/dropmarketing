import { describe, expect, it } from "vitest";
import { serverT } from "@/lib/server/messages";
import { makeFormatters } from "@/lib/formatters";
import { notificationParams } from "@/lib/notification-text";
import { errorKey } from "@/lib/client/errors";
import { ApiError } from "@/lib/client/use-api";

describe("server messages", () => {
  it("translates with interpolation and falls back to French", () => {
    expect(serverT("en")("email.subject", { rule: "Pets" })).toBe("TrendHunter · Pets");
    expect(serverT("de")("meta.title")).toContain("TrendHunter");
    expect(serverT("it")("does.not.exist")).toBe("does.not.exist");
  });

  it("formats alert notifications in the reader's locale", () => {
    const fr = serverT("fr");
    const f = makeFormatters("fr-FR");
    const text = fr("alerts.match.trend_increase", notificationParams({ name: "Lampe", pct: 1250 }, f, (c) => fr(`categories.${c}`)));
    expect(text).toMatch(/^Lampe : publicités actives \+1\s250\s%/);
    const en = serverT("en");
    expect(en("alerts.match.new_product", notificationParams({ name: "Bowl", category: "pets" }, makeFormatters("en-GB"), (c) => en(`categories.${c}`)))).toBe(`New product in ${en("categories.pets")}: Bowl`);
  });
});

describe("errorKey", () => {
  it("maps known API codes and falls back to the generic message", () => {
    expect(errorKey(new ApiError(429, "rate_limited", "x"))).toBe("errors.codes.rate_limited");
    expect(errorKey(new ApiError(429, "limit_reached", "x"))).toBe("billing.limitReached");
    expect(errorKey("invalid_shop")).toBe("errors.codes.invalid_shop");
    expect(errorKey(new ApiError(500, "something_else", "x"))).toBe("errors.generic");
    expect(errorKey(new TypeError("Failed to fetch"))).toBe("errors.codes.network");
  });
});
