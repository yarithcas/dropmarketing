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
  rateLimit: { requests: number; per: "second" | "minute" | "hour" | "day" };
  /** Field identifiers provided by the source. */
  fields: string[];
  syncFrequency: "hourly" | "every6h" | "daily" | "weekly" | "on_demand";
  /** Raw payload retention in days; derived aggregates are kept as history. */
  retentionDays: number;
  docsUrl: string;
}

export interface SyncContext {
  /** Keywords / domains to query, derived from tracked products and user watchlists. */
  keywords: string[];
  domains: string[];
  countries: string[];
  since: string;
}

export interface SyncResult {
  status: "success" | "skipped" | "failed";
  records: number;
  message?: string;
}

export interface Connector extends ConnectorSpec {
  configured(): boolean;
  sync(ctx: SyncContext): Promise<SyncResult>;
}
