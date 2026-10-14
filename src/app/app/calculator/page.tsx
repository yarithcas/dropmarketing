"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Info, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { InfoTip, PageHeader, PlanGate } from "@/components/app/bits";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/client/session";
import { CURRENCIES, useCurrency, type CurrencyCode } from "@/lib/client/prefs";
import { useUrlState } from "@/lib/client/use-url-state";
import { useFormat } from "@/lib/format";
import { computeProfit, DEFAULT_INPUTS, sensitivity, type ProfitInputs } from "@/lib/profitability";
import { cn } from "@/lib/cn";

const FIELDS: { key: keyof ProfitInputs; unit: "money" | "pct" | "count"; step: string }[] = [
  { key: "price", unit: "money", step: "0.01" },
  { key: "productCost", unit: "money", step: "0.01" },
  { key: "shippingCost", unit: "money", step: "0.01" },
  { key: "paymentFeePct", unit: "pct", step: "0.1" },
  { key: "paymentFeeFixed", unit: "money", step: "0.01" },
  { key: "platformCostPerOrder", unit: "money", step: "0.01" },
  { key: "cpa", unit: "money", step: "0.01" },
  { key: "refundRatePct", unit: "pct", step: "0.1" },
  { key: "otherCostPerOrder", unit: "money", step: "0.01" },
  { key: "fixedMonthlyCosts", unit: "money", step: "1" },
];

function Output({ label, value, tip, tone, big }: { label: string; value: string; tip?: string; tone?: "good" | "bad"; big?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 p-3">
      <div className="flex items-center gap-1.5 text-xs text-subtle">
        {label}
        {tip ? <InfoTip content={tip} /> : null}
      </div>
      <div className={cn("num mt-1 font-semibold", big ? "text-2xl" : "text-lg", tone === "good" && "text-[#3fcf3f]", tone === "bad" && "text-[#f07a7a]")}>{value}</div>
    </div>
  );
}

