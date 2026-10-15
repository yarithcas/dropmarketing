"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { Info, Radar, Search, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AdCard } from "@/components/app/ad-card";
import { ActiveAdvertisersEmpty, ActiveAdvertisersSwitch } from "@/components/app/active-advertiser";
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
import { DEFAULT_THRESHOLDS, THRESHOLD_LIMITS, type AdvertiserRule, type AdWithActivity } from "@/lib/advertisers";
import { cn } from "@/lib/cn";

interface AdsResponse {
  items: AdWithActivity<Advertisement & { productName: string | null }>[];
  total: number;
  page: number;
  pageSize: number;
  meta: { mode: "demo" | "live"; asOf: string };
  ignoredFilters?: string[];
  advertiserRule?: AdvertiserRule;
}

interface AdvertiserSuggestions {
  items: { name: string; ads: number; active: boolean; activeAds: number; activeSinceMinDays: number }[];
  advertiserRule: AdvertiserRule;
}

/** Threshold field value → URL parameter: empty means the default, anything else is clamped to the allowed range (never a 400). */
function thresholdParam(v: string, limits: { min: number; max: number }): string | null {
  const n = Number.parseInt(v, 10);
  return v.trim() === "" || Number.isNaN(n) ? null : String(Math.min(limits.max, Math.max(limits.min, n)));
}

const KEYS = ["q", "advertiser", "domain", "productId", "platform", "country", "language", "format", "category", "cta", "firstFrom", "firstTo", "lastFrom", "lastTo", "activeOnly", "activeAdvertisers", "minActiveAds", "minActiveDays"];

