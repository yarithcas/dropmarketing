import { z } from "zod";
import { CATEGORIES, COUNTRIES, LANGUAGES, PLATFORMS, TIME_RANGES } from "./types";

/** Query schemas shared by API routes (validation) and the client (URL building). */

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v == null ? [] : Array.isArray(v) ? v : v.split(",")).filter(Boolean))
    .pipe(z.array(z.enum(values)));

const num = z.coerce.number().finite().optional();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();
const text = z.string().trim().max(120).optional();
const bool = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => (v == null ? undefined : v === "true"));

export const PRODUCT_SORTS = ["score", "newest", "growth", "margin", "competition"] as const;

export const productQuerySchema = z.object({
  q: text,
  category: csv(CATEGORIES),
  country: csv(COUNTRIES),
  platform: csv(PLATFORMS),
  competition: csv(["low", "medium", "high"] as const),
  productType: csv(["physical", "digital", "subscription"] as const),
  priceMin: num,
  priceMax: num,
  marginMin: num, // percent
  growthMin: num, // percent
  firstFrom: day,
  firstTo: day,
  shippingVerified: bool,
  /** Verified sourcing characteristics: warehouse region and maximum delivery days. */
  warehouse: csv(["EU", "US", "CN"] as const),
  maxDeliveryDays: z.coerce.number().int().min(1).max(60).optional(),
  sort: z.enum(PRODUCT_SORTS).optional().default("score"),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(24),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;

export const AD_SORTS = ["newest", "longest", "recent"] as const;

export const adQuerySchema = z.object({
  q: text,
  advertiser: text,
  domain: text,
  productId: text,
  platform: csv(PLATFORMS),
  country: csv(COUNTRIES),
  language: csv(LANGUAGES),
  format: csv(["video", "image", "carousel"] as const),
  category: csv(CATEGORIES),
  cta: csv(["shop_now", "learn_more", "sign_up", "get_offer", "order_now"] as const),
  firstFrom: day,
  firstTo: day,
  lastFrom: day,
  lastTo: day,
  activeOnly: bool,
  sort: z.enum(AD_SORTS).optional().default("newest"),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(24),
});
export type AdQuery = z.infer<typeof adQuerySchema>;

export const storeQuerySchema = z.object({
  q: text, // name, domain, url, or product keyword
  category: csv(CATEGORIES),
  country: csv(COUNTRIES),
  platform: csv(["shopify", "woocommerce", "unknown"] as const),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(24),
});
export type StoreQuery = z.infer<typeof storeQuerySchema>;

export const trendQuerySchema = z.object({
  range: z.enum(TIME_RANGES as [string, ...string[]]).optional().default("30d"),
  category: csv(CATEGORIES),
  country: csv(COUNTRIES),
});
export type TrendQuery = z.infer<typeof trendQuerySchema>;

/** Converts URLSearchParams to a plain object (repeated keys become arrays). */
export function paramsToObject(sp: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(sp.keys())) {
    const all = sp.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

/** Normalizes a pasted store URL ("https://www.shop.com/products/x") to a bare domain. */
export function normalizeDomain(input: string): string {
  const s = input.trim().toLowerCase();
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return s.replace(/^www\./, "");
  }
}
