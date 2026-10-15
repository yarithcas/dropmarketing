"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Clapperboard, Copy, Lightbulb, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AdLibraryLink, CreativePreview, MatchEstimateTag } from "@/components/app/ad-card";
import { useText } from "@/components/app/analyst-result";
import { AdMediaViewer, isWatchable } from "@/components/app/ad-player";
import { PageHeader, PlanGate, PlatformBadge, ProvenanceBadge, ScoreBadge, SourceLine } from "@/components/app/bits";
import { SaveButton } from "@/components/app/save";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/client/session";
import { apiFetch, useApi } from "@/lib/client/use-api";
import { errorKey } from "@/lib/client/errors";
import { useUrlState } from "@/lib/client/use-url-state";
import { useWorkspace } from "@/lib/client/workspace";
import { useFormat } from "@/lib/format";
import { useLocale } from "@/lib/i18n/provider";
import { daysBetween } from "@/lib/dates";
import { formatInfo, type CreativeAnalysis } from "@/lib/analyst/creative";
import type { Advertisement, ProductWithMetrics, Store } from "@/lib/types";
import { cn } from "@/lib/cn";

interface AdDetail {
  ad: Advertisement;
  product: ProductWithMetrics | null;
  store: Store | null;
  related: Advertisement[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 p-3">
      <div className="label mb-1.5">{title}</div>
      <div className="text-sm text-fg">{children}</div>
    </div>
  );
}

