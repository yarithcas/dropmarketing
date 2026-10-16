"use client";

import Link from "next/link";
import { ArrowRight, Clapperboard, Radar, Store, TrendingUp, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCardNavigation } from "@/components/app/card-link";
import { PageHeader, ProvenanceBadge, ScoreBadge, Stat, Thumb, TrendPill, PlatformBadge } from "@/components/app/bits";
import { TimeSeriesChart } from "@/components/app/charts";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { useApi } from "@/lib/client/use-api";
import { useFormat } from "@/lib/format";
import { useSession } from "@/lib/client/session";
import type { ProductWithMetrics } from "@/lib/types";
import type { TrendValue } from "@/lib/scoring";
import type { AdvertiserRule, AdWithActivity } from "@/lib/advertisers";
import { ActiveAdvertiserFlag } from "@/components/app/active-advertiser";

interface Overview {
  asOf: string;
  counts: { products: number; scored: number; activeAds: number; newAdsWeek: number; newProducts: number; stores: number };
  top: ProductWithMetrics[];
  series: { date: string; activeAds: number; newAds: number }[];
  /** Newest ads of active advertisers (the same default as Ad Spy, its "View all" target). */
  recentAds: AdWithActivity[];
  advertiserRule: AdvertiserRule;
  trends: (ProductWithMetrics & { trend: TrendValue })[];
  meta: { mode: "demo" | "live"; asOf: string };
}

const QUESTIONS = [
  { key: "q1", href: "/app/products?sort=score", icon: Trophy },
  { key: "q2", href: "/app/trends", icon: TrendingUp },
  { key: "q3", href: "/app/ads?sort=longest", icon: Clapperboard },
  { key: "q4", href: "/app/competitors", icon: Store },
  { key: "q5", href: "/app/products?sort=competition", icon: Radar },
];

