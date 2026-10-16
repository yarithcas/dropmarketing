/**
 * Subscription plans and their entitlements. Limits are finite on every tier:
 * nothing is advertised as unlimited.
 */

export const PLAN_IDS = ["free", "pro", "business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Entitlements {
  productSearchesPerDay: number;
  adSearchesPerDay: number;
  aiQueriesPerDay: number;
  savedItems: number;
  collections: number;
  alertRules: number;
  workspaces: number;
  seats: number;
  advancedFilters: boolean;
  creativeAnalysis: boolean;
  calculator: boolean;
  alerts: boolean;
  advancedReports: boolean;
  exports: boolean;
  shopifyIntegration: boolean;
  /** Number of own Shopify stores that can be connected at once. */
  shopifyStores: number;
  /** Watchlists (monitored products, ads, stores and competitors). */
  watchlists: boolean;
  prioritySupport: boolean;
}

export const PLANS: Record<PlanId, { priceMonthly: number; priceYearly: number; entitlements: Entitlements }> = {
  free: {
    priceMonthly: 0,
    priceYearly: 0,
    entitlements: {
      productSearchesPerDay: 25,
      adSearchesPerDay: 25,
      aiQueriesPerDay: 5,
      savedItems: 20,
      collections: 2,
      alertRules: 0,
      workspaces: 1,
      seats: 1,
      advancedFilters: false,
      creativeAnalysis: false,
      calculator: false,
      alerts: false,
      advancedReports: false,
      exports: false,
      shopifyIntegration: false,
      shopifyStores: 0,
      watchlists: false,
      prioritySupport: false,
    },
  },
  pro: {
    priceMonthly: 49,
    priceYearly: 470,
    entitlements: {
      productSearchesPerDay: 500,
      adSearchesPerDay: 500,
      aiQueriesPerDay: 100,
      savedItems: 1000,
      collections: 50,
      alertRules: 25,
      workspaces: 1,
      seats: 1,
      advancedFilters: true,
      creativeAnalysis: true,
      calculator: true,
      alerts: true,
      advancedReports: false,
      exports: true,
      shopifyIntegration: true,
      shopifyStores: 1,
      watchlists: true,
      prioritySupport: false,
    },
  },
  business: {
    priceMonthly: 149,
    priceYearly: 1430,
    entitlements: {
      productSearchesPerDay: 3000,
      adSearchesPerDay: 3000,
      aiQueriesPerDay: 500,
      savedItems: 10000,
      collections: 500,
      alertRules: 200,
      workspaces: 5,
      seats: 10,
      advancedFilters: true,
      creativeAnalysis: true,
      calculator: true,
      alerts: true,
      advancedReports: true,
      exports: true,
      shopifyIntegration: true,
      shopifyStores: 5,
      watchlists: true,
      prioritySupport: true,
    },
  },
};

export type MeteredFeature = "product_search" | "ad_search" | "ai_query";

export const METER_LIMIT: Record<MeteredFeature, keyof Entitlements> = {
  product_search: "productSearchesPerDay",
  ad_search: "adSearchesPerDay",
  ai_query: "aiQueriesPerDay",
};

export function isPlan(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}

/** Advanced product filters (Free plan only gets keyword, category, price and sort). */
export const ADVANCED_PRODUCT_FILTERS = ["country", "platform", "competition", "productType", "marginMin", "growthMin", "firstFrom", "firstTo", "shippingVerified", "warehouse", "maxDeliveryDays"] as const;

/**
 * Advanced ad filters (Free plan only gets keyword, category, platform, sort and the
 * active-advertiser switch; adjusting that rule's thresholds is advanced).
 */
export const ADVANCED_AD_FILTERS = ["advertiser", "domain", "country", "language", "format", "cta", "firstFrom", "firstTo", "lastFrom", "lastTo", "activeOnly", "minActiveAds", "minActiveDays"] as const;
