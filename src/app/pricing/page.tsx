"use client";

import { useTranslation } from "react-i18next";
import { MarketingShell } from "@/components/marketing/chrome";
import { PricingTable } from "@/components/marketing/pricing-table";

export default function PricingPage() {
  const { t } = useTranslation();
  return (
    <MarketingShell>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("pricing.title")}</h1>
          <p className="mx-auto mt-3 max-w-2xl text-muted">{t("pricing.subtitle")}</p>
        </div>
        <PricingTable />
        <div className="mx-auto mt-12 grid max-w-4xl gap-4 text-sm md:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="card p-5">
              <div className="font-medium">{t(`pricing.faq.q${n}`)}</div>
              <p className="mt-1.5 text-muted">{t(`pricing.faq.a${n}`)}</p>
            </div>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
