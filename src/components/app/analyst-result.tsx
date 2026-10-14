"use client";

import Link from "next/link";
import { AlertTriangle, BadgeCheck, FlaskConical, HelpCircle, Lightbulb, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AnalystResponse, Text } from "@/lib/analyst/types";
import { useFormat } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
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

export function AnalystResult({ result, compact = false }: { result: AnalystResponse; compact?: boolean }) {
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
            <Bullets icon={AlertTriangle} title={t("analyst.labels.risks")} items={r.risks} color="text-[#f07a7a]" />
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
