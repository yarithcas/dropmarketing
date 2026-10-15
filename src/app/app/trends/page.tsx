"use client";

import { Suspense } from "react";
import Link from "next/link";
import { Database, Minus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CATEGORY_ICON, PageHeader, ProvenanceBadge, ScoreBadge, Thumb, TrendPill } from "@/components/app/bits";
import { BarList, TimeSeriesChart } from "@/components/app/charts";
import { ChipSet } from "@/components/app/filters";
import { WatchButton } from "@/components/app/save";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { useApi } from "@/lib/client/use-api";
import { useUrlState } from "@/lib/client/use-url-state";
import { useFormat } from "@/lib/format";
import type { TrendValue } from "@/lib/scoring";
import { EMERGENCE, MIN_AGGREGATE, type DiscoverySeries, type EntrySources, type Growth, type NicheEmergence, type Sample, type SearchTrend, type SignalCoverage, type SignalStatus } from "@/lib/trends";
import { CATEGORIES, COUNTRIES, TIME_RANGES, type Category, type Country, type ProductWithMetrics, type TimeRange } from "@/lib/types";

type Sourced<T> = T & { sources: EntrySources };
type Samples = { current: Sample; previous: Sample };
type CategoryRow = Sourced<{ category: Category; adsActive: number; products: number; newAdvertisers: number; sample: Samples } & Growth>;
type TrendRow = Sourced<ProductWithMetrics & { trend?: TrendValue; search?: SearchTrend | null }>;

interface TrendsResponse {
  range: TimeRange;
  asOf: string;
  coverageStart: string | null;
  trending: TrendRow[];
  declining: TrendRow[];
  emerging: TrendRow[];
  categories: CategoryRow[];
  countries: Sourced<{ country: Country; adsInRange: number; previous: number; sample: Samples } & Growth>[];
  series: Record<string, string | number>[];
  insufficient: number;
  niches: NicheEmergence[];
  nichesInsufficient: number;
  discovery: DiscoverySeries;
  searchInterest: { products: number; connectors: string[] };
  signals: SignalCoverage[];
  meta: { mode: "demo" | "live"; asOf: string; sources: string[] };
}

const connectorName = (t: (k: string, o?: Record<string, unknown>) => string, id: string) => t(`connectors.names.${id}`, { defaultValue: id });

/** Compact provenance of one entry: connectors behind it and the latest observation date. */
function SourcesLine({ sources }: { sources: EntrySources }) {
  const { t } = useTranslation();
  const f = useFormat();
  if (!sources.connectors.length) return <span className="text-[11px] text-subtle">{t("trends.noSourceRecords")}</span>;
  return (
    <Tooltip content={t("trends.entrySourcesTip", { kinds: sources.kinds.map((k) => t(`provenance.${k}`)).join(", ") })}>
      <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-subtle" data-testid="entry-sources">
        <Database className="size-3 shrink-0" />
        <span className="truncate">{t("trends.entrySources", { sources: sources.connectors.map((c) => connectorName(t, c)).join(", "), date: f.date(sources.lastObserved) })}</span>
      </span>
    </Tooltip>
  );
}

/** Growth percentage, or the reason it is withheld (minimum sample, history, activity). */
function GrowthPill({ g, className }: { g: Growth; className?: string }) {
  const { t } = useTranslation();
  if (g.growth != null) return <TrendPill pct={g.growth} className={className} />;
  const status = g.status === "ok" ? "insufficient_data" : g.status;
  return (
    <Tooltip content={t(`trend.status.${status}Tip`, { ads: MIN_AGGREGATE.ads, products: MIN_AGGREGATE.products })}>
      <span className={`inline-flex items-center gap-1 text-xs text-subtle ${className ?? ""}`}>
        <Minus className="size-3" />
        {t(`trend.status.${status}`)}
      </span>
    </Tooltip>
  );
}

