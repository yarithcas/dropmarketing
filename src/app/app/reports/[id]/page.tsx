"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CompetitionBadge, PlanGate, ProvenanceBadge, ScoreBadge, TrendPill } from "@/components/app/bits";
import { Logo } from "@/components/logo";
import { SimpleBarChart, TimeSeriesChart } from "@/components/app/charts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/use-api";
import { useFormat } from "@/lib/format";
import type { Category, CompetitionLevel, Confidence, Platform, ProvenanceKind } from "@/lib/types";

interface Report {
  id: string;
  category: Category | null;
  kind: "weekly" | "competitive" | "market";
  generatedAt: string;
  asOf: string;
  dataMode: "demo" | "live";
  overview: { products: number; scored: number; adsObserved: number; adsActive: number; advertisers: number; stores: number; medianMargin: number | null; growth: number | null };
  opportunities: { id: string; name: string; score: number | null; confidence: Confidence; trendGrowth: number | null; grossMargin: number | null; price: number | null; cost: number | null; currency: string; ads: number; competition: CompetitionLevel }[];
  trendSeries: Record<string, string | number>[];
  adExamples: { id: string; advertiser: string; platform: Platform; format: string; headline: string; excerpt: string; firstSeen: string; lastSeen: string }[];
  competitors: { id: string; name: string; domain: string; listings: number; relevantListings: number; ads: number }[];
  margins: { buckets: { label: string; count: number }[] };
  risks: string[];
  experiments: string[];
  sources: { connector: string; kind: ProvenanceKind; from: string; to: string; records: { products: number; ads: number; observations: number; stores: number } }[];
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={`${n}. ${title}`} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useTranslation();
  const f = useFormat();
  const { session } = useSession();
  const { data, error, loading, reload } = useApi<Report>(`/api/reports/${id}`);
  if (error?.code === "plan_required") return <PlanGate feature={t("reports.kinds.competitive")} allowed={false}>{null}</PlanGate>;
  if (error) return <ErrorState message={error.status === 404 ? t("errors.notFound") : undefined} onRetry={reload} />;
  if (loading || !data) return <Skeleton className="h-[600px] rounded-xl" />;
  const title = data.category ? t("reports.marketTitle", { category: t(`categories.${data.category}`) }) : t(`reports.kinds.${data.kind}`);
  const o = data.overview;
  const canExport = session?.entitlements.exports;

  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="report">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link href="/app/reports" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-fg">
          <ArrowLeft className="size-4" /> {t("reports.back")}
        </Link>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.print()} data-testid="export-pdf">
            <Printer /> {t("reports.exportPdf")}
          </Button>
          {canExport ? (
            <a href={`/api/reports/${id}/csv`} className={buttonVariants({ variant: "secondary" })} data-testid="export-report-csv">
              <Download /> CSV
            </a>
          ) : (
            <Button variant="secondary" disabled title={t("billing.exportLocked")}>
              <Download /> CSV
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-accent/20 via-surface to-accent-2/10 p-6">
          <Logo />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted">{t("reports.generatedMeta", { date: f.dateTime(data.generatedAt), asOf: f.date(data.asOf) })}</p>
          <div className="mt-3">
            <ProvenanceBadge kind={data.dataMode === "demo" ? "demo" : "measured"} />
          </div>
          {data.dataMode === "demo" && <p className="mt-3 text-xs text-warn">{t("reports.demoWarning")}</p>}
        </div>
      </Card>

      <Section n={1} title={t("reports.sections.overview")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [t("reports.ov.products"), f.number(o.products), t("reports.ov.scored", { n: o.scored })],
            [t("reports.ov.ads"), f.number(o.adsObserved), t("reports.ov.active", { n: o.adsActive })],
            [t("reports.ov.advertisers"), f.number(o.advertisers), ""],
            [t("reports.ov.stores"), f.number(o.stores), ""],
          ].map(([label, value, hint]) => (
            <div key={label} className="rounded-lg border border-border p-3">
              <div className="text-xs text-subtle">{label}</div>
              <div className="num mt-1 text-xl font-semibold">{value}</div>
              {hint ? <div className="text-[11px] text-subtle">{hint}</div> : null}
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">
          {t("reports.ov.summary", { margin: o.medianMargin == null ? "—" : f.pct(o.medianMargin * 100), growth: o.growth == null ? t("trend.status.insufficient_history") : f.pct(o.growth, 0, true) })}
        </p>
      </Section>

      <Section n={2} title={t("reports.sections.opportunities")}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="table-th">{t("products.product")}</th>
                <th className="table-th">{t("score.title")}</th>
                <th className="table-th">{t("products.trend30")}</th>
                <th className="table-th">{t("products.margin")}</th>
                <th className="table-th">{t("products.ads")}</th>
                <th className="table-th">{t("products.competition")}</th>
              </tr>
            </thead>
            <tbody>
              {data.opportunities.map((p) => (
                <tr key={p.id} className="border-b border-border/50 last:border-0">
                  <td className="table-td">
                    <Link href={`/app/products/${p.id}`} className="hover:text-accent">
                      {p.name}
                    </Link>
                  </td>
                  <td className="table-td">
                    <ScoreBadge score={p.score} />
                  </td>
                  <td className="table-td">
                    <TrendPill pct={p.trendGrowth} />
                  </td>
                  <td className="table-td num">{p.grossMargin == null ? "—" : f.pct(p.grossMargin * 100)}</td>
                  <td className="table-td num">{p.ads}</td>
                  <td className="table-td">
                    <CompetitionBadge level={p.competition} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section n={3} title={t("reports.sections.trends")}>
        <TimeSeriesChart
          data={data.trendSeries}
          height={240}
          series={Object.keys(data.trendSeries[0] ?? {})
            .filter((k) => k !== "date")
            .map((k) => ({ key: k, label: t(`categories.${k}`) }))}
        />
      </Section>

      <Section n={4} title={t("reports.sections.ads")}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.adExamples.map((a) => (
            <li key={a.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex justify-between gap-2 font-medium">
                <span>{a.advertiser}</span>
                <span className="text-xs text-subtle">{t(`platforms.${a.platform}`)} · {t(`formats.${a.format}`)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{a.excerpt}</p>
              <p className="mt-1 text-[11px] text-subtle">
                {f.date(a.firstSeen)} → {f.date(a.lastSeen)}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-subtle">{t("creative.durationNotProof")}</p>
      </Section>

      <Section n={5} title={t("reports.sections.competitors")}>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="table-th">{t("stores.store")}</th>
              <th className="table-th">{t("reports.relevantListings")}</th>
              <th className="table-th">{t("stores.publicListings")}</th>
              <th className="table-th">{t("stores.adsObserved")}</th>
            </tr>
          </thead>
          <tbody>
            {data.competitors.map((s) => (
              <tr key={s.id} className="border-b border-border/50 last:border-0">
                <td className="table-td">
                  <Link href={`/app/stores/${s.id}`} className="hover:text-accent">
                    {s.name}
                  </Link>
                  <div className="text-xs text-subtle">{s.domain}</div>
                </td>
                <td className="table-td num">{s.relevantListings}</td>
                <td className="table-td num">{s.listings}</td>
                <td className="table-td num">{s.ads}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section n={6} title={t("reports.sections.margins")}>
        <SimpleBarChart data={data.margins.buckets} xKey="label" yKey="count" label={t("reports.productsCount")} height={200} />
        <p className="mt-2 text-xs text-subtle">{t("reports.marginNote")}</p>
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section n={7} title={t("reports.sections.risks")}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
            {data.risks.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </Section>
        <Section n={8} title={t("reports.sections.experiments")}>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
            {data.experiments.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ol>
        </Section>
      </div>

      <Section n={9} title={t("reports.sections.sources")}>
        {/* One row per connector and data kind, computed from the records this report uses. */}
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="report-sources">
            <thead>
              <tr className="border-b border-border">
                <th className="table-th">{t("reports.source")}</th>
                <th className="table-th">{t("reports.dataKind")}</th>
                <th className="table-th">{t("reports.records")}</th>
                <th className="table-th">{t("reports.collected")}</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s) => (
                <tr key={`${s.connector}-${s.kind}`}>
                  <td className="table-td">{t(`connectors.names.${s.connector}`, { defaultValue: s.connector })}</td>
                  <td className="table-td">
                    <ProvenanceBadge kind={s.kind} />
                  </td>
                  <td className="table-td text-xs text-muted">
                    {(["products", "ads", "observations", "stores"] as const)
                      .filter((k) => s.records[k] > 0)
                      .map((k) => t(`reports.recordTypes.${k}`, { n: f.number(s.records[k]) }))
                      .join(" · ")}
                  </td>
                  <td className="table-td text-muted">
                    {f.date(s.from)} → {f.date(s.to)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.sources.length ? <p className="text-sm text-subtle">{t("reports.noSources")}</p> : null}
        <p className="mt-2 text-[11px] text-subtle">{t("reports.sourcesNote")}</p>
        <p className="mt-3 text-[11px] text-subtle">{t("reports.disclaimer")}</p>
      </Section>
    </div>
  );
}
