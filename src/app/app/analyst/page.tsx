"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Loader2, Package, Send, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnalystResult } from "@/components/app/analyst-result";
import { PageHeader } from "@/components/app/bits";
import { DebouncedInput } from "@/components/app/debounced-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/client/session";
import { ApiError, apiFetch, useApi } from "@/lib/client/use-api";
import { useUrlState } from "@/lib/client/use-url-state";
import { useLocale } from "@/lib/i18n/provider";
import type { AnalystResponse } from "@/lib/analyst/types";
import type { ProductWithMetrics } from "@/lib/types";

const EXAMPLES = ["fitness", "moderate", "analyze", "compare", "angles", "risks", "checklist"] as const;

interface Turn {
  id: number;
  question: string;
  products: { id: string; name: string }[];
  result?: AnalystResponse;
  error?: string;
}

function AnalystInner() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { session, refresh } = useSession();
  const url = useUrlState();
  const [question, setQuestion] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const { data: searchResults } = useApi<{ items: ProductWithMetrics[] }>(search.length >= 2 ? `/api/products?pageSize=6&q=${encodeURIComponent(search)}` : null);

  // Preselect products passed via ?products=a,b
  const preset = url.get("products");
  const { data: presetData } = useApi<{ items: ProductWithMetrics[] }>(preset ? `/api/products/batch?ids=${preset}` : null);
  useEffect(() => {
    if (presetData?.items.length) setPicked(presetData.items.slice(0, 5).map((p) => ({ id: p.id, name: p.name })));
  }, [presetData]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [turns]);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    const id = Date.now();
    const products = picked;
    setTurns((ts) => [...ts, { id, question: q, products }]);
    setQuestion("");
    setBusy(true);
    try {
      const result = await apiFetch<AnalystResponse>("/api/ai/analyst", { method: "POST", body: JSON.stringify({ question: q, productIds: products.map((p) => p.id), locale }) });
      setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, result } : x)));
    } catch (e) {
      const msg = e instanceof ApiError && e.code === "limit_reached" ? t("billing.limitReached") : t("errors.generic");
      setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, error: msg } : x)));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const usage = session?.usage.ai_query;

  return (
    <div>
      <PageHeader
        title={t("analyst.title")}
        description={t("analyst.subtitle")}
        eyebrow={
          session ? (
            <div className="flex flex-wrap gap-2">
              <Badge tone={session.features.ai ? "purple" : "neutral"}>{session.features.ai ? t("analyst.engine.claude") : t("analyst.engine.rules")}</Badge>
              {usage && <Badge>{t("analyst.usage", { used: usage.used, limit: usage.limit })}</Badge>}
            </div>
          ) : null
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          {turns.length === 0 ? (
            <Card>
              <CardBody className="space-y-4 py-8 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-2 text-white">
                  <Sparkles className="size-6" />
                </div>
                <div>
                  <p className="text-base font-medium">{t("analyst.emptyTitle")}</p>
                  <p className="mx-auto mt-1 max-w-lg text-sm text-subtle">{t("analyst.emptyText")}</p>
                </div>
                <div className="mx-auto flex max-w-2xl flex-wrap justify-center gap-2">
                  {EXAMPLES.map((ex) => (
                    <button key={ex} onClick={() => ask(t(`analyst.examples.${ex}`))} className="focus-ring rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-muted hover:border-accent/40 hover:text-fg" data-testid="analyst-example">
                      {t(`analyst.examples.${ex}`)}
                    </button>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : (
            turns.map((turn) => (
              <div key={turn.id} className="space-y-3">
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent/15 px-4 py-2.5 text-sm">
                  {turn.question}
                  {turn.products.length > 0 && <div className="mt-1 text-[11px] text-muted">{t("analyst.withProducts", { list: turn.products.map((p) => p.name).join(", ") })}</div>}
                </div>
                <Card>
                  <CardBody>
                    {turn.result ? (
                      <AnalystResult result={turn.result} />
                    ) : turn.error ? (
                      <p className="text-sm text-critical">{turn.error}</p>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-subtle">
                          <Loader2 className="size-4 animate-spin" /> {t("analyst.thinking")}
                        </div>
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-24" />
                      </div>
                    )}
                  </CardBody>
                </Card>
              </div>
            ))
          )}
          <div ref={bottom} />
          <Card className="sticky bottom-4 p-3 shadow-2xl">
            {picked.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {picked.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs">
                    <Package className="size-3" /> {p.name}
                    <button onClick={() => setPicked((ps) => ps.filter((x) => x.id !== p.id))} aria-label={t("common.remove")}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                ask(question);
              }}
            >
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask(question);
                  }
                }}
                rows={2}
                maxLength={1000}
                placeholder={t("analyst.placeholder")}
                className="min-h-[44px] resize-none"
                aria-label={t("analyst.placeholder")}
                data-testid="analyst-input"
              />
              <Button type="submit" size="icon" disabled={busy || !question.trim()} aria-label={t("analyst.send")}>
                {busy ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </form>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("analyst.contextTitle")} description={t("analyst.contextDesc")} />
            <CardBody className="space-y-2">
              <DebouncedInput value={search} onCommit={setSearch} placeholder={t("products.searchPlaceholder")} aria-label={t("products.searchPlaceholder")} />
              <ul className="divide-y divide-border/60">
                {(searchResults?.items ?? []).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="truncate">{p.name}</span>
                    <Button size="sm" variant="secondary" disabled={picked.some((x) => x.id === p.id) || picked.length >= 5} onClick={() => setPicked((ps) => [...ps, { id: p.id, name: p.name }])}>
                      {t("competitors.add")}
                    </Button>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card className="p-4 text-xs leading-relaxed text-subtle">
            <p className="mb-1 font-medium text-muted">{t("analyst.howTitle")}</p>
            <p>{t("analyst.howText")}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function AnalystPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <AnalystInner />
    </Suspense>
  );
}
