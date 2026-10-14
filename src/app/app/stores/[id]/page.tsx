"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Info, Swords } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AdCard } from "@/components/app/ad-card";
import { KeyValue, PageHeader, ProvenanceBadge, ScoreBadge, SourceLine, Thumb } from "@/components/app/bits";
import { TimeSeriesChart } from "@/components/app/charts";
import { SaveButton, WatchButton } from "@/components/app/save";
import { TechBadge } from "@/components/app/tech-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useApi } from "@/lib/client/use-api";
import { useFormat } from "@/lib/format";
import type { Advertisement, ProductWithMetrics, Store, StoreProduct, StoreSnapshot } from "@/lib/types";

interface StoreDetail {
  store: Store;
  listings: StoreProduct[];
  snapshots: StoreSnapshot[];
  ads: Advertisement[];
  products: ProductWithMetrics[];
}

export default function StoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useTranslation();
  const f = useFormat();
  const { data, error, loading, reload } = useApi<StoreDetail>(`/api/stores/${id}`);
  if (error) return <ErrorState message={error.status === 404 ? t("errors.notFound") : undefined} onRetry={reload} />;
  if (loading || !data) return <Skeleton className="h-96 rounded-xl" />;
  const s = data.store;
  const names = new Map(data.products.map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <Link href="/app/stores" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-fg">
        <ArrowLeft className="size-4" /> {t("stores.back")}
      </Link>
      <PageHeader
        eyebrow={
          <div className="flex flex-wrap gap-2">
            <ProvenanceBadge kind={s.source.kind} />
            {s.categories.map((c) => (
              <Badge key={c}>{t(`categories.${c}`)}</Badge>
            ))}
          </div>
        }
        title={
          <span className="flex items-center gap-3">
            <Thumb category={s.categories[0]} hue={s.hue} className="size-12" />
            {s.name}
          </span>
        }
        description={s.description}
        actions={
          <>
            <SaveButton type="store" refId={s.id} label={s.name} size="md" />
            <WatchButton type="store" refId={s.id} label={s.name} size="md" />
            <Link href={`/app/competitors?ids=${s.id}`} className={buttonVariants({ variant: "secondary" })}>
              <Swords /> {t("stores.compare")}
            </Link>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("stores.profile")} action={<SourceLine connector={s.source.connector} observedAt={s.source.observedAt} />} />
          <CardBody>
            <dl className="divide-y divide-border/60">
              <KeyValue label={t("stores.domain")}>{s.domain}</KeyValue>
              <KeyValue label={t("stores.currency")}>{s.currency}</KeyValue>
              <KeyValue label={t("stores.productCount")} tip={t("stores.productCountTip")}>
                {s.productCount ?? t("stores.unknown")}
              </KeyValue>
              <KeyValue label={t("stores.technology")}>
                <TechBadge tech={s.technology} />
              </KeyValue>
              <KeyValue label={t("filters.country")}>{t(`countries.${s.country}`)}</KeyValue>
              <KeyValue label={t("stores.firstObserved")}>{f.date(s.firstSeen)}</KeyValue>
              <KeyValue label={t("stores.socials")}>
                <span className="flex flex-wrap justify-end gap-2">
                  {s.socials.map((so) => (
                    <span key={so.network} className="inline-flex items-center gap-1 text-xs text-muted" title={so.url}>
                      <ExternalLink className="size-3" /> {t(`stores.networks.${so.network}`)}
                    </span>
                  ))}
                </span>
              </KeyValue>
            </dl>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t("stores.snapshots")} description={t("stores.snapshotsDesc")} />
          <CardBody>
            {data.snapshots.length < 2 ? (
              <EmptyState title={t("trend.status.insufficient_history")} />
            ) : (
              <TimeSeriesChart data={data.snapshots.map((x) => ({ date: x.date, productCount: x.productCount }))} series={[{ key: "productCount", label: t("stores.publicListings") }]} height={220} />
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="border-accent/20 p-4">
        <div className="flex gap-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" />
          <div>
            <p className="font-medium">{t("stores.revenueTitle")}</p>
            <p className="mt-1 text-muted">{t("stores.revenueText")}</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("stores.listingsTitle", { n: data.listings.length })} description={t("stores.listingsDesc")} />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="table-th">{t("stores.listing")}</th>
                <th className="table-th">{t("stores.displayedPrice")}</th>
                <th className="table-th">{t("stores.listedSince")}</th>
                <th className="table-th">{t("stores.trackedProduct")}</th>
              </tr>
            </thead>
            <tbody>
              {data.listings.map((l, i) => {
                const p = l.productId ? names.get(l.productId) : undefined;
                return (
                  <tr key={`${l.title}-${i}`} className="border-b border-border/50 last:border-0">
                    <td className="table-td">{l.title}</td>
                    <td className="table-td num">{f.currency(l.price, l.currency)}</td>
                    <td className="table-td text-muted">{f.date(l.firstSeen)}</td>
                    <td className="table-td">
                      {p ? (
                        <Link href={`/app/products/${p.id}`} className="flex items-center gap-2 hover:text-accent">
                          <ScoreBadge score={p.score.overall} /> <span className="max-w-[200px] truncate text-xs">{p.name}</span>
                        </Link>
                      ) : (
                        <span className="text-xs text-subtle">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold">{t("stores.associatedAds", { n: data.ads.length })}</h2>
        {data.ads.length === 0 ? (
          <EmptyState title={t("ads.emptyTitle")} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.ads.slice(0, 8).map((a) => (
              <AdCard key={a.id} ad={a} productName={a.productId ? names.get(a.productId)?.name : null} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
