"use client";

import { Suspense, useState } from "react";
import { Info, Radar, Search, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AdCard } from "@/components/app/ad-card";
import { DebouncedInput } from "@/components/app/debounced-input";
import { PageHeader, Pagination, ProvenanceBadge } from "@/components/app/bits";
import { ChipSet, FilterGroup, ResetFilters } from "@/components/app/filters";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { CardGridSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/use-api";
import { useUrlState } from "@/lib/client/use-url-state";
import { AD_SORTS } from "@/lib/queries";
import { CALLS_TO_ACTION, CATEGORIES, COUNTRIES, CREATIVE_FORMATS, LANGUAGES, PLATFORMS, type Advertisement } from "@/lib/types";
import { cn } from "@/lib/cn";

interface AdsResponse {
  items: (Advertisement & { productName: string | null })[];
  total: number;
  page: number;
  pageSize: number;
  meta: { mode: "demo" | "live"; asOf: string };
}

const KEYS = ["q", "advertiser", "domain", "productId", "platform", "country", "language", "format", "category", "cta", "firstFrom", "firstTo", "lastFrom", "lastTo", "activeOnly"];

function AdsInner() {
  const { t } = useTranslation();
  const { session } = useSession();
  const url = useUrlState();
  const [showFilters, setShowFilters] = useState(false);
  const { data, error, loading, reload } = useApi<AdsResponse>(session ? `/api/ads?${url.query}` : null);
  const active = KEYS.filter((k) => url.get(k)).length;
  const set = url.set;

  const filters = (
    <div className="space-y-5">
      <FilterGroup label={t("filters.platform")}>
        <ChipSet values={PLATFORMS} active={url.getList("platform")} onToggle={(v) => url.toggle("platform", v)} render={(v) => t(`platforms.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.format")}>
        <ChipSet values={CREATIVE_FORMATS} active={url.getList("format")} onToggle={(v) => url.toggle("format", v)} render={(v) => t(`formats.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.country")}>
        <ChipSet values={COUNTRIES} active={url.getList("country")} onToggle={(v) => url.toggle("country", v)} render={(v) => t(`countries.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.language")}>
        <ChipSet values={LANGUAGES} active={url.getList("language")} onToggle={(v) => url.toggle("language", v)} render={(v) => t(`languages.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.category")}>
        <ChipSet values={CATEGORIES} active={url.getList("category")} onToggle={(v) => url.toggle("category", v)} render={(v) => t(`categories.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.cta")}>
        <ChipSet values={CALLS_TO_ACTION} active={url.getList("cta")} onToggle={(v) => url.toggle("cta", v)} render={(v) => t(`cta.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.firstObserved")}>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={url.get("firstFrom")} onChange={(e) => set({ firstFrom: e.target.value })} aria-label={t("filters.from")} />
          <Input type="date" value={url.get("firstTo")} onChange={(e) => set({ firstTo: e.target.value })} aria-label={t("filters.to")} />
        </div>
      </FilterGroup>
      <FilterGroup label={t("filters.lastObserved")}>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={url.get("lastFrom")} onChange={(e) => set({ lastFrom: e.target.value })} aria-label={t("filters.from")} />
          <Input type="date" value={url.get("lastTo")} onChange={(e) => set({ lastTo: e.target.value })} aria-label={t("filters.to")} />
        </div>
      </FilterGroup>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" className="accent-[rgb(var(--accent))]" checked={url.get("activeOnly") === "true"} onChange={(e) => set({ activeOnly: e.target.checked ? "true" : null })} />
        {t("filters.activeOnly")}
      </label>
    </div>
  );

  return (
    <div>
      <PageHeader title={t("ads.title")} description={t("ads.subtitle")} eyebrow={data ? <ProvenanceBadge kind={data.meta.mode === "demo" ? "demo" : "measured"} /> : null} />
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0 text-accent" />
        <span>{t("ads.metricsNotice")}</span>
      </div>
      <div className="flex gap-6">
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-4 overflow-y-auto pb-6 pr-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{t("filters.title")}</span>
              <ResetFilters count={active} onReset={() => set(Object.fromEntries(KEYS.map((k) => [k, null])))} />
            </div>
            {filters}
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_180px_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <DebouncedInput value={url.get("q")} onCommit={(q) => set({ q })} placeholder={t("ads.searchKeyword")} className="pl-9" aria-label={t("ads.searchKeyword")} data-testid="ads-search" />
            </div>
            <DebouncedInput value={url.get("advertiser")} onCommit={(advertiser) => set({ advertiser })} placeholder={t("ads.searchAdvertiser")} aria-label={t("ads.searchAdvertiser")} />
            <DebouncedInput value={url.get("domain")} onCommit={(domain) => set({ domain })} placeholder={t("ads.searchDomain")} aria-label={t("ads.searchDomain")} />
            <Select value={url.get("sort") || "newest"} onChange={(e) => set({ sort: e.target.value })} aria-label={t("sort.label")} className="sm:w-auto">
              {AD_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.ads.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="secondary" className="mb-4 lg:hidden" onClick={() => setShowFilters((s) => !s)}>
            <SlidersHorizontal /> {t("filters.title")} {active ? `(${active})` : ""}
          </Button>
          {showFilters && <Card className="mb-4 p-4 lg:hidden">{filters}</Card>}
          {url.get("productId") && (
            <div className="mb-3 text-xs text-muted">
              {t("ads.filteredByProduct")}{" "}
              <button className="text-accent hover:underline" onClick={() => set({ productId: null })}>
                {t("filters.clear")}
              </button>
            </div>
          )}
          <div className="mb-3 text-xs text-subtle" aria-live="polite">
            {data ? t("ads.resultCount", { count: data.total }) : " "}
          </div>
          {error ? (
            <ErrorState message={error.code === "limit_reached" ? t("billing.limitReached") : undefined} onRetry={reload} />
          ) : loading && !data ? (
            <CardGridSkeleton />
          ) : data && data.items.length === 0 ? (
            <EmptyState icon={<Radar />} title={t("ads.emptyTitle")} description={t("ads.emptyText")} />
          ) : data ? (
            <div className={cn(loading && "opacity-60")}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {data.items.map((a) => (
                  <AdCard key={a.id} ad={a} productName={a.productName} />
                ))}
              </div>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => set({ page: String(page) }, { resetPage: false })} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function AdsPage() {
  return (
    <Suspense fallback={<CardGridSkeleton />}>
      <AdsInner />
    </Suspense>
  );
}
