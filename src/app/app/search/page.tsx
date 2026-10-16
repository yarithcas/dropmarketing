"use client";

import { Suspense } from "react";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SearchLinkFlag, searchLinks, type SearchResults } from "@/components/app/global-search";
import { PageHeader, TrendPill } from "@/components/app/bits";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useApi } from "@/lib/client/use-api";
import { useUrlState } from "@/lib/client/use-url-state";
import { DEFAULT_THRESHOLDS, ruleValues } from "@/lib/advertisers";

const GROUPS = ["products", "niches", "advertisers", "ads", "stores"] as const;

function SearchInner() {
  const { t } = useTranslation();
  const url = useUrlState();
  const q = url.get("q");
  const { data, error, loading, reload } = useApi<SearchResults>(q.length >= 2 ? `/api/search?q=${encodeURIComponent(q)}` : null);
  const links = data ? searchLinks(data) : [];
  // Ads of advertisers that do not qualify as active are counted, not listed: say so and link to them.
  const hidden = data?.hiddenAds ? (
    <p className="mt-4 text-xs text-subtle" data-testid="search-hidden-ads">
      {t("activeAdvertisers.searchHidden", { count: data.hiddenAds, ...ruleValues(t, (data.advertiserRule ?? DEFAULT_THRESHOLDS).minAds, (data.advertiserRule ?? DEFAULT_THRESHOLDS).minDays) })}{" "}
      <Link href={`/app/ads?q=${encodeURIComponent(q)}&activeAdvertisers=false`} className="text-accent hover:underline">
        {t("activeAdvertisers.showAll")}
      </Link>
    </p>
  ) : null;
  return (
    <div>
      <PageHeader title={t("search.title", { q })} description={t("search.subtitle")} />
      {q.length < 2 ? (
        <EmptyState title={t("search.tooShort")} />
      ) : error ? (
        <ErrorState onRetry={reload} />
      ) : loading || !data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : links.length === 0 ? (
        <>
          <EmptyState icon={<SearchX />} title={t("search.noResults", { q })} description={t("search.noResultsText")} />
          {hidden}
        </>
      ) : (
        <>
        <div className="grid gap-4 lg:grid-cols-2">
          {GROUPS.map((g) => {
            const items = links.filter((l) => l.group === g);
            if (!items.length) return null;
            return (
              <Card key={g}>
                <CardHeader title={t(`search.groups.${g}`)} />
                <ul className="divide-y divide-border/60">
                  {items.map((l) => {
                    const Icon = l.icon;
                    return (
                      <li key={l.href}>
                        <Link href={l.href} className="focus-ring flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-2 active:bg-surface-3">
                          <Icon className="size-4 text-subtle" />
                          <span className="truncate">{g === "niches" && l.label.length < 12 ? t(`categories.${l.label}`, { defaultValue: l.label }) : l.label}</span>
                          <SearchLinkFlag link={l} />
                          {l.growth !== undefined ? (
                            <TrendPill pct={l.growth} className="ml-auto" />
                          ) : (
                            <span className="ml-auto truncate text-xs text-subtle">{g === "products" ? t(`categories.${l.meta}`) : l.meta}</span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
        {hidden}
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <SearchInner />
    </Suspense>
  );
}
