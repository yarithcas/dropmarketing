"use client";

import Link from "next/link";
import { AlertTriangle, BadgeCheck, FlaskConical, HelpCircle, Info, Lightbulb, Link2, ListChecks, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AnalystResponse, Text } from "@/lib/analyst/types";
import { useFormat } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge, ProvenanceBadge, ScoreBadge } from "./bits";

/** Renders either literal AI text or an i18n key (rule engine) in the current language. */
export function useText() {
  const { t } = useTranslation();
  const f = useFormat();
  return (x: Text) => {
    if (typeof x === "string") return x;
    const params: Record<string, string | number> = { ...(x.params ?? {}) };
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === "number" && (k === "pct" || k === "price" || k === "cost")) params[k] = k === "pct" ? f.number(v, 0) : f.number(v, 2);
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) params[k] = f.date(v);
    }
    if (typeof params.category === "string" && params.category) params.category = t(`categories.${params.category}`, { defaultValue: params.category });
    if (typeof params.format === "string" && params.format) params.format = t(`formats.${params.format}`, { defaultValue: params.format });
    if (typeof params.country === "string" && /^[A-Z]{2}$/.test(params.country)) params.country = t(`countries.${params.country}`, { defaultValue: params.country });
    if (typeof params.triggers === "string" && params.triggers)
      params.triggers = params.triggers
        .split(", ")
        .map((k) => t(`creative.triggerNames.${k}`, { defaultValue: k }))
        .join(", ");
    if (typeof params.categories === "string" && params.categories)
      params.categories = params.categories
        .split(", ")
        .map((c) => t(`categories.${c}`, { defaultValue: c }))
        .join(", ");
    return t(x.key, params);
  };
}

function Bullets({ icon: Icon, title, items, color }: { icon: typeof Lightbulb; title: string; items: Text[]; color: string }) {
  const tx = useText();
  if (!items.length) return null;
  return (
    <div>
      <div className={`mb-1.5 flex items-center gap-1.5 text-xs font-medium ${color}`}>
        <Icon className="size-3.5" /> {title}
      </div>
      <ul className="space-y-1 pl-5 text-sm text-muted">
        {items.map((it, i) => (
          <li key={i} className="list-disc">
            {tx(it)}
          </li>
        ))}
      </ul>
    </div>
  );
}

type ProductRef = { id: string; name: string };

/** Optional hooks into the page's product context (the analyst page provides them; embedded results do not). */
export interface AnalystResultActions {
  /** Products already in the context, so suggestions show as added. */
  pickedIds?: string[];
  onAddProduct?: (p: ProductRef) => void;
  /** Moves focus to the product context picker. */
  onOpenContext?: () => void;
  /** Re-asks the question with these suggestions added to the context. */
  onCompare?: (ps: ProductRef[]) => void;
}