function SearchPill({ search, range }: { search: SearchTrend; range: TimeRange }) {
  const { t } = useTranslation();
  const f = useFormat();
  return (
    <Tooltip content={t("trends.searchTip", { range: t(`ranges.${range}`), latest: f.number(search.latest) })}>
      <span className="num inline-flex items-center gap-1 text-[11px] text-muted" data-testid="search-interest">
        <Search className="size-3" />
        {search.pct != null ? f.pct(search.pct, Math.abs(search.pct) < 10 ? 1 : 0, true) : t(`trend.status.${search.status}`)}
      </span>
    </Tooltip>
  );
}

function ProductRows({ items, range }: { items: TrendRow[]; range: TimeRange }) {
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
              <SourcesLine sources={p.sources} />
            </div>
          </Link>
          <ScoreBadge score={p.score.overall} className="hidden sm:inline-flex" />
          {p.trend ? (
            <div className="flex w-24 shrink-0 flex-col items-end gap-0.5">
              <TrendPill value={p.trend} className="justify-end" />
              {p.search ? <SearchPill search={p.search} range={range} /> : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function NicheRows({ items, insufficient }: { items: NicheEmergence[]; insufficient: number }) {
  const { t } = useTranslation();
  const note = insufficient > 0 ? t("trends.nichesInsufficient", { n: insufficient, ads: MIN_AGGREGATE.ads, products: MIN_AGGREGATE.products }) : undefined;
  if (!items.length) return <EmptyState className="m-4" title={t("trends.nichesNone")} description={note} />;
  return (
    <>
      <ul className="divide-y divide-border/70" data-testid="emerging-niches">
        {items.map((n) => {
          const Icon = CATEGORY_ICON[n.category];
          const label = n.kind === "category" ? t(`categories.${n.value}`) : `#${n.value}`;
          const href = n.kind === "category" ? `/app/products?category=${n.value}` : `/app/products?q=${encodeURIComponent(n.value)}`;
          return (
            <li key={`${n.kind}-${n.value}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
              <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-muted">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm hover:text-accent">{label}</span>
                    <Badge>{t(`trends.nicheKinds.${n.kind}`)}</Badge>
                  </div>
                  <div className="text-xs text-subtle">
                    {t("trends.nicheStats", {
                      products: n.newProducts.current,
                      prevProducts: n.newProducts.previous,
                      advertisers: n.newAdvertisers.current,
                      prevAdvertisers: n.newAdvertisers.previous,
                    })}
                  </div>
                  <SourcesLine sources={n.sources} />
                </div>
              </Link>
              <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                <GrowthPill g={n.activeAds} />
                <span className="num text-[11px] text-subtle">{t("trends.nicheAds", { previous: n.activeAds.previous, current: n.activeAds.current })}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {note ? <p className="border-t border-border/70 px-4 py-2 text-[11px] text-subtle">{note}</p> : null}
    </>
  );
}

/** Categories whose growth is withheld, with the reason and the sample behind the previous window. */
function WithheldCategories({ items }: { items: CategoryRow[] }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <div className="mt-4" data-testid="categories-withheld">
      <div className="label mb-1.5">{t("trends.categoriesWithheld")}</div>
      <ul className="divide-y divide-border/60 rounded-lg border border-border">
        {items.map((c) => (
          <li key={c.category} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2">
            <span className="text-sm">{t(`categories.${c.category}`)}</span>
            <GrowthPill g={c} />
            <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-subtle">
              <span className="num">{t("trends.previousSample", { ads: c.sample.previous.ads, products: c.sample.previous.products })}</span>
              <SourcesLine sources={c.sources} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATUS_TONE: Record<SignalStatus, "good" | "warn" | "demo" | "neutral"> = { connected: "good", configured: "warn", demo: "demo", not_connected: "neutral" };

function SignalCoverageTable({ signals }: { signals: SignalCoverage[] }) {
  const { t } = useTranslation();
  const f = useFormat();
  return (
    <div className="overflow-x-auto">
      <table className="w-full" data-testid="signal-coverage">
        <thead>
          <tr className="border-b border-border">
            <th className="table-th">{t("trends.signalCol")}</th>
            <th className="table-th">{t("trends.statusCol")}</th>
            <th className="table-th">{t("trends.sourcesCol")}</th>
            <th className="table-th">{t("trends.lastObservedCol")}</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((s) => (
            <tr key={s.key} className="border-b border-border/50 align-top last:border-0">
              <td className="table-td">
                <div className="text-sm">{t(`trends.signals.${s.key}.name`)}</div>
                <div className="max-w-sm text-xs text-subtle">{t(`trends.signals.${s.key}.desc`)}</div>
              </td>
              <td className="table-td">
                <Badge tone={STATUS_TONE[s.status]}>{t(`trends.signalStatus.${s.status}`)}</Badge>
              </td>
              <td className="table-td text-xs text-muted">
                {s.sources.connectors.length ? (
                  s.sources.connectors.map((c) => connectorName(t, c)).join(", ")
                ) : s.providers.length ? (
                  t("trends.signalProviders", { list: s.providers.map((c) => connectorName(t, c)).join(", ") })
                ) : (
                  <span className="text-subtle">{t("trends.signalNoConnector")}</span>
                )}
              </td>
              <td className="table-td num text-xs text-muted">{f.date(s.sources.lastObserved)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendsInner() {
  const { t } = useTranslation();
  const f = useFormat();
  const url = useUrlState();
  const range = (url.get("range") || "30d") as TimeRange;
  const { data, error, loading, reload } = useApi<TrendsResponse>(`/api/trends?${url.query}`);
  const rangeLabel = t(`ranges.${range}`);
  const searchSignal = data?.signals.find((s) => s.key === "search_interest");

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
            <CardHeader title={t("trends.chartTitle")} description={t("trends.chartDesc", { range: rangeLabel })} />
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
              <CardHeader title={t("trends.trending")} description={t("trends.trendingDesc", { range: rangeLabel })} />
              <ProductRows items={data.trending} range={range} />
              <p className="border-t border-border/70 px-4 py-2 text-[11px] text-subtle" data-testid="search-interest-note">
                {data.searchInterest.products > 0
                  ? t("trends.searchLegend", { sources: data.searchInterest.connectors.map((c) => connectorName(t, c)).join(", ") })
                  : searchSignal?.status === "configured"
                    ? t("trends.searchConfigured")
                    : t("trends.searchNotConnected")}
              </p>
            </Card>
            <Card>
              <CardHeader title={t("trends.categories")} description={t("trends.categoriesDesc", { ads: MIN_AGGREGATE.ads, products: MIN_AGGREGATE.products })} />
              <CardBody>
                <BarList
                  items={data.categories
                    .filter((c) => c.growth != null)
                    .map((c) => ({
                      label: t(`categories.${c.category}`),
                      value: c.growth as number,
                      hint: t("trends.newAdvertisers", { n: c.newAdvertisers }),
                      detail: <SourcesLine sources={c.sources} />,
                    }))}
                  valueFormat={(n) => f.pct(n, 0, true)}
                />
                {data.categories.every((c) => c.growth == null) ? <p className="text-xs text-subtle">{t("trends.categoriesNoneMeasured")}</p> : null}
                <WithheldCategories items={data.categories.filter((c) => c.growth == null)} />
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.categories.slice(0, 3).map((c) => (
                    <WatchButton key={c.category} type="category" refId={c.category} label={t(`categories.${c.category}`)} />
                  ))}
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title={t("trends.emerging")}
                description={
                  <>
                    {t("trends.emergingDesc", { range: rangeLabel })}{" "}
                    <span className="text-subtle">{t("trends.emergingRule", { entrants: EMERGENCE.minEntrants, growth: EMERGENCE.minGrowthPct, ads: MIN_AGGREGATE.ads, products: MIN_AGGREGATE.products })}</span>
                  </>
                }
              />
              <NicheRows items={data.niches} insufficient={data.nichesInsufficient} />
            </Card>
            <Card>
              <CardHeader title={t("trends.declining")} description={t("trends.decliningDesc")} />
              <ProductRows items={data.declining} range={range} />
            </Card>
          </div>

          <Card>
            <CardHeader title={t("trends.discoveryTitle")} description={t("trends.discoveryDesc")} />
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
              <CardBody className="min-w-0">
                {data.discovery.rows.some((r) => (r.total ?? 0) > 0) ? (
                  <>
                    <TimeSeriesChart
                      data={data.discovery.rows}
                      height={240}
                      series={[{ key: "total", label: t("trends.discoveryTotal") }, ...data.discovery.top.map((c) => ({ key: c, label: t(`categories.${c}`) }))]}
                    />
                    <p className="mt-3 text-xs text-subtle">
                      {t("trends.discoveryByCategory", {
                        list: data.discovery.byCategory.map((c) => `${t(`categories.${c.category}`)} ${f.number(c.count)}`).join(" · "),
                      })}
                    </p>
                    {data.discovery.rows.some((r) => r.total == null) && data.coverageStart ? (
                      <p className="mt-1 text-[11px] text-subtle">{t("trends.discoveryGap", { date: f.date(data.coverageStart) })}</p>
                    ) : null}
                  </>
                ) : (
                  <EmptyState title={t("trends.discoveryNone")} />
                )}
              </CardBody>
              <div className="border-t border-border/70 lg:border-l lg:border-t-0">
                <div className="px-4 pb-1 pt-3">
                  <div className="text-sm font-medium">{t("trends.newProducts")}</div>
                  <div className="text-xs text-subtle">{t("trends.newProductsDesc", { range: rangeLabel })}</div>
                </div>
                <ProductRows items={data.emerging} range={range} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title={t("trends.geo")} description={`${t("trends.geoDesc", { range: rangeLabel })} ${t("trends.geoRule", { ads: MIN_AGGREGATE.ads, products: MIN_AGGREGATE.products })}`} />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="table-th">{t("filters.country")}</th>
                    <th className="table-th">{t("trends.adsInRange")}</th>
                    <th className="table-th">{t("trends.previous")}</th>
                    <th className="table-th">{t("trends.change")}</th>
                    <th className="table-th">{t("trends.sourcesCol")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.countries.map((c) => (
                    <tr key={c.country} className="border-b border-border/50 last:border-0">
                      <td className="table-td">{t(`countries.${c.country}`)}</td>
                      <td className="table-td num">{c.adsInRange}</td>
                      <td className="table-td num">{c.previous}</td>
                      <td className="table-td">
                        <GrowthPill g={c} />
                      </td>
                      <td className="table-td">
                        <SourcesLine sources={c.sources} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title={t("trends.signalsTitle")} description={t("trends.signalsDesc")} />
            <SignalCoverageTable signals={data.signals} />
          </Card>

          <Card className="p-4">
            <div className="flex gap-3 text-sm text-muted">
              <Database className="mt-0.5 size-4 shrink-0 text-accent" />
              <div className="space-y-1">
                <p className="font-medium text-fg">{t("trends.sourcesTitle")}</p>
                <p>{t("trends.sourcesText", { sources: data.meta.sources.map((s) => connectorName(t, s)).join(", "), date: f.date(data.asOf) })}</p>
                <p className="text-xs text-subtle">{t("trends.insufficientNote", { n: data.insufficient })}</p>
                <p className="text-xs text-subtle" data-testid="aggregate-insufficient-note">
                  {t("trends.aggregateNote", {
                    date: f.date(data.coverageStart),
                    ads: MIN_AGGREGATE.ads,
                    products: MIN_AGGREGATE.products,
                    categories: data.categories.filter((c) => c.growth == null).length,
                    countries: data.countries.filter((c) => c.growth == null).length,
                  })}
                </p>
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
