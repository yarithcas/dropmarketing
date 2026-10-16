"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { ProductWithMetrics } from "@/lib/types";
import { useFormat } from "@/lib/format";
import { CompetitionBadge, ConfidenceBadge, ScoreBadge, Thumb, TrendPill } from "./bits";
import { SaveButton } from "./save";

export function ProductCard({ p }: { p: ProductWithMetrics }) {
  const { t } = useTranslation();
  const f = useFormat();
  return (
    // The whole card is the link; the save action sits beside it (not nested inside the <a>) and stays clickable.
    <div className="group/card relative flex">
      <Link href={`/app/products/${p.id}`} className="card card-interactive focus-ring group flex w-full flex-col overflow-hidden" data-testid="product-card">
      <div className="relative overflow-hidden">
        <Thumb category={p.category} hue={p.hue} src={p.imageUrl} className="h-32 w-full rounded-none transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100" label={p.name} />
        <div className="absolute left-2.5 top-2.5 flex flex-col items-start gap-1">
          <ScoreBadge score={p.score.overall} className="bg-bg/80 backdrop-blur" />
          {p.score.overall != null && p.score.confidence === "low" ? <ConfidenceBadge level="low" /> : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="text-[11px] text-subtle">{t(`categories.${p.category}`)}</div>
        <h3 className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug group-hover:text-accent">{p.name}</h3>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-subtle">{t("products.price")}</div>
            <div className="num mt-0.5 text-fg">{f.currency(p.priceEstimate, p.currency)}</div>
          </div>
          <div>
            <div className="text-subtle">{t("products.margin")}</div>
            <div className="num mt-0.5 text-fg">{p.metrics.grossMargin == null ? "—" : f.pct(p.metrics.grossMargin * 100)}</div>
          </div>
          <div>
            <div className="text-subtle">{t("products.trend30")}</div>
            <div className="mt-0.5">
              <TrendPill pct={p.metrics.trendGrowth} />
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-2.5 text-xs text-subtle">
          <span className="num">{t("products.adsStores", { ads: p.metrics.adsObserved, stores: p.metrics.storesObserved })}</span>
          <CompetitionBadge level={p.metrics.competition} />
        </div>
      </div>
      </Link>
      <div className="absolute right-2 top-2 opacity-90 transition-opacity group-hover/card:opacity-100">
        <SaveButton type="product" refId={p.id} label={p.name} iconOnly variant="secondary" />
      </div>
    </div>
  );
}
