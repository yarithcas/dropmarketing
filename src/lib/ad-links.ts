import type { Advertisement } from "./types";

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export interface AdSite {
  /** Domain shown to the user. */
  domain: string;
  /** Where "Visit site" goes; null for demo ads, whose advertisers and sites are invented. */
  href: string | null;
  /** "page": the landing URL the source reported; "domain": only the domain shown in the ad is known. */
  precision: "page" | "domain";
}

/**
 * The advertiser's site behind an ad. Real ads link to the reported landing page (HTTPS only) or, when the
 * source only gives the domain shown in the ad (Meta link caption), to that domain's home page. Demo ads are
 * never linked: their domains are fictional.
 */
export function adSite(ad: Pick<Advertisement, "landingDomain" | "landingUrl" | "source">): AdSite | null {
  const pageUrl = ad.landingUrl?.startsWith("https://") ? ad.landingUrl : null;
  const domain = ad.landingDomain?.trim().toLowerCase() || (pageUrl ? new URL(pageUrl).hostname : null);
  if (!domain) return null;
  if (ad.source.kind === "demo") return { domain, href: null, precision: pageUrl ? "page" : "domain" };
  if (pageUrl) return { domain, href: pageUrl, precision: "page" };
  return HOSTNAME.test(domain) ? { domain, href: `https://${domain}/`, precision: "domain" } : null;
}
