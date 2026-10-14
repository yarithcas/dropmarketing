/**
 * Core domain types for TrendHunter.
 *
 * Every externally sourced value carries provenance: where it came from and
 * when it was observed. `kind` distinguishes measured observations, third-party
 * estimates, AI-generated conclusions, and demo (synthetic) data.
 */

export type ProvenanceKind = "measured" | "estimate" | "ai" | "demo";

export interface SourceRef {
  /** Connector id, e.g. "meta_ad_library" or "demo". */
  connector: string;
  kind: ProvenanceKind;
  /** ISO timestamp when the value was collected. */
  observedAt: string;
  url?: string;
}

export const PLATFORMS = ["meta", "tiktok", "pinterest", "google", "snapchat"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CATEGORIES = [
  "fitness",
  "home",
  "kitchen",
  "beauty",
  "pets",
  "tech",
  "outdoor",
  "baby",
  "fashion",
  "wellness",
  "auto",
  "office",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const COUNTRIES = ["FR", "US", "GB", "DE", "ES", "IT", "CA", "AU", "BE", "NL"] as const;
export type Country = (typeof COUNTRIES)[number];

export const LANGUAGES = ["fr", "en", "es", "de", "it"] as const;
export type AdLanguage = (typeof LANGUAGES)[number];

export type CompetitionLevel = "low" | "medium" | "high";
export type ProductType = "physical" | "digital" | "subscription";
export type CreativeFormat = "video" | "image" | "carousel";
export type CallToAction = "shop_now" | "learn_more" | "sign_up" | "get_offer" | "order_now";
export type TrendShape = "rising" | "emerging" | "stable" | "declining" | "spike";

export interface ShippingInfo {
  /** Only populated when verified with the supplier or a licensed source. */
  verified: boolean;
  warehouse?: "EU" | "US" | "CN";
  deliveryDays?: [number, number];
}

export interface Product {
  id: string;
  name: string;
  category: Category;
  description: string;
  productType: ProductType;
  tags: string[];
  /** Estimated retail price (third-party / observed storefront prices). */
  priceEstimate: number | null;
  /** Estimated supplier unit cost (not a verified quotation). */
  supplierCostEstimate: number | null;
  currency: "EUR" | "USD";
  channels: Platform[];
  countries: Country[];
  shipping: ShippingInfo;
  /** Analyst-estimated differentiation, 0-100 (estimate). */
  differentiation: number | null;
  firstDetected: string;
  lastDetected: string;
  source: SourceRef;
  /** Index into a deterministic gradient palette for the generated thumbnail. */
  hue: number;
}

export interface ProductObservation {
  productId: string;
  /** YYYY-MM-DD */
  date: string;
  adsActive: number;
  newAdvertisers: number;
  storesObserved: number;
  /** Public search interest index 0-100 when a data source exists, else null. */
  searchInterest: number | null;
  source: SourceRef;
}

export interface Advertisement {
  id: string;
  productId: string | null;
  advertiser: string;
  platform: Platform;
  country: Country;
  language: AdLanguage;
  format: CreativeFormat;
  headline: string;
  copy: string;
  cta: CallToAction;
  landingDomain: string | null;
  landingUrl: string | null;
  category: Category;
  firstSeen: string;
  lastSeen: string;
  source: SourceRef;
  hue: number;
}

export interface StoreProduct {
  storeId: string;
  productId: string | null;
  title: string;
  price: number;
  currency: string;
  firstSeen: string;
}

export interface StoreSnapshot {
  date: string;
  productCount: number;
  minPrice: number;
  maxPrice: number;
  source: SourceRef;
}

export interface Store {
  id: string;
  name: string;
  domain: string;
  description: string;
  categories: Category[];
  currency: string;
  /** Null when not reliably known. */
  productCount: number | null;
  socials: { network: "instagram" | "tiktok" | "facebook" | "pinterest" | "youtube"; url: string }[];
  technology: { platform: "shopify" | "woocommerce" | "unknown"; verified: boolean };
  country: Country;
  firstSeen: string;
  source: SourceRef;
  hue: number;
}

export type TimeRange = "24h" | "7d" | "30d" | "90d";
export const TIME_RANGES: TimeRange[] = ["24h", "7d", "30d", "90d"];

export interface ProductMetrics {
  adsObserved: number;
  adsActive: number;
  advertisersObserved: number;
  storesObserved: number;
  /** Growth of active ads, last 30 days vs previous 30 days, percentage. Null when history is insufficient. */
  trendGrowth: number | null;
  competition: CompetitionLevel;
  /** 0-100 estimate of market saturation. */
  saturation: number;
  grossMargin: number | null;
  observationCount: number;
}

export interface ScoreComponent {
  key: "trend" | "ads" | "margin" | "competition" | "differentiation" | "freshness";
  weight: number;
  /** Normalized 0-100, or null if the input is missing. */
  value: number | null;
  provenance: ProvenanceKind;
}

export type Confidence = "high" | "medium" | "low";

export interface Signal {
  key: string;
  params?: Record<string, string | number>;
}

export interface OpportunityScore {
  /** Null means "Insufficient data". */
  overall: number | null;
  components: ScoreComponent[];
  confidence: Confidence;
  positives: Signal[];
  negatives: Signal[];
  nextSteps: Signal[];
  insufficientReasons: Signal[];
}

export interface ProductWithMetrics extends Product {
  metrics: ProductMetrics;
  score: OpportunityScore;
}
