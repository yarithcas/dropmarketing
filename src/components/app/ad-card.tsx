"use client";

import Link from "next/link";
import { ExternalLink, FileQuestion, Image as ImageIcon, Images, PlayCircle, ScanSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Advertisement } from "@/lib/types";
import { daysBetween } from "@/lib/dates";
import { useFormat } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { PlatformBadge, ProvenanceBadge, SourceLine } from "./bits";
import { SaveButton } from "./save";
import { isWatchable, WatchAdButton } from "./ad-player";
import { ActiveAdvertiserBadge } from "./active-advertiser";
import type { AdvertiserActivity } from "@/lib/advertisers";
import { cn } from "@/lib/cn";

const FORMAT_ICON = { video: PlayCircle, image: ImageIcon, carousel: Images, unknown: FileQuestion };

/** "Est." tag on a product link TrendHunter inferred (search term or token overlap), with how it was made. */
export function MatchEstimateTag({ ad }: { ad: Advertisement }) {
  const { t } = useTranslation();
  if (!ad.productId || !ad.productMatchBasis || ad.productMatchBasis === "source") return null;
  return (
    <Tooltip content={t(`ads.matchBasis.${ad.productMatchBasis}`)}>
      <span tabIndex={0} className="shrink-0 rounded bg-warn/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-warn">
        {t("provenance.estimateShort")}
      </span>
    </Tooltip>
  );
}

/** Link to the ad's page in the platform's public ad library (never embedded). Rendered only for HTTPS URLs. */
export function AdLibraryLink({ ad, className }: { ad: Advertisement; className?: string }) {
  const { t } = useTranslation();
  if (!ad.snapshotUrl?.startsWith("https://")) return null;
  return (
    <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer nofollow" className={cn("inline-flex items-center gap-1 text-xs text-accent hover:underline", className)} data-testid="ad-library-link">
      <ExternalLink className="size-3" /> {t("ads.viewInLibrary", { platform: t(`platforms.${ad.platform}`) })}
    </a>
  );
}

/** Creative preview placeholder: authorized thumbnails are shown only when a connector supplies them. */
export function CreativePreview({ ad, className, hideIcon = false }: { ad: Advertisement; className?: string; hideIcon?: boolean }) {
  const { t } = useTranslation();
  const Icon = FORMAT_ICON[ad.format];
  return (
    <div
      className={cn("relative flex flex-col justify-end overflow-hidden rounded-lg p-3", className)}
      style={{ background: `linear-gradient(160deg, hsl(${ad.hue} 55% 26%), hsl(${(ad.hue + 60) % 360} 50% 10%))` }}
      role="img"
      aria-label={t("ads.previewLabel", { advertiser: ad.advertiser })}
    >
      <div className="bg-grid absolute inset-0 opacity-25" />
      {hideIcon ? null : <Icon className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-[70%] text-white/70" strokeWidth={1.3} />}
      <div className="relative line-clamp-2 text-sm font-semibold leading-snug text-white drop-shadow">{ad.headline}</div>
      <div className="relative mt-1 text-[10px] uppercase tracking-wider text-white/60">{t("ads.generatedPreview")}</div>
    </div>
  );
}

export function AdCard({ ad, productName }: { ad: Advertisement & { advertiserActivity?: AdvertiserActivity | null }; productName?: string | null }) {
  const { t } = useTranslation();
  const f = useFormat();
  const days = daysBetween(ad.firstSeen, ad.lastSeen) + 1;
  const watchable = isWatchable(ad);
  return (
    <article className="card flex flex-col overflow-hidden" data-testid="ad-card">
      <div className="relative">
        <CreativePreview ad={ad} className="h-40 rounded-none" hideIcon={watchable} />
        {watchable ? <WatchAdButton ad={ad} productName={productName} /> : null}
        <div className="absolute right-2 top-2 flex gap-1.5">
          <SaveButton type="ad" refId={ad.id} label={`${ad.advertiser} — ${ad.headline}`} iconOnly />
        </div>
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold">{ad.advertiser}</span>
          <PlatformBadge platform={ad.platform} />
        </div>
        {ad.copy ? <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted">{ad.copy}</p> : <p className="mt-1.5 text-xs text-subtle">{t("ads.noCopy")}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <ActiveAdvertiserBadge activity={ad.advertiserActivity} />
          <Badge>{t(`formats.${ad.format}`)}</Badge>
          <Badge>{t(`cta.${ad.cta}`)}</Badge>
          <Badge>{t(`countries.${ad.country}`)}</Badge>
          <Badge>{ad.language ? ad.language.toUpperCase() : t("ads.languageUnknown")}</Badge>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="text-subtle">{t("ads.firstSeen")}</dt>
            <dd className="mt-0.5">{f.date(ad.firstSeen)}</dd>
          </div>
          <div>
            <dt className="text-subtle">{t("ads.lastSeen")}</dt>
            <dd className="mt-0.5">{f.date(ad.lastSeen)}</dd>
          </div>
          <div>
            <dt className="text-subtle">{t("ads.observedFor")}</dt>
            <dd className="num mt-0.5">{t("ads.days", { count: days })}</dd>
          </div>
          <div>
            <dt className="text-subtle">{t("ads.spend")}</dt>
            <dd className="mt-0.5 text-subtle">{t("ads.notPublic")}</dd>
          </div>
        </dl>
        {productName && ad.productId ? (
          <div className="mt-3 flex min-w-0 items-center gap-1.5">
            <Link href={`/app/products/${ad.productId}`} className="truncate text-xs text-accent hover:underline">
              {t("ads.product")}: {productName}
            </Link>
            <MatchEstimateTag ad={ad} />
          </div>
        ) : null}
        <div className="mt-auto space-y-2.5 border-t border-border/70 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <ProvenanceBadge kind={ad.source.kind} />
            <SourceLine connector={ad.source.connector} observedAt={ad.source.observedAt} />
          </div>
          <AdLibraryLink ad={ad} />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 truncate text-[11px] text-subtle">
              {ad.landingDomain ? (
                ad.source.kind !== "demo" && ad.landingUrl ? (
                  <a href={ad.landingUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:text-accent">
                    <ExternalLink className="size-3" /> {ad.landingDomain}
                  </a>
                ) : (
                  // Domain only (e.g. a Meta link caption): shown, not linked.
                  <span title={ad.source.kind === "demo" ? t("ads.landingDemo", { domain: ad.landingDomain }) : undefined}>
                    {t("ads.landing")}: {ad.landingDomain}
                  </span>
                )
              ) : null}
            </div>
            <Link href={`/app/creatives?ad=${ad.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })} data-testid="analyze-ad">
              <ScanSearch /> {t("ads.analyze")}
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
