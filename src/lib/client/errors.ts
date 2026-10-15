import { ApiError } from "./use-api";

/** API error codes with a translated message under `errors.codes.*`. */
export const ERROR_CODES = [
  "plan_required",
  "rate_limited",
  "unauthenticated",
  "not_configured",
  "billing_not_configured",
  "demo_mode",
  "demo_only",
  "database_unavailable",
  "not_connected",
  "sync_failed",
  "connect_failed",
  "invalid_shop",
  "invalid_state",
  "invalid_hmac",
  "missing_code",
  "not_found",
  "invalid_body",
  "network",
  "no_customer",
  "delete_failed",
  "interval_unavailable",
  "support_not_configured",
  "database_error",
  // Teams and workspaces
  "no_workspace",
  "role_required",
  "owner_required",
  "last_owner",
  "last_workspace",
  "seats_exhausted",
  "already_member",
  "limit_workspaces",
  "invite_invalid",
  "invite_expired",
  "invite_email_mismatch",
  "email_unconfirmed",
  "shopify_revoked",
  "shopify_access_denied",
  "shopify_unavailable",
  "store_limit",
] as const;

const KNOWN = new Set<string>(ERROR_CODES);

/** Translation key for an error code or a thrown API error; unknown codes fall back to the generic message. */
export function errorKey(e: unknown): string {
  const code = e instanceof ApiError ? e.code : typeof e === "string" ? e : e instanceof TypeError ? "network" : "";
  if (code === "limit_reached") return "billing.limitReached";
  return KNOWN.has(code) ? `errors.codes.${code}` : "errors.generic";
}
