"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Store as StoreIcon, Swords } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader, Pagination, ProvenanceBadge, Thumb } from "@/components/app/bits";
import { DebouncedInput } from "@/components/app/debounced-input";
import { ChipSet } from "@/components/app/filters";
import { MyStorePanel } from "@/components/app/my-store";
import { useCardNavigation } from "@/components/app/card-link";
import { TechBadge } from "@/components/app/tech-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { useApi } from "@/lib/client/use-api";
import { useSession } from "@/lib/client/session";
import { useUrlState } from "@/lib/client/use-url-state";
import { useFormat } from "@/lib/format";
import { CATEGORIES, COUNTRIES, type Store } from "@/lib/types";

interface StoresResponse {
  items: (Store & { adsCount: number; trackedProducts: number })[];
  total: number;
  page: number;
  pageSize: number;
  meta: { mode: "demo" | "live" };
}

function PublicStores() {
  const { t } = useTranslation();
  const f = useFormat();
  const url = useUrlState();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const cardLink = useCardNavigation();
  const { data, error, loading, reload } = useApi<StoresResponse>(`/api/stores?${url.query}`);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 5 ? s : [...s, id]));

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <DebouncedInput value={url.get("q")} onCommit={(q) => url.set({ q })} placeholder={t("stores.searchPlaceholder")} className="pl-9" aria-label={t("stores.searchPlaceholder")} data-testid="stores-search" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="label mb-2">{t("filters.category")}</div>
            <ChipSet values={CATEGORIES} active={url.getList("category")} onToggle={(v) => url.toggle("category", v)} render={(v) => t(`categories.${v}`)} />
          </div>
          <div>
            <div className="label mb-2">{t("filters.country")}</div>
            <ChipSet values={COUNTRIES} active={url.getList("country")} onToggle={(v) => url.toggle("country", v)} render={(v) => t(`countries.${v}`)} />
          </div>
          <div>
            <div className="label mb-2">{t("stores.technology")}</div>
            <ChipSet values={["shopify", "woocommerce", "unknown"]} active={url.getList("platform")} onToggle={(v) => url.toggle("platform", v)} render={(v) => (v === "unknown" ? t("stores.techUnknown") : t(`stores.platforms.${v}`))} />
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-subtle">{data ? t("stores.resultCount", { count: data.total }) : " "}</span>
        <Button size="sm" disabled={selected.length < 2} disabledReason={t("stores.compareHint")} onClick={() => router.push(`/app/competitors?ids=${selected.join(",")}`)} data-testid="compare-selected">
          <Swords /> {t("stores.compareSelected", { n: selected.length })}
        </Button>
      </div>

      {error ? (
        <ErrorState onRetry={reload} />
      ) : loading && !data ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : data && data.items.length === 0 ? (
        <EmptyState icon={<StoreIcon />} title={t("stores.emptyTitle")} description={t("stores.emptyText")} />
      ) : data ? (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="table-th w-8">
                  <span className="sr-only">{t("stores.select")}</span>
                </th>
                <th className="table-th">{t("stores.store")}</th>
                <th className="table-th">{t("filters.category")}</th>
                <th className="table-th">{t("stores.technology")}</th>
                <th className="table-th">{t("stores.listings")}</th>
                <th className="table-th">{t("stores.adsObserved")}</th>
                <th className="table-th">{t("stores.firstSeen")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} className="cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-surface-2 active:bg-surface-3" {...cardLink(`/app/stores/${s.id}`)} data-testid="store-row">
                  <td className="p-0" data-card-ignore onClick={(e) => e.target === e.currentTarget && toggle(s.id)}>
                    {/* The whole cell toggles the checkbox (bigger target) and never opens the row. */}
                    <label className="flex min-h-10 cursor-pointer items-center justify-center px-3">
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-[rgb(var(--accent))] disabled:cursor-not-allowed"
                      checked={selected.includes(s.id)}
                      onChange={() => toggle(s.id)}
                      aria-label={t("stores.selectStore", { name: s.name })}
                      disabled={!selected.includes(s.id) && selected.length >= 5}
                      title={!selected.includes(s.id) && selected.length >= 5 ? t("stores.compareMax") : undefined}
                    />
                    </label>
                  </td>
                  <td className="table-td">
                    <Link href={`/app/stores/${s.id}`} className="focus-ring flex items-center gap-2.5 rounded hover:text-accent">
                      <Thumb category={s.categories[0]} hue={s.hue} className="size-8 shrink-0" />
                      <span>
                        <span className="block font-medium">{s.name}</span>
                        <span className="text-xs text-subtle">{s.domain}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="table-td text-muted">{s.categories.map((c) => t(`categories.${c}`)).join(", ")}</td>
                  <td className="table-td">
                    <TechBadge tech={s.technology} />
                  </td>
                  <td className="table-td num">{s.productCount ?? "—"}</td>
                  <td className="table-td num">{s.adsCount}</td>
                  <td className="table-td text-muted">{f.date(s.firstSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 pb-4">
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => url.set({ page: String(page) }, { resetPage: false })} />
          </div>
        </Card>
      ) : null}
      <p className="text-[11px] text-subtle">{t("stores.publicOnly")}</p>
    </div>
  );
}

function StoresInner() {
  const { t } = useTranslation();
  const url = useUrlState();
  const { session } = useSession();
  const tab = url.get("tab") === "mine" ? "mine" : "public";
  return (
    <div>
      <PageHeader
        title={t("stores.title")}
        description={t("stores.subtitle")}
        eyebrow={session ? <ProvenanceBadge kind={session.data.mode === "demo" ? "demo" : "measured"} /> : null}
        actions={
          <Tabs
            value={tab}
            onChange={(v) => url.set({ tab: v === "public" ? null : v })}
            items={[
              { value: "public", label: t("stores.tabs.public") },
              { value: "mine", label: t("stores.tabs.mine") },
            ]}
          />
        }
      />
      {tab === "public" ? <PublicStores /> : <MyStorePanel />}
    </div>
  );
}

export default function StoresPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <StoresInner />
    </Suspense>
  );
}
