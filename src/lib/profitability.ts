/**
 * Unit-economics calculator. Pure functions, locale-independent: the interface
 * language never changes these numbers, only how they are formatted.
 *
 * Definitions
 * - Gross margin before advertising = price − product cost − shipping − payment fees.
 * - Contribution margin (before ads) = price − all variable costs per order
 *   (product, shipping, payment fees, platform/apps allocation, refunds allowance, other).
 *   This is also the break-even CPA.
 * - Net contribution per order = contribution margin − advertising CPA.
 * - Estimated operating profit = net contribution × orders − fixed monthly overhead.
 *   It is NOT net profit: taxes, salaries, financing and one-off costs are excluded.
 */

export interface ProfitInputs {
  price: number;
  productCost: number;
  shippingCost: number;
  paymentFeePct: number; // e.g. 2.9 (%)
  paymentFeeFixed: number; // e.g. 0.30 per order
  platformCostPerOrder: number; // Shopify + apps allocated per order
  cpa: number; // advertising cost per acquisition
  refundRatePct: number; // allowance as % of revenue
  otherCostPerOrder: number;
  fixedMonthlyCosts: number;
  orders: number;
}

export const DEFAULT_INPUTS: ProfitInputs = {
  price: 34.9,
  productCost: 7.1,
  shippingCost: 4.5,
  paymentFeePct: 2.9,
  paymentFeeFixed: 0.3,
  platformCostPerOrder: 0.8,
  cpa: 12,
  refundRatePct: 4,
  otherCostPerOrder: 0.5,
  fixedMonthlyCosts: 150,
  orders: 300,
};

export interface ProfitResult {
  paymentFees: number;
  refundAllowance: number;
  variableCosts: number;
  grossMarginBeforeAds: number;
  grossMarginBeforeAdsPct: number | null;
  contributionMargin: number;
  contributionMarginPct: number | null;
  breakEvenCpa: number;
  /** Null when contribution margin ≤ 0 (no ROAS can break even). */
  breakEvenRoas: number | null;
  netContributionPerOrder: number;
  netContributionPct: number | null;
  /** Actual ROAS implied by price / CPA. */
  impliedRoas: number | null;
  totalRevenue: number;
  totalNetContribution: number;
  estimatedOperatingProfit: number;
  /** Orders needed to cover fixed costs, null if per-order contribution ≤ 0. */
  breakEvenOrders: number | null;
}

/** Round half away from zero to `dp` decimals, avoiding binary float artefacts. */
export function round(n: number, dp = 2): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** dp;
  // toPrecision(15) removes binary artefacts before rounding (1.005 * 100 = 100.49999…).
  return (Math.sign(n) * Math.round(Number((Math.abs(n) * f).toPrecision(15)))) / f || 0;
}

const pct = (num: number, den: number) => (den > 0 ? round((num / den) * 100, 1) : null);

export function sanitize(i: Partial<ProfitInputs>): ProfitInputs {
  const out = { ...DEFAULT_INPUTS };
  for (const k of Object.keys(DEFAULT_INPUTS) as (keyof ProfitInputs)[]) {
    const v = Number(i[k]);
    if (i[k] !== undefined && Number.isFinite(v)) out[k] = Math.max(0, v);
  }
  out.paymentFeePct = Math.min(out.paymentFeePct, 100);
  out.refundRatePct = Math.min(out.refundRatePct, 100);
  out.orders = Math.floor(out.orders);
  return out;
}

export function computeProfit(raw: ProfitInputs): ProfitResult {
  const i = sanitize(raw);
  const paymentFees = i.price * (i.paymentFeePct / 100) + i.paymentFeeFixed;
  const refundAllowance = i.price * (i.refundRatePct / 100);
  const grossMarginBeforeAds = i.price - i.productCost - i.shippingCost - paymentFees;
  const variableCosts = i.productCost + i.shippingCost + paymentFees + i.platformCostPerOrder + refundAllowance + i.otherCostPerOrder;
  const contributionMargin = i.price - variableCosts;
  const netContributionPerOrder = contributionMargin - i.cpa;
  const totalNetContribution = netContributionPerOrder * i.orders;
  return {
    paymentFees: round(paymentFees),
    refundAllowance: round(refundAllowance),
    variableCosts: round(variableCosts),
    grossMarginBeforeAds: round(grossMarginBeforeAds),
    grossMarginBeforeAdsPct: pct(grossMarginBeforeAds, i.price),
    contributionMargin: round(contributionMargin),
    contributionMarginPct: pct(contributionMargin, i.price),
    breakEvenCpa: round(Math.max(0, contributionMargin)),
    breakEvenRoas: contributionMargin > 0 ? round(i.price / contributionMargin) : null,
    netContributionPerOrder: round(netContributionPerOrder),
    netContributionPct: pct(netContributionPerOrder, i.price),
    impliedRoas: i.cpa > 0 ? round(i.price / i.cpa) : null,
    totalRevenue: round(i.price * i.orders),
    totalNetContribution: round(totalNetContribution),
    estimatedOperatingProfit: round(totalNetContribution - i.fixedMonthlyCosts),
    breakEvenOrders: netContributionPerOrder > 0 ? Math.ceil(i.fixedMonthlyCosts / netContributionPerOrder) : null,
  };
}

export interface SensitivityCell {
  priceDelta: number;
  cpaDelta: number;
  netContributionPerOrder: number;
}

/** Net contribution per order under ±% shifts of price (rows) and CPA (columns). */
export function sensitivity(i: ProfitInputs, deltas = [-20, -10, 0, 10, 20]): SensitivityCell[][] {
  return deltas.map((pd) =>
    deltas.map((cd) => ({
      priceDelta: pd,
      cpaDelta: cd,
      netContributionPerOrder: computeProfit({ ...i, price: i.price * (1 + pd / 100), cpa: i.cpa * (1 + cd / 100) }).netContributionPerOrder,
    })),
  );
}
