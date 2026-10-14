"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  Baby,
  Briefcase,
  Car,
  ChefHat,
  Cpu,
  Dumbbell,
  HeartPulse,
  Info,
  Lock,
  Minus,
  PawPrint,
  Shirt,
  Sofa,
  Sparkle,
  Tent,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Category, CompetitionLevel, Confidence, Platform, ProvenanceKind } from "@/lib/types";
import type { TrendValue } from "@/lib/scoring";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { buttonVariants } from "@/components/ui/button";

export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  fitness: Dumbbell,
  home: Sofa,
  kitchen: ChefHat,
  beauty: Sparkle,
  pets: PawPrint,
  tech: Cpu,
  outdoor: Tent,
  baby: Baby,
  fashion: Shirt,
  wellness: HeartPulse,
  auto: Car,
  office: Briefcase,
};

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1.5">{eyebrow}</div> : null}
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="no-print flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Generated, copyright-free thumbnail: category glyph on a deterministic gradient. */
export function Thumb({ category, hue, className, label }: { category: Category; hue: number; className?: string; label?: string }) {
  const Icon = CATEGORY_ICON[category] ?? Sparkle;
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative flex items-center justify-center overflow-hidden rounded-lg", className)}
      style={{ background: `radial-gradient(120% 120% at 20% 10%, hsl(${hue} 70% 34% / .9), hsl(${(hue + 50) % 360} 60% 14%) 70%)` }}
    >
      <div className="bg-grid absolute inset-0 opacity-30" />
      <Icon className="relative size-1/3 max-h-12 max-w-12 text-white/85" strokeWidth={1.5} />
    </div>
  );
}

export function scoreTone(score: number | null) {
  if (score == null) return "neutral" as const;
  if (score >= 70) return "good" as const;
  if (score >= 50) return "accent" as const;
  return "serious" as const;
}

export function ScoreBadge({ score, className }: { score: number | null; className?: string }) {
  const { t } = useTranslation();
  if (score == null)
    return (
      <Tooltip content={t("score.insufficientTip")}>
        <Badge tone="neutral" className={className}>
          {t("score.insufficient")}
        </Badge>
      </Tooltip>
    );
  return (
    <Badge tone={scoreTone(score)} className={cn("num text-[12px]", className)}>
      {score}
      <span className="font-normal opacity-60">/100</span>
    </Badge>
  );
}

export function ScoreRing({ score, size = 96 }: { score: number | null; size?: number }) {
  const { t } = useTranslation();
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  const color = { good: "#0ca30c", accent: "rgb(var(--accent))", serious: "#ec835a", neutral: "rgb(var(--subtle))" }[tone];
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(var(--surface-3))" strokeWidth="6" fill="none" />
        {score != null && <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="6" fill="none" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {score == null ? (
          <span className="px-2 text-center text-[11px] leading-tight text-subtle">{t("score.insufficient")}</span>
        ) : (
          <>
            <span className="text-2xl font-semibold">{score}</span>
            <span className="text-[10px] text-subtle">/ 100</span>
          </>
        )}
      </div>
    </div>
  );
}

export function ProvenanceBadge({ kind, className }: { kind: ProvenanceKind; className?: string }) {
  const { t } = useTranslation();
  const tone = { measured: "good", estimate: "warn", ai: "purple", demo: "demo" }[kind] as "good" | "warn" | "purple" | "demo";
  return (
    <Tooltip content={t(`provenance.${kind}Tip`)}>
      <Badge tone={tone} className={className}>
        {t(`provenance.${kind}`)}
      </Badge>
    </Tooltip>
  );
}

export function TrendPill({ value, pct, className }: { value?: TrendValue; pct?: number | null; className?: string }) {
  const { t } = useTranslation();
  const f = useFormat();
  const p = value ? value.pct : pct ?? null;
  if (p == null) {
    const reason = value?.status ?? "insufficient_history";
    return (
      <Tooltip content={t(`trend.status.${reason}Tip`)}>
        <span className={cn("inline-flex items-center gap-1 text-xs text-subtle", className)}>
          <Minus className="size-3" />
          {t(`trend.status.${reason}`)}
        </span>
      </Tooltip>
    );
  }
  const up = p > 0;
  const Icon = up ? ArrowUpRight : p < 0 ? ArrowDownRight : Minus;
  return (
    <span className={cn("num inline-flex items-center gap-0.5 text-xs font-medium", up ? "text-[#3fcf3f]" : p < 0 ? "text-[#f07a7a]" : "text-muted", className)}>
      <Icon className="size-3.5" />
      {f.pct(p, Math.abs(p) < 10 ? 1 : 0, true)}
    </span>
  );
}

