"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { Plus, Search, Swords, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader, PlatformBadge, ProvenanceBadge, ScoreBadge, Thumb, TrendPill } from "@/components/app/bits";
import { TimeSeriesChart } from "@/components/app/charts";
import { DebouncedInput } from "@/components/app/debounced-input";
import { TechBadge } from "@/components/app/tech-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useApi } from "@/lib/client/use-api";
import { useUrlState } from "@/lib/client/use-url-state";
import { useFormat } from "@/lib/format";
import type { Platform, ProductWithMetrics, Store, StoreSnapshot } from "@/lib/types";

interface CompareResponse {
  meta: { mode: "demo" | "live" };
  stores: {
    store: Store;
    listingCount: number;
    trackedProducts: number;
    priceMin: number | null;
    priceMax: number | null;
    priceMedian: number | null;
    adsObserved: number;
    activeAds: number;
    platforms: Platform[];
    listingGrowth: number | null;
    snapshots: StoreSnapshot[];
    topProducts: { id: string; name: string; score: number | null }[];
  }[];
}

function StorePicker({ selected, onAdd }: { selected: string[]; onAdd: (id: string) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const { data } = useApi<{ items: Store[] }>(`/api/stores?pageSize=8${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <DebouncedInput value={q} onCommit={setQ} placeholder={t("competitors.searchStores")} className="pl-9" aria-label={t("competitors.searchStores")} />
      </div>
      <ul className="max-h-64 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border">
        {(data?.items ?? []).map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate">{s.name}</span>
              <span className="text-xs text-subtle">{s.domain}</span>
            </span>
            <button
              className="focus-ring inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-fg disabled:opacity-40"
              disabled={selected.includes(s.id) || selected.length >= 5}
              onClick={() => onAdd(s.id)}
              data-testid="add-store"
            >
              <Plus className="size-3" /> {t("competitors.add")}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-subtle">{t("competitors.max", { n: selected.length })}</p>
    </div>
  );
}

function ProductCompetitors() {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const { data } = useApi<{ items: ProductWithMetrics[] }>(q.length >= 2 ? `/api/products?pageSize=6&q=${encodeURIComponent(q)}` : null);
  const items = data?.items ?? [];
  return (
    <Card>
      <CardHeader title={t("competitors.byProduct")} description={t("competitors.byProductDesc")} />
      <CardBody className="space-y-3">
        <DebouncedInput value={q} onCommit={setQ} placeholder={t("products.searchPlaceholder")} aria-label={t("products.searchPlaceholder")} />
        <ul className="divide-y divide-border/60">
          {items.map((p) => (
            <li key={p.id}>
              <Link href={`/app/products/${p.id}`} className="flex items-center gap-3 py-2 text-sm hover:text-accent">
                <Thumb category={p.category} hue={p.hue} className="size-8" />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-xs text-subtle">{t("competitors.storesSelling", { n: p.metrics.storesObserved })}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function CompetitorsInner() {
  const { t } = useTranslation();
  const f = useFormat();
  const url = useUrlState();
  const ids = url.getList("ids").slice(0, 5);
  const { data, error, loading, reload } = useApi<CompareResponse>(ids.length ? `/api/stores/compare?ids=${ids.join(",")}` : null);
  const setIds = (next: string[]) => url.set({ ids: next });

  const dates = Array.from(new Set((data?.stores ?? []).flatMap((s) => s.snapshots.map((x) => x.date)))).sort();
  const chart = dates.map((date) => {
    const row: Record<string, string | number | null> = { date };
    for (const s of data?.stores ?? []) {
      const snap = [...s.snapshots].reverse().find((x) => x.date <= date);
      row[s.store.id] = snap?.productCount ?? null;
    }
    return row;
  });

  const rows: { label: string; render: (s: CompareResponse["stores"][number]) => React.ReactNode }[] = [
    { label: t("stores.domain"), render: (s) => <span className="text-xs">{s.store.domain}</span> },
    { label: t("stores.technology"), render: (s) => <TechBadge tech={s.store.technology} /> },
    { label: t("filters.country"), render: (s) => (s.store.country ? t(`countries.${s.store.country}`) : t("common.unknown")) },
    { label: t("filters.category"), render: (s) => s.store.categories.map((c) => t(`categories.${c}`)).join(", ") },
    { label: t("stores.publicListings"), render: (s) => <span className="num">{s.listingCount}</span> },
    { label: t("competitors.listingGrowth"), render: (s) => <TrendPill pct={s.listingGrowth} /> },
    { label: t("competitors.trackedProducts"), render: (s) => <span className="num">{s.trackedProducts}</span> },
    { label: t("competitors.priceRange"), render: (s) => <span className="num text-xs">{s.priceMin == null ? "—" : `${f.currency(s.priceMin, s.store.currency)} – ${f.currency(s.priceMax, s.store.currency)}`}</span> },
    { label: t("competitors.medianPrice"), render: (s) => <span className="num">{f.currency(s.priceMedian, s.store.currency)}</span> },
    { label: t("stores.adsObserved"), render: (s) => <span className="num">{s.adsObserved}</span> },
    { label: t("competitors.platforms"), render: (s) => <span className="flex flex-wrap gap-2">{s.platforms.length ? s.platforms.map((p) => <PlatformBadge key={p} platform={p} />) : "—"}</span> },
    { label: t("stores.firstObserved"), render: (s) => f.date(s.store.firstSeen) },
    {
      label: t("competitors.topProducts"),
      render: (s) => (
        <ul className="space-y-1">
          {s.topProducts.map((p) => (
            <li key={p.id}>
              <Link href={`/app/products/${p.id}`} className="flex items-center gap-1.5 text-xs hover:text-accent">
                <ScoreBadge score={p.score} /> <span className="max-w-[150px] truncate">{p.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ),
    },
    { label: t("competitors.revenue"), render: () => <span className="text-xs text-subtle">{t("competitors.notEstimated")}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("competitors.title")} description={t("competitors.subtitle")} eyebrow={data ? <ProvenanceBadge kind={data.meta.mode === "demo" ? "demo" : "measured"} /> : null} />
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("competitors.selectStores")} />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {ids.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs">
                    {data?.stores.find((s) => s.store.id === id)?.store.name ?? id}
                    <button onClick={() => setIds(ids.filter((x) => x !== id))} aria-label={t("common.remove")} className="text-subtle hover:text-fg">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <StorePicker selected={ids} onAdd={(id) => setIds([...ids, id])} />
            </CardBody>
          </Card>
          <ProductCompetitors />
        </div>
        <div className="min-w-0 space-y-4">
          {!ids.length ? (
            <EmptyState icon={<Swords />} title={t("competitors.emptyTitle")} description={t("competitors.emptyText")} />
          ) : error ? (
            <ErrorState onRetry={reload} />
          ) : loading || !data ? (
            <Card>
              <TableSkeleton rows={8} />
            </Card>
          ) : (
            <>
              <Card className="overflow-x-auto" data-testid="comparison-table">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="table-th w-44" />
                      {data.stores.map((s) => (
                        <th key={s.store.id} className="table-th normal-case tracking-normal">
                          <Link href={`/app/stores/${s.store.id}`} className="text-sm font-semibold text-fg hover:text-accent">
                            {s.store.name}
                          </Link>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.label} className="border-b border-border/50 align-top last:border-0">
                        <td className="table-td text-xs text-subtle">{r.label}</td>
                        {data.stores.map((s) => (
                          <td key={s.store.id} className="table-td whitespace-normal">
                            {r.render(s)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <Card>
                <CardHeader title={t("competitors.listingHistory")} description={t("competitors.listingHistoryDesc")} />
                <CardBody>
                  {chart.length < 2 ? <Skeleton className="h-10" /> : <TimeSeriesChart data={chart} series={data.stores.map((s) => ({ key: s.store.id, label: s.store.name }))} height={240} />}
                </CardBody>
              </Card>
              <p className="text-[11px] text-subtle">{t("competitors.disclaimer")}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CompetitorsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <CompetitorsInner />
    </Suspense>
  );
}