/** "Select products first" state: the question cannot be answered with the current context. */
function NeedsProducts({ result, actions }: { result: AnalystResponse; actions: AnalystResultActions }) {
  const { t } = useTranslation();
  const tx = useText();
  const need = result.needsProducts!;
  const suggestions = result.suggestions ?? [];
  const picked = new Set(actions.pickedIds ?? []);
  const canCompare = need.selected + suggestions.length >= need.min;
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4" data-testid="analyst-needs-products">
      <div className="flex items-start gap-2.5">
        <ListChecks className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium text-fg">{t("analyst.needsProducts.title", { min: need.min, max: need.max })}</p>
          <p className="text-muted">{need.selected ? t("analyst.needsProducts.textSome", { count: need.selected }) : t("analyst.needsProducts.textNone")}</p>
        </div>
      </div>
      {actions.onOpenContext ? (
        <Button size="sm" variant="secondary" className="mt-3" onClick={actions.onOpenContext} data-testid="analyst-open-context">
          <Plus /> {t("analyst.needsProducts.choose")}
        </Button>
      ) : null}
      {suggestions.length > 0 && (
        <div className="mt-4">
          <div className="label mb-1.5">{t("analyst.needsProducts.suggestionsTitle")}</div>
          <ul className="divide-y divide-border/60 rounded-lg border border-border bg-surface/60">
            {suggestions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <Link href={`/app/products/${s.id}`} className="text-sm font-medium hover:text-accent">
                  {s.name}
                </Link>
                <ScoreBadge score={s.score} />
                <span className="min-w-0 basis-full text-xs text-subtle sm:basis-0 sm:flex-1">{tx(s.reason)}</span>
                {actions.onAddProduct ? (
                  <Button size="sm" variant="ghost" disabled={picked.has(s.id) || picked.size >= need.max} onClick={() => actions.onAddProduct!({ id: s.id, name: s.name })}>
                    {picked.has(s.id) ? t("analyst.needsProducts.added") : t("competitors.add")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-subtle">{t("analyst.needsProducts.suggestionsNote")}</p>
          {actions.onCompare && canCompare ? (
            <Button size="sm" className="mt-3" onClick={() => actions.onCompare!(suggestions.map((s) => ({ id: s.id, name: s.name })))} data-testid="analyst-compare-suggestions">
              {need.selected ? t("analyst.needsProducts.compareWith", { count: suggestions.length }) : t("analyst.needsProducts.compareSuggested", { count: suggestions.length })}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function AnalystResult({ result, compact = false, actions = {} }: { result: AnalystResponse; compact?: boolean; actions?: AnalystResultActions }) {
  const { t } = useTranslation();
  const tx = useText();
  return (
    <div className="space-y-4" data-testid="analyst-result">
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceBadge kind="ai" />
        <Badge tone={result.engine === "claude" ? "purple" : "neutral"}>{t(`analyst.engine.${result.engine}`)}</Badge>
        <Badge>{t(`analyst.intents.${result.intent}`)}</Badge>
      </div>
      {result.notice ? <p className="rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">{tx(result.notice)}</p> : null}
      <p className="text-sm leading-relaxed text-fg">{tx(result.summary)}</p>
      {result.contextNote ? (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-xs text-muted" data-testid="analyst-context-note">
          <Info className="mt-px size-3.5 shrink-0 text-accent" />
          {tx(result.contextNote)}
        </p>
      ) : null}
      {result.needsProducts ? <NeedsProducts result={result} actions={actions} /> : null}

      {result.recommendations.map((r) => (
        <div key={r.productId} className="rounded-xl border border-border bg-surface-2/60 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Link href={`/app/products/${r.productId}`} className="text-sm font-semibold hover:text-accent">
              {r.productName}
            </Link>
            <ScoreBadge score={r.score} />
            <ConfidenceBadge level={r.confidence} />
          </div>
          <div className={compact ? "grid gap-4 md:grid-cols-2" : "grid gap-4 md:grid-cols-2 xl:grid-cols-3"}>
            <Bullets icon={Lightbulb} title={t("analyst.labels.why")} items={r.why} color="text-accent" />
            <Bullets icon={BadgeCheck} title={t("analyst.labels.evidence")} items={r.evidence} color="text-[#3fcf3f]" />
            {/* Risks are always shown; an engine that found none still gets an explicit statement. */}
            <Bullets icon={AlertTriangle} title={t("analyst.labels.risks")} items={r.risks.length ? r.risks : [{ key: "analyst.risks.fallback.none" }]} color="text-[#f07a7a]" />
            <Bullets icon={HelpCircle} title={t("analyst.labels.missing")} items={r.missing} color="text-warn" />
            <Bullets icon={FlaskConical} title={t("analyst.labels.validation")} items={r.validation} color="text-accent-2" />
          </div>
        </div>
      ))}

      {result.sections.map((s, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface-2/60 p-4">
          <div className="mb-2 text-sm font-semibold">{tx(s.title)}</div>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
            {s.items.map((it, j) => (
              <li key={j}>{tx(it)}</li>
            ))}
          </ol>
        </div>
      ))}

      {result.sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
          <Link2 className="size-3.5" /> {t("analyst.labels.sources")}:
          {result.sources.map((s) => (
            <Link key={s.href} href={s.href} className="rounded border border-border px-1.5 py-0.5 text-muted hover:text-accent">
              {s.label}
            </Link>
          ))}
        </div>
      )}
      <p className="text-[11px] text-subtle">{tx(result.disclaimer)}</p>
    </div>
  );
}