export default function OverviewPage() {
  const { t } = useTranslation();
  const cardLink = useCardNavigation();
  const f = useFormat();
  const { session } = useSession();
  const { data, error, loading, reload } = useApi<Overview>("/api/overview");
  const kind = data?.meta.mode === "demo" ? "demo" : "measured";

  return (
    <div className="space-y-6">
      <PageHeader
        title={session?.user?.name ? t("overview.welcomeName", { name: session.user.name.split(" ")[0] }) : t("overview.title")}
        description={t("overview.subtitle")}
        eyebrow={data ? <ProvenanceBadge kind={kind} /> : null}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {QUESTIONS.map((q, i) => {
          const Icon = q.icon;
          return (
            <Link key={q.key} href={q.href} className="card card-interactive focus-ring group p-4">
              <div className="flex items-center justify-between">
                <span className="flex size-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Icon className="size-4" />
                </span>
                <span className="text-xs text-subtle">{i + 1}/5</span>
              </div>
              <p className="mt-3 text-sm font-medium leading-snug">{t(`overview.questions.${q.key}`)}</p>
              <span className="mt-2 inline-flex items-center gap-1 text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100">
                {t("common.explore")} <ArrowRight className="size-3" />
              </span>
            </Link>
          );
        })}
      </div>

      {error ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {loading || !data ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[98px] rounded-xl" />)
            ) : (
              <>
                <Stat label={t("overview.stats.products")} value={f.number(data.counts.products)} hint={t("overview.stats.scored", { n: data.counts.scored })} />
                <Stat label={t("overview.stats.activeAds")} value={f.number(data.counts.activeAds)} hint={t("overview.stats.newAdsWeek", { n: data.counts.newAdsWeek })} tip={t("overview.stats.activeAdsTip")} />
                <Stat label={t("overview.stats.newProducts")} value={f.number(data.counts.newProducts)} hint={t("overview.stats.last30")} />
                <Stat label={t("overview.stats.stores")} value={f.number(data.counts.stores)} hint={t("overview.stats.storesHint")} />
              </>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title={t("overview.activityTitle")} description={data ? t("overview.activityDesc", { date: f.date(data.asOf) }) : undefined} action={data ? <ProvenanceBadge kind={kind} /> : null} />
              <CardBody>
                {loading || !data ? (
                  <Skeleton className="h-[260px] w-full" />
                ) : (
                  <TimeSeriesChart
                    area
                    height={260}
                    data={data.series}
                    series={[
                      { key: "activeAds", label: t("overview.series.activeAds") },
                      { key: "newAds", label: t("overview.series.newAds") },
                    ]}
                  />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("overview.trendingTitle")} description={t("overview.trendingDesc")} action={<Link href="/app/trends" className="focus-ring tap rounded text-xs text-accent underline-offset-4 hover:underline">{t("common.viewAll")}</Link>} />
              <ul className="divide-y divide-border/70">
                {loading || !data
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <li key={i} className="px-4 py-3">
                        <Skeleton className="h-8 w-full" />
                      </li>
                    ))
                  : data.trends.map((p) => (
                      <li key={p.id}>
                        <Link href={`/app/products/${p.id}`} className="focus-ring flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2 active:bg-surface-3">
                          <Thumb category={p.category} hue={p.hue} className="size-9 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm">{p.name}</div>
                            <div className="text-xs text-subtle">{t(`categories.${p.category}`)}</div>
                          </div>
                          <TrendPill value={p.trend} />
                        </Link>
                      </li>
                    ))}
              </ul>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title={t("overview.topTitle")} description={t("overview.topDesc")} action={<Link href="/app/products" className="focus-ring tap rounded text-xs text-accent underline-offset-4 hover:underline">{t("common.viewAll")}</Link>} />
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border/70">
                      <th className="table-th">{t("products.product")}</th>
                      <th className="table-th">{t("score.title")}</th>
                      <th className="table-th">{t("products.trend30")}</th>
                      <th className="table-th">{t("products.margin")}</th>
                      <th className="table-th">{t("products.ads")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.top ?? []).map((p) => (
                      <tr key={p.id} className="cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-surface-2 active:bg-surface-3" {...cardLink(`/app/products/${p.id}`)}>
                        <td className="table-td">
                          <Link href={`/app/products/${p.id}`} className="focus-ring tap flex items-center gap-2.5 rounded hover:text-accent">
                            <Thumb category={p.category} hue={p.hue} className="size-8 shrink-0" />
                            <span className="max-w-[260px] truncate">{p.name}</span>
                          </Link>
                        </td>
                        <td className="table-td">
                          <ScoreBadge score={p.score.overall} />
                        </td>
                        <td className="table-td">
                          <TrendPill pct={p.metrics.trendGrowth} />
                        </td>
                        <td className="table-td num">{p.metrics.grossMargin == null ? "—" : f.pct(p.metrics.grossMargin * 100)}</td>
                        <td className="table-td num">{p.metrics.adsObserved}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {loading && <Skeleton className="m-4 h-40" />}
              </div>
            </Card>
            <Card>
              <CardHeader title={t("overview.recentAdsTitle")} action={<Link href="/app/ads" className="focus-ring tap rounded text-xs text-accent underline-offset-4 hover:underline">{t("common.viewAll")}</Link>} />
              {data && data.recentAds.length === 0 ? (
                <p className="px-4 py-3 text-xs text-subtle" data-testid="recent-ads-empty">
                  {t("activeAdvertisers.emptyTitle")} ·{" "}
                  <Link href="/app/ads?activeAdvertisers=false" className="focus-ring rounded text-accent underline-offset-4 hover:underline">
                    {t("activeAdvertisers.showAll")}
                  </Link>
                </p>
              ) : null}
              <ul className="divide-y divide-border/70" data-testid="recent-ads">
                {(data?.recentAds ?? []).map((a) => (
                  <li key={a.id}>
                    <Link href={`/app/creatives?ad=${a.id}`} className="focus-ring block px-4 py-3 transition-colors hover:bg-surface-2 active:bg-surface-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">{a.advertiser}</span>
                          {a.advertiserActivity?.qualifies ? <ActiveAdvertiserFlag count={a.advertiserActivity.activeSinceMinDays} days={a.advertiserActivity.minDays} /> : null}
                        </span>
                        <PlatformBadge platform={a.platform} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{a.copy}</p>
                      <div className="mt-1 text-[11px] text-subtle">{t("ads.firstSeenOn", { date: f.date(a.firstSeen) })}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
