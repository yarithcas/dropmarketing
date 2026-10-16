"use client";

import type { ReactNode } from "react";
import { Lock, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Chip } from "@/components/ui/chip";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

export function FilterGroup({ label, children, locked, className }: { label: string; children: ReactNode; locked?: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1.5">
        <span className="label">{label}</span>
        {locked && (
          <Tooltip content={t("billing.advancedFilterLocked")}>
            <Lock className="size-3 text-accent" aria-label={t("billing.advancedFilterLocked")} tabIndex={0} />
          </Tooltip>
        )}
      </div>
      {/* A disabled fieldset disables every nested chip/input natively; the title explains why on hover. */}
      <fieldset disabled={locked} title={locked ? t("billing.advancedFilterLocked") : undefined} className={cn("min-w-0", locked && "opacity-40")}>
        {children}
      </fieldset>
    </div>
  );
}

export function ChipSet({ values, active, onToggle, render }: { values: readonly string[]; active: string[]; onToggle: (v: string) => void; render: (v: string) => string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <Chip key={v} active={active.includes(v)} onClick={() => onToggle(v)}>
          {render(v)}
        </Chip>
      ))}
    </div>
  );
}

export function ResetFilters({ onReset, count }: { onReset: () => void; count: number }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <button type="button" onClick={onReset} className="focus-ring tap inline-flex items-center gap-1 rounded text-xs text-accent underline-offset-4 transition-colors hover:underline active:text-accent/80">
      <RotateCcw className="size-3" /> {t("filters.reset", { count })}
    </button>
  );
}
