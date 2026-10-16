"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { PLAN_IDS, PLANS, type PlanId } from "@/lib/plans";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/cn";

export function PricingTable({
  current,
  onChoose,
  busy,
  demo,
  yearlyAvailable = true,
}: {
  current?: PlanId;
  onChoose?: (p: PlanId, interval: "month" | "year") => void;
  busy?: PlanId | "portal" | null;
  demo?: boolean;
  /** False when the deployment has no yearly Stripe prices: only monthly billing is offered. */
  yearlyAvailable?: boolean;
}) {
  const { t } = useTranslation();
  const f = useFormat();
  const [chosen, setInterval] = useState<"monthly" | "yearly">("monthly");
  const interval = yearlyAvailable ? chosen : "monthly";
  return (
    <div>
      <div className={cn("mb-6 flex justify-center", !yearlyAvailable && "hidden")}>
        <Tabs
          value={interval}
          onChange={setInterval}
          items={[
            { value: "monthly", label: t("pricing.monthly") },
            { value: "yearly", label: t("pricing.yearly") },
          ]}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {PLAN_IDS.map((id) => {
          const plan = PLANS[id];
          const e = plan.entitlements;
          const price = interval === "monthly" ? plan.priceMonthly : plan.priceYearly;
          const highlight = id === "pro";
          const features = [
            t("pricing.f.productSearches", { n: f.number(e.productSearchesPerDay) }),
            t("pricing.f.adSearches", { n: f.number(e.adSearchesPerDay) }),
            t("pricing.f.ai", { n: f.number(e.aiQueriesPerDay) }),
            t("pricing.f.saved", { n: f.number(e.savedItems) }),
            t("pricing.f.collections", { n: f.number(e.collections) }),
            e.alerts ? t("pricing.f.alerts", { n: e.alertRules }) : null,
            e.advancedFilters ? t("pricing.f.advancedFilters") : t("pricing.f.basicFilters"),
            e.creativeAnalysis ? t("pricing.f.creative") : null,
            e.calculator ? t("pricing.f.calculator") : null,
            e.exports ? t("pricing.f.exports") : null,
            e.shopifyIntegration ? t("pricing.f.shopify") : null,
            e.shopifyStores > 1 ? t("pricing.f.shopifyStores", { n: e.shopifyStores }) : null,
            e.advancedReports ? t("pricing.f.advancedReports") : t("pricing.f.basicTrends"),
            e.workspaces > 1 ? t("pricing.f.workspaces", { n: e.workspaces, seats: e.seats }) : null,
            e.prioritySupport ? t("pricing.f.support") : null,
          ].filter(Boolean) as string[];
          return (
            <div key={id} className={cn("card relative flex flex-col p-6", highlight && "border-accent/50 shadow-[0_0_0_1px_rgb(var(--accent)/0.3),0_20px_60px_-20px_rgb(var(--accent)/0.4)]")} data-testid={`plan-${id}`}>
              {highlight && (
                <Badge tone="accent" className="absolute -top-2.5 left-6">
                  {t("pricing.popular")}
                </Badge>
              )}
              <div className="text-sm font-semibold">{t(`plans.${id}.name`)}</div>
              <p className="mt-1 min-h-[40px] text-sm text-subtle">{t(`plans.${id}.tagline`)}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="num text-3xl font-semibold tracking-tight">{f.currency(price, "EUR", 0)}</span>
                <span className="text-sm text-subtle">/{interval === "monthly" ? t("pricing.perMonth") : t("pricing.perYear")}</span>
              </div>
              <p className="mt-1 text-[11px] text-subtle">{t("pricing.vat")}</p>
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                {features.map((x) => (
                  <li key={x} className="flex gap-2 text-muted">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent" /> {x}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                {onChoose ? (
                  <Button className="w-full" variant={current === id ? "secondary" : highlight ? "primary" : "secondary"} disabled={current === id || (busy != null && busy !== id)} loading={busy === id} disabledReason={current === id ? t("pricing.currentReason") : undefined} onClick={() => onChoose(id, interval === "yearly" ? "year" : "month")} data-testid={`choose-${id}`}>
                    {current === id ? t("pricing.current") : demo ? t("pricing.switchDemo") : id === "free" ? t("pricing.downgrade") : t("pricing.upgradeTo", { plan: t(`plans.${id}.name`) })}
                  </Button>
                ) : (
                  <Link href={id === "free" ? "/signup" : `/signup?plan=${id}`} className={cn(buttonVariants({ variant: highlight ? "primary" : "secondary" }), "w-full")}>
                    {id === "free" ? t("pricing.startFree") : t("pricing.choose", { plan: t(`plans.${id}.name`) })}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-center text-xs text-subtle">{t("pricing.limitsNote")}</p>
    </div>
  );
}
