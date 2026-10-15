"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calculator, CheckCircle2, ChevronDown, CircleAlert, ExternalLink, ListChecks, Sparkles, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  BasisTag,
  CompetitionBadge,
  ConfidenceBadge,
  KeyValue,
  PageHeader,
  PlatformBadge,
  ProvenanceBadge,
  ScoreBadge,
  ScoreRing,
  SourceLine,
  Thumb,
  TrendPill,
} from "@/components/app/bits";
import { TimeSeriesChart } from "@/components/app/charts";
import { AnalystResult } from "@/components/app/analyst-result";
import { SaveButton, WatchButton } from "@/components/app/save";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { apiFetch, useApi } from "@/lib/client/use-api";
import { errorKey } from "@/lib/client/errors";
import { useFormat } from "@/lib/format";
import { useLocale } from "@/lib/i18n/provider";
import { NORMALIZATION, SCORE_WEIGHTS, type TrendValue } from "@/lib/scoring";
import { RANGE_DAYS, addDays } from "@/lib/dates";
import type { AnalystResponse } from "@/lib/analyst/types";
import type { Advertisement, ProductObservation, ProductWithMetrics, Signal, Store, StoreProduct, TimeRange } from "@/lib/types";
import { cn } from "@/lib/cn";

interface Detail {
  product: ProductWithMetrics;
  observations: ProductObservation[];
  ads: Advertisement[];
  stores: (Store & { listing: StoreProduct })[];
  similar: ProductWithMetrics[];
  trends: Record<TimeRange, TrendValue>;
  meta: { mode: "demo" | "live"; asOf: string };
}