function AdsInner() {
  const { t } = useTranslation();
  const { session } = useSession();
  const url = useUrlState();
  const [showFilters, setShowFilters] = useState(false);
  const { data, error, loading, reload } = useApi<AdsResponse>(session ? `/api/ads?${url.query}` : null);
  const active = KEYS.filter((k) => url.get(k)).length;
  const set = url.set;
  // Free plan: keyword, category, platform and sort only (enforced server-side too).
  const locked = session ? !session.entitlements.advancedFilters : false;
  // Active advertisers only: ON unless explicitly turned off (every plan). Thresholds come back from the server.
  const activeAdvertisers = url.get("activeAdvertisers") !== "false";
  const rule = data?.advertiserRule ?? { ...DEFAULT_THRESHOLDS, enabled: activeAdvertisers };
  const advertiserQuery = url.get("advertiser").trim();
  const { data: suggestions } = useApi<AdvertiserSuggestions>(session && !locked && advertiserQuery.length >= 2 ? `/api/advertisers?q=${encodeURIComponent(advertiserQuery)}` : null);

  const filters = (
    <div className="space-y-5">
      <FilterGroup label={t("filters.platform")}>
        <ChipSet values={PLATFORMS} active={url.getList("platform")} onToggle={(v) => url.toggle("platform", v)} render={(v) => t(`platforms.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.format")} locked={locked}>
        <ChipSet values={CREATIVE_FORMATS} active={url.getList("format")} onToggle={(v) => url.toggle("format", v)} render={(v) => t(`formats.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.country")} locked={locked}>
        <ChipSet values={COUNTRIES} active={url.getList("country")} onToggle={(v) => url.toggle("country", v)} render={(v) => t(`countries.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.language")} locked={locked}>
        <ChipSet values={LANGUAGES} active={url.getList("language")} onToggle={(v) => url.toggle("language", v)} render={(v) => t(`languages.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.category")}>
        <ChipSet values={CATEGORIES} active={url.getList("category")} onToggle={(v) => url.toggle("category", v)} render={(v) => t(`categories.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.cta")} locked={locked}>
        <ChipSet values={CALLS_TO_ACTION} active={url.getList("cta")} onToggle={(v) => url.toggle("cta", v)} render={(v) => t(`cta.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.firstObserved")} locked={locked}>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={url.get("firstFrom")} onChange={(e) => set({ firstFrom: e.target.value })} aria-label={t("filters.from")} />
          <Input type="date" value={url.get("firstTo")} onChange={(e) => set({ firstTo: e.target.value })} aria-label={t("filters.to")} />
        </div>
      </FilterGroup>
      <FilterGroup label={t("filters.lastObserved")} locked={locked}>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={url.get("lastFrom")} onChange={(e) => set({ lastFrom: e.target.value })} aria-label={t("filters.from")} />
          <Input type="date" value={url.get("lastTo")} onChange={(e) => set({ lastTo: e.target.value })} aria-label={t("filters.to")} />
        </div>
      </FilterGroup>
      <label className={cn("flex items-center gap-2 text-sm text-muted", locked ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:text-fg")} title={locked ? t("billing.advancedFilterLocked") : undefined}>
        <input type="checkbox" className="accent-[rgb(var(--accent))]" disabled={locked} checked={url.get("activeOnly") === "true"} onChange={(e) => set({ activeOnly: e.target.checked ? "true" : null })} />
        {t("filters.activeOnly")}
      </label>
      <FilterGroup label={t("activeAdvertisers.thresholds")} locked={locked}>
        <div className="grid grid-cols-2 gap-2" data-testid="active-advertiser-thresholds">
          <label className="space-y-1 text-[11px] text-subtle">
            <span>{t("activeAdvertisers.minAds")}</span>
            <DebouncedInput
              type="number"
              inputMode="numeric"
              min={THRESHOLD_LIMITS.minAds.min}
              max={THRESHOLD_LIMITS.minAds.max}
              value={url.get("minActiveAds")}
              placeholder={String(DEFAULT_THRESHOLDS.minAds)}
              onCommit={(v) => set({ minActiveAds: thresholdParam(v, THRESHOLD_LIMITS.minAds) })}
              disabled={locked || !activeAdvertisers}
              data-testid="min-active-ads"
            />
          </label>
          <label className="space-y-1 text-[11px] text-subtle">
            <span>{t("activeAdvertisers.minDays")}</span>
            <DebouncedInput
              type="number"
              inputMode="numeric"
              min={THRESHOLD_LIMITS.minDays.min}
              max={THRESHOLD_LIMITS.minDays.max}
              value={url.get("minActiveDays")}
              placeholder={String(DEFAULT_THRESHOLDS.minDays)}
              onCommit={(v) => set({ minActiveDays: thresholdParam(v, THRESHOLD_LIMITS.minDays) })}
              disabled={locked || !activeAdvertisers}
              data-testid="min-active-days"
            />
          </label>
        </div>
      </FilterGroup>
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
            <DebouncedInput value={url.get("advertiser")} onCommit={(advertiser) => set({ advertiser })} placeholder={t("ads.searchAdvertiser")} aria-label={t("ads.searchAdvertiser")} disabled={locked} title={locked ? t("billing.advancedFilterLocked") : undefined} list="advertiser-suggestions" />
            {/* Suggestions rank active advertisers first and flag them. */}
            <datalist id="advertiser-suggestions" data-testid="advertiser-suggestions">
              {(suggestions?.items ?? []).map((s) => (
                <option
                  key={s.name}
                  value={s.name}
                  label={s.active ? t("activeAdvertisers.suggestionActive", { count: s.activeSinceMinDays, days: suggestions?.advertiserRule.minDays }) : t("activeAdvertisers.suggestionInactive", { count: s.ads })}
                />
              ))}
            </datalist>
            <DebouncedInput value={url.get("domain")} onCommit={(domain) => set({ domain })} placeholder={t("ads.searchDomain")} aria-label={t("ads.searchDomain")} disabled={locked} title={locked ? t("billing.advancedFilterLocked") : undefined} />
            <Select value={url.get("sort") || "newest"} onChange={(e) => set({ sort: e.target.value })} aria-label={t("sort.label")} className="sm:w-auto">
              {AD_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.ads.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="secondary" className="mb-4 lg:hidden" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
            <SlidersHorizontal /> {t("filters.title")} {active ? `(${active})` : ""}
          </Button>
          {showFilters && <Card className="mb-4 p-4 lg:hidden">{filters}</Card>}
          {url.get("productId") && (
            <div className="mb-3 text-xs text-muted">
              {t("ads.filteredByProduct")}{" "}
              <button type="button" className="focus-ring tap rounded text-accent underline-offset-4 hover:underline active:text-accent/80" onClick={() => set({ productId: null })}>
                {t("filters.clear")}
              </button>
            </div>
          )}
          {data?.ignoredFilters?.length ? (
            <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-muted" data-testid="ads-filters-ignored">
              {t("billing.filtersIgnored")}{" "}
              <Link href="/app/settings?tab=billing" className="text-accent hover:underline">
                {t("billing.upgrade")}
              </Link>
            </div>
          ) : null}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <ActiveAdvertisersSwitch checked={activeAdvertisers} thresholds={rule} onChange={(on) => set({ activeAdvertisers: on ? null : "false" })} />
            <div className="text-xs text-subtle" aria-live="polite" data-testid="ads-result-count" data-total={data?.total ?? ""}>
              {data ? (data.advertiserRule?.enabled ? t("activeAdvertisers.resultCount", { count: data.total }) : t("ads.resultCount", { count: data.total })) : null}
            </div>
          </div>
          {error ? (
            <ErrorState message={error.code === "limit_reached" ? t("billing.limitReached") : undefined} onRetry={reload} />
          ) : loading && !data ? (
            <CardGridSkeleton />
          ) : data && data.items.length === 0 ? (
            data.advertiserRule?.enabled ? (
              <ActiveAdvertisersEmpty thresholds={data.advertiserRule} onShowAll={() => set({ activeAdvertisers: "false" })} />
            ) : (
              <EmptyState icon={<Radar />} title={t("ads.emptyTitle")} description={t("ads.emptyText")} />
            )
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