export function CompetitionBadge({ level }: { level: CompetitionLevel }) {
  const { t } = useTranslation();
  const tone = { low: "good", medium: "warn", high: "critical" }[level] as "good" | "warn" | "critical";
  return (
    <Tooltip content={t("competition.tip")}>
      <Badge tone={tone}>{t(`competition.${level}`)}</Badge>
    </Tooltip>
  );
}

export function ConfidenceBadge({ level }: { level: Confidence }) {
  const { t } = useTranslation();
  const tone = { high: "good", medium: "warn", low: "serious" }[level] as "good" | "warn" | "serious";
  return (
    <Tooltip content={t("confidence.tip")}>
      <Badge tone={tone}>{t("confidence.label", { level: t(`confidence.${level}`) })}</Badge>
    </Tooltip>
  );
}

const PLATFORM_COLOR: Record<Platform, string> = { meta: "#3987e5", tiktok: "#e66767", pinterest: "#d55181", google: "#199e70", snapchat: "#c98500" };

export function PlatformBadge({ platform }: { platform: Platform }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="size-2 rounded-full" style={{ background: PLATFORM_COLOR[platform] }} aria-hidden />
      {t(`platforms.${platform}`)}
    </span>
  );
}

export function InfoTip({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      <button type="button" className="focus-ring inline-flex rounded text-subtle hover:text-fg" aria-label={typeof content === "string" ? content : "info"}>
        <Info className="size-3.5" />
      </button>
    </Tooltip>
  );
}

export function Stat({ label, value, hint, tip, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tip?: ReactNode; className?: string }) {
  return (
    <div className={cn("card p-4", className)}>
      <div className="flex items-center gap-1.5 text-xs text-subtle">
        {label}
        {tip ? <InfoTip content={tip} /> : null}
      </div>
      <div className="num mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="mt-1 text-xs text-subtle">{hint}</div> : null}
    </div>
  );
}

export function KeyValue({ label, children, tip }: { label: ReactNode; children: ReactNode; tip?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="flex items-center gap-1.5 text-subtle">
        {label}
        {tip ? <InfoTip content={tip} /> : null}
      </dt>
      <dd className="text-right text-fg">{children}</dd>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="mt-6 flex items-center justify-between gap-3 text-sm text-subtle">
      <span>{t("common.pageOf", { page, pages, total })}</span>
      <div className="flex gap-2">
        <button className={buttonVariants({ variant: "secondary", size: "sm" })} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t("common.previous")}
        </button>
        <button className={buttonVariants({ variant: "secondary", size: "sm" })} disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t("common.next")}
        </button>
      </div>
    </div>
  );
}

export function PlanGate({ feature, children, allowed }: { feature: string; children: ReactNode; allowed: boolean }) {
  const { t } = useTranslation();
  if (allowed) return <>{children}</>;
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
        <Lock className="size-5" />
      </div>
      <p className="text-sm font-medium">{t("billing.gateTitle", { feature })}</p>
      <p className="mt-1 max-w-md text-sm text-subtle">{t("billing.gateText")}</p>
      <Link href="/app/settings?tab=billing" className={cn(buttonVariants({ size: "sm" }), "mt-4")}>
        {t("billing.upgrade")}
      </Link>
    </div>
  );
}

export function SourceLine({ connector, observedAt }: { connector: string; observedAt: string }) {
  const { t } = useTranslation();
  const f = useFormat();
  return (
    <span className="text-[11px] text-subtle">
      {t("provenance.sourceLine", { source: t(`connectors.names.${connector}`, { defaultValue: connector }), date: f.date(observedAt.slice(0, 10)) })}
    </span>
  );
}