function Viewer({ adId }: { adId: string }) {
  const { t } = useTranslation();
  const f = useFormat();
  const tx = useText();
  const toast = useToast();
  const { locale } = useLocale();
  const { session } = useSession();
  const { data, error, loading, reload } = useApi<AdDetail>(`/api/ads/${adId}`);
  const [analysis, setAnalysis] = useState<CreativeAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setAnalysis(null), [adId]);

  if (error) return <ErrorState message={error.status === 404 ? t("errors.notFound") : undefined} onRetry={reload} />;
  if (loading || !data) return <Skeleton className="h-[520px] rounded-xl" />;
  const { ad, product } = data;
  const allowed = session?.entitlements.creativeAnalysis ?? false;
  // Some sources (e.g. the TikTok query API) disclose no ad text: there is nothing to analyze.
  const hasText = Boolean(ad.headline.trim() || ad.copy.trim());

  const run = async () => {
    setBusy(true);
    try {
      setAnalysis(await apiFetch<CreativeAnalysis>("/api/ai/creative", { method: "POST", body: JSON.stringify({ adId: ad.id, locale }) }));
    } catch (e) {
      toast(t(errorKey(e)), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="creative-viewer">
      <Card>
        <div className="grid gap-0 md:grid-cols-[minmax(0,280px)_1fr]">
          {isWatchable(ad) ? (
            <div className="border-b border-border p-3 md:border-b-0 md:border-r" data-testid="creative-player">
              <AdMediaViewer ad={ad} productName={product?.name} />
            </div>
          ) : (
            <CreativePreview ad={ad} className="h-64 rounded-none md:h-full md:min-h-[300px] md:rounded-l-xl" />
          )}
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-base font-semibold">{ad.advertiser}</div>
                <div className="mt-0.5 flex items-center gap-2">
                  <PlatformBadge platform={ad.platform} />
                  <Badge>{t(`formats.${ad.format}`)}</Badge>
                  <Badge>{ad.language ? ad.language.toUpperCase() : t("ads.languageUnknown")}</Badge>
                  {ad.placements?.length ? <span className="text-xs text-subtle">{ad.placements.map((p) => t(`placements.${p}`, { defaultValue: p })).join(" · ")}</span> : null}
                </div>
              </div>
              <div className="flex gap-2">
                <SaveButton type="ad" refId={ad.id} label={`${ad.advertiser} — ${ad.headline}`} preferSwipe />
              </div>
            </div>
            <div>
              <div className="label mb-1">{t("creative.headline")}</div>
              {ad.headline ? <p className="text-sm font-medium">{ad.headline}</p> : <p className="text-xs text-subtle">{t("ads.noCopy")}</p>}
            </div>
            <div>
              <div className="label mb-1 flex items-center gap-2">
                {t("creative.copy")}
                <button
                  className="text-subtle hover:text-fg"
                  aria-label={t("common.copy")}
                  onClick={() => {
                    navigator.clipboard?.writeText(ad.copy).then(() => toast(t("common.copied")), () => {});
                  }}
                >
                  <Copy className="size-3" />
                </button>
              </div>
              {ad.copy ? <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{ad.copy}</p> : <p className="text-xs text-subtle">{t("ads.noCopy")}</p>}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-subtle">{t("ads.firstSeen")}</dt>
                <dd>{f.date(ad.firstSeen)}</dd>
              </div>
              <div>
                <dt className="text-subtle">{t("ads.lastSeen")}</dt>
                <dd>{f.date(ad.lastSeen)}</dd>
              </div>
              <div>
                <dt className="text-subtle">{t("ads.observedFor")}</dt>
                <dd>{t("ads.days", { count: daysBetween(ad.firstSeen, ad.lastSeen) + 1 })}</dd>
              </div>
              <div>
                <dt className="text-subtle">{t("filters.cta")}</dt>
                <dd>{t(`cta.${ad.cta}`)}</dd>
              </div>
            </dl>
            {product && (
              <div className="flex items-center gap-2">
                <Link href={`/app/products/${product.id}`} className="flex items-center gap-2 text-xs text-accent hover:underline">
                  {t("ads.product")}: {product.name} <ScoreBadge score={product.score.overall} />
                </Link>
                <MatchEstimateTag ad={ad} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <ProvenanceBadge kind={ad.source.kind} />
              <SourceLine connector={ad.source.connector} observedAt={ad.source.observedAt} />
            </div>
            <AdLibraryLink ad={ad} />
            <p className="text-[11px] text-subtle">{t("creative.durationNotProof")}</p>
          </div>
        </div>
      </Card>

      <PlanGate feature={t("creative.title")} allowed={allowed}>
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Sparkles className="size-4 text-accent-2" /> {t("creative.analysisTitle")}
              </span>
            }
            description={t("creative.analysisDesc")}
            action={
              <Button size="sm" onClick={run} disabled={busy || !hasText} data-testid="run-creative-analysis">
                <Sparkles /> {busy ? t("common.loading") : analysis ? t("product.aiRegenerate") : t("creative.analyze")}
              </Button>
            }
          />
          <CardBody>
            {busy ? (
              <div className="grid gap-3 md:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : !analysis ? (
              <p className="text-sm text-subtle">{hasText ? t("creative.analysisEmpty") : t("creative.noCopyToAnalyze")}</p>
            ) : (
              <div className="space-y-4" data-testid="creative-analysis">
                <div className="flex flex-wrap gap-2">
                  <ProvenanceBadge kind="ai" />
                  <Badge tone={analysis.engine === "claude" ? "purple" : "neutral"}>{t(`analyst.engine.${analysis.engine}`)}</Badge>
                </div>
                {analysis.notice ? <p className="rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">{tx(analysis.notice)}</p> : null}
                {analysis.noCopy ? (
                  <p className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-xs text-muted" data-testid="creative-no-copy">
                    {t("creative.noCopy.banner")}
                  </p>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <Section title={t("creative.hook")}>
                    {analysis.noCopy ? <p className="text-subtle">{tx(analysis.hook)}</p> : <p>“{tx(analysis.hook)}”</p>}
                    {analysis.hookType ? (
                      <Badge tone="accent" className="mt-2">
                        {t(`creative.hookTypes.${analysis.hookType}`)}
                      </Badge>
                    ) : null}
                  </Section>
                  <Section title={t("creative.problem.title")}>{tx(analysis.problem)}</Section>
                  <Section title={t("creative.benefit.title")}>{tx(analysis.benefit)}</Section>
                  <Section title={t("creative.audience.title")}>{tx(analysis.audience)}</Section>
                  <Section title={t("creative.value.title")}>
                    <p>{tx(analysis.valueProposition)}</p>
                    {analysis.valueEvidence?.length ? (
                      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t("creative.value.evidence")}>
                        {analysis.valueEvidence.map((c) => (
                          <li key={`${c.kind}-${c.quote}`} className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted">
                            <span className="text-subtle">{t(`creative.cues.${c.kind}`)}</span> · “{c.quote}”
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </Section>
                  <Section title={t("creative.cta.title")}>{tx(analysis.cta)}</Section>
                  {/* Format as recorded by the source; never inferred from the creative. */}
                  <Section title={t("creative.formatInfo.title")}>{tx(analysis.format ?? formatInfo(ad))}</Section>
                  <Section title={t("creative.triggers")}>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.triggers.length ? analysis.triggers.map((tr) => <Badge key={tr}>{t(`creative.triggerNames.${tr}`)}</Badge>) : <span className="text-subtle">{t("common.none")}</span>}
                    </div>
                  </Section>
                  <Section title={t("creative.structure")}>
                    {analysis.structure ? <span className="font-medium">{t(`creative.structures.${analysis.structure}`)}</span> : <span className="text-subtle">{t("creative.notDeterminable")}</span>}
                  </Section>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[#3fcf3f]">
                      <ThumbsUp className="size-3.5" /> {t("creative.strengthsTitle")}
                    </div>
                    {analysis.strengths.length ? (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                        {analysis.strengths.map((s, i) => (
                          <li key={i}>{tx(s)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-subtle">{t("creative.notDeterminable")}</p>
                    )}
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[#f07a7a]">
                      <ThumbsDown className="size-3.5" /> {t("creative.weaknessesTitle")}
                    </div>
                    {analysis.weaknesses.length ? (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                        {analysis.weaknesses.map((s, i) => (
                          <li key={i}>{tx(s)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-subtle">{t("creative.notDeterminable")}</p>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-accent-2/30 bg-accent-2/5 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[#d3a9ff]">
                    <Lightbulb className="size-3.5" /> {t("creative.variationsTitle")}
                  </div>
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
                    {analysis.variations.map((s, i) => (
                      <li key={i}>{tx(s)}</li>
                    ))}
                  </ol>
                </div>
                <p className="text-[11px] text-subtle">{tx(analysis.disclaimer)}</p>
              </div>
            )}
          </CardBody>
        </Card>
      </PlanGate>

      {data.related.length > 0 && (
        <Card>
          <CardHeader title={t("creative.related")} />
          <ul className="grid gap-px sm:grid-cols-2 lg:grid-cols-3">
            {data.related.map((r) => (
              <li key={r.id}>
                <Link href={`/app/creatives?ad=${r.id}`} className="block p-4 hover:bg-surface-2">
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span className="truncate">{r.advertiser}</span>
                    <PlatformBadge platform={r.platform} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{r.headline}</p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function CreativesInner() {
  const { t } = useTranslation();
  const url = useUrlState();
  const { workspace } = useWorkspace();
  const [tab, setTab] = useState<"swipe" | "recent" | "long">(workspace.collections.find((c) => c.kind === "swipe")?.items.length ? "swipe" : "recent");
  const adId = url.get("ad");
  const { data } = useApi<{ items: Advertisement[] }>(tab === "swipe" ? null : `/api/ads?pageSize=20&sort=${tab === "long" ? "longest" : "newest"}&page=1`);
  const swipe = workspace.collections.find((c) => c.kind === "swipe");
  const list: { id: string; title: string; subtitle: string }[] =
    tab === "swipe" ? (swipe?.items ?? []).filter((i) => i.type === "ad").map((i) => ({ id: i.refId, title: i.label, subtitle: i.note })) : (data?.items ?? []).map((a) => ({ id: a.id, title: a.advertiser, subtitle: a.headline }));

  return (
    <div>
      <PageHeader title={t("creative.title")} description={t("creative.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <div className="border-b border-border p-3">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: "swipe", label: t("collections.swipeFile"), count: swipe?.items.length ?? 0 },
                { value: "recent", label: t("creative.tabs.recent") },
                { value: "long", label: t("creative.tabs.long") },
              ]}
            />
          </div>
          {list.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={<Clapperboard />} title={t("creative.swipeEmpty")} description={t("creative.swipeEmptyText")} action={<Link href="/app/ads" className="text-sm text-accent hover:underline">{t("nav.ads")}</Link>} />
            </div>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-border/70 overflow-y-auto">
              {list.map((it) => (
                <li key={it.id}>
                  <button
                    onClick={() => url.set({ ad: it.id }, { resetPage: false })}
                    className={cn("block w-full px-4 py-3 text-left hover:bg-surface-2", adId === it.id && "bg-surface-2 shadow-[inset_2px_0_0_rgb(var(--accent))]")}
                  >
                    <div className="truncate text-sm font-medium">{it.title}</div>
                    {it.subtitle ? <div className="mt-0.5 truncate text-xs text-subtle">{it.subtitle}</div> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="min-w-0">{adId ? <Viewer adId={adId} /> : <EmptyState icon={<Clapperboard />} title={t("creative.selectTitle")} description={t("creative.selectText")} />}</div>
      </div>
    </div>
  );
}

export default function CreativesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <CreativesInner />
    </Suspense>
  );
}
