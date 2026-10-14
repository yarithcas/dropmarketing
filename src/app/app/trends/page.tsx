"use client";

import { Suspense } from "react";
import Link from "next/link";
import { Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader, ProvenanceBadge, ScoreBadge, Thumb, TrendPill } from "@/components/app/bits";
import { BarList, TimeSeriesChart } from "@/components/app/charts";
import { ChipSet } from "@/components/app/filters";
import { WatchButton } from "@/components/app/save";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { useApi } from "@/lib/client/use-api";
import { useUrlState } from "@/lib/client/use-url-state";
import { useFormat } from "@/lib/format";
import type { TrendValue } from "@/lib/scoring";
import { CATEGORIES, COUNTRIES, TIME_RANGES, type Category, type Country, type ProductWithMetrics, type TimeRange } from "@/lib/types";

interface TrendsResponse {
  range: TimeRange;
  asOf: string;
  trending: (ProductWithMetrics & { trend: TrendValue })[];
  declining: (ProductWithMetrics & { trend: TrendValue })[];
  emerging: ProductWithMetrics[];
  categories: { category: Category; growth: number | null; adsActive: number; products: number; newAdvertisers: number }[];
  countries: { country: Country; adsInRange: number; previous: number; growth: number | null }[];
  series: Record<string, string | number>[];
  insufficient: number;
  meta: { mode: "demo" | "live"; asOf: string; sources: string[] };
}

function ProductRows({ items }: { items: (ProductWithMetrics & { trend?: TrendValue })[] }) {
  const { t } = useTranslation();
  const f = useFormat();
  if (!items.length) return <EmptyState className="m-4" title={t("trends.noneInRange")} />;
  return (
    <ul className="divide-y divide-border/70">
      {items.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
          <Link href={`/app/products/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
            <Thumb category={p.category} hue={p.hue} className="size-9 shrink-0" />
            <div className="min-w-0">
              <div className="truncate text-sm hover:text-accent">{p.name}</div>
              <div className="text-xs text-subtle">
                {t(`categories.${p.category}`)} · {t("products.firstDetectedOn", { date: f.date(p.firstDetected) })}
              </div>
            </div>
          </Link>
          <ScoreBadge score={p.score.overall} className="hidden sm:inline-flex" />
          {p.trend ? <TrendPill value={p.trend} className="w-20 justify-end" /> : null}
        </li>
      ))}
    </ul>
  );
}

function TrendsInner() {
  const { t } = useTranslation();
  const f = useFormat();
  const url = useUrlState();
  const range = (url.get("range") || "30d") as TimeRange;
  const { data, error, loading, reload } = useApi<TrendsResponse>(`/api/trends?${url.query}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("trends.title")}
        description={t("trends.subtitle")}
        eyebrow={data ? <ProvenanceBadge kind={data.meta.mode === "demo" ? "demo" : "measured"} /> : null}
        actions={<Tabs value={range} onChange={(r) => url.set({ range: r })} items={TIME_RANGES.map((r) => ({ value: r, label: t(`ranges.${r}`) }))} />}
      />
      <Card className="p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="label mb-2">{t("filters.category")}</div>
            <ChipSet values={CATEGORIES} active={url.getList("category")} onToggle={(v) => url.toggle("category", v)} render={(v) => t(`categories.${v}`)} />
          </div>
          <div>
            <div className="label mb-2">{t("filters.country")}</div>
            <ChipSet values={COUNTRIES} active={url.getList("country")} onToggle={(v) => url.toggle("country", v)} render={(v) => t(`countries.${v}`)} />
          </div>
        </div>
      </Card>

      {error ? (
        <ErrorState onRetry={reload} />
      ) : loading || !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-xl lg:col-span-2" />
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader title={t("trends.chartTitle")} description={t("trends.chartDesc", { range: t(`ranges.${range}`) })} />
            <CardBody>
              <TimeSeriesChart
                data={data.series}
                height={280}
                series={Object.keys(data.series[0] ?? {})
                  .filter((k) => k !== "date")
                  .map((k) => ({ key: k, label: t(`categories.${k}`) }))}
              />
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t("trends.trending")} description={t("trends.trendingDesc", { range: t(`ranges.${range}`) })} />
              <ProductRows items={data.trending} />
            </Card>
            <Card>
              <CardHeader title={t("trends.categories")} description={t("trends.categoriesDesc")} />
              <CardBody>
                <BarList
                  items={data.categories
                    .filter((c) => c.growth != null)
                    .map((c) => ({ label: t(`categories.${c.category}`), value: c.growth as number, hint: t("trends.newAdvertisers", { n: c.newAdvertisers }) }))}
                  valueFormat={(n) => f.pct(n, 0, true)}
                />
                {data.categories.some((c) => c.growth == null) && (
                  <p className="mt-3 text-xs text-subtle">
                    {t("trends.categoriesInsufficient", {
                      list: data.categories
                        .filter((c) => c.growth == null)
                        .map((c) => t(`categories.${c.category}`))
                        .join(", "),
                    })}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.categories.slice(0, 3).map((c) => (
                    <WatchButton key={c.category} type="category" refId={c.category} label={t(`categories.${c.category}`)} />
                  ))}
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("trends.emerging")} description={t("trends.emergingDesc")} />
              <ProductRows items={data.emerging} />
            </Card>
            <Card>
              <CardHeader title={t("trends.declining")} description={t("trends.decliningDesc")} />
              <ProductRows items={data.declining} />
            </Card>
          </div>

          <Card>
            <CardHeader title={t("trends.geo")} description={t("trends.geoDesc", { range: t(`ranges.${range}`) })} />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="table-th">{t("filters.country")}</th>
                    <th className="table-th">{t("trends.adsInRange")}</th>
                    <th className="table-th">{t("trends.previous")}</th>
                    <th className="table-th">{t("trends.change")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.countries.map((c) => (
                    <tr key={c.country} className="border-b border-border/50 last:border-0">
                      <td className="table-td">{t(`countries.${c.country}`)}</td>
                      <td className="table-td num">{c.adsInRange}</td>
                      <td className="table-td num">{c.previous}</td>
                      <td className="table-td">
                        <TrendPill pct={c.growth} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex gap-3 text-sm text-muted">
              <Database className="mt-0.5 size-4 shrink-0 text-accent" />
              <div className="space-y-1">
                <p className="font-medium text-fg">{t("trends.sourcesTitle")}</p>
                <p>{t("trends.sourcesText", { sources: data.meta.sources.map((s) => t(`connectors.names.${s}`, { defaultValue: s })).join(", "), date: f.date(data.asOf) })}</p>
                <p className="text-xs text-subtle">{t("trends.insufficientNote", { n: data.insufficient })}</p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default function TrendsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <TrendsInner />
    </Suspense>
  );
}
