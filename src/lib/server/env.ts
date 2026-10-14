import "server-only";

/**
 * Server-side configuration. Secrets are read only here and never sent to the
 * browser. Every integration reports whether it is configured; unconfigured
 * integrations fall back to clearly labelled demo behaviour.
 */
const e = process.env;

export const env = {
  appUrl: e.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supabaseUrl: e.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: e.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
  anthropicApiKey: e.ANTHROPIC_API_KEY,
  anthropicModel: e.ANTHROPIC_MODEL ?? "claude-opus-5-5",
  stripeSecretKey: e.STRIPE_SECRET_KEY,
  stripeWebhookSecret: e.STRIPE_WEBHOOK_SECRET,
  stripePricePro: e.STRIPE_PRICE_PRO,
  stripePriceBusiness: e.STRIPE_PRICE_BUSINESS,
  shopifyApiKey: e.SHOPIFY_API_KEY,
  shopifyApiSecret: e.SHOPIFY_API_SECRET,
  shopifyScopes: e.SHOPIFY_SCOPES ?? "read_products,read_orders,read_inventory",
  shopifyApiVersion: e.SHOPIFY_API_VERSION ?? "2025-07",
  resendApiKey: e.RESEND_API_KEY,
  emailFrom: e.EMAIL_FROM ?? "TrendHunter <alerts@trendhunter.app>",
  cronSecret: e.CRON_SECRET,
  encryptionKey: e.ENCRYPTION_KEY, // 32-byte base64 key for integration tokens
  metaAccessToken: e.META_AD_LIBRARY_ACCESS_TOKEN,
  metaGraphVersion: e.META_GRAPH_VERSION ?? "v23.0",
  tiktokClientKey: e.TIKTOK_RESEARCH_CLIENT_KEY,
  tiktokClientSecret: e.TIKTOK_RESEARCH_CLIENT_SECRET,
  pinterestToken: e.PINTEREST_API_TOKEN,
  trendsApiKey: e.SEARCH_TRENDS_API_KEY,
  storefrontCrawlerEnabled: e.STOREFRONT_CRAWLER_ENABLED === "true",
  licensedProviderUrl: e.LICENSED_DATA_PROVIDER_URL,
  licensedProviderKey: e.LICENSED_DATA_PROVIDER_KEY,
};

export function features() {
  const supabase = Boolean(env.supabaseUrl && env.supabaseAnonKey);
  return {
    supabase,
    supabaseAdmin: supabase && Boolean(env.supabaseServiceRoleKey),
    ai: Boolean(env.anthropicApiKey),
    stripe: Boolean(env.stripeSecretKey && env.stripeWebhookSecret && env.stripePricePro && env.stripePriceBusiness),
    shopify: Boolean(env.shopifyApiKey && env.shopifyApiSecret && env.encryptionKey && supabase),
    email: Boolean(env.resendApiKey),
    cron: Boolean(env.cronSecret && supabase && env.supabaseServiceRoleKey),
  };
}
export type Features = ReturnType<typeof features>;
