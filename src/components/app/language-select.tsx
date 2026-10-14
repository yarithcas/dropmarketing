"use client";

import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocale } from "@/lib/i18n/provider";
import { LOCALE_LABEL, LOCALES, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/cn";

export function LanguageSelect({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { locale, setLocale } = useLocale();
  const { t } = useTranslation();
  return (
    <label className={cn("relative inline-flex items-center", className)}>
      <span className="sr-only">{t("settings.language")}</span>
      <Globe className="pointer-events-none absolute left-2.5 size-4 text-subtle" />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="focus-ring h-9 cursor-pointer appearance-none rounded-lg border border-border bg-surface-2 pl-8 pr-3 text-[13px] text-fg hover:bg-surface-3"
        aria-label={t("settings.language")}
        data-testid="language-select"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {compact ? l.toUpperCase() : LOCALE_LABEL[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
