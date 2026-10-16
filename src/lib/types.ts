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
/** "unknown" when the source does not disclose the value; it is never replaced by a guess. */
export const CREATIVE_FORMATS = ["video", "image", "carousel", "unknown"] as const;
export type CreativeFormat = (typeof CREATIVE_FORMATS)[number];
export const CALLS_TO_ACTION = ["shop_now", "learn_more", "sign_up", "get_offer", "order_now", "unknown"] as const;
export type CallToAction = (typeof CALLS_TO_ACTION)[number];
/**
 * How an ad was linked to a tracked product. Only "source" comes from the data
 * provider; the others are TrendHunter heuristics (ESTIMATES, see
 * lib/connectors/matching.ts): the product whose name was the provider search
 * term, or token overlap between the ad text and product names/tags.
 */
export type ProductMatchBasis = "source" | "search_term" | "token_overlap";
/** How an ad's category was obtained: from the source, or estimated from the linked product / a keyword classifier. */
export type CategoryBasis = "source" | "product" | "keyword_classifier";
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
  /** Product image from an authorized source (supplier feed, licensed provider). Null → generated thumbnail. */
  imageUrl?: string | null;
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

/**
 * Creative media a provider officially returns for display (e.g. TikTok Commercial Content API
 * `ad.videos[].url`, a licensed feed's media fields). HTTPS only, tokenless, never re-hosted or
 * scraped; absent when the source returns none (Meta's Ad Library API exposes no media URL).
 */
export interface AdMedia {
  type: "video" | "image";
  url: string;
  /** HTTPS poster / cover image supplied with a video. */
  posterUrl?: string | null;
  /** Connector that supplied the URL. */
  source: string;
  /** Only media from an authorized source is ever stored. */
  authorized: true;
}

export interface Advertisement {
  id: string;
  productId: string | null;
  /** How productId was assigned; anything but "source" is an estimate. Absent = supplied by the source. */
  productMatchBasis?: ProductMatchBasis | null;
  advertiser: string;
  platform: Platform;
  /** A country the ad is reported to have reached (connectors query one country at a time; the first match is kept). */
  country: Country;
  /** ISO 639-1 code as reported by the source (may be outside LANGUAGES); null when not provided. */
  language: string | null;
  format: CreativeFormat;
  headline: string;
  copy: string;
  cta: CallToAction;
  landingDomain: string | null;
  landingUrl: string | null;
  /** Null when the source provides none and no estimate could be made. */
  category: Category | null;
  /** How category was obtained; anything but "source" is an estimate. Absent = supplied by the source. */
  categoryBasis?: CategoryBasis | null;
  /** HTTPS page of this ad in the platform's public ad library (linked, never embedded or hotlinked). */
  snapshotUrl?: string | null;
  /** Placements reported by the source (e.g. Meta publisher_platforms: facebook, instagram). */
  placements?: string[];
  /** Playable/displayable media from an authorized source (migration 0007). Empty or absent → none. */
  media?: AdMedia[];
  firstSeen: string;
  lastSeen: string;
  /**
   * The source reported at its latest observation that the ad no longer runs (connector flag
   * `ad_observations.active = false`, column `advertisements.ended`); `lastSeen` is then its last
   * delivery day. Absent or false: still running at the latest observation (see lib/advertisers.ts).
   */
  ended?: boolean;
  source: SourceRef;
  hue: number;
}

export interface StoreProduct {
  storeId: string;
  productId: string | null;
  title: string;
  price: number;
  /** ISO 4217 code read from a public storefront endpoint; null when the storefront does not expose it. */
  currency: string | null;
  firstSeen: string;
  /** Who observed the listing and when. Absent on rows stored before listing provenance was recorded. */
  source?: SourceRef;
}

export interface StoreSnapshot {
  date: string;
  productCount: number;
  /** Null when not every listing was read on that date. */
  minPrice: number | null;
  maxPrice: number | null;
  source: SourceRef;
}

export interface Store {
  id: string;
  name: string;
  domain: string;
  description: string;
  categories: Category[];
  /** Null when not detected from a public storefront endpoint. */
  currency: string | null;
  /** Null when not reliably known. */
  productCount: number | null;
  socials: { network: "instagram" | "tiktok" | "facebook" | "pinterest" | "youtube"; url: string }[];
  /** verified=true only when a public platform endpoint returned a valid platform response. */
  technology: { platform: "shopify" | "woocommerce" | "unknown"; verified: boolean };
  /** Null when not known. */
  country: Country | null;
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
  /** Provenance of the underlying data (demo when the record is synthetic). */
  provenance: ProvenanceKind;
  /** Nature of the input regardless of dataset: observed facts vs estimates. */
  basis: "measured" | "estimate";
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
