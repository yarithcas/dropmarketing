"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  Calculator,
  Clapperboard,
  FileBarChart2,
  FlaskConical,
  Radar,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarketingShell } from "@/components/marketing/chrome";
import { PricingTable } from "@/components/marketing/pricing-table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { SCORE_WEIGHTS } from "@/lib/scoring";
import { cn } from "@/lib/cn";

const FEATURES = [
  { key: "products", icon: Trophy },
  { key: "adspy", icon: Radar },
  { key: "creatives", icon: Clapperboard },
  { key: "trends", icon: TrendingUp },
  { key: "stores", icon: Store },
  { key: "analyst", icon: Sparkles },
  { key: "calculator", icon: Calculator },
  { key: "alerts", icon: BellRing },
  { key: "reports", icon: FileBarChart2 },
];

function HeroPreview() {
  const { t } = useTranslation();
  const rows = [
    { name: "Smart Jump Rope with Counter", score: 81, trend: "+125%", w: 81 },
    { name: "Interactive Cat Feather Toy", score: 80, trend: "+120%", w: 80 },
    { name: "Mini Thermal Label Printer", score: 80, trend: "+150%", w: 80 },
    { name: "Electric Spice Grinder (USB-C)", score: 72, trend: "+79%", w: 72 },
  ];
  const bars = [18, 22, 20, 27, 31, 29, 36, 41, 39, 47, 52, 58, 55, 63];
  return (
    <div className="relative mx-auto mt-14 max-w-5xl">
      <div className="absolute -inset-x-10 -top-10 h-72 rounded-full bg-gradient-to-r from-accent/30 via-[#8b7bff]/20 to-accent-2/30 blur-3xl" aria-hidden />
      <div className="card relative overflow-hidden shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-[#e66767]/70" />
          <span className="size-2.5 rounded-full bg-[#c98500]/70" />
          <span className="size-2.5 rounded-full bg-[#199e70]/70" />
          <span className="ml-3 text-xs text-subtle">app.trendhunter / {t("nav.overview")}</span>
          <Badge tone="demo" className="ml-auto">
            <FlaskConical /> {t("provenance.demo")}
          </Badge>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-5">
          <div className="space-y-3 md:col-span-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                [t("landing.preview.tracked"), "54"],
                [t("landing.preview.activeAds"), "212"],
                [t("landing.preview.newWeek"), "38"],
              ].map(([l, v]) => (
                <div key={l} className="rounded-lg border border-border bg-surface-2 p-3">
                  <div className="text-[11px] text-subtle">{l}</div>
                  <div className="num mt-1 text-lg font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="mb-3 text-xs text-subtle">{t("landing.preview.chart")}</div>
              <div className="flex h-28 items-end gap-1.5">
                {bars.map((h, i) => (
                  <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-accent/40 to-accent" style={{ height: `${h + 30}%` }} />
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3 md:col-span-2">
            <div className="mb-2 text-xs text-subtle">{t("landing.preview.top")}</div>
            <ul className="space-y-2.5">
              {rows.map((r) => (
                <li key={r.name}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate">{r.name}</span>
                    <span className="num text-[#3fcf3f]">{r.trend}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-surface-3">
                      <div className="h-1.5 rounded-full bg-accent" style={{ width: `${r.w}%` }} />
                    </div>
                    <span className="num text-[11px] text-muted">{r.score}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[11px] text-subtle">{t("landing.preview.note")}</p>
    </div>
  );
}

export default function LandingPage() {
  const { t } = useTranslation();
  return (
    <MarketingShell>
      <section className="relative overflow-hidden">
        <div className="bg-grid absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 text-center sm:px-6 sm:pt-24">
          <Badge tone="accent" className="mb-5 px-2.5 py-1 text-xs">
            <ShieldCheck /> {t("landing.badge")}
          </Badge>
          <h1 className="mx-auto max-w-4xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
            {t("landing.heroTitle1")} <span className="gradient-text">{t("landing.heroTitle2")}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted sm:text-lg">{t("landing.heroText")}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/app" className={buttonVariants({ size: "lg" })} data-testid="cta-demo">
              {t("landing.ctaDemo")} <ArrowRight />
            </Link>
            <Link href="/pricing" className={buttonVariants({ size: "lg", variant: "secondary" })}>
              {t("landing.ctaPricing")}
            </Link>
          </div>
          <p className="mt-3 text-xs text-subtle">{t("landing.noCard")}</p>
          <HeroPreview />
        </div>
      </section>

      <section className="border-y border-border/60 bg-surface/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">{t("landing.questionsTitle")}</h2>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="card p-5">
                <div className="num text-sm font-semibold text-accent">0{n}</div>
                <p className="mt-2 text-sm font-medium leading-snug">{t(`overview.questions.q${n}`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("landing.featuresTitle")}</h2>
          <p className="mt-3 text-muted">{t("landing.featuresText")}</p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ key, icon: Icon }) => (
            <div key={key} className="card group p-5 transition-colors hover:border-accent/40">
              <span className="flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-accent/20 to-accent-2/20 text-accent">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold">{t(`landing.features.${key}.title`)}</h3>
              <p className="mt-1.5 text-sm text-muted">{t(`landing.features.${key}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="scoring" className="scroll-mt-20 border-y border-border/60 bg-surface/40">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("landing.scoringTitle")}</h2>
            <p className="mt-3 text-muted">{t("landing.scoringText")}</p>
            <ul className="mt-6 space-y-3 text-sm">
              {["measured", "estimate", "ai", "demo"].map((k) => (
                <li key={k} className="flex items-start gap-3">
                  <Badge tone={{ measured: "good", estimate: "warn", ai: "purple", demo: "demo" }[k] as "good"} className="mt-0.5 shrink-0">
                    {t(`provenance.${k}`)}
                  </Badge>
                  <span className="text-muted">{t(`provenance.${k}Tip`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold">{t("score.title")}</span>
              <Badge tone="good">
                <BadgeCheck /> {t("landing.transparent")}
              </Badge>
            </div>
            <ul className="space-y-3">
              {(Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((k) => (
                <li key={k}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-muted">{t(`score.components.${k}`)}</span>
                    <span className="num">{SCORE_WEIGHTS[k] * 100}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-3">
                    <div className="h-2 rounded-full bg-gradient-to-r from-accent to-accent-2" style={{ width: `${SCORE_WEIGHTS[k] * 400}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-xs text-subtle">{t("landing.scoringNote")}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("landing.integrityTitle")}</h2>
          <p className="mt-3 text-muted">{t("landing.integrityText")}</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {["sources", "noFake", "compliance"].map((k) => (
            <div key={k} className="card p-5">
              <h3 className="font-semibold">{t(`landing.integrity.${k}.title`)}</h3>
              <p className="mt-1.5 text-sm text-muted">{t(`landing.integrity.${k}.text`)}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {["meta_ad_library", "tiktok_commercial_content", "pinterest_ads_repository", "search_trends", "public_storefronts", "shopify_admin", "licensed_dataset"].map((c) => (
            <span key={c} className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-muted">
              {t(`connectors.names.${c}`)}
            </span>
          ))}
        </div>
      </section>

      <section id="pricing" className="scroll-mt-20 border-t border-border/60 bg-surface/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("pricing.title")}</h2>
            <p className="mt-3 text-muted">{t("pricing.subtitle")}</p>
          </div>
          <PricingTable />
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20 sm:px-6">
        <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">{t("landing.faqTitle")}</h2>
        <div className="mt-8 divide-y divide-border rounded-xl border border-border">
          {[1, 2, 3, 4, 5].map((n) => (
            <details key={n} className="group px-5 py-4">
              <summary className="cursor-pointer list-none text-sm font-medium marker:hidden">
                <span className="flex items-center justify-between gap-4">
                  {t(`landing.faq.q${n}`)}
                  <span className="text-subtle transition-transform group-open:rotate-45">+</span>
                </span>
              </summary>
              <p className="mt-2 text-sm text-muted">{t(`landing.faq.a${n}`)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="px-4 pb-20 sm:px-6">
        <div className={cn("mx-auto max-w-5xl overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/20 via-surface to-accent-2/20 px-6 py-14 text-center")}>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("landing.finalTitle")}</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">{t("landing.finalText")}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/app" className={buttonVariants({ size: "lg" })}>
              {t("landing.ctaDemo")} <ArrowRight />
            </Link>
            <Link href="/signup" className={buttonVariants({ size: "lg", variant: "secondary" })}>
              {t("auth.signup")}
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
