"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Calculator, LayoutGrid, List, PackageSearch, Search, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CompetitionBadge, PageHeader, Pagination, ProvenanceBadge, ScoreBadge, Thumb, TrendPill } from "@/components/app/bits";
import { ChipSet, FilterGroup, ResetFilters } from "@/components/app/filters";
import { ProductCard } from "@/components/app/product-card";
import { SaveButton } from "@/components/app/save";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { CardGridSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/use-api";
import { useUrlState } from "@/lib/client/use-url-state";
import { useFormat } from "@/lib/format";
import { PRODUCT_SORTS } from "@/lib/queries";
import { CATEGORIES, COUNTRIES, PLATFORMS, type ProductWithMetrics } from "@/lib/types";
import { cn } from "@/lib/cn";

interface ProductsResponse {
  items: ProductWithMetrics[];
  total: number;
  page: number;
  pageSize: number;
  ignoredFilters: string[];
  meta: { mode: "demo" | "live"; asOf: string };
}

const FILTER_KEYS = ["q", "category", "country", "platform", "competition", "productType", "priceMin", "priceMax", "marginMin", "growthMin", "firstFrom", "firstTo", "shippingVerified", "warehouse", "maxDeliveryDays"];

function ProductsInner() {
  const { t } = useTranslation();
  const f = useFormat();
  const { session } = useSession();
  const url = useUrlState();
  const [view, setView] = useState<"grid" | "table">("grid");
  const [showFilters, setShowFilters] = useState(false);
  const [q, setQ] = useState(url.get("q"));
  const locked = session ? !session.entitlements.advancedFilters : false;

  useEffect(() => {
    try {
      const v = localStorage.getItem("th_products_view");
      if (v === "table" || v === "grid") setView(v);
    } catch {}
  }, []);
  const urlQ = url.get("q");
  const setUrl = url.set;
  useEffect(() => setQ(urlQ), [urlQ]);
  useEffect(() => {
    const id = setTimeout(() => q !== urlQ && setUrl({ q }), 300);
    return () => clearTimeout(id);
  }, [q, urlQ, setUrl]);

  const { data, error, loading, reload } = useApi<ProductsResponse>(session ? `/api/products?${url.query}` : null);
  const activeCount = FILTER_KEYS.filter((k) => url.get(k)).length;
  const sort = url.get("sort") || "score";

  const changeView = (v: "grid" | "table") => {
    setView(v);
    try {
      localStorage.setItem("th_products_view", v);
    } catch {}
  };

  const filters = (
    <div className="space-y-5">
      <FilterGroup label={t("filters.category")}>
        <ChipSet values={CATEGORIES} active={url.getList("category")} onToggle={(v) => url.toggle("category", v)} render={(v) => t(`categories.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.price")}>
        <div className="flex items-center gap-2">
          <Input type="number" inputMode="decimal" min={0} placeholder={t("filters.min")} value={url.get("priceMin")} onChange={(e) => url.set({ priceMin: e.target.value })} aria-label={t("filters.priceMin")} />
          <span className="text-subtle">–</span>
          <Input type="number" inputMode="decimal" min={0} placeholder={t("filters.max")} value={url.get("priceMax")} onChange={(e) => url.set({ priceMax: e.target.value })} aria-label={t("filters.priceMax")} />
        </div>
      </FilterGroup>
      <FilterGroup label={t("filters.marginMin")} locked={locked}>
        <Select value={url.get("marginMin")} onChange={(e) => url.set({ marginMin: e.target.value })} aria-label={t("filters.marginMin")}>
          <option value="">{t("filters.any")}</option>
          {[40, 60, 70, 80].map((v) => (
            <option key={v} value={v}>
              ≥ {f.pct(v)}
            </option>
          ))}
        </Select>
      </FilterGroup>
      <FilterGroup label={t("filters.growthMin")} locked={locked}>
        <Select value={url.get("growthMin")} onChange={(e) => url.set({ growthMin: e.target.value })} aria-label={t("filters.growthMin")}>
          <option value="">{t("filters.any")}</option>
          {[0, 20, 50, 100].map((v) => (
            <option key={v} value={v}>
              ≥ {f.pct(v, 0, true)}
            </option>
          ))}
        </Select>
      </FilterGroup>
      <FilterGroup label={t("filters.competition")} locked={locked}>
        <ChipSet values={["low", "medium", "high"]} active={url.getList("competition")} onToggle={(v) => url.toggle("competition", v)} render={(v) => t(`competition.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.platform")} locked={locked}>
        <ChipSet values={PLATFORMS} active={url.getList("platform")} onToggle={(v) => url.toggle("platform", v)} render={(v) => t(`platforms.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.country")} locked={locked}>
        <ChipSet values={COUNTRIES} active={url.getList("country")} onToggle={(v) => url.toggle("country", v)} render={(v) => t(`countries.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.firstDetected")} locked={locked}>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={url.get("firstFrom")} onChange={(e) => url.set({ firstFrom: e.target.value })} aria-label={t("filters.from")} />
          <Input type="date" value={url.get("firstTo")} onChange={(e) => url.set({ firstTo: e.target.value })} aria-label={t("filters.to")} />
        </div>
      </FilterGroup>
      <FilterGroup label={t("filters.productType")} locked={locked}>
        <ChipSet values={["physical", "digital", "subscription"]} active={url.getList("productType")} onToggle={(v) => url.toggle("productType", v)} render={(v) => t(`productTypes.${v}`)} />
      </FilterGroup>
      <FilterGroup label={t("filters.shipping")} locked={locked}>
        <Select value={url.get("shippingVerified")} onChange={(e) => url.set({ shippingVerified: e.target.value })} aria-label={t("filters.shipping")}>
          <option value="">{t("filters.any")}</option>
          <option value="true">{t("filters.shippingVerified")}</option>
          <option value="false">{t("filters.shippingUnverified")}</option>
        </Select>
        <div className="mt-2 space-y-2">
          <ChipSet values={["EU", "US", "CN"]} active={url.getList("warehouse")} onToggle={(v) => url.toggle("warehouse", v)} render={(v) => t("filters.warehouse", { region: v })} />
          <Select value={url.get("maxDeliveryDays")} onChange={(e) => url.set({ maxDeliveryDays: e.target.value })} aria-label={t("filters.maxDelivery")}>
            <option value="">{t("filters.maxDelivery")}</option>
            {[7, 10, 14].map((d) => (
              <option key={d} value={d}>
                {t("filters.deliveryWithin", { n: d })}
              </option>
            ))}
          </Select>
          <p className="text-[11px] text-subtle">{t("filters.shippingVerifiedOnly")}</p>
        </div>
      </FilterGroup>
    </div>
  );

  return (
    <div>
      <PageHeader
        title={t("products.title")}
        description={t("products.subtitle")}
        eyebrow={data ? <ProvenanceBadge kind={data.meta.mode === "demo" ? "demo" : "measured"} /> : null}
        actions={
          <Link href="/app/calculator" className={buttonVariants({ variant: "secondary" })} data-testid="open-calculator">
            <Calculator /> {t("nav.calculator")}
          </Link>
        }
      />
      <div className="flex gap-6">
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-4 overflow-y-auto pb-6 pr-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{t("filters.title")}</span>
              <ResetFilters count={activeCount} onReset={() => url.set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))} />
            </div>
            {filters}
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("products.searchPlaceholder")} className="pl-9" aria-label={t("products.searchPlaceholder")} data-testid="products-search" />
            </div>
            <Button variant="secondary" className="lg:hidden" onClick={() => setShowFilters((s) => !s)}>
              <SlidersHorizontal /> {t("filters.title")} {activeCount ? `(${activeCount})` : ""}
            </Button>
            <Select value={sort} onChange={(e) => url.set({ sort: e.target.value })} className="w-auto min-w-[190px]" aria-label={t("sort.label")} data-testid="products-sort">
              {PRODUCT_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.products.${s}`)}
                </option>
              ))}
            </Select>
            <div className="flex rounded-lg border border-border bg-surface-2 p-0.5">
              <button onClick={() => changeView("grid")} className={cn("focus-ring rounded-md p-1.5", view === "grid" ? "bg-surface-3 text-fg" : "text-subtle")} aria-label={t("common.gridView")} aria-pressed={view === "grid"}>
                <LayoutGrid className="size-4" />
              </button>
              <button onClick={() => changeView("table")} className={cn("focus-ring rounded-md p-1.5", view === "table" ? "bg-surface-3 text-fg" : "text-subtle")} aria-label={t("common.tableView")} aria-pressed={view === "table"}>
                <List className="size-4" />
              </button>
            </div>
          </div>
          {showFilters && <Card className="mb-4 p-4 lg:hidden">{filters}</Card>}

          {data?.ignoredFilters?.length ? (
            <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-muted">
              {t("billing.filtersIgnored")}{" "}
              <Link href="/app/settings?tab=billing" className="text-accent hover:underline">
                {t("billing.upgrade")}
              </Link>
            </div>
          ) : null}

          <div className="mb-3 text-xs text-subtle" aria-live="polite">
            {data ? t("products.resultCount", { count: data.total }) : " "}
          </div>

          {error ? (
            <ErrorState message={error.code === "limit_reached" ? t("billing.limitReached") : undefined} onRetry={reload} />
          ) : loading && !data ? (
            <CardGridSkeleton />
          ) : data && data.items.length === 0 ? (
            <EmptyState icon={<PackageSearch />} title={t("products.emptyTitle")} description={t("products.emptyText")} action={<Button variant="secondary" size="sm" onClick={() => url.set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))}>{t("filters.clearAll")}</Button>} />
          ) : data ? (
            <div className={cn(loading && "opacity-60 transition-opacity")}>
              {view === "grid" ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {data.items.map((p) => (
                    <ProductCard key={p.id} p={p} />
                  ))}
                </div>
              ) : (
                <Card className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="table-th">{t("products.product")}</th>
                        <th className="table-th">{t("score.title")}</th>
                        <th className="table-th">{t("products.price")}</th>
                        <th className="table-th">{t("products.margin")}</th>
                        <th className="table-th">{t("products.trend30")}</th>
                        <th className="table-th">{t("products.ads")}</th>
                        <th className="table-th">{t("products.stores")}</th>
                        <th className="table-th">{t("products.competition")}</th>
                        <th className="table-th">{t("products.firstDetected")}</th>
                        <th className="table-th" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((p) => (
                        <tr key={p.id} className="border-b border-border/50 last:border-0 hover:bg-surface-2">
                          <td className="table-td">
                            <Link href={`/app/products/${p.id}`} className="flex items-center gap-2.5 hover:text-accent">
                              <Thumb category={p.category} hue={p.hue} src={p.imageUrl} className="size-8 shrink-0" />
                              <span>
                                <span className="block max-w-[240px] truncate">{p.name}</span>
                                <span className="text-xs text-subtle">{t(`categories.${p.category}`)}</span>
                              </span>
                            </Link>
                          </td>
                          <td className="table-td">
                            <ScoreBadge score={p.score.overall} />
                          </td>
                          <td className="table-td num">{f.currency(p.priceEstimate, p.currency)}</td>
                          <td className="table-td num">{p.metrics.grossMargin == null ? "—" : f.pct(p.metrics.grossMargin * 100)}</td>
                          <td className="table-td">
                            <TrendPill pct={p.metrics.trendGrowth} />
                          </td>
                          <td className="table-td num">{p.metrics.adsObserved}</td>
                          <td className="table-td num">{p.metrics.storesObserved}</td>
                          <td className="table-td">
                            <CompetitionBadge level={p.metrics.competition} />
                          </td>
                          <td className="table-td text-muted">{f.date(p.firstDetected)}</td>
                          <td className="table-td">
                            <SaveButton type="product" refId={p.id} label={p.name} iconOnly variant="ghost" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => url.set({ page: String(page) }, { resetPage: false })} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<CardGridSkeleton />}>
      <ProductsInner />
    </Suspense>
  );
}