function CalculatorInner() {
  const { t } = useTranslation();
  const f = useFormat();
  const { session } = useSession();
  const url = useUrlState();
  const [currency, setCurrency] = useCurrency();
  const [inputs, setInputs] = useState<ProfitInputs>(DEFAULT_INPUTS);
  const product = url.get("product");

  useEffect(() => {
    const next = { ...DEFAULT_INPUTS };
    let touched = false;
    for (const k of Object.keys(DEFAULT_INPUTS) as (keyof ProfitInputs)[]) {
      const v = url.params.get(k);
      if (v != null && v !== "" && Number.isFinite(Number(v))) {
        next[k] = Number(v);
        touched = true;
      }
    }
    if (touched) setInputs(next);
    // only on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const r = useMemo(() => computeProfit(inputs), [inputs]);
  const sens = useMemo(() => sensitivity(inputs), [inputs]);
  const money = (n: number | null) => f.currency(n, currency);
  const set = (k: keyof ProfitInputs, v: string) => setInputs((s) => ({ ...s, [k]: v === "" ? 0 : Number(v) }));

  return (
    <PlanGate feature={t("calculator.title")} allowed={session?.entitlements.calculator ?? true}>
      <div>
        <PageHeader
          title={t("calculator.title")}
          description={product ? t("calculator.forProduct", { name: product }) : t("calculator.subtitle")}
          actions={
            <>
              <Select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)} className="w-28" aria-label={t("settings.currency")}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
              <Button variant="secondary" onClick={() => setInputs(DEFAULT_INPUTS)}>
                <RotateCcw /> {t("calculator.reset")}
              </Button>
            </>
          }
        />
        <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
          <Card className="h-fit">
            <CardHeader title={t("calculator.assumptions")} description={t("calculator.assumptionsDesc")} />
            <CardBody className="space-y-3">
              {FIELDS.map((fd) => (
                <div key={fd.key} className="grid grid-cols-[1fr_130px] items-center gap-3">
                  <label htmlFor={`calc-${fd.key}`} className="flex items-center gap-1.5 text-sm text-muted">
                    {t(`calculator.inputs.${fd.key}`)}
                    <InfoTip content={t(`calculator.tips.${fd.key}`)} />
                  </label>
                  <div className="relative">
                    <Input id={`calc-${fd.key}`} type="number" inputMode="decimal" min={0} step={fd.step} value={Number.isFinite(inputs[fd.key]) ? inputs[fd.key] : 0} onChange={(e) => set(fd.key, e.target.value)} className="num pr-10 text-right" data-testid={`calc-${fd.key}`} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-subtle">{fd.unit === "pct" ? "%" : currency}</span>
                  </div>
                </div>
              ))}
              <div className="pt-2">
                <label htmlFor="calc-orders" className="flex items-center justify-between text-sm text-muted">
                  {t("calculator.inputs.orders")}
                  <span className="num text-fg">{f.number(inputs.orders)}</span>
                </label>
                <input id="calc-orders" type="range" min={0} max={5000} step={10} value={inputs.orders} onChange={(e) => set("orders", e.target.value)} className="mt-2 w-full accent-[rgb(var(--accent))]" data-testid="calc-orders" />
              </div>
            </CardBody>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title={t("calculator.perOrder")} />
              <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Output label={t("calculator.out.grossMargin")} value={`${money(r.grossMarginBeforeAds)} · ${f.pct(r.grossMarginBeforeAdsPct, 1)}`} tip={t("calculator.def.grossMargin")} />
                <Output label={t("calculator.out.contribution")} value={`${money(r.contributionMargin)} · ${f.pct(r.contributionMarginPct, 1)}`} tip={t("calculator.def.contribution")} />
                <Output label={t("calculator.out.breakEvenCpa")} value={money(r.breakEvenCpa)} tip={t("calculator.def.breakEvenCpa")} />
                <Output label={t("calculator.out.breakEvenRoas")} value={r.breakEvenRoas == null ? t("calculator.notReachable") : `${f.number(r.breakEvenRoas, 2)}×`} tip={t("calculator.def.breakEvenRoas")} />
                <Output label={t("calculator.out.netContribution")} value={money(r.netContributionPerOrder)} tone={r.netContributionPerOrder >= 0 ? "good" : "bad"} tip={t("calculator.def.netContribution")} big />
                <Output label={t("calculator.out.impliedRoas")} value={r.impliedRoas == null ? "—" : `${f.number(r.impliedRoas, 2)}×`} tip={t("calculator.def.impliedRoas")} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("calculator.forVolume", { n: f.number(inputs.orders) })} />
              <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Output label={t("calculator.out.revenue")} value={money(r.totalRevenue)} />
                <Output label={t("calculator.out.totalContribution")} value={money(r.totalNetContribution)} tone={r.totalNetContribution >= 0 ? "good" : "bad"} />
                <Output label={t("calculator.out.operatingProfit")} value={money(r.estimatedOperatingProfit)} tone={r.estimatedOperatingProfit >= 0 ? "good" : "bad"} tip={t("calculator.def.operatingProfit")} big />
                <Output label={t("calculator.out.breakEvenOrders")} value={r.breakEvenOrders == null ? t("calculator.notReachable") : f.number(r.breakEvenOrders)} tip={t("calculator.def.breakEvenOrders")} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("calculator.sensitivity")} description={t("calculator.sensitivityDesc")} />
              <div className="overflow-x-auto p-4">
                <table className="w-full text-sm" data-testid="sensitivity">
                  <thead>
                    <tr>
                      <th className="table-th">{t("calculator.priceVsCpa")}</th>
                      {sens[0].map((c) => (
                        <th key={c.cpaDelta} className="table-th text-right">
                          CPA {f.pct(c.cpaDelta, 0, true)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sens.map((row) => (
                      <tr key={row[0].priceDelta}>
                        <td className="table-td text-xs text-subtle">
                          {t("calculator.price")} {f.pct(row[0].priceDelta, 0, true)}
                        </td>
                        {row.map((c) => (
                          <td
                            key={c.cpaDelta}
                            className={cn(
                              "table-td num text-right",
                              c.netContributionPerOrder >= 0 ? "text-[#3fcf3f]" : "text-[#f07a7a]",
                              c.priceDelta === 0 && c.cpaDelta === 0 && "rounded-md bg-surface-3 font-semibold",
                            )}
                          >
                            {money(c.netContributionPerOrder)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex gap-3 text-xs leading-relaxed text-muted">
                <Info className="mt-0.5 size-4 shrink-0 text-accent" />
                <div className="space-y-1">
                  <p>{t("calculator.note1")}</p>
                  <p>{t("calculator.note2")}</p>
                  <p>{t("calculator.note3")}</p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </PlanGate>
  );
}

export default function CalculatorPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <CalculatorInner />
    </Suspense>
  );
}
