/** Contract every external data connector implements. */

export type ConnectorCategory = "ads" | "trends" | "stores" | "commerce" | "licensed" | "demo";
export type AuthKind = "none" | "api_key" | "oauth_client" | "access_token" | "oauth_user";

export interface ConnectorSpec {
  id: string;
  category: ConnectorCategory;
  /** How the connector authenticates (translated label in UI). */
  auth: AuthKind;
  /** Environment variables required server-side. */
  envVars: string[];
  /** i18n key describing permitted data access / terms constraints. */
  permittedKey: string;
  /** Enforced by the shared fetch helper (lib/connectors/http.ts), not just displayed. */
  rateLimit: { requests: number; per: "second" | "minute" | "hour" | "day" };
  /** Field identifiers provided by the source. */
  fields: string[];
  syncFrequency: "hourly" | "every6h" | "daily" | "weekly" | "on_demand";
  /** Raw payload retention in days; derived aggregates are kept as history. */
  retentionDays: number;
  docsUrl: string;
  /**
   * False while TrendHunter has no mapping for the provider (omitted = true):
   * such a connector never syncs and is never reported as configured, whatever
   * credentials are set.
   */
  available?: boolean;
}

/** A provider search term and the tracked product whose name it is (null for other keywords). */
export interface SearchTerm {
  term: string;
  productId: string | null;
}

export interface SyncContext {
  /** Keywords / domains to query, derived from tracked products and user watchlists. */
  keywords: string[];
  /**
   * Keywords with the product each one names. When absent, connectors pair
   * `keywords` with tracked (non-demo) products of exactly that name.
   */
  searchTerms?: SearchTerm[];
  domains: string[];
  countries: string[];
  since: string;
  /** Optional epoch-ms deadline shared by the whole scan; each connector also applies its own time budget. */
  deadline?: number;
}

export interface SyncResult {
  /** "partial": some records were stored and some failed (or the time/request budget ran out). */
  status: "success" | "partial" | "skipped" | "failed";
  /** Records actually stored (upserts that returned no error). */
  records: number;
  /** Records that were fetched but could not be stored or were rejected by validation. */
  failed?: number;
  message?: string;
}

export interface Connector extends ConnectorSpec {
  configured(): boolean;
  sync(ctx: SyncContext): Promise<SyncResult>;
}
