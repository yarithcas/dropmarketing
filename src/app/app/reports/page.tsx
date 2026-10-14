"use client";

import Link from "next/link";
import { FileBarChart2, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CATEGORY_ICON, PageHeader, ProvenanceBadge } from "@/components/app/bits";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/use-api";
import type { Category } from "@/lib/types";

interface Catalog {
  items: { id: string; kind: "weekly" | "competitive" | "market"; category?: Category; advanced: boolean }[];
  meta: { mode: "demo" | "live"; asOf: string };
}

export default function ReportsPage() {
  const { t } = useTranslation();
  const { session } = useSession();
  const { data, error, loading, reload } = useApi<Catalog>("/api/reports");
  return (
    <div>
      <PageHeader title={t("reports.title")} description={t("reports.subtitle")} eyebrow={data ? <ProvenanceBadge kind={data.meta.mode === "demo" ? "demo" : "measured"} /> : null} />
      {error ? (
        <ErrorState onRetry={reload} />
      ) : loading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((r) => {
            const Icon = r.category ? CATEGORY_ICON[r.category] : FileBarChart2;
            const locked = r.advanced && !session?.entitlements.advancedReports;
            return (
              <Link key={r.id} href={`/app/reports/${r.id}`} className="card focus-ring group flex gap-3 p-4 hover:border-accent/40" data-testid="report-card">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium group-hover:text-accent">
                    {r.category ? t("reports.marketTitle", { category: t(`categories.${r.category}`) }) : t(`reports.kinds.${r.kind}`)}
                    {locked && <Lock className="size-3.5 text-accent" />}
                  </div>
                  <p className="mt-1 text-xs text-subtle">{t(`reports.kindDesc.${r.kind}`)}</p>
                  {r.advanced && <Badge tone="purple" className="mt-2">{t("plans.business.name")}</Badge>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
