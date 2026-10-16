import { describe, expect, it } from "vitest";
import { computeProfit, DEFAULT_INPUTS, round, sanitize, sensitivity } from "@/lib/profitability";

describe("computeProfit", () => {
  const base = { ...DEFAULT_INPUTS, price: 40, productCost: 10, shippingCost: 5, paymentFeePct: 2.5, paymentFeeFixed: 0.5, platformCostPerOrder: 1, cpa: 12, refundRatePct: 5, otherCostPerOrder: 0.5, fixedMonthlyCosts: 200, orders: 100 };
  const r = computeProfit(base);

  it("computes each documented quantity", () => {
    expect(r.paymentFees).toBe(1.5); // 40*2.5% + 0.5
    expect(r.refundAllowance).toBe(2); // 40*5%
    expect(r.grossMarginBeforeAds).toBe(23.5); // 40-10-5-1.5
    expect(r.contributionMargin).toBe(20); // 40-(10+5+1.5+1+2+0.5)
    expect(r.breakEvenCpa).toBe(20);
    expect(r.breakEvenRoas).toBe(2);
    expect(r.netContributionPerOrder).toBe(8);
    expect(r.impliedRoas).toBe(3.33);
    expect(r.totalRevenue).toBe(4000);
    expect(r.totalNetContribution).toBe(800);
    expect(r.estimatedOperatingProfit).toBe(600); // contribution - fixed costs (not net profit)
    expect(r.breakEvenOrders).toBe(25);
  });

  it("handles unprofitable unit economics", () => {
    const bad = computeProfit({ ...base, price: 15 });
    expect(bad.contributionMargin).toBeLessThan(0);
    expect(bad.breakEvenRoas).toBeNull();
    expect(bad.breakEvenCpa).toBe(0);
    expect(bad.breakEvenOrders).toBeNull();
  });

  it("is independent of display locale and sanitizes inputs", () => {
    const s = sanitize({ price: -5 as number, paymentFeePct: 250, orders: 10.7 });
    expect(s.price).toBe(0);
    expect(s.paymentFeePct).toBe(100);
    expect(s.orders).toBe(10);
  });

  it("rounds half away from zero without float artefacts", () => {
    expect(round(1.005)).toBe(1.01);
    expect(round(-1.005)).toBe(-1.01);
    expect(round(2.675)).toBe(2.68);
    expect(round(1e-7)).toBe(0);
    expect(round(123456.789, 1)).toBe(123456.8);
  });

  it("sensitivity grid centre equals the base case", () => {
    const grid = sensitivity(base);
    expect(grid).toHaveLength(5);
    expect(grid[2][2].netContributionPerOrder).toBe(r.netContributionPerOrder);
    expect(grid[4][0].netContributionPerOrder).toBeGreaterThan(grid[0][4].netContributionPerOrder);
  });
});