function SignalList({ items, tone }: { items: Signal[]; tone: "good" | "bad" | "step" }) {
  const { t } = useTranslation();
  const f = useFormat();
  const Icon = tone === "good" ? CheckCircle2 : tone === "bad" ? XCircle : ListChecks;
  const color = tone === "good" ? "text-[#3fcf3f]" : tone === "bad" ? "text-[#f07a7a]" : "text-accent";
  if (!items.length) return <p className="text-sm text-subtle">{t("common.none")}</p>;
  return (
    <ul className="space-y-2">
      {items.map((s) => (
        <li key={s.key} className="flex gap-2 text-sm">
          <Icon className={cn("mt-0.5 size-4 shrink-0", color)} />
          <span className="text-muted">{t(s.key, { ...s.params, pct: typeof s.params?.pct === "number" ? f.number(s.params.pct, 0) : s.params?.pct })}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useTranslation();
  const f = useFormat();
  const { locale } = useLocale();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Detail>(`/api/products/${id}`);
  const [range, setRange] = useState<TimeRange>("90d");
  const [showMethod, setShowMethod] = useState(false);
  const [analysis, setAnalysis] = useState<AnalystResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  if (error) return <ErrorState message={error.status === 404 ? t("errors.notFound") : undefined} onRetry={reload} />;
  if (loading || !data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-2/3" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl lg:col-span-2" />
        </div>
      </div>
    );

  const p = data.product;
  const m = p.metrics;
  const s = p.score;
  const kind = p.source.kind;
  const span = Math.max(RANGE_DAYS[range], 14);
  const chartData = data.observations.filter((o) => o.date > addDays(data.meta.asOf, -span)).map((o) => ({ date: o.date, adsActive: o.adsActive, storesObserved: o.storesObserved, searchInterest: o.searchInterest }));

  const analyze = async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      setAnalysis(await apiFetch<AnalystResponse>("/api/ai/analyst", { method: "POST", body: JSON.stringify({ question: t("product.aiQuestion", { name: p.name }), productIds: [p.id], locale }) }));
      toast(t("common.analysisReady"));
    } catch (e) {
      setAnalysisError(t(errorKey(e)));
      toast(t(errorKey(e)), "error");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link href="/app/products" className="focus-ring tap group/back inline-flex items-center gap-1 rounded text-sm text-subtle transition-colors hover:text-fg">
        <ArrowLeft className="size-4 transition-transform group-hover/back:-translate-x-0.5" /> {t("product.back")}
      </Link>
      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{t(`categories.${p.category}`)}</Badge>
            <ProvenanceBadge kind={kind} />
            {p.tags.map((tag) => (
              <Badge key={tag} tone="neutral" className="font-normal">
                #{tag}
              </Badge>
            ))}
          </div>
        }
        title={
          <span className="flex items-center gap-3">
            <Thumb category={p.category} hue={p.hue} src={p.imageUrl} label={p.name} className="size-12 shrink-0" />
            {p.name}
          </span>
        }
        description={p.description}
        actions={
          <>
            <SaveButton type="product" refId={p.id} label={p.name} size="md" />
            <WatchButton type="product" refId={p.id} label={p.name} size="md" />
            <Link
              href={`/app/calculator?price=${p.priceEstimate ?? ""}&productCost=${p.supplierCostEstimate ?? ""}&product=${encodeURIComponent(p.name)}`}
              className={buttonVariants({ variant: "secondary" })}
            >
              <Calculator /> {t("product.openCalculator")}
            </Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Score */}
        <Card>
          <CardHeader title={t("score.title")} description={t("score.subtitle")} action={<ConfidenceBadge level={s.confidence} />} />
          <CardBody className="space-y-5">
            <div className="flex items-center gap-5">
              <ScoreRing score={s.overall} />
              <div className="text-sm text-muted">
                {s.overall == null ? (
                  <div className="space-y-1">
                    <p className="font-medium text-fg">{t("score.insufficientTitle")}</p>
                    {s.insufficientReasons.map((r) => (
                      <p key={r.key} className="text-xs">
                        {t(r.key, r.params)}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p>{t("score.notGuarantee")}</p>
                )}
              </div>
            </div>
            <ul className="space-y-2.5" data-testid="score-components">
              {s.components.map((c) => (
                <li key={c.key}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted">
                      {t(`score.components.${c.key}`)} <span className="text-subtle">· {f.pct(c.weight * 100)}</span> <BasisTag basis={c.basis} />
                    </span>
                    <span className="num text-fg">{c.value == null ? t("score.missing") : c.value}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-3">
                    {c.value != null && <div className="h-1.5 rounded-full bg-accent" style={{ width: `${c.value}%` }} />}
                  </div>
                </li>
              ))}
            </ul>
            <button type="button" className="focus-ring tap flex w-full items-center justify-between rounded text-xs text-accent transition-colors hover:text-accent/80" onClick={() => setShowMethod((v) => !v)} aria-expanded={showMethod}>
              {t("score.methodology")}
              <ChevronDown className={cn("size-4 transition-transform", showMethod && "rotate-180")} />
            </button>
            {showMethod && (
              <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3 text-xs leading-relaxed text-muted">
                <p>{t("score.method.intro")}</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>{t("score.method.trend", { w: SCORE_WEIGHTS.trend * 100, lo: NORMALIZATION.trendGrowthPct[0], hi: NORMALIZATION.trendGrowthPct[1] })}</li>
                  <li>{t("score.method.ads", { w: SCORE_WEIGHTS.ads * 100 })}</li>
                  <li>{t("score.method.margin", { w: SCORE_WEIGHTS.margin * 100, lo: NORMALIZATION.grossMargin[0] * 100, hi: NORMALIZATION.grossMargin[1] * 100 })}</li>
                  <li>{t("score.method.competition", { w: SCORE_WEIGHTS.competition * 100 })}</li>
                  <li>{t("score.method.differentiation", { w: SCORE_WEIGHTS.differentiation * 100 })}</li>
                  <li>{t("score.method.freshness", { w: SCORE_WEIGHTS.freshness * 100 })}</li>
                </ul>
                <p>{t("score.method.missing")}</p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Facts */}
        <Card className="lg:col-span-2">
          <CardHeader title={t("product.facts")} action={<SourceLine connector={p.source.connector} observedAt={p.source.observedAt} />} />
          <CardBody className="grid gap-x-8 sm:grid-cols-2">
            <dl className="divide-y divide-border/60">
              <KeyValue basis="estimate" label={t("product.priceEstimate")} tip={t("provenance.estimateTip")}>
                <span className="num">{f.currency(p.priceEstimate, p.currency)}</span>
              </KeyValue>
              <KeyValue basis="estimate" label={t("product.costEstimate")} tip={t("product.costTip")}>
                <span className="num">{f.currency(p.supplierCostEstimate, p.currency)}</span>
              </KeyValue>
              <KeyValue basis="estimate" label={t("product.marginEstimate")} tip={t("product.marginTip")}>
                <span className="num">{m.grossMargin == null ? t("score.insufficient") : f.pct(m.grossMargin * 100, 1)}</span>
              </KeyValue>
              <KeyValue basis="measured" label={t("product.firstDetected")}>{f.date(p.firstDetected)}</KeyValue>
              <KeyValue basis="measured" label={t("product.lastDetected")}>{f.date(p.lastDetected)}</KeyValue>
              <KeyValue label={t("product.productType")}>{t(`productTypes.${p.productType}`)}</KeyValue>
              <KeyValue label={t("product.shipping")}>
                {p.shipping.verified ? (
                  <span>
                    {t("product.shippingVerified", { warehouse: p.shipping.warehouse, min: p.shipping.deliveryDays?.[0], max: p.shipping.deliveryDays?.[1] })}
                  </span>
                ) : (
                  <span className="text-subtle">{t("product.shippingUnverified")}</span>
                )}
              </KeyValue>
            </dl>
            <dl className="divide-y divide-border/60">
              <KeyValue basis="measured" label={t("product.adsObserved")} tip={t("product.adsObservedTip")}>
                <span className="num">{m.adsObserved}</span>
              </KeyValue>
              <KeyValue basis="measured" label={t("product.adsActive")}>
                <span className="num">{m.adsActive}</span>
              </KeyValue>
              <KeyValue basis="measured" label={t("product.advertisers")}>
                <span className="num">{m.advertisersObserved}</span>
              </KeyValue>
              <KeyValue basis="measured" label={t("product.storesObserved")}>
                <span className="num">{m.storesObserved}</span>
              </KeyValue>
              <KeyValue basis="estimate" label={t("product.competition")} tip={t("product.saturationTip", { n: m.saturation })}>
                <CompetitionBadge level={m.competition} />
              </KeyValue>
              <KeyValue label={t("product.channels")}>
                <span className="flex flex-wrap justify-end gap-2">
                  {p.channels.map((c) => (
                    <PlatformBadge key={c} platform={c} />
                  ))}
                </span>
              </KeyValue>
              <KeyValue label={t("product.countries")}>{p.countries.map((c) => t(`countries.${c}`)).join(", ")}</KeyValue>
            </dl>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("score.positives")} />
          <CardBody>
            <SignalList items={s.positives} tone="good" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("score.negatives")} />
          <CardBody>
            <SignalList items={s.negatives} tone="bad" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("score.nextSteps")} />
          <CardBody>
            <SignalList items={s.nextSteps} tone="step" />
          </CardBody>
        </Card>
      </div>

      {/* History */}
      <Card>
        <CardHeader
          title={t("product.history")}
          description={t("product.historyDesc")}
          action={<Tabs value={range} onChange={setRange} items={(["7d", "30d", "90d"] as TimeRange[]).map((r) => ({ value: r, label: t(`ranges.${r}`) }))} />}
        />
        <CardBody>
          <div className="mb-4 flex flex-wrap gap-4">
            {(["24h", "7d", "30d", "90d"] as TimeRange[]).map((r) => (
              <div key={r} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
                <div className="text-[11px] text-subtle">{t("product.growthVsPrev", { range: t(`ranges.${r}`) })}</div>
                <TrendPill value={data.trends[r]} className="mt-0.5 text-sm" />
              </div>
            ))}
          </div>
          {chartData.length < 2 ? (
            <EmptyState title={t("trend.status.insufficient_history")} description={t("trend.status.insufficient_historyTip")} />
          ) : (
            <TimeSeriesChart
              data={chartData}
              height={260}
              series={[
                { key: "adsActive", label: t("product.series.adsActive") },
                { key: "storesObserved", label: t("product.series.stores") },
                { key: "searchInterest", label: t("product.series.searchInterest") },
              ]}
            />
          )}
          <p className="mt-3 text-[11px] text-subtle">{t("product.historySources", { n: data.observations.length })}</p>
        </CardBody>
      </Card>

      {/* AI analysis */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent-2" /> {t("product.aiTitle")}
            </span>
          }
          description={t("product.aiDesc")}
          action={
            <Button size="sm" onClick={analyze} loading={analyzing} data-testid="product-ai">
              <Sparkles /> {analyzing ? t("common.loading") : analysis ? t("product.aiRegenerate") : t("product.aiGenerate")}
            </Button>
          }
        />
        <CardBody>
          {analysisError ? (
            <p className="flex items-center gap-2 text-sm text-critical">
              <CircleAlert className="size-4" /> {analysisError}
            </p>
          ) : analyzing ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : analysis ? (
            <AnalystResult result={analysis} compact />
          ) : (
            <p className="text-sm text-subtle">{t("product.aiEmpty")}</p>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("product.relatedAds", { n: data.ads.length })} action={<Link href={`/app/ads?productId=${p.id}`} className="focus-ring tap rounded text-xs text-accent underline-offset-4 hover:underline">{t("common.viewAll")}</Link>} />
          {data.ads.length === 0 ? (
            <CardBody>
              <EmptyState title={t("ads.emptyTitle")} />
            </CardBody>
          ) : (
            <ul className="divide-y divide-border/70">
              {data.ads.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <Link href={`/app/creatives?ad=${a.id}`} className="focus-ring flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2 active:bg-surface-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{a.advertiser}</span>
                        <PlatformBadge platform={a.platform} />
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted">{a.copy}</p>
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-subtle">
                      <div>{t(`formats.${a.format}`)}</div>
                      <div>
                        {f.date(a.firstSeen, "short")} → {f.date(a.lastSeen, "short")}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t("product.competitorStores", { n: data.stores.length })} description={t("product.competitorStoresDesc")} />
          {data.stores.length === 0 ? (
            <CardBody>
              <EmptyState title={t("stores.emptyTitle")} />
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/70">
                    <th className="table-th">{t("stores.store")}</th>
                    <th className="table-th">{t("stores.displayedPrice")}</th>
                    <th className="table-th">{t("stores.listedSince")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stores.map((st) => (
                    <tr key={`${st.id}-${st.listing.title}`} className="border-b border-border/50 last:border-0 hover:bg-surface-2">
                      <td className="table-td">
                        <Link href={`/app/stores/${st.id}`} className="hover:text-accent">
                          {st.name}
                        </Link>
                        <div className="text-xs text-subtle">{st.domain}</div>
                      </td>
                      <td className="table-td num">{f.currency(st.listing.price, st.listing.currency)}</td>
                      <td className="table-td text-muted">{f.date(st.listing.firstSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {data.similar.length > 0 && (
        <Card>
          <CardHeader title={t("product.similar")} />
          <ul className="grid divide-y divide-border/70 sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4">
            {data.similar.map((sp) => (
              <li key={sp.id}>
                <Link href={`/app/products/${sp.id}`} className="focus-ring flex items-center gap-3 p-4 transition-colors hover:bg-surface-2 active:bg-surface-3">
                  <Thumb category={sp.category} hue={sp.hue} className="size-10 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{sp.name}</div>
                    <ScoreBadge score={sp.score.overall} className="mt-1" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="flex items-center gap-1 text-[11px] text-subtle">
        <ExternalLink className="size-3" /> {t("product.footerNote")}
      </p>
    </div>
  );
}
